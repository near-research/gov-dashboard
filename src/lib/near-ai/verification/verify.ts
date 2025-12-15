import { sha256sum, extractChatId, parseSignatureText } from "./hash";
import { fetchSignature, compareHashes, verifySignature } from "./signature";
import { fetchAttestation } from "./attestation";
import type {
  ChatVerificationResult,
  VerifyOptions,
  AttestationInfo,
} from "./types";

/**
 * Verify a chat message by:
 * 1. Fetching attestation report to get TEE signing addresses
 * 2. Computing request/response hashes
 * 3. Fetching signature from NEAR AI
 * 4. Comparing hashes
 * 5. Verifying ECDSA signature is from a TEE-attested address
 *
 * Security: The recovered signer MUST be in the attestation's TEE address list
 * for verification to pass (unless skipAttestation is true, which weakens security).
 */
export async function verifyChatMessage(
  requestBody: string,
  responseText: string,
  model: string,
  options?: VerifyOptions
): Promise<ChatVerificationResult> {
  const chatId = extractChatId(responseText);

  if (!chatId) {
    return {
      verified: false,
      chatId: "",
      requestHash: "",
      responseHash: "",
      signature: null,
      hashValidation: null,
      signatureValidation: null,
      attestation: null,
      error: "Could not extract chat ID from response",
    };
  }

  const requestHash = sha256sum(requestBody);
  const responseHash = sha256sum(responseText);

  // Step 1: Fetch attestation (unless skipped)
  let attestationInfo: AttestationInfo;
  let teeAddresses: string[] = [];

  if (options?.skipAttestation) {
    attestationInfo = {
      fetched: false,
      teeAddresses: [],
      hasNvidiaPayload: false,
      error: "Attestation skipped by caller (security weakened)",
    };
  } else {
    try {
      const attestation = await fetchAttestation(model, {
        baseUrl: options?.baseUrl,
        apiKey: options?.apiKey,
        timeout: options?.timeout,
        verifyNvidia: options?.verifyNvidia,
      });
      teeAddresses = attestation.teeAddresses;
      attestationInfo = {
        fetched: true,
        teeAddresses: attestation.teeAddresses,
        hasNvidiaPayload: attestation.hasNvidiaPayload,
        nvidiaVerification: attestation.nvidiaVerification,
      };
    } catch (error) {
      // Attestation fetch failure is fatal (unless skipped)
      return {
        verified: false,
        chatId,
        requestHash,
        responseHash,
        signature: null,
        hashValidation: null,
        signatureValidation: null,
        attestation: {
          fetched: false,
          teeAddresses: [],
          hasNvidiaPayload: false,
          error:
            error instanceof Error ? error.message : "Attestation fetch failed",
        },
        error: "Attestation fetch failed - cannot verify TEE origin",
      };
    }
  }

  // Step 2: Fetch signature
  try {
    const signature = await fetchSignature(chatId, model, {
      baseUrl: options?.baseUrl,
      apiKey: options?.apiKey,
      timeout: options?.timeout,
    });

    // Step 3: Validate signature text format
    const parsedSignatureText = parseSignatureText(signature.text);
    if (!parsedSignatureText) {
      return {
        verified: false,
        chatId,
        requestHash,
        responseHash,
        signature,
        hashValidation: null,
        signatureValidation: null,
        attestation: attestationInfo,
        error: "Signature text is malformed",
      };
    }

    // Step 4: Compare hashes
    const hashValidation = compareHashes(
      signature.text,
      requestHash,
      responseHash
    );

    // Step 5: Verify signature against TEE addresses
    const signatureValidation = verifySignature(
      signature.text,
      signature.signature,
      teeAddresses
    );

    // Overall verification requires:
    // 1. Hash validation passes
    // 2. Signature validation passes (which includes TEE address check)
    // 3. If attestation was fetched, signer must be TEE-attested
    const verified =
      hashValidation.valid &&
      signatureValidation.valid &&
      (options?.skipAttestation || signatureValidation.teeAttested);

    return {
      verified,
      chatId,
      requestHash,
      responseHash,
      signature,
      hashValidation,
      signatureValidation,
      attestation: attestationInfo,
      error: verified
        ? undefined
        : determineError(hashValidation, signatureValidation, attestationInfo),
    };
  } catch (error) {
    return {
      verified: false,
      chatId,
      requestHash,
      responseHash,
      signature: null,
      hashValidation: null,
      signatureValidation: null,
      attestation: attestationInfo,
      error:
        error instanceof Error
          ? error.message
          : "Verification failed unexpectedly",
    };
  }
}

/**
 * Determine the most relevant error message
 */
function determineError(
  hashValidation: {
    valid: boolean;
    requestHashMatch: boolean;
    responseHashMatch: boolean;
  } | null,
  signatureValidation: {
    valid: boolean;
    teeAttested: boolean;
    error?: string;
  } | null,
  attestation: AttestationInfo | null
): string {
  if (hashValidation && !hashValidation.valid) {
    if (!hashValidation.requestHashMatch && !hashValidation.responseHashMatch) {
      return "Both request and response hashes do not match";
    }
    if (!hashValidation.requestHashMatch) {
      return "Request hash does not match";
    }
    return "Response hash does not match";
  }

  if (signatureValidation?.error) {
    return `Signature verification failed: ${signatureValidation.error}`;
  }

  if (
    signatureValidation &&
    !signatureValidation.teeAttested &&
    attestation?.fetched
  ) {
    return "Signer is not in TEE attestation addresses";
  }

  if (signatureValidation && !signatureValidation.valid) {
    return "Signature validation failed";
  }

  return "Verification failed";
}
