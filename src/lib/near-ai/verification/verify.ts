import { sha256sum, extractChatId, parseSignatureText } from "./hash";
import { fetchSignature, compareHashes, verifySignature } from "./signature";
import { fetchAttestation } from "./attestation";
import { logger } from "@/lib/logger";
import type {
  ChatVerificationResult,
  VerifyOptions,
  AttestationInfo,
} from "./types";

/**
 * Verify a chat message by:
 * 1. Fetching the signed message from NEAR AI
 * 2. Computing request/response hashes
 * 3. Fetching the attestation report to verify TEE signers
 * 4. Confirming the signature is from an attested signer
 *
 * Security: Verified when hashes and the signature are valid; missing TEE
 * attestations surface as warnings (gateway rotation can omit some nodes).
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

  try {
    // Step 1: Fetch signature
    const signature = await fetchSignature(chatId, model, {
      baseUrl: options?.baseUrl,
      apiKey: options?.apiKey,
      timeout: options?.timeout,
    });

    // Step 2: Validate signature text format
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
        attestation: null,
        error: "Signature text is malformed",
      };
    }

    // Step 3: Compare hashes
    const hashValidation = compareHashes(
      signature.text,
      requestHash,
      responseHash
    );

    logger.debug("[RequestHash] Request body being hashed:", requestBody);
    logger.debug("[RequestHash] Our computed hash:", requestHash);
    logger.debug("[RequestHash] NEAR AI's hash:", hashValidation.signedRequestHash);
    logger.debug("[RequestHash] Match:", hashValidation.requestHashMatch);

    let teeAddresses: string[] = [];
    let attestationInfo: AttestationInfo;

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
        return {
          verified: false,
          chatId,
          requestHash,
          responseHash,
          signature,
          hashValidation,
          signatureValidation: null,
          attestation: {
            fetched: false,
            teeAddresses: [],
            hasNvidiaPayload: false,
            error:
              error instanceof Error
                ? error.message
                : "Attestation fetch failed",
          },
          error: "Attestation fetch failed - cannot verify TEE origin",
        };
      }
    }

    // Step 3: Verify signature against TEE addresses
    const signatureValidation = verifySignature(
      signature.text,
      signature.signature,
      teeAddresses,
      signature.signing_address
    );

    console.log(
      "[DEBUG] TEE addresses from attestation:",
      JSON.stringify(teeAddresses)
    );
    console.log("[DEBUG] Signature response:", {
      signing_address: signature.signing_address,
      signing_algo: signature.signing_algo,
    });
    console.log("[DEBUG] Signature validation result:", {
      recoveredAddress: signatureValidation.recoveredAddress,
      signingAddress: signatureValidation.signingAddress,
      valid: signatureValidation.valid,
      teeAttested: signatureValidation.teeAttested,
    });

    const warnings: string[] = [];
    if (
      signatureValidation.valid &&
      !signatureValidation.teeAttested &&
      attestationInfo?.fetched
    ) {
      warnings.push(
        "Signer not in current attestation list (gateway rotation)"
      );
    }

    // Overall verification requires:
    // 1. Hash validation passes
    // 2. Signature validation passes (attestation is a warning)
    const verified = hashValidation.valid && signatureValidation.valid;

    return {
      verified,
      chatId,
      requestHash,
      responseHash,
      signature,
      hashValidation,
      signatureValidation,
      attestation: attestationInfo,
      warnings: warnings.length ? warnings : undefined,
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
      attestation: null,
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

  if (signatureValidation && !signatureValidation.valid) {
    return "Signature validation failed";
  }

  return "Verification failed";
}
