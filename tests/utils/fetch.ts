type FetchHandler = (url: string, init?: RequestInit) => Promise<any>;

let currentFetchHandler: FetchHandler = async () => {
  throw new Error("test fetch handler not configured");
};

export const setTestFetchHandler = (handler: FetchHandler) => {
  currentFetchHandler = handler;
};

export const resetTestFetchHandler = () => {
  currentFetchHandler = async () => {
    throw new Error("test fetch handler not configured");
  };
};

const normalizeUrl = (input: RequestInfo): string => {
  if (typeof input === "string") {
    return new URL(input, "http://localhost").toString();
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return (input as { url: string }).url;
};

export const testFetchProxy = (input: RequestInfo, init?: RequestInit) => {
  const normalized = normalizeUrl(input);
  return currentFetchHandler(normalized, init);
};
