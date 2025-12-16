import { verifyNvidiaPayloads } from "./nvidia";
import type { NvidiaVerificationInfo } from "./types";
import { logger } from "@/lib/logger";

/**
 * Attestation fetching for TEE signer verification
 *
 * Fetches the attestation report from NEAR AI and extracts
 * the list of valid TEE signing addresses.
 */

export interface ModelAttestation {
  signing_address?: string;
  nvidia_payload?: string;
  intel_quote?: string;
  event_log?: unknown;
  info?: {
    signing_address?: string;
    signingAddress?: string;
    [key: string]: unknown;
  };
}

export interface GatewayAttestation {
  signing_address?: string;
}

export interface AttestationReport {
  gateway_attestation?: GatewayAttestation;
  model_attestations?: ModelAttestation[];
}

export interface AttestationResult {
  teeAddresses: string[];
  hasNvidiaPayload: boolean;
  nvidiaPayloads: string[];
  nvidiaVerification?: NvidiaVerificationInfo;
  report: AttestationReport;
  raw: AttestationReport;
}

interface AddressSource {
  address: string;
  path: string;
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
    bypassCache?: boolean;
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

  logger.debug("[Agent] Fetching attestation report", { model });

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

    const data: AttestationReport = await response.json();

    const rawData: AttestationReport = data;
    const modelAttestations = data.model_attestations || [];

    logger.debug("[Agent] Attestation response structure", {
      rootKeys: Object.keys(data),
      gatewayHasSigningAddress: Boolean(
        data.gateway_attestation?.signing_address
      ),
      modelAttestationCount: modelAttestations.length,
    });

    // Extract unique signing addresses
    const teeAddresses: string[] = [];
    const signingAddressesFound: string[] = [];
    const addressSources: AddressSource[] = [];

    const recordSigningAddress = (address?: string) => {
      if (address && !signingAddressesFound.includes(address)) {
        signingAddressesFound.push(address);
      }
    };

    const addAddressFromPath = (address: string, path: string) => {
      addressSources.push({ address, path });
      recordSigningAddress(address);
      if (!teeAddresses.includes(address)) {
        teeAddresses.push(address);
      }
    };

    if (data.gateway_attestation?.signing_address) {
      addAddressFromPath(
        data.gateway_attestation.signing_address,
        "gateway_attestation.signing_address"
      );
    }
    let hasNvidiaPayload = false;
    const nvidiaPayloads: string[] = [];

    for (const [index, attestation] of modelAttestations.entries()) {
      const signingAddressPath =
        attestation.signing_address !== undefined
          ? {
              address: attestation.signing_address,
              path: `model_attestations[${index}].signing_address`,
            }
          : attestation.info?.signing_address
          ? {
              address: attestation.info.signing_address,
              path: `model_attestations[${index}].info.signing_address`,
            }
          : attestation.info?.signingAddress
          ? {
              address: attestation.info.signingAddress,
              path: `model_attestations[${index}].info.signingAddress`,
            }
          : null;

      if (signingAddressPath) {
        addAddressFromPath(signingAddressPath.address, signingAddressPath.path);
      }

      if (attestation.nvidia_payload) {
        hasNvidiaPayload = true;
        nvidiaPayloads.push(attestation.nvidia_payload);
      }
    }

    logger.debug("[Agent] TEE address stats", {
      uniqueTees: teeAddresses.length,
      signingAddressesFound: signingAddressesFound.length,
      sourceCount: addressSources.length,
    });

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
      report: data,
      raw: rawData,
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
