"use client";

import { FormEvent, useCallback, useState } from "react";
import type { VerificationResult } from "@/lib/verification";

const DEFAULT_MODEL = "deepseek-ai/DeepSeek-V3.1";
const DEFAULT_PROMPT = "In a few sentences, tell me something I don't know.";

type FormState = {
  prompt: string;
  model: string;
  signingAlgo: "ecdsa" | "ed25519";
};

export default function VerificationTestPage() {
  const [form, setForm] = useState<FormState>({
    prompt: DEFAULT_PROMPT,
    model: DEFAULT_MODEL,
    signingAlgo: "ecdsa",
  });
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [verificationResult, setVerificationResult] = useState<VerificationResult | null>(null);
  const [requestBody, setRequestBody] = useState<string | null>(null);
  const [responseText, setResponseText] = useState<string | null>(null);

  const handleChange =
    (key: keyof FormState) =>
    (
      event: React.ChangeEvent<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >
    ) => {
      setForm((prev) => ({ ...prev, [key]: event.target.value }));
    };

  const handleRunVerification = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setIsVerifying(true);
      setVerificationError(null);
      setVerificationResult(null);
      setRequestBody(null);
      setResponseText(null);

      try {
        const res = await fetch("/api/verification/simple", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: form.prompt,
            model: form.model,
            signingAlgo: form.signingAlgo,
          }),
        });

        const payload = await res.json();
        if (!res.ok || !payload?.success) {
          throw new Error(payload?.error || "Verification request failed");
        }

        setRequestBody(payload.requestBody ?? null);
        setResponseText(payload.verification?.responseText ?? null);
        setVerificationResult(payload.verification ?? null);
      } catch (err) {
        setVerificationError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsVerifying(false);
      }
    },
    [form]
  );

  const hashValidation = verificationResult?.hashValidation;
  const signatureValidation = verificationResult?.signatureValidation;

  return (
    <div className="max-w-2xl mx-auto space-y-6 px-4 py-8">
      <header>
        <h1 className="text-3xl font-semibold text-slate-900">
          Simplified NEAR AI Verification
        </h1>
        <p className="text-sm text-slate-500">
          Sends a chat completion through the NEAR AI Cloud, hashes the request
          and response, and validates the attached signature against known TEE
          addresses.
        </p>
      </header>

      <section className="space-y-4 rounded-lg border border-border/60 bg-white p-4 shadow-sm">
        <form onSubmit={handleRunVerification} className="space-y-4">
          <div className="space-y-1">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Prompt
            </label>
            <textarea
              rows={4}
              value={form.prompt}
              onChange={handleChange("prompt")}
              className="w-full rounded-md border border-border/60 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <label className="flex-1 min-w-[160px] space-y-1 text-[11px] text-slate-500">
              <span className="font-semibold text-slate-700">Model</span>
              <input
                type="text"
                value={form.model}
                onChange={handleChange("model")}
                className="w-full rounded-md border border-border/60 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
              />
            </label>
            <label className="min-w-[140px] space-y-1 text-[11px] text-slate-500">
              <span className="font-semibold text-slate-700">Signing algo</span>
              <select
                value={form.signingAlgo}
                onChange={handleChange("signingAlgo")}
                className="w-full rounded-md border border-border/60 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
              >
                <option value="ecdsa">ecdsa</option>
                <option value="ed25519">ed25519</option>
              </select>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={isVerifying}
              className="rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white disabled:opacity-50"
            >
              {isVerifying ? "Verifying…" : "Run verification"}
            </button>
            <p className="text-xs text-slate-500">
              This replay call sends the exact request JSON and validates NEAR AI
              signatures on the response hash.
            </p>
          </div>
        </form>

        {verificationError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <strong>Error:</strong> {verificationError}
          </div>
        )}

        {verificationResult && (
          <div className="space-y-3 rounded-lg border border-border/60 bg-slate-50/80 p-3 text-xs text-slate-700">
            <p className="text-sm font-semibold text-slate-900">
              Verified:{" "}
              <span
                className={`font-semibold ${
                  verificationResult.verified ? "text-emerald-600" : "text-rose-600"
                }`}
              >
                {verificationResult.verified ? "Yes" : "No"}
              </span>
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-[10px] uppercase text-slate-500">Request hash</p>
                <p className="font-mono text-[11px] text-slate-800 break-words">
                  {verificationResult.requestHash}
                </p>
                <p className="text-[11px] text-slate-500">
                  Match: {hashValidation?.requestHashMatch ? "✓" : "✗"}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-slate-500">Response hash</p>
                <p className="font-mono text-[11px] text-slate-800 break-words">
                  {verificationResult.responseHash}
                </p>
                <p className="text-[11px] text-slate-500">
                  Match: {hashValidation?.responseHashMatch ? "✓" : "✗"}
                </p>
              </div>
            </div>
            {signatureValidation && (
              <div className="space-y-1 rounded border border-border/60 bg-white/60 p-2 text-[11px] text-slate-600">
                <p className="text-[10px] uppercase text-slate-500">Signature</p>
                <p>
                  <span className="font-semibold text-slate-700">Recovered:</span>{" "}
                  {signatureValidation.recoveredAddress ?? "N/A"}
                </p>
                <p>
                  <span className="font-semibold text-slate-700">Valid:</span>{" "}
                  {signatureValidation.valid ? "Yes" : "No"}
                </p>
            {signatureValidation.attestedAddresses.length > 0 && (
              <p className="text-[10px] text-slate-500">
                Attested:{" "}
                {signatureValidation.attestedAddresses
                  .map((attestedAddr) => attestedAddr.toLowerCase())
                  .join(", ")}
              </p>
            )}
              </div>
            )}
            {verificationResult.signature?.text && (
              <details className="text-[11px] text-slate-600">
                <summary className="cursor-pointer font-semibold text-slate-700">
                  Signed hash text
                </summary>
                <pre className="mt-1 rounded border border-border/60 bg-white/70 p-2 text-[10px] text-slate-700">
                  {verificationResult.signature.text}
                </pre>
              </details>
            )}
          </div>
        )}

        {responseText && (
          <div className="space-y-1 rounded-lg border border-border/60 bg-white/60 p-3 text-xs text-slate-700">
            <p className="text-[10px] uppercase text-slate-500">Response preview</p>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-[10px]">
              {responseText}
            </pre>
          </div>
        )}

        {requestBody && (
          <div className="space-y-1 rounded-lg border border-dashed border-border/60 bg-slate-900/70 p-3 text-[10px] text-slate-100">
            <p className="text-[10px] uppercase text-slate-200">Request payload</p>
            <pre className="max-h-[200px] overflow-auto whitespace-pre-wrap text-[10px]">
              {requestBody}
            </pre>
          </div>
        )}
      </section>
    </div>
  );
}
