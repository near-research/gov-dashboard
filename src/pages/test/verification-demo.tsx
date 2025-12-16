"use client";

import Head from "next/head";
import { useState } from "react";
import { VerificationBadge, type VerificationInfo } from "@/components/VerificationBadge";

type DemoVerificationResult = VerificationInfo & {
  verified: boolean;
  nonce?: string;
  requestHash?: string;
  responseHash?: string;
  attestedNonce?: string;
  error?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
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
  verification?: DemoVerificationResult;
  error?: string;
  message?: string;
};

type RequestState = {
  loading: boolean;
  response?: ChatResponse;
  error?: string;
  latencyMs?: number;
};

type AttestationData = {
  model: string;
  fetchedAt: string;
  teeAddresses: string[];
  hasNvidiaPayload: boolean;
  raw: unknown;
};

type AttestationState = {
  loading: boolean;
  data?: AttestationData;
  error?: string;
  latencyMs?: number;
};

const DEMO_PROMPTS = [
  "What is NEAR Protocol in one sentence?",
  "Explain blockchain governance briefly.",
  "What makes decentralized AI verification important?",
];

const VerificationDetails = ({
  verification,
}: {
  verification?: DemoVerificationResult;
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
  const [streamingText, setStreamingText] = useState("");
  const [useStreaming, setUseStreaming] = useState(true);
  const [attestationState, setAttestationState] = useState<AttestationState>({
    loading: false,
  });

  const handleSubmit = async () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      setState({ loading: false, error: "Please enter a prompt" });
      return;
    }

    setState({ loading: true });
    setStreamingText("");
    const startTime = performance.now();

    try {
      const response = await fetch("/api/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: trimmedPrompt }],
          stream: useStreaming,
          max_tokens: 256,
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let parsedError: unknown = errorText;
        try {
          parsedError = JSON.parse(errorText);
        } catch {
          // ignore non-JSON error
        }
        const latencyMs = Math.round(performance.now() - startTime);
        let message = `Request failed (${response.status})`;
        if (typeof parsedError === "object" && parsedError !== null) {
          const parsedObject = parsedError as {
            message?: string;
            error?: string;
          };
          message = parsedObject.message || parsedObject.error || message;
        }
        setState({
          loading: false,
          error: message,
          latencyMs,
        });
        return;
      }

      if (!useStreaming) {
        const data: ChatResponse = await response.json();
        const latencyMs = Math.round(performance.now() - startTime);
        setState({ loading: false, response: data, latencyMs });
        return;
      }

      if (!response.body) {
        throw new Error("Response stream is empty");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantText = "";
      let finalVerification: DemoVerificationResult | undefined;
      let parsedChatId: string | undefined;
      let streamDone = false;

      const processEvent = (rawEvent: string) => {
        const trimmedEvent = rawEvent.trim();
        if (!trimmedEvent) return;

        const lines = trimmedEvent.split(/\r?\n/);
        let didAppend = false;

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          if (payload === "[DONE]") {
            streamDone = true;
            continue;
          }

          let parsed: unknown;
          try {
            parsed = JSON.parse(payload);
          } catch {
            continue;
          }

          if (!parsedChatId && parsed && typeof parsed === "object") {
            const id = (parsed as Record<string, unknown>).id;
            if (typeof id === "string") {
              parsedChatId = id;
            }
          }

          const parsedObject =
            parsed && typeof parsed === "object"
              ? (parsed as Record<string, unknown>)
              : null;

          const verificationPayload =
            (parsedObject?.verification as DemoVerificationResult | undefined) ??
            (parsedObject?.verificationResult as DemoVerificationResult | undefined);
          if (verificationPayload && typeof verificationPayload === "object") {
            finalVerification = verificationPayload;
            continue;
          }

          const parsedChoices = parsedObject?.choices as
            | Array<{
                delta?: { content?: string };
                message?: { content?: string };
              }>
            | undefined;
          const chunkChoice = parsedChoices?.[0];

          const deltaContent =
            chunkChoice?.delta && typeof chunkChoice.delta.content === "string"
              ? chunkChoice.delta.content
              : "";
          if (deltaContent) {
            assistantText += deltaContent;
            didAppend = true;
          } else {
            const messageContent =
              chunkChoice?.message &&
              typeof chunkChoice.message.content === "string"
                ? chunkChoice.message.content
                : "";
            if (messageContent) {
              assistantText += messageContent;
              didAppend = true;
            }
          }
        }

        if (didAppend) {
          setStreamingText(assistantText);
        }
      };

      const flushBuffer = (force = false) => {
        let delimiterIndex: number;
        while ((delimiterIndex = buffer.indexOf("\n\n")) !== -1) {
          const rawEvent = buffer.slice(0, delimiterIndex);
          buffer = buffer.slice(delimiterIndex + 2);
          processEvent(rawEvent);
          if (streamDone) {
            break;
          }
        }

        if (force && buffer.trim()) {
          processEvent(buffer);
          buffer = "";
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          flushBuffer();
        }
        if (done || streamDone) {
          const tail = decoder.decode();
          if (tail) {
            buffer += tail;
          }
          flushBuffer(true);
          break;
        }
      }

      const latencyMs = Math.round(performance.now() - startTime);
      setState({
        loading: false,
        response: {
          id: parsedChatId,
          choices: [
            {
              message: {
                role: "assistant",
                content: assistantText,
              },
            },
          ],
          verification: finalVerification,
        },
        latencyMs,
      });
    } catch (err) {
      const latencyMs = Math.round(performance.now() - startTime);
      setState({
        loading: false,
        error: err instanceof Error ? err.message : "Network error",
        latencyMs,
      });
    }
  };

  const handleFetchAttestation = async () => {
    setAttestationState({ loading: true });
    const startTime = performance.now();

    try {
      const response = await fetch(
        `/api/verification/attestation?model=${encodeURIComponent(model)}`
      );
      const data = await response.json();
      const latencyMs = Math.round(performance.now() - startTime);

      if (!response.ok) {
        setAttestationState({
          loading: false,
          error:
            data.message ||
            data.error ||
            `Request failed (${response.status})`,
          latencyMs,
        });
        return;
      }

      setAttestationState({ loading: false, data, latencyMs });
    } catch (err) {
      setAttestationState({
        loading: false,
        error: err instanceof Error ? err.message : "Network error",
        latencyMs: Math.round(performance.now() - startTime),
      });
    }
  };

  const assistantMessage =
    state.loading && useStreaming
      ? streamingText
      : state.response?.choices?.[0]?.message?.content;

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

              <div className="flex items-center justify-between text-xs text-zinc-400">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={useStreaming}
                    onChange={(event) => setUseStreaming(event.target.checked)}
                    className="h-4 w-4 rounded border border-zinc-600 bg-zinc-800 text-emerald-500 focus:ring-0"
                  />
                  Streaming mode
                </label>
                <span className="text-zinc-500">
                  {useStreaming
                    ? "SSE responses with verification"
                    : "Standard JSON response"}
                </span>
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

          {/* Attestation Section */}
          <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-medium text-zinc-300">
                  Model Attestation
                </h2>
                <p className="text-xs text-zinc-500 mt-1">
                  Fetch TEE signing addresses for {model}
                </p>
              </div>
              <button
                type="button"
                onClick={handleFetchAttestation}
                disabled={attestationState.loading}
                className="rounded bg-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-zinc-600 disabled:opacity-50"
              >
                {attestationState.loading ? "Fetching..." : "Fetch Attestation"}
              </button>
            </div>

            {attestationState.error && (
              <p className="mt-3 text-sm text-red-400">
                {attestationState.error}
              </p>
            )}

            {attestationState.data && (
              <div className="mt-3">
                <div className="flex items-center gap-2">
                  {attestationState.latencyMs && (
                    <span className="text-xs text-zinc-500">
                      {attestationState.latencyMs}ms
                    </span>
                  )}
                  <span className="text-xs text-zinc-500">
                    {attestationState.data.fetchedAt}
                  </span>
                </div>

                <div className="mt-2 space-y-1">
                  <p className="text-xs font-medium text-zinc-400">
                    TEE Signing Addresses (
                    {attestationState.data.teeAddresses.length}):
                  </p>
                  {attestationState.data.teeAddresses.map((addr, i) => (
                    <p key={i} className="text-xs font-mono text-emerald-400">
                      {addr}
                    </p>
                  ))}
                  {attestationState.data.hasNvidiaPayload && (
                    <p className="text-xs text-zinc-500 mt-1">
                      ✓ NVIDIA attestation available
                    </p>
                  )}
                </div>

                <details className="mt-3">
                  <summary className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-400">
                    View raw attestation response
                  </summary>
                  <pre className="mt-2 max-h-64 overflow-auto rounded bg-zinc-800/50 px-3 py-2 text-xs text-zinc-400">
                    {JSON.stringify(attestationState.data.raw, null, 2)}
                  </pre>
                </details>
              </div>
            )}
          </section>

          {/* Response Section */}
          {(state.response || state.error || state.loading) && (
            <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <h2 className="text-sm font-medium text-zinc-300">
                    Response
                  </h2>
                  <VerificationBadge
                    verification={state.response?.verification ?? null}
                  />
                  {state.loading && useStreaming && (
                    <span className="text-xs text-zinc-500">Streaming...</span>
                  )}
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
              ) : state.loading && useStreaming ? (
                <p className="mt-3 text-sm text-zinc-500">Streaming response...</p>
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
            Responses are generated in NEAR AI&apos;s Trusted Execution
            Environment.
            <br />
            Verification confirms the response hasn&apos;t been tampered with.
          </p>
        </div>
      </main>
    </>
  );
}
