/**
 * NEAR AI Cloud verification helpers
 *
 */

import { createHash } from "crypto";
import { verifyMessage } from "ethers";
import type {
  SignatureData,
  HashValidationResult,
  SignatureValidationResult,
  VerificationResult,
  VerificationStatus,
  AttestationReport,
} from "./types";

const NEAR_AI_BASE_URL = "https://cloud-api.near.ai";

export const sha256 = (data: string): string =>
  createHash("sha256").update(data, "utf8").digest("hex");

export const extractChatId = (responseText: string): string | null => {
  try {
    const firstDataLine = responseText
      .split("\n")
      .find((line) => line.startsWith("data: {"));
    if (firstDataLine) {
      const json = JSON.parse(firstDataLine.substring(6));
      return json.id || null;
    }
    return null;
  } catch {
    return null;
  }
};

export const compareHashes = (
  signatureText: string,
  expectedRequestHash: string,
  expectedResponseHash: string
): HashValidationResult => {
  try {
    const hashParts = signatureText.split(":");
    if (hashParts.length !== 2) {
      return {
        valid: false,
        requestHashMatch: false,
        responseHashMatch: false,
        signedRequestHash: "",
        signedResponseHash: "",
        expectedRequestHash,
        expectedResponseHash,
        error: `Expected format "requestHash:responseHash", got ${hashParts.length} parts`,
      };
    }

    const [signedRequestHash, signedResponseHash] = hashParts;
    const requestHashMatch =
      signedRequestHash.toLowerCase() === expectedRequestHash.toLowerCase();
    const responseHashMatch =
      signedResponseHash.toLowerCase() === expectedResponseHash.toLowerCase();

    return {
      valid: requestHashMatch && responseHashMatch,
      requestHashMatch,
      responseHashMatch,
      signedRequestHash,
      signedResponseHash,
      expectedRequestHash,
      expectedResponseHash,
    };
  } catch (error) {
    return {
      valid: false,
      requestHashMatch: false,
      responseHashMatch: false,
      signedRequestHash: "",
      signedResponseHash: "",
      expectedRequestHash,
      expectedResponseHash,
      error: error instanceof Error ? error.message : "Hash comparison failed",
    };
  }
};

export const verifySignature = (
  message: string,
  signature: string,
  claimedSigningAddress: string,
  attestedAddresses?: string[]
): SignatureValidationResult => {
  try {
    const recoveredAddress = verifyMessage(message, signature);
    const normalizedRecovered = recoveredAddress.toLowerCase();
    const normalizedClaimed = claimedSigningAddress.toLowerCase();

    const signatureValid = normalizedRecovered === normalizedClaimed;

    let teeAttested = false;
    if (attestedAddresses?.length) {
      teeAttested = attestedAddresses
        .filter((addr) => addr.startsWith("0x") && addr.length === 42)
        .some((addr) => addr.toLowerCase() === normalizedRecovered);
    }

    return {
      valid: signatureValid,
      cryptographicallyValid: true,
      addressConsistent: signatureValid,
      teeAttested,
      recoveredAddress,
      claimedAddress: claimedSigningAddress,
      attestedAddresses: attestedAddresses ?? [],
    };
  } catch (error) {
    return {
      valid: false,
      cryptographicallyValid: false,
      addressConsistent: false,
      teeAttested: false,
      recoveredAddress: null,
      claimedAddress: claimedSigningAddress,
      attestedAddresses: attestedAddresses ?? [],
      error:
        error instanceof Error
          ? error.message
          : "Signature verification failed",
    };
  }
};

export const extractSigningAddresses = (
  attestation: AttestationReport
): string[] => {
  const addresses: string[] = [];
  const seen = new Set<string>();

  const addAddress = (addr: unknown) => {
    if (typeof addr !== "string" || !addr) return;
    const normalized = addr.toLowerCase();
    if (seen.has(normalized)) return;
    seen.add(normalized);
    addresses.push(addr);
  };

  if (Array.isArray(attestation.model_attestations)) {
    attestation.model_attestations.forEach((node) => {
      addAddress(node?.signing_address);
      addAddress(node?.signingAddress);
    });
  }

  if (attestation.gateway_attestation) {
    addAddress(attestation.gateway_attestation.signing_address);
    addAddress(attestation.gateway_attestation.signingAddress);
  }

  const anyAttestations = (attestation as any).all_attestations;
  if (Array.isArray(anyAttestations)) {
    anyAttestations.forEach((node: any) => {
      addAddress(node?.signing_address);
      addAddress(node?.signingAddress);
    });
  }

  addAddress((attestation as any).signing_address);
  addAddress((attestation as any).signingAddress);

  return addresses;
};

