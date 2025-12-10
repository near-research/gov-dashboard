import "../../vi-compat";
import React from "react";
import { JSDOM } from "jsdom";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { VerificationProof } from "@/components/verification/VerificationProof";
import type { VerificationProofResponse } from "@/types/verification";
import {
  mockNonce,
  mockAddress,
  verifiedProofMock,
  failedProofMock,
} from "../../fixtures/verification";
import { verifyMessage } from "ethers";
var fetchProofMock = vi.fn();

type VerificationAuthTokenFn = typeof import("@/lib/verification/near-ai")["createVerificationAuthToken"];
const walletSignerMock = { signMessage: vi.fn() };
const createAuthTokenMock = vi.fn<VerificationAuthTokenFn>(async () => "proof-token");
vi.mock("@/hooks/useNear", () => ({
  useNear: () => ({
    walletSigner: walletSignerMock,
    signedAccountId: "test.near",
  }),
}));
vi.mock("@/lib/verification/near-ai", () => ({
  createVerificationAuthToken: (...args: Parameters<VerificationAuthTokenFn>) =>
    createAuthTokenMock(...args),
}));

vi.mock("@/services/verification/proof-service", () => ({
  fetchVerificationProof: (...args: any[]) => fetchProofMock(...args),
  verifyWithNrasService: vi.fn(),
}));

const ensureDom = () => {
  if (typeof document !== "undefined" && (globalThis as any).document) return;
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  (globalThis as any).window = dom.window;
  (globalThis as any).document = dom.window.document;
  (globalThis as any).navigator = dom.window.navigator;
  (globalThis as any).HTMLElement = dom.window.HTMLElement;
  (globalThis as any).HTMLInputElement = dom.window.HTMLInputElement;
  (globalThis as any).Event = dom.window.Event;
  (globalThis as any).CustomEvent = dom.window.CustomEvent;
  (globalThis as any).MouseEvent = dom.window.MouseEvent;
  (globalThis as any).NodeFilter = dom.window.NodeFilter;
  (globalThis as any).Blob = dom.window.Blob;
  (globalThis as any).File = dom.window.File;
  (globalThis as any).URL = dom.window.URL;
  (globalThis as any).getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  (globalThis as any).MutationObserver = dom.window.MutationObserver;
  (globalThis as any).requestAnimationFrame =
    (globalThis as any).requestAnimationFrame ||
    ((cb: FrameRequestCallback) => setTimeout(cb, 0));
  (globalThis as any).cancelAnimationFrame =
    (globalThis as any).cancelAnimationFrame ||
    ((id: number) => clearTimeout(id));
};

// Ensure a DOM exists even if another test file restored globals.
ensureDom();

const {
  render,
  screen,
  waitFor,
  fireEvent,
  act,
  within,
} = await import("@testing-library/react");

const compatVi = vi as any;
if (!compatVi.stubGlobal) {
  compatVi.stubGlobal = (name: string, value: any) => {
    const previous = (globalThis as any)[name];
    (globalThis as any)[name] = value;
    return { restore: () => (previous === undefined ? delete (globalThis as any)[name] : (globalThis as any)[name] = previous) };
  };
}
if (!compatVi.resetModules) {
  compatVi.resetModules = () => {
    vi.resetAllMocks();
    vi.clearAllMocks();
  };
}

vi.mock("ethers", () => ({
  verifyMessage: vi.fn(() => mockAddress),
}));

