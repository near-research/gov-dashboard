"use client";

import Head from "next/head";
import type { FormEvent, ReactNode } from "react";
import { useState } from "react";

type ApiState = {
  loading: boolean;
  url?: string;
  data?: unknown;
  error?: string;
};

const fetchJson = async (path: string, payload: unknown) => {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "message" in body
        ? (body as { message?: string }).message
        : undefined;
    throw new Error(message ?? `Request failed (${response.status})`);
  }
  return body;
};

const JsonViewer = ({ value }: { value?: unknown }) => {
  if (!value) {
    return (
      <p className="text-sm text-muted-foreground">
        No response yet — run the request to inspect the payload.
      </p>
    );
  }
  return (
    <pre className="mt-3 max-h-64 overflow-auto rounded border border-border bg-muted px-3 py-2 text-xs text-foreground">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
};

const Section = ({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) => (
  <section className="rounded-lg border border-border bg-background-secondary/80 p-4 shadow-sm">
    <div className="mb-3 space-y-1">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      {description ? (
        <p className="text-sm text-muted-foreground">{description}</p>
      ) : null}
    </div>
    {children}
  </section>
);

const InputRow = ({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) => (
  <label className="flex flex-col gap-1 text-sm text-foreground">
    <span className="font-medium text-foreground/70">{label}</span>
    {children}
  </label>
);

export default function VerificationDemoPage() {
  const [verificationId, setVerificationId] = useState("demo-verification");
  const [nonceOverride, setNonceOverride] = useState("");
  const [requestHash, setRequestHash] = useState("");
  const [responseHash, setResponseHash] = useState("");
  const [attestedNonce, setAttestedNonce] = useState("");

  const [sessionState, setSessionState] = useState<ApiState>({ loading: false });
  const [proofState, setProofState] = useState<ApiState>({ loading: false });

  const renderState = (state: ApiState) => (
    <div className="mt-3 space-y-2 text-sm">
      <p className="text-xs uppercase tracking-[0.32em] text-muted-foreground">
        {state.url ?? "No request yet"}
      </p>
      {state.loading && <p className="text-foreground">Loading…</p>}
      {state.error && (
        <p className="text-sm text-destructive">Error: {state.error}</p>
      )}
      {!state.loading && !state.error && <JsonViewer value={state.data} />}
    </div>
  );

  const handleSessionSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!verificationId.trim()) {
      setSessionState({
        loading: false,
        error: "verificationId is required",
      });
      return;
    }
    const payload: Record<string, unknown> = { verificationId };
    if (nonceOverride.trim()) payload.nonce = nonceOverride.trim();
    if (requestHash.trim()) payload.requestHash = requestHash.trim();
    if (responseHash.trim()) payload.responseHash = responseHash.trim();
    if (attestedNonce.trim()) payload.attestedNonce = attestedNonce.trim();

    const url = "/api/verification/session";
    setSessionState({ loading: true, url });
    try {
      const data = await fetchJson(url, payload);
      setSessionState({ loading: false, data, url });
    } catch (error) {
      setSessionState({
        loading: false,
        error: error instanceof Error ? error.message : "Unknown error",
        url,
      });
    }
  };

  const handleProofSubmit = async () => {
    if (!verificationId.trim()) {
      setProofState({
        loading: false,
        error: "verificationId is required",
      });
      return;
    }
    const url = "/api/verification/proof";
    const payload = { verificationId };
    setProofState({ loading: true, url });
    try {
      const data = await fetchJson(url, payload);
      setProofState({ loading: false, data, url });
    } catch (error) {
      setProofState({
        loading: false,
        error: error instanceof Error ? error.message : "Unknown error",
        url,
      });
    }
  };

  return (
    <>
      <Head>
        <title>Verification Demo</title>
      </Head>
      <main className="min-h-screen bg-background py-10 px-4">
        <div className="mx-auto flex max-w-4xl flex-col gap-6">
          <header className="space-y-2 text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.32em] text-muted-foreground">
              Verification Sandbox
            </p>
            <h1 className="text-3xl font-bold text-foreground">
              NEAR AI Verification Demo
            </h1>
            <p className="text-sm text-muted-foreground">
              Interact with the verification session and proof endpoints to
              inspect nonce, hashes, and attested values.
            </p>
          </header>

          <Section
            title="Session lifecycle"
            description="Register a verification session, optionally overriding the nonce or hashes."
          >
            <form
              className="grid gap-3 md:grid-cols-2"
              onSubmit={handleSessionSubmit}
            >
              <InputRow label="verificationId">
                <input
                  className="w-full rounded border border-border bg-input px-3 py-2 text-sm text-foreground"
                  value={verificationId}
                  onChange={(event) => setVerificationId(event.target.value)}
                />
              </InputRow>
              <div className="flex items-end">
                <button
                  type="submit"
                  className="w-full rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
                  disabled={sessionState.loading}
                >
                  Register session
                </button>
              </div>
              <InputRow label="nonce override">
                <input
                  className="rounded border border-border bg-input px-3 py-2 text-sm text-foreground"
                  value={nonceOverride}
                  onChange={(event) => setNonceOverride(event.target.value)}
                  placeholder="Optional 64 hex chars"
                />
              </InputRow>
              <InputRow label="attested nonce">
                <input
                  className="rounded border border-border bg-input px-3 py-2 text-sm text-foreground"
                  value={attestedNonce}
                  onChange={(event) => setAttestedNonce(event.target.value)}
                  placeholder="Optional 64 hex chars"
                />
              </InputRow>
              <InputRow label="request hash">
                <input
                  className="rounded border border-border bg-input px-3 py-2 text-sm text-foreground"
                  value={requestHash}
                  onChange={(event) => setRequestHash(event.target.value)}
                  placeholder="Optional string"
                />
              </InputRow>
              <InputRow label="response hash">
                <input
                  className="rounded border border-border bg-input px-3 py-2 text-sm text-foreground"
                  value={responseHash}
                  onChange={(event) => setResponseHash(event.target.value)}
                  placeholder="Optional string"
                />
              </InputRow>
            </form>
            {renderState(sessionState)}
          </Section>

          <Section
            title="Fetch verification proof"
            description="Read the nonce and hashes that were stored in the verification session."
          >
            <div className="flex flex-col gap-3 md:flex-row">
              <InputRow label="verificationId">
                <input
                  className="w-full rounded border border-border bg-input px-3 py-2 text-sm text-foreground"
                  value={verificationId}
                  onChange={(event) => setVerificationId(event.target.value)}
                />
              </InputRow>
              <button
                type="button"
                className="rounded bg-secondary px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-secondary/80"
                onClick={handleProofSubmit}
                disabled={proofState.loading}
              >
                Load proof
              </button>
            </div>
            {renderState(proofState)}
          </Section>
        </div>
      </main>
    </>
  );
}
