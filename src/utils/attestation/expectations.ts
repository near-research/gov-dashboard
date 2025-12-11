import type { AttestationExpectations, PartialExpectations } from "@/types/verification";

type ValidationResult = {
  complete: boolean;
  missing: Array<keyof AttestationExpectations>;
  message?: string;
};

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

const parseJsonValue = (value: any) => {
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

const decodeEventPayload = (entry: string | undefined) => {
  if (!entry) return "";
  const trimmed = entry.trim();
  if (!trimmed) return "";
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    try {
      return Buffer.from(trimmed, "hex").toString("utf8");
    } catch {
      return trimmed;
    }
  }
  return trimmed;
};

const searchForKeyInText = (text: string, keys: string[]) => {
  const normalized = text;
  for (const key of keys) {
    const regex = new RegExp(
      `${key}\\s*[:=]\\s*([A-Za-z0-9\\-_.:]+)`,
      "i"
    );
    const match = normalized.match(regex);
    if (match?.[1]) {
      return match[1];
    }
    const secondRegex = new RegExp(`${key}\\s+([A-Za-z0-9\\-_.:]+)`, "i");
    const fallback = normalized.match(secondRegex);
    if (fallback?.[1]) {
      return fallback[1];
    }
  }
  return undefined;
};

const extractFromEventLogValue = (value: any, keys: string[]) => {
  if (!value) return undefined;
  const entries = Array.isArray(value) ? value : parseJsonValue(value) ?? [];

  if (!Array.isArray(entries)) return undefined;

  for (const entry of entries) {
    const payload = decodeEventPayload(entry?.event_payload ?? entry?.payload ?? entry?.data);
    const found = searchForKeyInText(payload, keys);
    if (found) return found;
  }

  return undefined;
};

const extractFromInfo = (info: any, keys: string[]) => {
  if (!info || typeof info !== "object") return undefined;
  return searchForKeyInText(
    JSON.stringify(info),
    keys
  );
};

