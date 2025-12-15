export const parseJsonSafe = (
  value: string | null | undefined
): Record<string, unknown> | null => {
  if (!value || value.trim().length === 0) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

export const readJsonSafe = async (
  response?: { json?: () => Promise<unknown> }
): Promise<Record<string, unknown> | null> => {
  if (!response || typeof response.json !== "function") return null;
  try {
    const parsed = await response.json();
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};
