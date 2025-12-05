"use client";

import Head from "next/head";
import { ProposalScreener } from "@/components/proposal/ProposalScreener";

export default function PlaywrightScreeningPage() {
  return (
    <>
      <Head>
        <title>Playwright Screening Fixture</title>
      </Head>
      <main className="min-h-screen bg-background py-12 px-4">
        <div className="mx-auto max-w-5xl space-y-6">
          <div className="text-center space-y-2">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              Testing Harness
            </p>
            <h1 className="text-3xl font-bold">AI Proposal Screening</h1>
            <p className="text-sm text-muted-foreground">
              Submit a mock proposal to verify the NEAR AI screening UI updates.
            </p>
          </div>
          <ProposalScreener />
        </div>
      </main>
    </>
  );
}
