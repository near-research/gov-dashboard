const FILE_URL_HOST_ERROR_CODE = "ERR_INVALID_FILE_URL_HOST";
const FILE_URL_HOST_MESSAGE = 'File URL host must be "localhost" or empty on darwin';

const friendlyMessage =
  "macOS forbids loading file URLs whose host is not localhost, so the hosted Discourse plugin can't be loaded from the baked-in Zephyr entry point. " +
  "Run the plugin on localhost (see README: `cd discourse-plugin && bun run dev`) and point `DISCOURSE_PLUGIN_URL` at that `remoteEntry.js`, or use a host that resolves to localhost.";

const extractErrorChain = (error: unknown): Array<unknown> => {
  const chain: Array<unknown> = [];
  let current: any = error;
  while (current && !chain.includes(current)) {
    chain.push(current);
    current = current?.cause;
  }
  return chain;
};

export const isFileUrlHostError = (error: unknown): boolean => {
  const chain = extractErrorChain(error);
  return chain.some(
    (entry) =>
      (entry as any)?.code === FILE_URL_HOST_ERROR_CODE ||
      typeof (entry as any)?.message === "string" &&
        (entry as any)?.message?.includes(FILE_URL_HOST_MESSAGE),
  );
};

export const wrapDiscoursePluginError = (error: unknown): never => {
  if (isFileUrlHostError(error)) {
    const hintError = new Error(friendlyMessage);
    (hintError as any).cause = error;
    console.warn("[discourse-plugin] Could not load remote container", { error });
    throw hintError;
  }
  throw error;
};

export const discoursePluginHintMessage = friendlyMessage;
