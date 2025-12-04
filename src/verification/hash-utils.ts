export const extractHashesFromSignedText = (
  signatureText?: string | null
): { requestHash: string; responseHash: string } | null => {
  if (typeof signatureText !== "string" || signatureText.trim().length === 0) {
    return null;
  }

  const sanitize = (value?: string) =>
    typeof value === "string" ? value.trim() : "";
  const [directRequest, directResponse] = signatureText
    .split(":")
    .map(sanitize);
  const hexPattern = /^[0-9a-f]{64}$/i;
  if (hexPattern.test(directRequest) && hexPattern.test(directResponse)) {
    return {
      requestHash: directRequest,
      responseHash: directResponse,
    };
  }

  const matches = signatureText.match(/[0-9a-f]{64}/gi);
  if (matches && matches.length >= 2) {
    return {
      requestHash: matches[0],
      responseHash: matches[1],
    };
  }

  return null;
};

/**
 * Validates that a signature text matches the concatenated request/response hashes.
 */
export const validateHashPair = (
  requestHash: string | null | undefined,
  responseHash: string | null | undefined,
  signatureText: string | null | undefined
): boolean => {
  if (!requestHash || !responseHash || !signatureText) return false;
  const expected = `${requestHash}:${responseHash}`.trim().toLowerCase();
  return expected === signatureText.trim().toLowerCase();
};
