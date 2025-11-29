export interface AttestationExpectations {
  nonce: string;
  arch: string;
  deviceCertHash: string;
  rimHash?: string;
  ueid?: string;
  measurements: string[];
}

export type PartialExpectations = Partial<AttestationExpectations>;

export interface ValidationResult {
  complete: boolean;
  missing: Array<keyof AttestationExpectations>;
  message?: string;
}

const pickFirst = (source: any, keys: string[]) => {
  for (const key of keys) {
    if (source && source[key] !== undefined && source[key] !== null) {
      return source[key];
    }
  }
  return undefined;
};

const normalizeMeasurements = (value: any): string[] | undefined => {
  if (Array.isArray(value)) {
    return value.filter((v) => typeof v === "string" && v.length > 0);
  }
  if (typeof value === "string" && value.length > 0) {
    return [value];
  }
  return undefined;
};

const extractFromSources = (sources: any[]): PartialExpectations => {
  const parsePayload = (value: any) => {
    if (!value) return undefined;
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return undefined;
      }
    }
    if (typeof value === "object") return value;
    return undefined;
  };

  for (const source of sources) {
    if (!source || typeof source !== "object") continue;

    const modelPayload = parsePayload(source.model_attestations?.[0]?.nvidia_payload);
    const gatewayPayload = parsePayload(source.gateway_attestation?.nvidia_payload);
    const directPayload = parsePayload(source.nvidia_payload);

    const candidates = [source, modelPayload, gatewayPayload, directPayload].filter(Boolean);

    const nonce = pickFirst(candidates[0], [
      "nonce",
      "eat_nonce",
      "x-nvidia-eat-nonce",
      "expectedNonce",
      "request_nonce",
    ]) ?? pickFirst(modelPayload ?? {}, [
      "nonce",
      "eat_nonce",
      "x-nvidia-eat-nonce",
      "expectedNonce",
      "request_nonce",
    ]) ?? pickFirst(gatewayPayload ?? {}, [
      "nonce",
      "eat_nonce",
      "x-nvidia-eat-nonce",
      "expectedNonce",
      "request_nonce",
    ]) ?? pickFirst(directPayload ?? {}, [
      "nonce",
      "eat_nonce",
      "x-nvidia-eat-nonce",
      "expectedNonce",
      "request_nonce",
    ]);

    const arch =
      pickFirst(candidates[0], ["arch", "gpu_arch", "expectedArch", "expected_arch"]) ??
      pickFirst(modelPayload ?? {}, ["arch", "gpu_arch", "expectedArch", "expected_arch"]) ??
      pickFirst(gatewayPayload ?? {}, ["arch", "gpu_arch", "expectedArch", "expected_arch"]) ??
      pickFirst(directPayload ?? {}, ["arch", "gpu_arch", "expectedArch", "expected_arch"]);

    const deviceCertHash =
      pickFirst(candidates[0], [
        "deviceCertHash",
        "device_cert_hash",
        "expectedDeviceCertHash",
        "expected_device_cert_hash",
      ]) ??
      pickFirst(modelPayload ?? {}, [
        "deviceCertHash",
        "device_cert_hash",
        "expectedDeviceCertHash",
        "expected_device_cert_hash",
      ]) ??
      pickFirst(gatewayPayload ?? {}, [
        "deviceCertHash",
        "device_cert_hash",
        "expectedDeviceCertHash",
        "expected_device_cert_hash",
      ]) ??
      pickFirst(directPayload ?? {}, [
        "deviceCertHash",
        "device_cert_hash",
        "expectedDeviceCertHash",
        "expected_device_cert_hash",
      ]);

    const rimHash =
      pickFirst(candidates[0], ["rimHash", "rim", "expectedRimHash", "expected_rim_hash"]) ??
      pickFirst(modelPayload ?? {}, ["rimHash", "rim", "expectedRimHash", "expected_rim_hash"]) ??
      pickFirst(gatewayPayload ?? {}, ["rimHash", "rim", "expectedRimHash", "expected_rim_hash"]) ??
      pickFirst(directPayload ?? {}, ["rimHash", "rim", "expectedRimHash", "expected_rim_hash"]);

    const ueid =
      pickFirst(candidates[0], ["ueid", "expectedUeid", "expected_ueid", "device_id"]) ??
      pickFirst(modelPayload ?? {}, ["ueid", "expectedUeid", "expected_ueid", "device_id"]) ??
      pickFirst(gatewayPayload ?? {}, ["ueid", "expectedUeid", "expected_ueid", "device_id"]) ??
      pickFirst(directPayload ?? {}, ["ueid", "expectedUeid", "expected_ueid", "device_id"]);

    const measurementsRaw =
      pickFirst(candidates[0], ["measurements", "expectedMeasurements", "expected_measurements"]) ??
      pickFirst(modelPayload ?? {}, ["measurements", "expectedMeasurements", "expected_measurements"]) ??
      pickFirst(gatewayPayload ?? {}, ["measurements", "expectedMeasurements", "expected_measurements"]) ??
      pickFirst(directPayload ?? {}, ["measurements", "expectedMeasurements", "expected_measurements"]);

    const measurements = normalizeMeasurements(measurementsRaw);

    if (nonce || arch || deviceCertHash || rimHash || ueid || measurements) {
      return {
        nonce,
        arch,
        deviceCertHash,
        rimHash,
        ueid,
        measurements,
      };
    }
  }

  return {};
};

export const validateExpectations = (
  expectations: PartialExpectations
): ValidationResult => {
  const missing: Array<keyof AttestationExpectations> = [];

  if (!expectations.nonce) missing.push("nonce");
  if (!expectations.arch) missing.push("arch");
  if (!expectations.deviceCertHash) missing.push("deviceCertHash");
  if (!expectations.measurements || expectations.measurements.length === 0) {
    missing.push("measurements");
  }

  return {
    complete: missing.length === 0,
    missing,
    message: missing.length ? `Missing expectations: ${missing.join(", ")}` : undefined,
  };
};

export const isCompleteExpectations = (
  expectations: PartialExpectations
): expectations is AttestationExpectations => validateExpectations(expectations).complete;

export const extractExpectationsFromProposal = (
  proposal: any
): PartialExpectations => {
  if (!proposal) return {};
  return extractFromSources([
    proposal.verification,
    proposal.metadata?.verification,
    proposal.metadata,
    proposal,
  ]);
};

export const extractExpectationsFromMessage = (message: any): PartialExpectations => {
  if (!message) return {};
  return extractFromSources([
    message.verification,
    message.proof,
    message.data?.proof,
    message.metadata?.verification,
    message.metadata,
    message.envelope,
    message,
  ]);
};
