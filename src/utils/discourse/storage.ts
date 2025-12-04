const STORAGE_KEY = "discourseUserApiKey";

export const saveDiscourseUserApiKey = (value: string | null | undefined) => {
  if (typeof window === "undefined") return;
  try {
    if (value && value.trim()) {
      window.localStorage.setItem(STORAGE_KEY, value.trim());
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors (e.g., opaque origins in tests)
  }
};

export const getDiscourseUserApiKey = (): string | null => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

export const clearDiscourseUserApiKey = () => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // noop
  }
};