const verifyMessageMock = vi.mocked(verifyMessage);
describe("VerificationProof component", () => {
  beforeEach(() => {
    vi.useRealTimers();
    fetchProofMock = vi.fn();
    verifyMessageMock.mockReset();
    verifyMessageMock.mockReturnValue(mockAddress);
    ensureDom();
    vi.stubGlobal(
      "requestAnimationFrame",
      (cb: FrameRequestCallback) => setTimeout(cb, 0) as unknown as number
    );
    vi.stubGlobal(
      "cancelAnimationFrame",
      (id: number) => clearTimeout(id)
    );
    fetchProofMock.mockResolvedValue(verifiedProofMock as VerificationProofResponse);
    walletSignerMock.signMessage.mockReset();
    createAuthTokenMock.mockReset();
    createAuthTokenMock.mockResolvedValue("proof-token");
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob://mock");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fetchProofMock.mockClear();
    // Clean up clipboard stub on jsdom navigator
    // @ts-expect-error - clipboard is optional on Navigator
    delete navigator.clipboard;
  });

  const renderComponent = (props: Partial<React.ComponentProps<typeof VerificationProof>> = {}) =>
    render(
      <VerificationProof
        verificationId="id1"
        model="m"
        requestHash="req"
        responseHash="res"
        nonce={mockNonce}
        expectedArch="HOPPER"
        expectedDeviceCertHash="hash"
        expectedRimHash="rim"
        expectedUeid="ueid"
        expectedMeasurements={["m1"]}
        {...props}
      />
    );

  it("renders verified badge and steps when proof passes", async () => {
    renderComponent();
    const button = screen.getByRole("button");
    await act(async () => fireEvent.click(button));
    await waitFor(() => expect(fetchProofMock).toHaveBeenCalled());
    expect(screen.getAllByText(/verified/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Hardware Attestation/i).length).toBeGreaterThan(
      0
    );
  });

  it("shows expectations missing alert and skips fetch when expectations absent", async () => {
    render(
      <VerificationProof
        verificationId="id1"
        model="m"
        requestHash="req"
        responseHash="res"
      />
    );
    await act(async () => fireEvent.click(screen.getByRole("button")));
    expect(fetchProofMock).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Hardware expectations required/i)
    ).toBeInTheDocument();
  });

  it("shows unverified hardware when not validated", async () => {
    fetchProofMock.mockResolvedValueOnce({ ...failedProofMock } as VerificationProofResponse);
    renderComponent();
    await act(async () => fireEvent.click(screen.getByRole("button")));
    await waitFor(() => expect(fetchProofMock).toHaveBeenCalled());
    expect(
      screen.getAllByText(/Attestation failed/i).length
    ).toBeGreaterThan(0);
  });

  it("renders badge reasons when NRAS/intel/nonce fail", async () => {
    fetchProofMock.mockResolvedValueOnce({
      ...failedProofMock,
      attestation: {
        gateway_attestation: {
          ...(failedProofMock.attestation as any)?.gateway_attestation,
          intel_quote: JSON.stringify({ eat_nonce: mockNonce }),
        },
      },
      intel: { verified: false },
    } as VerificationProofResponse);
    renderComponent();
    await act(async () => fireEvent.click(screen.getByRole("button")));
    await waitFor(() => expect(fetchProofMock).toHaveBeenCalled());
    expect(screen.getAllByText(/Nonce mismatch/i).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/Attestation failed/i).length
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/Intel attestation failed or missing/i).length
    ).toBeGreaterThan(0);
  });

  it("shows fetch error alert", async () => {
    fetchProofMock.mockRejectedValueOnce(new Error("Failed to fetch proof"));
    renderComponent();
    await act(async () => fireEvent.click(screen.getByRole("button")));
    await waitFor(() => expect(fetchProofMock).toHaveBeenCalled());
    expect(screen.getAllByText(/Failed to fetch proof/i).length).toBeGreaterThan(0);
  });

  it("shows hash mismatch in steps and badge reasons", async () => {
    renderComponent({ responseHash: "other" });
    await act(async () => fireEvent.click(screen.getByRole("button")));
    await waitFor(() => expect(fetchProofMock).toHaveBeenCalled());
    const hashTexts = screen.getAllByText(/Hash mismatch/i);
    expect(hashTexts.length).toBeGreaterThanOrEqual(1);
    hashTexts.forEach((node) => expect(node).toBeInTheDocument());
  });

  it("triggers export proof and uses object URL", async () => {
    renderComponent();
    await act(async () => fireEvent.click(screen.getByRole("button")));
    await waitFor(() => expect(fetchProofMock).toHaveBeenCalled());
    const exportBtn = screen.getByRole("button", { name: /export proof/i });
    await act(async () => fireEvent.click(exportBtn));
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("shows config missing alerts", async () => {
    fetchProofMock.mockResolvedValueOnce({
      ...failedProofMock,
      configMissing: { intel: true, intelApiKey: true },
      results: { verified: false, reasons: ["Intel attestation not configured"] },
    } as VerificationProofResponse);
    renderComponent();
    await act(async () => fireEvent.click(screen.getByRole("button")));
    await waitFor(() => expect(fetchProofMock).toHaveBeenCalled());
    expect(
      screen.getByText(/Intel API key missing; configure INTEL_TDX_API_KEY\./i)
    ).toBeInTheDocument();
  });

  it("shows missing attested signing address error", async () => {
    fetchProofMock.mockResolvedValueOnce({
      ...verifiedProofMock,
      attestation: {}, // remove signing address from attestation
      signature: { ...verifiedProofMock.signature, signing_address: undefined },
    } as VerificationProofResponse);
    renderComponent();
    await act(async () => fireEvent.click(screen.getByRole("button")));
    await waitFor(() => expect(fetchProofMock).toHaveBeenCalled());
    const missing = screen.getAllByText(/No TEE addresses available/i);
    expect(missing.length).toBeGreaterThanOrEqual(1);
  });

  it("shows nonce mismatch step/error", async () => {
    fetchProofMock.mockResolvedValueOnce({
      ...verifiedProofMock,
      nonceCheck: { expected: mockNonce, attested: "wrong", nras: "wrong", valid: false },
      results: { verified: false, reasons: ["Nonce mismatch"] },
    } as VerificationProofResponse);
    renderComponent();
    await act(async () => fireEvent.click(screen.getByRole("button")));
    await waitFor(() => expect(fetchProofMock).toHaveBeenCalled());
    expect(screen.getAllByText(/Nonce mismatch/i).length).toBeGreaterThan(0);
  });

  it("shows GPU/CPU failures and reasons", async () => {
    fetchProofMock.mockResolvedValueOnce({
      ...failedProofMock,
      attestation: {
        gateway_attestation: {
          ...(failedProofMock.attestation as any)?.gateway_attestation,
          intel_quote: JSON.stringify({ eat_nonce: mockNonce }),
        },
      },
      intel: { verified: false },
    } as VerificationProofResponse);
    renderComponent();
    await act(async () => fireEvent.click(screen.getByRole("button")));
    await waitFor(() => expect(fetchProofMock).toHaveBeenCalled());
    expect(
      screen.getAllByText(/Attestation failed/i).length
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/Intel attestation failed or missing/i).length
    ).toBeGreaterThan(0);
  });

  it("shows No Verification ID alert when verification ID missing", async () => {
    render(
      <VerificationProof
        model="m"
        requestHash="req"
        responseHash="res"
        nonce={mockNonce}
        expectedArch="HOPPER"
        expectedDeviceCertHash="hash"
        expectedRimHash="rim"
        expectedUeid="ueid"
        expectedMeasurements={["m1"]}
      />
    );
    await act(async () => fireEvent.click(screen.getByRole("button")));
    expect(screen.getByText(/No Verification ID/i)).toBeInTheDocument();
  });

  it("renders NRAS summary when verification passes", async () => {
    fetchProofMock.mockResolvedValueOnce({ ...verifiedProofMock } as VerificationProofResponse);
    renderComponent();
    await act(async () => fireEvent.click(screen.getByRole("button")));
    await waitFor(() => expect(fetchProofMock).toHaveBeenCalled());
    expect(screen.getByText(/NVIDIA Report/i)).toBeInTheDocument();
  });

  it("renders NRAS summary and copies JWT", async () => {
    const clipboardSpy = vi.spyOn(navigator.clipboard, "writeText");
    render(
      <VerificationProof
        verificationId="id1"
        model="m"
        requestHash="req"
        responseHash="res"
        nonce={mockNonce}
        expectedArch="HOPPER"
        expectedDeviceCertHash="hash"
        expectedRimHash="rim"
        expectedUeid="ueid"
        expectedMeasurements={["m1"]}
        prefetchedProof={{
          attestation: {
            gateway_attestation: {
              signing_address: mockAddress,
              nvidia_payload: { nonce: mockNonce, arch: "HOPPER", evidence_list: [] },
            },
          },
          signature: verifiedProofMock.signature,
          nras: {
            verified: true,
            jwt: "mock-jwt",
            claims: { hwmodel: "H100" },
            gpus: { "GPU-0": "tok" },
            raw: { ok: true },
          },
          nrasRaw: { ok: true },
          nonceCheck: {
            expected: mockNonce,
            attested: mockNonce,
            nras: mockNonce,
            valid: true,
          },
        }}
      />
    );
    await act(async () => fireEvent.click(screen.getByRole("button")));
    expect(screen.getByText(/NVIDIA Report/i)).toBeInTheDocument();
    const copyButtons = screen.getAllByRole("button", { name: /Copy/i });
    await act(async () => fireEvent.click(copyButtons[0]));
    expect(clipboardSpy).toHaveBeenCalled();
    clipboardSpy.mockRestore();
  });

  it("copies Intel quote when manual verification required", async () => {
    const clipboardSpy = vi.spyOn(navigator.clipboard, "writeText");
    fetchProofMock.mockResolvedValueOnce({
      ...verifiedProofMock,
      configMissing: { intel: true },
      attestation: {
        gateway_attestation: {
          ...(verifiedProofMock.attestation as any)?.gateway_attestation,
          intel_quote: "fake-intel-quote",
        },
      },
      intel: { verified: false },
    } as VerificationProofResponse);
    renderComponent();
    await act(async () => fireEvent.click(screen.getByRole("button")));
    await waitFor(() => expect(fetchProofMock).toHaveBeenCalled());

    const intelTile =
      screen.getByText(/Intel TDX Quote/i).closest("div")?.parentElement
        ?.parentElement;
    expect(intelTile).toBeTruthy();
    const copyBtn = within(intelTile as HTMLElement).getByRole("button", {
      name: /Copy/i,
    });
    await act(async () => fireEvent.click(copyBtn));
    expect(clipboardSpy).toHaveBeenCalledWith("fake-intel-quote");
    clipboardSpy.mockRestore();
  });

  it("shows expired proof hint on 404 fetch", async () => {
    fetchProofMock.mockRejectedValueOnce(
      new Error(
        "Failed to fetch proof\n\nProof may have expired. Proofs are only available for 5 minutes after generation unless queried."
      )
    );
    renderComponent();
    await act(async () => fireEvent.click(screen.getByRole("button")));
    await waitFor(() => expect(fetchProofMock).toHaveBeenCalled());
    expect(screen.getByText(/Proof may have expired/i)).toBeInTheDocument();
  });

  it("shows auth hint on 401 fetch", async () => {
    fetchProofMock.mockRejectedValueOnce(
      new Error("Authentication error. Please check your API key.")
    );
    renderComponent();
    await act(async () => fireEvent.click(screen.getByRole("button")));
    await waitFor(() => expect(fetchProofMock).toHaveBeenCalled());
    expect(screen.getByText(/Authentication error/i)).toBeInTheDocument();
  });

  it("uses verification status for derived badge", () => {
    renderComponent({
      verification: { source: "x", status: "failed", messageId: "m1" } as any,
      verificationId: undefined,
    });
    const button = screen.getByTestId("verification-proof-trigger");
    expect(button).toHaveTextContent(/Failed/i);
  });

  it("renders inline verification data when provided", async () => {
    fetchProofMock.mockResolvedValueOnce({
      ...verifiedProofMock,
      verification: {
        measurement: "abcd1234",
        signature: "sig",
        attestationReport: { report: "r" },
        proof: { blob: true },
      },
    } as VerificationProofResponse);
    renderComponent({
      verification: {
        source: "near-ai-cloud",
        status: "verified",
        measurement: "abcd1234",
        signature: "sig",
        attestationReport: "r",
        proof: { blob: true } as any,
      },
    });
    await act(async () => fireEvent.click(screen.getByRole("button")));
    await waitFor(() => expect(fetchProofMock).toHaveBeenCalled());
    expect(screen.getByText(/Inline Verification Data/i)).toBeInTheDocument();
    expect(screen.getByText(/TEE Signature/i)).toBeInTheDocument();
    expect(screen.getByText(/Measurement/i)).toBeInTheDocument();
  });

  it("shows retry button when proof fetch fails", async () => {
    fetchProofMock.mockRejectedValueOnce(new Error("server error"));
    renderComponent();
    await act(async () => fireEvent.click(screen.getByRole("button")));
    await waitFor(() => expect(fetchProofMock).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument();
  });

  it("surfaces fetch error banner", async () => {
    fetchProofMock.mockRejectedValueOnce(new Error("network failure"));
    renderComponent();
    await act(async () => fireEvent.click(screen.getByRole("button")));
    await waitFor(() => expect(fetchProofMock).toHaveBeenCalled());
    expect(screen.getByText(/Failed to Fetch Proof/i)).toBeInTheDocument();
    expect(screen.getByText(/network failure/i)).toBeInTheDocument();
  });
});
