"use client";

import Head from "next/head";
import { useState } from "react";

type VerificationResult = {
  verified: boolean;
  nonce?: string;
  requestHash?: string;
  responseHash?: string;
  attestedNonce?: string;
  error?: string;
};

type ChatResponse = {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: {
      role: string;
      content: string;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  verification?: VerificationResult;
  error?: string;
  message?: string;
};

type RequestState = {
  loading: boolean;
  response?: ChatResponse;
  error?: string;
  latencyMs?: number;
};

const DEMO_PROMPTS = [
  "What is NEAR Protocol in one sentence?",
  "Explain blockchain governance briefly.",
  "What makes decentralized AI verification important?",
];

const VerificationBadge = ({
  verification,
}: {
  verification?: VerificationResult;
}) => {
  if (!verification) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-700 px-3 py-1 text-xs font-medium text-zinc-300">
        <span className="h-2 w-2 rounded-full bg-zinc-500" />
        No verification
      </span>
    );
  }

  if (verification.error) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-900/50 px-3 py-1 text-xs font-medium text-amber-300">
        <span className="h-2 w-2 rounded-full bg-amber-500" />
        Verification error
      </span>
    );
  }

  if (verification.verified) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-900/50 px-3 py-1 text-xs font-medium text-emerald-300">
        <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
        Verified
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-red-900/50 px-3 py-1 text-xs font-medium text-red-300">
      <span className="h-2 w-2 rounded-full bg-red-500" />
      Unverified
    </span>
  );
};

const VerificationDetails = ({
  verification,
}: {
  verification?: VerificationResult;
}) => {
  const [expanded, setExpanded] = useState(false);

  if (!verification) return null;

  return (
    <div className="mt-3 border-t border-zinc-700 pt-3">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-zinc-400 hover:text-zinc-300 transition"
      >
        {expanded ? "▼ Hide" : "▶ Show"} verification details
      </button>
      {expanded && (
        <div className="mt-2 space-y-1 text-xs font-mono text-zinc-500">
          <p>
            <span className="text-zinc-400">verified:</span>{" "}
            {String(verification.verified)}
          </p>
          {verification.nonce && (
            <p className="truncate">
              <span className="text-zinc-400">nonce:</span> {verification.nonce}
            </p>
          )}
          {verification.requestHash && (
            <p className="truncate">
              <span className="text-zinc-400">requestHash:</span>{" "}
              {verification.requestHash}
            </p>
          )}
          {verification.responseHash && (
            <p className="truncate">
              <span className="text-zinc-400">responseHash:</span>{" "}
              {verification.responseHash}
            </p>
          )}
          {verification.attestedNonce && (
            <p className="truncate">
              <span className="text-zinc-400">attestedNonce:</span>{" "}
              {verification.attestedNonce}
            </p>
          )}
          {verification.error && (
            <p className="text-amber-400">
              <span className="text-zinc-400">error:</span> {verification.error}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default function VerificationDemoPage() {
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("deepseek-ai/DeepSeek-V3.1");
  const [state, setState] = useState<RequestState>({ loading: false });

  const handleSubmit = async () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      setState({ loading: false, error: "Please enter a prompt" });
      return;
    }

    setState({ loading: true });
    const startTime = performance.now();

    try {
      const response = await fetch("/api/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: trimmedPrompt }],
          stream: false,
          max_tokens: 256,
          temperature: 0.7,
        }),
      });

      const data: ChatResponse = await response.json();
      const latencyMs = Math.round(performance.now() - startTime);

      if (!response.ok) {
        setState({
          loading: false,
          error:
            data.message || data.error || `Request failed (${response.status})`,
          latencyMs,
        });
        return;
      }

      setState({ loading: false, response: data, latencyMs });
    } catch (err) {
      setState({
        loading: false,
        error: err instanceof Error ? err.message : "Network error",
        latencyMs: Math.round(performance.now() - startTime),
      });
    }
  };

  const assistantMessage = state.response?.choices?.[0]?.message?.content;

  return (
    <>
      <Head>
        <title>NEAR AI Verification Demo</title>
      </Head>
      <main className="min-h-screen bg-zinc-950 py-10 px-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-6">
          <header className="space-y-2 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-zinc-500">
              NEAR AI Cloud
            </p>
            <h1 className="text-2xl font-bold text-zinc-100">
              Chat Completions Verification
            </h1>
            <p className="text-sm text-zinc-400">
              Test NEAR AI inference with TEE verification
            </p>
          </header>

          {/* Input Section */}
          <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <div className="space-y-3">
              <div className="flex gap-2">
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200"
                >
                  <option value="deepseek-ai/DeepSeek-V3.1">
                    DeepSeek V3.1
                  </option>
                  <option value="openai/gpt-oss-120b">GPT-OSS 120B</option>
                  <option value="Qwen/Qwen3-30B-A3B-Instruct-2507">
                    Qwen3 30B
                  </option>
                  <option value="Zhipu/GLM-4.6-FP8">GLM 4.6</option>
                </select>
              </div>

              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Enter your prompt..."
                rows={3}
                className="w-full resize-none rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none"
              />

              <div className="flex flex-wrap gap-2">
                {DEMO_PROMPTS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPrompt(p)}
                    className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300 transition"
                  >
                    {p.length > 35 ? p.slice(0, 35) + "…" : p}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={handleSubmit}
                disabled={state.loading}
                className="w-full rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {state.loading ? "Running..." : "Run Completion"}
              </button>
            </div>
          </section>

          {/* Response Section */}
          {(state.response || state.error) && (
            <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <h2 className="text-sm font-medium text-zinc-300">
                    Response
                  </h2>
                  <VerificationBadge
                    verification={state.response?.verification}
                  />
                </div>
                {state.latencyMs !== undefined && (
                  <span className="text-xs text-zinc-500">
                    {state.latencyMs}ms
                  </span>
                )}
              </div>

              {state.error ? (
                <p className="mt-3 text-sm text-red-400">{state.error}</p>
              ) : assistantMessage ? (
                <div className="mt-3 rounded bg-zinc-800/50 px-3 py-2">
                  <p className="text-sm text-zinc-200 whitespace-pre-wrap">
                    {assistantMessage}
                  </p>
                </div>
              ) : (
                <p className="mt-3 text-sm text-zinc-500">
                  No content in response
                </p>
              )}

              {state.response?.usage && (
                <p className="mt-2 text-xs text-zinc-500">
                  Tokens: {state.response.usage.prompt_tokens} in /{" "}
                  {state.response.usage.completion_tokens} out
                </p>
              )}

              <VerificationDetails
                verification={state.response?.verification}
              />
            </section>
          )}

          {/* Info */}
          <p className="text-center text-xs text-zinc-600">
            Responses are generated in NEAR AI's Trusted Execution Environment.
            <br />
            Verification confirms the response hasn't been tampered with.
          </p>
        </div>
      </main>
    </>
  );
}
