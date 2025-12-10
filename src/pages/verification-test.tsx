"use client";

import { ChevronDown } from "lucide-react";
import { FormEvent, useCallback, useState } from "react";
import { VerificationProof } from "@/components/verification/VerificationProof";
import type { TextSummaryResponse } from "@/types/summaries";

type FormState = {
  verificationId: string;
  requestHash: string;
  responseHash: string;
  model: string;
  signingAlgo: "ecdsa" | "ed25519";
  authToken: string;
};

const DEFAULT_MODEL = "deepseek-ai/DeepSeek-V3.1";

export default function VerificationTestPage() {
  const [form, setForm] = useState<FormState>({
    verificationId: "",
    requestHash: "",
    responseHash: "",
    model: DEFAULT_MODEL,
    signingAlgo: "ecdsa",
    authToken: "",
  });
  const [loading, setLoading] = useState(false);
  const [responseText, setResponseText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [houseSummary, setHouseSummary] = useState<TextSummaryResponse | null>(
    null
  );
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);

  const handleChange =
    (key: keyof FormState) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setForm((prev) => ({ ...prev, [key]: event.target.value }));
    };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setResponseText(null);

    try {
      const payload = {
        verificationId: form.verificationId || undefined,
        requestHash: form.requestHash || undefined,
        responseHash: form.responseHash || undefined,
        model: form.model || undefined,
        signingAlgo: form.signingAlgo,
      };

      const headers: HeadersInit = {
        "Content-Type": "application/json",
      };
      if (form.authToken) {
        headers.Authorization = `Bearer ${form.authToken.trim()}`;
      }

      const res = await fetch("/api/verification/proof", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      const text = await res.text();
      if (!res.ok) {
        throw new Error(text || `Request failed with ${res.status}`);
      }

      setResponseText(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSummarize = useCallback(async () => {
    setIsSummarizing(true);
    setSummaryError(null);
    setHouseSummary(null);
    try {
      const res = await fetch("/api/summarize/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const payload = (await res.json()) as TextSummaryResponse & {
        error?: string;
      };
      if (!res.ok || !payload?.success) {
        throw new Error(payload?.error || "Failed to summarize");
      }
      setHouseSummary(payload);
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSummarizing(false);
    }
  }, []);

  return (
    <div className="max-w-2xl mx-auto space-y-6 px-4 py-8">
      <header>
        <h1 className="text-3xl font-semibold text-slate-900">
          NEAR AI Verification Test
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Provide a verification session and hashes to inspect the proof
          response.
        </p>
      </header>

      <details className="group mt-4 rounded-lg border border-border/80 bg-muted/40 text-sm text-slate-700 [&_summary::-webkit-details-marker]:hidden">
        <summary
          aria-label="Toggle manual verification inputs"
          className="cursor-pointer flex items-center justify-between px-4 py-3 font-semibold text-slate-900"
        >
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-900">
            Manual
          </span>
          <ChevronDown className="h-4 w-4 transition-transform duration-150 group-open:rotate-180" />
        </summary>
        <form onSubmit={handleSubmit} className="space-y-4 px-4 pb-4">
          <label className="block space-y-1 text-sm text-slate-700">
            <span>Verification ID</span>
            <input
              value={form.verificationId}
              onChange={handleChange("verificationId")}
              placeholder="chatcmpl-..."
              className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1 text-sm text-slate-700">
              <span>Request Hash</span>
              <input
                value={form.requestHash}
                onChange={handleChange("requestHash")}
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-xs font-mono focus:outline-none focus:ring"
              />
            </label>
            <label className="block space-y-1 text-sm text-slate-700">
              <span>Response Hash</span>
              <input
                value={form.responseHash}
                onChange={handleChange("responseHash")}
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-xs font-mono focus:outline-none focus:ring"
              />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1 text-sm text-slate-700">
              <span>Model</span>
              <input
                value={form.model}
                onChange={handleChange("model")}
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring"
              />
            </label>
            <label className="block space-y-1 text-sm text-slate-700">
              <span>Signing Algo</span>
              <select
                value={form.signingAlgo}
                onChange={handleChange("signingAlgo")}
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring"
              >
                <option value="ecdsa">ECDSA</option>
                <option value="ed25519">Ed25519</option>
              </select>
            </label>
          </div>

          <label className="block space-y-1 text-sm text-slate-700">
            <span>Bearer Token (optional)</span>
            <input
              value={form.authToken}
              onChange={handleChange("authToken")}
              placeholder="Bearer token from NEP-413 signer"
              className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring"
            />
          </label>

          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center justify-center rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {loading ? "Fetching proof…" : "Fetch verification proof"}
          </button>
        </form>
      </details>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          <strong>Error:</strong> {error}
        </div>
      )}

      {responseText && (
        <section className="space-y-2 rounded-lg border border-border/80 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold">Proof response</h2>
              <p className="text-xs text-slate-500">
                The NEAR AI proof result will appear here along with a badge.
              </p>
            </div>
            <span className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              ✅ Test verification badge
            </span>
          </div>
          <div className="min-h-[80px] rounded bg-slate-950/90 p-3 text-[12px] text-slate-100">
            {responseText ? (
              <pre className="whitespace-pre-wrap">{responseText}</pre>
            ) : (
              <p className="text-xs text-slate-400">
                Awaiting proof response...
              </p>
            )}
          </div>
        </section>
      )}

      <section className="space-y-3 rounded-lg border border-border/80 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h2 className="text-base font-semibold">Test Verification</h2>
            <p className="text-xs text-slate-500">NEAR AI Cloud</p>
          </div>
          <div className="flex items-center gap-2">
            <VerificationProof
              verification={houseSummary?.verification ?? undefined}
              verificationId={houseSummary?.verificationId ?? undefined}
              model={houseSummary?.model ?? undefined}
              requestHash={houseSummary?.proof?.requestHash ?? undefined}
              responseHash={houseSummary?.proof?.responseHash ?? undefined}
              nonce={houseSummary?.proof?.nonce ?? undefined}
              expectedArch={houseSummary?.proof?.arch ?? undefined}
              expectedDeviceCertHash={
                houseSummary?.proof?.deviceCertHash ?? undefined
              }
              expectedRimHash={houseSummary?.proof?.rimHash ?? undefined}
              expectedUeid={houseSummary?.proof?.ueid ?? undefined}
              expectedMeasurements={
                houseSummary?.proof?.measurements ?? undefined
              }
              prefetchedProof={houseSummary?.remoteProof ?? undefined}
              triggerLabel="View verification proof"
              className="cursor-default"
            />
          </div>
          <button
            type="button"
            onClick={handleSummarize}
            disabled={isSummarizing}
            className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            {isSummarizing ? "Summarizing…" : "Summarize"}
          </button>
        </div>
        {summaryError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <strong>Error:</strong> {summaryError}
          </div>
        )}

        <div className="mt-2 rounded border border-dashed border-border/60 bg-slate-50 p-3 min-h-[84px]">
          {houseSummary ? (
            <p className="text-sm text-slate-700 whitespace-pre-line">
              {houseSummary.summary}
            </p>
          ) : (
            <p className="text-xs text-slate-400">Awaiting response...</p>
          )}
        </div>
      </section>
    </div>
  );
}
