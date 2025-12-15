import { verifyNvidiaPayloads } from "./nvidia";
import type { NvidiaVerificationInfo } from "./types";

/**
 * Attestation fetching for TEE signer verification
 *
 * Fetches the attestation report from NEAR AI and extracts
 * the list of valid TEE signing addresses.
 */

export interface ModelAttestation {
  signing_address: string;
  nvidia_payload?: string;
}

export interface AttestationReport {
  model_attestations?: ModelAttestation[];
}

export interface AttestationResult {
  teeAddresses: string[];
  hasNvidiaPayload: boolean;
  nvidiaPayloads: string[];
  nvidiaVerification?: NvidiaVerificationInfo;
  report: AttestationReport;
}

/**
 * Fetch attestation report and extract TEE signing addresses
 */
export async function fetchAttestation(
  model: string,
  options?: {
    baseUrl?: string;
    apiKey?: string;
    timeout?: number;
    verifyNvidia?: boolean;
  }
): Promise<AttestationResult> {
  const baseUrl =
    options?.baseUrl || process.env.NEAR_AI_URL || "https://cloud-api.near.ai";
  const apiKey = options?.apiKey || process.env.NEAR_AI_CLOUD_API_KEY;

  if (!apiKey) {
    throw new Error("NEAR AI API key not configured");
  }

  const url = `${baseUrl}/v1/attestation/report?model=${encodeURIComponent(
    model
  )}&signing_algo=ecdsa`;

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    options?.timeout ?? 10000
  );

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `Attestation fetch failed: ${response.status} ${response.statusText}`
      );
    }

    const report: AttestationReport = await response.json();

    // Extract unique signing addresses
    const teeAddresses: string[] = [];
    let hasNvidiaPayload = false;
    const nvidiaPayloads: string[] = [];

    for (const attestation of report.model_attestations || []) {
      if (
        attestation.signing_address &&
        !teeAddresses.includes(attestation.signing_address)
      ) {
        teeAddresses.push(attestation.signing_address);
      }
      if (attestation.nvidia_payload) {
        hasNvidiaPayload = true;
        nvidiaPayloads.push(attestation.nvidia_payload);
      }
    }

    let nvidiaVerification: NvidiaVerificationInfo | undefined;

    if (options?.verifyNvidia) {
      if (nvidiaPayloads.length > 0) {
        const { allPassed, results } = await verifyNvidiaPayloads(
          nvidiaPayloads,
          {
            timeout: options?.timeout,
          }
        );

        nvidiaVerification = {
          performed: true,
          payloadCount: nvidiaPayloads.length,
          allPassed,
          results: results.map((result) => ({
            verified: result.verified,
            overallResult: result.overallResult,
            error: result.error,
          })),
        };

        if (!allPassed) {
          const failedCount = results.filter((result) => !result.verified).length;
          throw new Error(
            `NVIDIA attestation verification failed: ${failedCount}/${results.length} payloads failed`
          );
        }
      } else {
        nvidiaVerification = {
          performed: false,
          payloadCount: 0,
          allPassed: true,
          error: "No NVIDIA payloads found in attestation report",
        };
      }
    }

    return {
      teeAddresses,
      hasNvidiaPayload,
      nvidiaPayloads,
      nvidiaVerification,
      report,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Check if an address is in the list of TEE addresses (case-insensitive)
 */
export function isAddressInTeeList(
  address: string,
  teeAddresses: string[]
): boolean {
  const normalizedAddress = address.toLowerCase();
  return teeAddresses.some((tee) => tee.toLowerCase() === normalizedAddress);
}
