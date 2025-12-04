import { describe, it, expect } from "vitest";
import {
  calculateRequestHash,
  calculateResponseHash,
  calculateStreamingHash,
  validateHashPair,
} from "@/verification/hashes";

describe("request-hash", () => {
  it("calculates request hash for NEAR AI example", () => {
    const body = `{
  "messages": [
    {
      "content": "Respond with only two words.",
      "role": "user"
    }
  ],
  "stream": true,
  "model": "deepseek-v3.1"
}`;
    const hash = calculateRequestHash(body);
    expect(hash).toBe("2ec65b4a042f68d7d4520e21a7135505a5154d52aa87dbd19e9d08021ffe5c4d");
  });

  it("calculates streaming response hash for NEAR AI example", () => {
    let sse = [
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
    ].join("\n");
    sse += "\n"; // trailing newline preserved per NEAR AI docs

    const hash = calculateStreamingHash(sse);
    expect(hash).toBe("bdcfaa70301ea760ad215a2de31e80b7a69ee920c02a4b97ae05d0798b75fe79");
  });

  it("validates signature text against hash pair", () => {
    const req = "aaa";
    const res = "bbb";
    expect(validateHashPair(req, res, "aaa:bbb")).toBe(true);
    expect(validateHashPair(req, res, "AAA:BBB")).toBe(true);
    expect(validateHashPair(req, res, "wrong")).toBe(false);
  });
});
