import { Readable } from "stream";
import { StreamingBodyHelper } from "@/utils/streaming-body";

const bufferSourceToUint8Array = (source: BufferSource): Uint8Array => {
  if (ArrayBuffer.isView(source)) {
    return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  }
  return new Uint8Array(source);
};

describe("isReadableStream", () => {
  it("returns true for valid ReadableStream", () => {
    const stream = new ReadableStream<Uint8Array>();
    expect(StreamingBodyHelper.isReadableStream(stream)).toBe(true);
  });

  it("returns false for null", () => {
    expect(StreamingBodyHelper.isReadableStream(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(StreamingBodyHelper.isReadableStream(undefined)).toBe(false);
  });

  it("returns false for plain objects", () => {
    expect(StreamingBodyHelper.isReadableStream({})).toBe(false);
  });

  it("returns false for objects without getReader", () => {
    expect(StreamingBodyHelper.isReadableStream({ pipe: () => {} })).toBe(false);
  });

  it("returns true for duck-typed object with getReader function", () => {
    const fake = { getReader: () => ({ read: () => Promise.resolve({ done: true, value: undefined }) }) };
    expect(StreamingBodyHelper.isReadableStream(fake)).toBe(true);
  });
});

describe("createStreamingBody", () => {
  it("passes through valid ReadableStream unchanged", () => {
    const stream = new ReadableStream<Uint8Array>();
    const result = StreamingBodyHelper.createStreamingBody(stream);
    expect(result).toBe(stream);
  });
});

describe("createStreamingBody with Node Readable", () => {
  it("converts Node Readable to Web ReadableStream", () => {
    const nodeStream = Readable.from(["chunk1", "chunk2"]);
    const result = StreamingBodyHelper.createStreamingBody(nodeStream);
    expect(StreamingBodyHelper.isReadableStream(result)).toBe(true);
  });

  it("converted stream yields same data", async () => {
    const chunks = ["hello", "world"];
    const nodeStream = Readable.from(chunks);
    const webStream = StreamingBodyHelper.createStreamingBody(nodeStream) as ReadableStream;
    const reader = webStream.getReader();
    const results: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const decoded =
        typeof value === "string"
          ? value
          : new TextDecoder().decode(value ?? new Uint8Array());
      results.push(decoded);
    }

    expect(results.join("")).toBe("helloworld");
  });
});

describe("error handling", () => {
  it("throws for invalid source type (string)", () => {
    expect(() => {
      StreamingBodyHelper.createStreamingBody("not a stream" as any);
    }).toThrow("Unable to convert provided source into a streaming BodyInit");
  });

  it("throws for invalid source type (number)", () => {
    expect(() => {
      StreamingBodyHelper.createStreamingBody(123 as any);
    }).toThrow();
  });

  it("throws for plain object without stream interface", () => {
    expect(() => {
      StreamingBodyHelper.createStreamingBody({ data: "test" } as any);
    }).toThrow();
  });

  it("throws for array", () => {
    expect(() => {
      StreamingBodyHelper.createStreamingBody([1, 2, 3] as any);
    }).toThrow();
  });
});

describe("Node to Web stream conversion", () => {
  it("handles empty Node Readable", async () => {
    const nodeStream = Readable.from([]);
    const webStream = StreamingBodyHelper.createStreamingBody(nodeStream) as ReadableStream;
    const reader = webStream.getReader();
    const { done } = await reader.read();
    expect(done).toBe(true);
  });

  it("handles Node Readable with binary data", async () => {
    const buffer = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    const nodeStream = Readable.from([buffer]);
    const webStream = StreamingBodyHelper.createStreamingBody(nodeStream) as ReadableStream;
    const reader = webStream.getReader();
    const { value } = await reader.read();
    expect(value).toBeDefined();
    const normalized =
      value && Array.isArray((value as any).data)
        ? new Uint8Array((value as any).data)
        : value
        ? bufferSourceToUint8Array(value as BufferSource)
        : new Uint8Array();
    expect(normalized).toEqual(new Uint8Array([0x00, 0x01, 0x02, 0x03]));
  });
});

describe("Readable.toWeb requirement", () => {
  it("throws descriptive error if Readable.toWeb is unavailable", () => {
    const originalToWeb = Readable.toWeb;
    try {
      // @ts-expect-error - force removal of toWeb for guard verification
      Readable.toWeb = undefined;
      const nodeStream = Readable.from(["test"]);
      expect(() => {
        StreamingBodyHelper.createStreamingBody(nodeStream);
      }).toThrow("Node Readable.toWeb()");
    } finally {
      Readable.toWeb = originalToWeb;
    }
  });
});
