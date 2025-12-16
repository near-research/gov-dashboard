import { Readable } from "stream";
import type { ReadableStream as NodeReadableStream } from "stream/web";

const isReadableStreamLike = (
  value: unknown
): value is ReadableStream<Uint8Array> =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Record<string, unknown>).getReader === "function";

const ensureReadableStream = (
  value: unknown
): ReadableStream<Uint8Array> | null => {
  return isReadableStreamLike(value) ? value : null;
};

const toWebStream = (nodeStream: Readable): ReadableStream<Uint8Array> => {
  if (typeof Readable.toWeb !== "function") {
    throw new Error("Node Readable.toWeb() is required for stream passthrough");
  }

  const webStream = Readable.toWeb(nodeStream);
  const validated = ensureReadableStream(webStream);
  if (!validated) {
    throw new Error("Readable.toWeb() returned an invalid ReadableStream");
  }

  return validated;
};

export const StreamingBodyHelper = {
  isReadableStream: isReadableStreamLike,

  /**
   * Convert a Node-readable stream into a fetch-friendly BodyInit.
   * This enforces runtime validation instead of casting directly.
   */
  createStreamingBody(
    source: Readable | NodeReadableStream<Uint8Array> | ReadableStream<Uint8Array>
  ): BodyInit {
    const validatedStream = ensureReadableStream(source);
    if (validatedStream) {
      return validatedStream;
    }

    if (source instanceof Readable) {
      return toWebStream(source);
    }

    throw new Error("Unable to convert provided source into a streaming BodyInit");
  },
};
