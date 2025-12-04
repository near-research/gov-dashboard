const toLower = (value?: string | null) =>
  typeof value === "string" ? value.toLowerCase() : "";

export const collectSigningAddressesFromAttestation = (att?: any): string[] => {
  if (!att || typeof att !== "object") return [];

  const addresses: string[] = [];
  const add = (addr?: string | null) => {
    if (typeof addr === "string" && addr.startsWith("0x")) {
      addresses.push(addr.toLowerCase());
    }
  };

  add(att.signing_address);
  add(att.signingAddress);
  add(att.key);

  const gateway = att.gateway_attestation;
  if (Array.isArray(gateway)) {
    gateway.forEach((node: any) => add(node?.signing_address));
  } else if (gateway) {
    add(gateway.signing_address);
  }

  const modelAtts = Array.isArray(att.model_attestations)
    ? att.model_attestations
    : [];
  modelAtts.forEach((node: any) => add(node?.signing_address));

  const allAtts = Array.isArray(att.all_attestations)
    ? att.all_attestations
    : [];
  allAtts.forEach((node: any) => add(node?.signing_address));

  return [...new Set(addresses)];
};

const stringifyReportData = (value: any): string => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
};

const tryDecodeBase64 = (value: string): string | null => {
  try {
    const normalized = value.replace(/[\r\n]/g, "");
    // Bail if it does not look like base64
    if (!/^[A-Za-z0-9+/=]+$/.test(normalized) || normalized.length % 4 !== 0) {
      return null;
    }
    const buff = Buffer.from(normalized, "base64");
    const text = buff.toString("utf8");
    return text.trim().length ? text : null;
  } catch {
    return null;
  }
};

const extractNonce = (raw: string, expectedNonce?: string | null): { match: boolean; found: string | null } => {
  const normalizedExpected = (expectedNonce || "").toLowerCase();
  const candidates: string[] = [];
  if (raw) {
    candidates.push(raw);
    const decoded = tryDecodeBase64(raw);
    if (decoded) candidates.push(decoded);
  }
  for (const candidate of candidates) {
    const matches = candidate.match(/[0-9a-f]{64}/gi);
    if (matches?.length) {
      const nonce = matches.find((n) => n.toLowerCase() === normalizedExpected);
      if (nonce) return { match: true, found: nonce.toLowerCase() };
      return { match: false, found: matches[0].toLowerCase() };
    }
  }
  return { match: false, found: null };
};

const extractSigningAddress = (raw: string, signingAddresses: string[] = []) => {
  const addresses = signingAddresses.map((addr) => addr.toLowerCase());
  const lowerRaw = raw.toLowerCase();
  const matches = lowerRaw.match(/0x[0-9a-f]{40}/gi);
  if (!matches || matches.length === 0) {
    return { match: false, found: null };
  }
  const found = matches[0].toLowerCase();
  if (addresses.length === 0) {
    return { match: false, found };
  }
  const match = addresses.includes(found);
  return { match, found };
};

export const validateIntelBinding = (
  intelParsed: any,
  expectedNonce?: string | null,
  signingAddresses: string[] = []
) => {
  const reportData =
    intelParsed?.reportData ||
    intelParsed?.report_data ||
    intelParsed?.runtimeData?.report_data ||
    intelParsed?.runtime_data?.report_data ||
    intelParsed?.runtimeData?.nonce ||
    intelParsed?.runtime_data?.nonce ||
    intelParsed?.nonce;

  const rawString = stringifyReportData(reportData);
  const decoded = tryDecodeBase64(rawString);
  const dataString = decoded || rawString;
  const lowerData = String(dataString || "").toLowerCase();
  const normalizedExpected = (expectedNonce || "").toLowerCase();

  const nonceResult = extractNonce(dataString, expectedNonce);
  const signingResult = extractSigningAddress(dataString, signingAddresses);
  const includesSigning = signingAddresses.some((addr) =>
    lowerData.includes(addr.toLowerCase())
  );

  // Require both nonce and signing address to be present and matched
  const parsedNonce =
    typeof dataString === "string"
      ? dataString.match(/nonce=([^;,\s]+)/i)?.[1]?.toLowerCase() || null
      : null;
  const nonceMatch =
    Boolean(expectedNonce) &&
    (lowerData.includes(normalizedExpected) ||
      (parsedNonce !== null && parsedNonce === normalizedExpected) ||
      nonceResult.match);
  const signingMatch =
    signingAddresses.length > 0 &&
    (signingResult.match === true || includesSigning);

  return {
    nonceMatch,
    signingMatch,
    reportDataString: dataString.toLowerCase(),
    nonceFound: nonceResult.found,
    signingFound: signingResult.found,
  };
};

export const extractComposeManifest = (att?: any): string | null => {
  if (!att || typeof att !== "object") return null;
  const sources = [
    att?.info?.compose,
    att?.gateway_attestation?.info?.compose,
    ...(Array.isArray(att?.model_attestations)
      ? att.model_attestations.map((m: any) => m?.info?.compose)
      : []),
    ...(Array.isArray(att?.all_attestations)
      ? att.all_attestations.map((m: any) => m?.info?.compose)
      : []),
  ].filter(Boolean);

  const manifest = sources.find(
    (value) => typeof value === "string" && value.trim().length > 0
  );
  return manifest ?? null;
};

export const extractMrConfig = (intelParsed: any): string | null => {
  const candidates = [
    intelParsed?.mr_config,
    intelParsed?.quote?.mr_config,
    intelParsed?.tdx_quote_body?.mr_config,
    intelParsed?.report?.mr_config,
    intelParsed?.report_data?.mr_config,
  ].filter(Boolean);
  const candidate = candidates.find(
    (value) => typeof value === "string" && value.trim().length > 0
  );
  return candidate ? candidate.toLowerCase() : null;
};

export const hashComposeManifest = (composeManifest: string): string =>
  createHash("sha256").update(composeManifest).digest("hex");
import { createHash } from "crypto";
