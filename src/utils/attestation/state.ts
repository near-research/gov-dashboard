import { verifyMessage } from "ethers";
import type {
  VerificationProofResponse,
  NonceCheck,
  VerificationState,
  DeriveArgs,
} from "@/types/verification";

const attestationDebugEnabled =
  process.env.ATTESTATION_DEBUG === "true" ||
  process.env.NEXT_PUBLIC_ATTESTATION_DEBUG === "true";

const attestationDebugLog = (...args: any[]) => {
  if (attestationDebugEnabled) {
    console.log(...args);
  }
};

const attestationDebugError = (...args: any[]) => {
  if (attestationDebugEnabled) {
    console.error(...args);
  }
};

export function deriveVerificationState({
  proof,
  requestHash,
  responseHash,
  signatureText,
  signature,
  signatureAddress,
  signatureAlgo,
  attestedAddress,
  attestationResult,
  nrasVerified,
  nrasReasons,
  intelVerified,
  nonceCheck,
  intelRequired,
  intelConfigured = true,
  trustedAddresses = [],
  normalizedVerification,
}: DeriveArgs): VerificationState {
  attestationDebugLog("[attestation] deriveVerificationState called with:", {
    attestedAddress,
    signatureAddress,
    hasProof: !!proof,
  });
  const hasProof = !!proof;

  const steps: VerificationState["steps"] = {
    hash: { status: "pending" },
    signature: { status: "pending" },
    address: { status: "pending" },
    attestation: { status: "pending" },
    nonce: { status: "pending" },
    gpu: { status: "pending" },
    cpu: { status: "pending" },
  };

  const reasons: string[] = [];
  const localSignedText =
    requestHash && responseHash ? `${requestHash}:${responseHash}` : null;

  const normalize = (value?: string | null) =>
    typeof value === "string" ? value.trim().toLowerCase() : null;
  const timingSafeEqual = (a: string | null, b: string | null) => {
    if (!a || !b || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
  };
  const normalizedSignatureText = normalize(signatureText);
  const normalizedRequestHash = normalize(requestHash);
  const normalizedResponseHash = normalize(responseHash);
  const hasVerificationSignals =
    hasProof ||
    (attestationResult !== undefined && attestationResult !== null) ||
    typeof nrasVerified === "boolean" ||
    typeof intelVerified === "boolean";
  const noVerificationData =
    !hasProof &&
    !requestHash &&
    !responseHash &&
    !signatureText &&
    !signature &&
    !signatureAddress &&
    attestationResult == null &&
    typeof nrasVerified !== "boolean" &&
    typeof intelVerified !== "boolean" &&
    !nonceCheck;

  const normalizedReasons = normalizedVerification?.reasons?.filter(Boolean) ?? [];
  const normalizedReasonText = normalizedReasons.join("\n");
  const appendNormalizedReason = (fallback: string) => {
    if (normalizedReasonText) {
      if (!reasons.includes(normalizedReasonText)) {
        reasons.push(normalizedReasonText);
      }
    } else {
      reasons.push(fallback);
    }
  };

  // Hash step
  if (!normalizedSignatureText || !normalizedRequestHash || !normalizedResponseHash) {
    steps.hash = {
      status: "pending",
      message: "Provide request and response hashes to validate.",
    };
  } else {
    const expected = `${normalizedRequestHash}:${normalizedResponseHash}`;

    if (timingSafeEqual(normalizedSignatureText, expected)) {
      steps.hash = { status: "success", message: "Hashes match" };
    } else {
      steps.hash = {
        status: "error",
        message: "Hash mismatch",
        details: `Expected: ${localSignedText}\nReceived: ${signatureText}`,
      };
      reasons.push("Hash mismatch");
    }
  }

  let recoveredAddress: string | null = null;

  // Signature step
  const algo = (signatureAlgo || "ecdsa").toLowerCase();

  if (normalizedVerification) {
    const signatureStatus = normalizedVerification.signatureVerified ? "success" : "error";
    steps.signature = {
      status: signatureStatus,
      message: normalizedVerification.signatureVerified
        ? "Signature verified by normalized proof"
        : "Signature flagged by normalized proof",
      details: !normalizedVerification.signatureVerified
        ? normalizedReasonText || undefined
        : undefined,
    };
    if (!normalizedVerification.signatureVerified) {
      appendNormalizedReason("Signature verification failed");
    }
    steps.address = {
      status: signatureStatus,
      message: normalizedVerification.signatureVerified
        ? "Signing address matches attested node"
        : "Signing address verification failed according to normalized proof",
      details: !normalizedVerification.signatureVerified
        ? normalizedReasonText || undefined
        : undefined,
    };
    if (!normalizedVerification.signatureVerified) {
      appendNormalizedReason("Signing address verification failed");
    }
    recoveredAddress = signatureAddress ?? null;
  } else if (!signature || !signatureText) {
    steps.signature = {
      status: "pending",
      message: "Missing signature or signed text",
    };
  } else {
    if (typeof signature === "string" && /^0x0+$/i.test(signature.slice(2))) {
      steps.signature = {
        status: "error",
        message: "Signature verification failed",
      };
      reasons.push("Invalid signature");
      recoveredAddress = null;
    } else {
      try {
        if (algo === "ecdsa") {
          recoveredAddress = verifyMessage(signatureText, signature);
        } else if (algo === "ed25519") {
          const isEdAddress =
            typeof signatureAddress === "string" &&
            signatureAddress.toLowerCase().startsWith("ed25519:");
          if (!isEdAddress) {
            throw new Error("Unsupported signing algorithm: ed25519 without ed25519 signer");
          }
          recoveredAddress = signatureAddress || null;
        } else {
          throw new Error(`Unsupported signing algorithm: ${signatureAlgo}`);
        }
        steps.signature = {
          status: "success",
          message: "Signature valid",
          details: `Recovered address: ${recoveredAddress}`,
        };
      } catch (error) {
        steps.signature = {
          status: "error",
          message:
            error instanceof Error
              ? error.message || "Signature verification failed"
              : "Signature verification failed",
        };
        reasons.push("Invalid signature");
      }
    }
  }

  // Nonce step
  if (!nonceCheck) {
    if (hasVerificationSignals) {
      steps.nonce = {
        status: "error",
        message: "Nonce not validated - missing nonce check",
      };
      reasons.push("Nonce not validated");
    } else {
      steps.nonce = {
        status: "pending",
        message: "Waiting for proof to validate nonce",
      };
    }
  } else if (nonceCheck.valid) {
    steps.nonce = { status: "success", message: "Nonce bound" };
  } else {
    steps.nonce = {
      status: "error",
      message: "Nonce mismatch",
      details: `Expected: ${nonceCheck.expected || "unknown"}\nAttested: ${
        nonceCheck.attested || "unknown"
      }\nNRAS: ${nonceCheck.nras || "unknown"}`,
    };
    reasons.push("Nonce mismatch");
  }

  if (noVerificationData) {
    steps.hash = {
      status: "pending",
      message: "Waiting for verification inputs",
    };
  }

  // GPU
  if (normalizedVerification) {
    if (normalizedVerification.nrasVerified) {
      steps.gpu = { status: "success", message: "NRAS verified" };
    } else {
      steps.gpu = {
        status: "error",
        message: "NRAS verification failed",
        details: normalizedReasonText || undefined,
      };
      appendNormalizedReason("NRAS failed");
    }
  } else if (nrasVerified === true) {
    steps.gpu = { status: "success", message: "NRAS verified" };
  } else if (nrasVerified === false) {
    steps.gpu = {
      status: "error",
      message: "NRAS verification failed",
      details: (nrasReasons || []).join("\n") || undefined,
    };
    reasons.push("NRAS failed");
  }

  const effectiveIntelRequired = intelRequired && intelConfigured;

  // CPU
  if (effectiveIntelRequired) {
    if (intelVerified === true) {
      steps.cpu = { status: "success", message: "Intel TDX verified" };
    } else if (intelVerified === false) {
      steps.cpu = {
        status: "error",
        message: "Intel verification failed or missing",
      };
      reasons.push("Intel attestation failed or missing");
    } else {
      steps.cpu = {
        status: "pending",
        message: "Intel verification pending",
      };
    }
  } else {
    steps.cpu = {
      status: "pending",
      message: intelConfigured
        ? "Intel attestation not required"
        : "Intel attestation not configured",
    };
  }

  // Attestation
  if (normalizedVerification) {
    if (normalizedVerification.hardwareVerified) {
      steps.attestation = { status: "success", message: "Attestation verified" };
    } else {
      steps.attestation = {
        status: "error",
        message: "Attestation failed",
        details: normalizedReasonText || undefined,
      };
      appendNormalizedReason("Attestation failed");
    }
  } else {
    const attestationValidated =
      (attestationResult === "Pass" ||
        (typeof attestationResult === "boolean" && attestationResult === true)) &&
      nrasVerified === true &&
      (!effectiveIntelRequired || intelVerified === true) &&
      (nonceCheck ? nonceCheck.valid === true : false);

    if (attestationValidated) {
      steps.attestation = { status: "success", message: "Attestation verified" };
    } else if (attestationResult === "Fail") {
      steps.attestation = { status: "error", message: "Attestation failed" };
      reasons.push("Attestation failed");
    } else {
      steps.attestation = {
        status: "pending",
        message: "Attestation not fully validated",
      };
    }

    // Address step - check all possible TEE nodes
    const attestationPayload = proof?.attestation as any;
    const trustedSet = (trustedAddresses || []).map((a) => a.toLowerCase());
    const hasMultipleTrusted = trustedSet.length > 1;
    attestationDebugLog("[attestation] Address verification:", {
      recoveredAddress,
      attestedAddress,
      willUseDirectMatch: !!attestedAddress && !hasMultipleTrusted,
      willUseComprehensiveCheck: !attestedAddress || hasMultipleTrusted,
    });
    const normalizedRecovered =
      recoveredAddress?.toLowerCase() ?? normalize(signatureAddress);

    if (!normalizedRecovered) {
      steps.address = {
        status: "pending",
        message: "Waiting for signature verification",
      };
    } else {
      // If attestedAddress provided, enforce it directly
      if (attestedAddress && !hasMultipleTrusted) {
        const matches = timingSafeEqual(
          normalizedRecovered,
          attestedAddress.trim().toLowerCase()
        );
        steps.address = {
          status: matches ? "success" : "error",
          message: matches ? "Address verified" : "Address mismatch",
          details: matches
            ? `TEE address: ${attestedAddress}`
            : `Recovered: ${normalizedRecovered}\nExpected: ${attestedAddress}`,
        };
        if (!matches) reasons.push("Signer does not match attested key");
      } else {
        const possibleAddresses: string[] = [];
        const attestation = proof?.attestation;
        const expectedNonce =
          typeof nonceCheck?.expected === "string"
            ? nonceCheck.expected.toLowerCase()
            : null;
        const nodeNonces: Record<string, string | null> = {};

        const extractNonce = (node: any): string | null => {
          if (!node) return null;
          const payload = node.nvidia_payload || node.evidence || node.payload;
          if (!payload) return null;
          let parsed = payload;
          if (typeof parsed === "string") {
            try {
              parsed = JSON.parse(parsed);
            } catch {
              return null;
            }
          }
          const nonce =
            parsed?.eat_nonce ||
            parsed?.nonce ||
            parsed?.["x-nvidia-eat-nonce"] ||
            null;
          return typeof nonce === "string" ? nonce.toLowerCase() : null;
        };

        const addAddress = (addr: any) => {
          if (
            addr &&
            typeof addr === "string" &&
            (addr.startsWith("0x") || addr.startsWith("ed25519:"))
          ) {
            possibleAddresses.push(addr.toLowerCase());
          }
        };

        // Top-level
        addAddress(attestationPayload?.signing_address);
        addAddress(attestation?.signing_address);
        // Gateway
        const gateway =
          attestationPayload?.gateway_attestation ||
          attestation?.gateway_attestation;
        if (Array.isArray(gateway)) {
          gateway.forEach((node: any) => addAddress(node?.signing_address));
        } else if (gateway) {
          addAddress(gateway.signing_address);
        }
        // Model attestations
        const modelAtts =
          attestationPayload?.model_attestations ||
          attestation?.model_attestations;
        if (Array.isArray(modelAtts)) {
          modelAtts.forEach((model: any) => {
            addAddress(model?.signing_address);
            if (model?.signing_address) {
              nodeNonces[model.signing_address.toLowerCase()] = extractNonce(model);
            }
          });
        }
        // All attestations
        const allAtts =
          attestationPayload?.all_attestations || attestation?.all_attestations;
        if (Array.isArray(allAtts)) {
          allAtts.forEach((node: any) => {
            addAddress(node?.signing_address);
            if (node?.signing_address) {
              nodeNonces[node.signing_address.toLowerCase()] = extractNonce(node);
            }
          });
        }

        const uniqueAddresses = [...new Set(possibleAddresses)];
        const nonceBoundAddresses =
          expectedNonce && proof?.nras?.verified
            ? uniqueAddresses.filter((addr) => nodeNonces[addr] === expectedNonce)
            : uniqueAddresses;

        const addressesToCheck =
          nonceBoundAddresses.length > 0 ? nonceBoundAddresses : uniqueAddresses;

        const addressesWithTrust = trustedSet.length
          ? trustedSet
          : addressesToCheck;

        if (uniqueAddresses.length === 0) {
          steps.address = {
            status: "error",
            message: "No TEE addresses found in attestation or signature",
          };
          reasons.push("No TEE addresses available");
        } else {
          const matchedAddress = addressesWithTrust.find((addr) =>
            timingSafeEqual(addr, normalizedRecovered)
          );
          if (matchedAddress) {
            steps.address = {
              status: "success",
              message: "Address verified",
              details: `Matched TEE node: ${matchedAddress}`,
            };
          } else if (expectedNonce && proof?.nras?.verified) {
            steps.address = {
              status: "error",
              message: "Address mismatch on verified TEE nodes",
              details: `Recovered: ${normalizedRecovered}\nChecked ${
                addressesToCheck.length
              } nonce-bound TEE nodes:\n${addressesToCheck
                .slice(0, 3)
                .join("\n")}${addressesToCheck.length > 3 ? "\n..." : ""}`,
            };
            reasons.push("Signer does not match any TEE nodes");
          } else {
            steps.address = {
              status: "error",
              message: "Address mismatch",
              details: `Recovered: ${normalizedRecovered}\nChecked ${
                uniqueAddresses.length
              } TEE nodes:\n${uniqueAddresses.slice(0, 3).join("\n")}${
                uniqueAddresses.length > 3 ? "\n..." : ""
              }`,
            };
            reasons.push("Signer does not match any TEE nodes");
            attestationDebugError("[verification] Address mismatch:", {
              recovered: recoveredAddress,
              checkedNodes: uniqueAddresses,
            });
          }
      }
    }
  }
}

if (
  steps.attestation.status === "error" &&
  !reasons.includes("Attestation failed")
) {
  reasons.push("Attestation failed");
}

const attestationRecord = proof?.attestation as Record<string, any> | null;
const claimedAddresses = [
  attestationRecord?.signing_address,
  attestationRecord?.gateway_attestation?.signing_address,
  ...(Array.isArray(attestationRecord?.model_attestations)
    ? attestationRecord.model_attestations.flatMap((node: any) =>
        node?.signing_address ? [node.signing_address] : []
      )
    : []),
  ...(Array.isArray(attestationRecord?.all_attestations)
    ? attestationRecord.all_attestations.flatMap((node: any) =>
        node?.signing_address ? [node.signing_address] : []
      )
    : []),
];
const hasAttestationAddress = claimedAddresses.some(
  (addr) => typeof addr === "string" && addr.length > 0
);

if (
  !hasAttestationAddress &&
  !signatureAddress &&
  !reasons.includes("No TEE addresses available")
) {
  reasons.push("No TEE addresses available");
}

if (
  steps.address.status === "error" &&
  steps.address.message?.includes("No TEE addresses found")
) {
  if (!reasons.includes("No TEE addresses available")) {
    reasons.push("No TEE addresses available");
  }
}

const anyError = Object.values(steps).some((s) => s.status === "error");
  const allSuccess = Object.values(steps).every((s) => s.status === "success");

  // Critical steps that must be successful for overall verification
  const criticalStepsSuccess =
    steps.hash.status === "success" &&
    steps.signature.status === "success" &&
    steps.address.status === "success" &&
    steps.attestation.status === "success" &&
    steps.nonce.status === "success" &&
    steps.gpu.status === "success";

  // CPU is optional; allow pending when not required/configured
  const cpuOk =
    steps.cpu.status === "success" ||
    (steps.cpu.status === "pending" &&
      (steps.cpu.message?.includes("not required") ||
        steps.cpu.message?.includes("not configured")));

  const overall: VerificationState["overall"] = anyError
    ? "failed"
    : criticalStepsSuccess && cpuOk
    ? "verified"
    : "pending";

  attestationDebugLog("[attestation] Final state before return:", {
    overall,
    allSteps: Object.entries(steps).map(([k, v]) => ({
      name: k,
      status: v.status,
      message: v.message,
    })),
    anyError,
    allSuccess,
  });

  const finalReasons = attestedAddress
    ? reasons.filter((reason) => reason !== "No TEE addresses available")
    : reasons;

  return {
    overall,
    steps,
    recoveredAddress,
    attestedAddress,
    reasons: finalReasons.length ? finalReasons : undefined,
  };
}