export const fetchAttestation = async (
  model: string,
  apiKey: string
): Promise<AttestationReport> => {
  const response = await fetch(
    `${NEAR_AI_BASE_URL}/v1/attestation/report?model=${encodeURIComponent(
      model
    )}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Attestation request failed: ${response.status}`);
  }

  return response.json();
};

export const fetchSignature = async (
  chatId: string,
  model: string,
  apiKey: string,
  signingAlgo: string = "ecdsa"
): Promise<SignatureData> => {
  const params = new URLSearchParams({ model, signing_algo: signingAlgo });

  const response = await fetch(
    `${NEAR_AI_BASE_URL}/v1/signature/${encodeURIComponent(chatId)}?${params}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    }
  );

  if (!response.ok) {
    throw new Error(
      `Signature fetch failed: ${response.status} ${response.statusText}`
    );
  }

  return response.json();
};

export const sendChatRequest = async (
  requestBody: string,
  apiKey: string
): Promise<{ responseText: string; chatId: string | null }> => {
  const response = await fetch(`${NEAR_AI_BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: requestBody,
  });

  if (!response.ok) {
    throw new Error(`Chat request failed: ${response.status}`);
  }

  const responseText = await response.text();
  const chatId = extractChatId(responseText);

  return { responseText, chatId };
};

const determineStatus = (
  hashValid: boolean,
  sigValid: SignatureValidationResult
): VerificationStatus => {
  if (!hashValid || !sigValid.valid) return "failed";
  return "verified";
};

export const verifyExistingResponse = async (options: {
  requestBody: string;
  responseText: string;
  chatId: string;
  model: string;
  apiKey: string;
  signingAlgo?: string;
  skipAttestation?: boolean;
}): Promise<VerificationResult> => {
  const {
    requestBody,
    responseText,
    chatId,
    model,
    apiKey,
    signingAlgo = "ecdsa",
    skipAttestation = false,
  } = options;

  const warnings: string[] = [];

  try {
    const requestHash = sha256(requestBody);
    const responseHash = sha256(responseText);

    const signature = await fetchSignature(chatId, model, apiKey, signingAlgo);

    const hashValidation = compareHashes(
      signature.text,
      requestHash,
      responseHash
    );

    let attestedAddresses: string[] = [];
    if (!skipAttestation) {
      try {
        const attestation = await fetchAttestation(model, apiKey);
        attestedAddresses = extractSigningAddresses(attestation);
      } catch (err) {
        warnings.push(
          `Unable to fetch attestation: ${
            err instanceof Error ? err.message : "unknown error"
          }`
        );
      }
    }

    const signatureValidation = verifySignature(
      signature.text,
      signature.signature,
      signature.signing_address,
      attestedAddresses
    );

    const status = determineStatus(hashValidation.valid, signatureValidation);

    if (
      signatureValidation.valid &&
      !signatureValidation.teeAttested &&
      attestedAddresses.length > 0
    ) {
      warnings.push(
        `Signature valid but signer ${signatureValidation.recoveredAddress} is not in attestation.`
      );
    }

    return {
      verified: hashValidation.valid && signatureValidation.valid,
      status,
      hashValidation,
      signatureValidation,
      chatId,
      requestHash,
      responseHash,
      signature,
      warnings,
    };
  } catch (error) {
    return {
      verified: false,
      status: "failed",
      hashValidation: null,
      signatureValidation: null,
      chatId,
      requestHash: "",
      responseHash: "",
      signature: null,
      warnings,
      error: error instanceof Error ? error.message : "Verification failed",
    };
  }
};

export const verifyChat = async (options: {
  requestBody: string;
  model: string;
  apiKey: string;
  signingAlgo?: string;
  skipAttestation?: boolean;
}): Promise<VerificationResult> => {
  const { requestBody, model, apiKey, signingAlgo, skipAttestation } = options;

  try {
    const { responseText, chatId } = await sendChatRequest(requestBody, apiKey);

    if (!chatId) {
      return {
        verified: false,
        status: "failed",
        hashValidation: null,
        signatureValidation: null,
        chatId: null,
        requestHash: "",
        responseHash: "",
        signature: null,
        warnings: [],
        error: "Could not extract chat ID from response",
      };
    }

    return verifyExistingResponse({
      requestBody,
      responseText,
      chatId,
      model,
      apiKey,
      signingAlgo,
      skipAttestation,
    });
  } catch (error) {
    return {
      verified: false,
      status: "failed",
      hashValidation: null,
      signatureValidation: null,
      chatId: null,
      requestHash: "",
      responseHash: "",
      signature: null,
      warnings: [],
      error: error instanceof Error ? error.message : "Verification failed",
    };
  }
};
