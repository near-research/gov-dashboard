import { ethers } from "ethers";
import type {
  VerificationProofResponse,
  NonceCheck,
} from "@/types/verification";

type StepStatus = "pending" | "success" | "error";

export type VerificationStepKey =
  | "hash"
  | "signature"
  | "address"
  | "attestation"
  | "nonce"
  | "gpu"
  | "cpu";

export interface VerificationStep {
  status: StepStatus;
  message?: string;
  details?: string;
}

export interface VerificationState {
  overall: "unverified" | "pending" | "verified" | "failed";
  steps: Record<VerificationStepKey, VerificationStep>;
  recoveredAddress?: string | null;
  attestedAddress?: string | null;
  reasons?: string[];
}

interface DeriveArgs {
  proof?: VerificationProofResponse | null;
  requestHash?: string | null;
  responseHash?: string | null;
  signatureText?: string | null;
  signature?: string | null;
  signatureAddress?: string | null;
  attestedAddress?: string | null;
  attestationResult?: string | null;
  nrasVerified?: boolean;
  nrasReasons?: string[];
  intelVerified?: boolean;
  nonceCheck?: NonceCheck | null;
  intelRequired?: boolean;
  intelConfigured?: boolean;
}

export function deriveVerificationState({
  proof,
  requestHash,
  responseHash,
  signatureText,
  signature,
  signatureAddress,
  attestedAddress,
  attestationResult,
  nrasVerified,
  nrasReasons,
  intelVerified,
  nonceCheck,
  intelRequired,
  intelConfigured = true,
}: DeriveArgs): VerificationState {
  console.log("[attestation] deriveVerificationState called with:", {
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

  // Hash step
  if (!normalizedSignatureText || !normalizedRequestHash || !normalizedResponseHash) {
    steps.hash = {
      status: "pending",
      message: "Provide request and response hashes to validate.",
    };
  } else {
    const exactMatch =
      normalizedSignatureText ===
      `${normalizedRequestHash}:${normalizedResponseHash}`;
    const containsRequest = normalizedSignatureText.includes(
      normalizedRequestHash
    );
    const containsResponse = normalizedSignatureText.includes(
      normalizedResponseHash
    );

    if (exactMatch || (containsRequest && containsResponse)) {
      steps.hash = { status: "success", message: "Hashes match" };
    } else {
      const missingPieces = [
        containsRequest ? null : "request hash",
        containsResponse ? null : "response hash",
      ]
        .filter(Boolean)
        .join(" & ");
      steps.hash = {
        status: "error",
        message: missingPieces
          ? `Signature text missing ${missingPieces}`
          : "Hash mismatch",
        details: `Expected: ${localSignedText}\nReceived: ${signatureText}`,
      };
      reasons.push("Hash mismatch");
    }
  }

  let recoveredAddress: string | null = null;

  // Signature step
  if (!signature || !signatureText) {
    steps.signature = {
      status: "pending",
      message: "Missing signature or signed text",
    };
  } else {
    try {
      recoveredAddress = ethers.verifyMessage(signatureText, signature);
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
  if (nrasVerified === true) {
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
  console.log("[attestation] Address verification:", {
    recoveredAddress,
    attestedAddress,
    willUseDirectMatch: !!attestedAddress,
    willUseComprehensiveCheck: !attestedAddress,
  });
  if (!recoveredAddress) {
    steps.address = {
      status: "pending",
      message: "Waiting for signature verification",
    };
  } else {
    // If attestedAddress provided, enforce it directly
    if (attestedAddress) {
      const matches =
        recoveredAddress.trim().toLowerCase() ===
        attestedAddress.trim().toLowerCase();
      steps.address = {
        status: matches ? "success" : "error",
        message: matches ? "Address verified" : "Address mismatch",
        details: matches
          ? `TEE address: ${attestedAddress}`
          : `Recovered: ${recoveredAddress}\nExpected: ${attestedAddress}`,
      };
      if (!matches) reasons.push("Signer does not match attested key");
    } else {
      const possibleAddresses: string[] = [];
      const attestation = proof?.attestation;
      const addAddress = (addr: any) => {
        if (addr && typeof addr === "string" && addr.startsWith("0x")) {
          possibleAddresses.push(addr.toLowerCase());
        }
      };

      // Signature address primary
      addAddress(signatureAddress);
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
        modelAtts.forEach((model: any) => addAddress(model?.signing_address));
      }
      // All attestations
      const allAtts =
        attestationPayload?.all_attestations || attestation?.all_attestations;
      if (Array.isArray(allAtts)) {
        allAtts.forEach((node: any) => addAddress(node?.signing_address));
      }

      const uniqueAddresses = [...new Set(possibleAddresses)];
      if (uniqueAddresses.length === 0) {
        steps.address = {
          status: "error",
          message: "No TEE addresses found in attestation or signature",
        };
        reasons.push("No TEE addresses available");
      } else {
        const normalizedRecovered = recoveredAddress.toLowerCase();
        const matchedAddress = uniqueAddresses.find(
          (addr) => addr === normalizedRecovered
        );
        if (matchedAddress) {
          steps.address = {
            status: "success",
            message: "Address verified",
            details: `Matched TEE node: ${matchedAddress}`,
          };
        } else {
          steps.address = {
            status: "error",
            message: "Address mismatch",
            details: `Recovered: ${recoveredAddress}\nChecked ${
              uniqueAddresses.length
            } TEE nodes:\n${uniqueAddresses.slice(0, 3).join("\n")}${
              uniqueAddresses.length > 3 ? "\n..." : ""
            }`,
          };
          reasons.push("Signer does not match any TEE nodes");
          console.error("[verification] Address mismatch:", {
            recovered: recoveredAddress,
            checkedNodes: uniqueAddresses,
          });
        }
      }
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

  console.log("[attestation] Final state before return:", {
    overall,
    allSteps: Object.entries(steps).map(([k, v]) => ({
      name: k,
      status: v.status,
      message: v.message,
    })),
    anyError,
    allSuccess,
  });

  return {
    overall,
    steps,
    recoveredAddress,
    attestedAddress,
    reasons: reasons.length ? reasons : undefined,
  };
}
