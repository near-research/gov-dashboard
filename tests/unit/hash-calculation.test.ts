import { describe, it, expect } from "vitest";
import {
  calculateRequestHash,
  calculateResponseHash,
  calculateStreamingHash,
  validateHashPair,
} from "@/verification/hashes";
import { computeRequestHash } from "@/verification/server";

// Official NEAR AI example payloads
const officialRequestBody = `{
  "messages": [
    {
      "content": "Respond with only two words.",
      "role": "user"
    }
  ],
  "stream": true,
  "model": "deepseek-v3.1"
}`;
const officialRequestHash =
  "2ec65b4a042f68d7d4520e21a7135505a5154d52aa87dbd19e9d08021ffe5c4d";
const officialResponseHash =
  "bdcfaa70301ea760ad215a2de31e80b7a69ee920c02a4b97ae05d0798b75fe79";

// SSE stream from docs; trailing newline must be preserved for correct hash
const sseLines = [
  `data: {"id":"chatcmpl-f42e8ae7ddb346e1adfba47e3d710b46","object":"chat.completion.chunk","created":1760031300,"model":"deepseek-ai/DeepSeek-V3.1","choices":[{"index":0,"delta":{"role":"assistant","content":""},"logprobs":null,"finish_reason":null}],"prompt_token_ids":null}`,
  ``,
  `data: {"id":"chatcmpl-f42e8ae7ddb346e1adfba47e3d710b46","object":"chat.completion.chunk","created":1760031300,"model":"deepseek-ai/DeepSeek-V3.1","choices":[{"index":0,"delta":{"content":"Okay"},"logprobs":null,"finish_reason":null,"token_ids":null}]}`,
  ``,
  `data: {"id":"chatcmpl-f42e8ae7ddb346e1adfba47e3d710b46","object":"chat.completion.chunk","created":1760031300,"model":"deepseek-ai/DeepSeek-V3.1","choices":[{"index":0,"delta":{"content":"."},"logprobs":null,"finish_reason":null,"token_ids":null}]}`,
  ``,
  `data: {"id":"chatcmpl-f42e8ae7ddb346e1adfba47e3d710b46","object":"chat.completion.chunk","created":1760031300,"model":"deepseek-ai/DeepSeek-V3.1","choices":[{"index":0,"delta":{"content":" Sure"},"logprobs":null,"finish_reason":null,"token_ids":null}]}`,
  ``,
  `data: {"id":"chatcmpl-f42e8ae7ddb346e1adfba47e3d710b46","object":"chat.completion.chunk","created":1760031300,"model":"deepseek-ai/DeepSeek-V3.1","choices":[{"index":0,"delta":{"content":"."},"logprobs":null,"finish_reason":null,"token_ids":null}]}`,
  ``,
  `data: {"id":"chatcmpl-f42e8ae7ddb346e1adfba47e3d710b46","object":"chat.completion.chunk","created":1760031300,"model":"deepseek-ai/DeepSeek-V3.1","choices":[{"index":0,"delta":{"content":""},"logprobs":null,"finish_reason":"stop","stop_reason":null,"token_ids":null}]}`,
  ``,
  `data: [DONE]`,
  ``,
];

describe("request/response hash calculation", () => {
  it("matches official NEAR AI request/response hashes", () => {
    const reqHash = calculateRequestHash(officialRequestBody);
    const sseWithTrailing = sseLines.join("\n") + "\n";
    const resHash = calculateResponseHash(sseWithTrailing);
    expect(reqHash).toBe(officialRequestHash);
    expect(resHash).toBe(officialResponseHash);
    expect(validateHashPair(reqHash, resHash, `${reqHash}:${resHash}`)).toBe(true);
  });

  it("detects mismatched signature text", () => {
    const reqHash = calculateRequestHash(officialRequestBody);
    const resHash = officialResponseHash;
    expect(validateHashPair(reqHash, resHash, `${resHash}:${reqHash}`)).toBe(false);
  });

  it("rejects signature text with extra prefix/suffix", () => {
    const reqHash = calculateRequestHash(officialRequestBody);
    const resHash = officialResponseHash;
    expect(validateHashPair(reqHash, resHash, `extra:${reqHash}:${resHash}`)).toBe(
      false
    );
    expect(validateHashPair(reqHash, resHash, `${reqHash}:${resHash}:extra`)).toBe(
      false
    );
  });

  it("preserves trailing newline for streaming hashes", () => {
    const sseWithTrailing = sseLines.join("\n") + "\n";
    const hash = calculateStreamingHash(sseWithTrailing);
    expect(hash).toBe(officialResponseHash);
  });

  it("changes when trailing newline is trimmed", () => {
    const sseTrimmed = sseLines.join("\n");
    const hashTrimmed = calculateStreamingHash(sseTrimmed);
    expect(hashTrimmed).not.toBe(officialResponseHash);
  });

  it("handles unicode content", () => {
    const body = '{"messages":[{"content":"你好，世界 🌎","role":"user"}]}';
    const hash = calculateRequestHash(body);
    expect(hash).toBe(calculateRequestHash(body)); // deterministic
    expect(hash).not.toBe(calculateRequestHash(body + " "));
  });

  it("treats formatting differences as distinct bodies", () => {
    const compact = '{"foo":"bar","baz":[1,2]}';
    const pretty = '{\n  "foo": "bar",\n  "baz": [1, 2]\n}';
    expect(calculateRequestHash(compact)).not.toBe(calculateRequestHash(pretty));
  });

  it("returns valid hash for empty body", () => {
    const emptyHash = calculateRequestHash("");
    expect(emptyHash).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(validateHashPair(emptyHash, officialResponseHash, `${emptyHash}:${officialResponseHash}`)).toBe(true);
  });

  it("rejects non-string request bodies", () => {
    expect(() => calculateRequestHash({ foo: "bar" } as any)).toThrow(
      /exact serialized request string/
    );
    expect(() => computeRequestHash({ foo: "bar" } as any)).toThrow(
      /exact serialized request string/
    );
  });
});