const extractFromSources = (sources: any[]): PartialExpectations => {
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;

    const modelPayload = parseJsonValue(
      source.model_attestations?.[0]?.nvidia_payload
    );
    const gatewayPayload = parseJsonValue(source.gateway_attestation?.nvidia_payload);
    const modelEventLog = parseJsonValue(
      source.model_attestations?.[0]?.event_log ??
        source.model_attestations?.[0]?.eventLog
    );
    const gatewayEventLog = parseJsonValue(
      source.gateway_attestation?.event_log ??
        source.gateway_attestation?.eventLog
    );
    const directPayload = parseJsonValue(source.nvidia_payload);

    const candidates = [
      source,
      modelPayload,
      modelEventLog,
      gatewayPayload,
      gatewayEventLog,
      directPayload,
    ].filter(Boolean);

    const nonceKeys = [
      "nonce",
      "eat_nonce",
      "x-nvidia-eat-nonce",
      "expectedNonce",
      "request_nonce",
      "requestNonce",
    ];
    const nonce =
      pickFirst(modelPayload ?? {}, nonceKeys) ??
      pickFirst(gatewayPayload ?? {}, nonceKeys) ??
      pickFirst(directPayload ?? {}, nonceKeys) ??
      pickFirst(source, nonceKeys);
    const eventNonce =
      extractFromEventLogValue(source.event_log, [
        "nonce",
        "eat_nonce",
        "x-nvidia-eat-nonce",
        "request_nonce",
        "requestNonce",
      ]) ??
      extractFromEventLogValue(source.gateway_attestation?.event_log, [
        "nonce",
        "eat_nonce",
        "x-nvidia-eat-nonce",
        "request_nonce",
        "requestNonce",
      ]);
    const nonceFinal = nonce ?? eventNonce;

    const arch =
      pickFirst(candidates[0], [
        "arch",
        "gpu_arch",
        "expectedArch",
        "expected_arch",
        "architecture",
      ]) ??
      pickFirst(modelPayload ?? {}, [
        "arch",
        "gpu_arch",
        "expectedArch",
        "expected_arch",
        "architecture",
      ]) ??
      pickFirst(gatewayPayload ?? {}, [
        "arch",
        "gpu_arch",
        "expectedArch",
        "expected_arch",
        "architecture",
      ]) ??
      pickFirst(directPayload ?? {}, [
        "arch",
        "gpu_arch",
        "expectedArch",
        "expected_arch",
        "architecture",
      ]);

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
      pickFirst(candidates[0], [
        "rimHash",
        "rim",
        "expectedRimHash",
        "expected_rim_hash",
      ]) ??
      pickFirst(modelPayload ?? {}, [
        "rimHash",
        "rim",
        "expectedRimHash",
        "expected_rim_hash",
      ]) ??
      pickFirst(gatewayPayload ?? {}, [
        "rimHash",
        "rim",
        "expectedRimHash",
        "expected_rim_hash",
      ]) ??
      pickFirst(directPayload ?? {}, [
        "rimHash",
        "rim",
        "expectedRimHash",
        "expected_rim_hash",
      ]);

    const ueid =
      pickFirst(candidates[0], [
        "ueid",
        "expectedUeid",
        "expected_ueid",
        "device_id",
      ]) ??
      pickFirst(modelPayload ?? {}, [
        "ueid",
        "expectedUeid",
        "expected_ueid",
        "device_id",
      ]) ??
      pickFirst(gatewayPayload ?? {}, [
        "ueid",
        "expectedUeid",
        "expected_ueid",
        "device_id",
      ]) ??
      pickFirst(directPayload ?? {}, [
        "ueid",
        "expectedUeid",
        "expected_ueid",
        "device_id",
      ]);

    const measurementsRaw =
      pickFirst(candidates[0], [
        "measurements",
        "expectedMeasurements",
        "expected_measurements",
      ]) ??
      pickFirst(modelPayload ?? {}, [
        "measurements",
        "expectedMeasurements",
        "expected_measurements",
      ]) ??
      pickFirst(gatewayPayload ?? {}, [
        "measurements",
        "expectedMeasurements",
        "expected_measurements",
      ]) ??
      pickFirst(directPayload ?? {}, [
        "measurements",
        "expectedMeasurements",
        "expected_measurements",
      ]);

    const measurements = normalizeMeasurements(measurementsRaw);

    const eventLogs = [
      modelEventLog,
      gatewayEventLog,
      source.event_log,
      source.eventLog,
      source.gateway_attestation?.event_log,
      source.gateway_attestation?.eventLog,
    ];

    const eventArch = eventLogs.reduce<string | undefined>((prev, log) => {
      if (prev) return prev;
      return extractFromEventLogValue(log, ["arch", "gpu_arch", "architecture"]);
    }, undefined);

    const eventDeviceId = eventLogs.reduce<string | undefined>((prev, log) => {
      if (prev) return prev;
      return extractFromEventLogValue(log, [
        "device_id",
        "device",
        "dev_id",
        "deviceid",
      ]);
    }, undefined);

    const measurementCandidates = [
      pickFirst(candidates[0], ["measurements", "measurement", "expectedMeasurements"]),
      pickFirst(modelPayload ?? {}, ["measurements", "measurement"]),
      pickFirst(gatewayPayload ?? {}, ["measurements", "measurement"]),
      pickFirst(directPayload ?? {}, ["measurements", "measurement"]),
      extractFromEventLogValue(source.event_log, ["measurements", "measurement", "measurement_list"]),
      extractFromEventLogValue(source.gateway_attestation?.event_log, ["measurements", "measurement"]),
    ].filter(Boolean);
    const eventMeasurements =
      measurementCandidates.length > 0
        ? measurementCandidates.flatMap((item) =>
            typeof item === "string" ? item.split(/\s*,\s*/) : item
          )
        : [];

    const deviceCertFromInfo = pickFirst(source.info ?? {}, [
      "device_cert_hash",
      "deviceCertHash",
      "cert_hash",
    ]);

    const deviceCertFromEvent = extractFromEventLogValue(source.event_log, [
      "device_cert_hash",
      "cert_hash",
    ]);

    const measurementsFinal =
      measurements ??
      (eventMeasurements.length ? eventMeasurements : undefined);

    const deviceCertFinal = deviceCertHash ?? deviceCertFromInfo ?? deviceCertFromEvent;

    const archFinal = arch ?? eventArch;

    const ueidFinal = ueid ?? eventDeviceId;

    if (
      nonceFinal ||
      archFinal ||
      deviceCertFinal ||
      rimHash ||
      ueidFinal ||
      measurementsFinal
    ) {
      return {
        nonce: nonceFinal,
        arch: archFinal,
        deviceCertHash: deviceCertFinal,
        rimHash,
        ueid: ueidFinal,
        measurements: measurementsFinal,
      };
    }
  }

  console.log("[attestation expectations] extraction failed; sample sources:", {
    samples: sources
      .filter(Boolean)
      .slice(0, 2)
      .map((src) => ({
        model: src?.model,
        nonce: src?.nonce ?? src?.request_nonce ?? src?.verification?.nonce,
        keyCount: Object.keys(src ?? {}).length,
        infoKeys: src?.info ? Object.keys(src.info).slice(0, 4) : [],
        eventLogLength: Array.isArray(src?.event_log)
          ? src.event_log.length
          : 0,
      })),
  });
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
    message: missing.length
      ? `Missing expectations: ${missing.join(", ")}`
      : undefined,
  };
};

export const isCompleteExpectations = (
  expectations: PartialExpectations
): expectations is AttestationExpectations =>
  validateExpectations(expectations).complete;

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
