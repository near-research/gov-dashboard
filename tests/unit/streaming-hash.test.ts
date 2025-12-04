import { describe, it, expect } from "vitest";
import { calculateStreamingHash } from "@/verification/hashes";

describe("Streaming hash compliance with trailing newlines", () => {
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

  it("matches official hash when trailing newline is preserved", () => {
    const sse = sseLines.join("\n") + "\n";
    const hash = calculateStreamingHash(sse);
    expect(hash).toBe("bdcfaa70301ea760ad215a2de31e80b7a69ee920c02a4b97ae05d0798b75fe79");
  });

  it("changes hash when trailing newline is trimmed (should not verify)", () => {
    const sse = sseLines.join("\n"); // missing final newline
    const hash = calculateStreamingHash(sse);
    expect(hash).not.toBe("bdcfaa70301ea760ad215a2de31e80b7a69ee920c02a4b97ae05d0798b75fe79");
  });
});
