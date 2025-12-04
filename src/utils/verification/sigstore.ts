const DEFAULT_SIGSTORE_BASE =
  process.env.SIGSTORE_PROVENANCE_BASE || "https://rekor.sigstore.dev";
const CACHE_TTL_MS = 2 * 60 * 1000; // keep short to prefer fresh provenance
const EXPECTED_REPO =
  process.env.SIGSTORE_EXPECTED_REPO || "near/nearai-cloud-api";
const EXPECTED_WORKFLOW =
  process.env.SIGSTORE_EXPECTED_WORKFLOW || "release.yml";
const EXPECTED_IMAGE_PREFIX =
  process.env.SIGSTORE_EXPECTED_IMAGE_PREFIX || "nearaidev/cloud-api";

type ProvenanceResponse = {
  repository?: string;
  tag?: string;
  workflow?: string;
  bundle?: any;
};

type VerifiedCacheEntry = { expiresAt: number; value: ProvenanceResponse | null };
const verifiedCache = new Map<string, VerifiedCacheEntry>();

const now = () => Date.now();

export const extractComposeImageDigests = (compose: string): string[] => {
  if (!compose || typeof compose !== "string") return [];
  const matches = compose.match(/[^\s"']+@sha256:[0-9a-f]{64}/gi);
  return matches ? Array.from(new Set(matches.map((m) => m.trim()))) : [];
};

const decodeBase64Json = (value?: string) => {
  if (!value || typeof value !== "string") return null;
  try {
    const buff = Buffer.from(value, "base64");
    return JSON.parse(buff.toString("utf8"));
  } catch {
    return null;
  }
};

type SigstoreVerifyFn = ((bundle: any) => Promise<any>) | null;

let testVerifyImpl: SigstoreVerifyFn = null;

const loadSigstoreVerifier = async (): Promise<SigstoreVerifyFn> => {
  const globalMock = (globalThis as any).__sigstoreVerifyMock;
  if (typeof globalMock === "function") {
    return globalMock as SigstoreVerifyFn;
  }
  if (testVerifyImpl) return testVerifyImpl;

  try {
    const dynamicImport = new Function("id", "return import(id)");
    const mod: any = await (dynamicImport as any)("@sigstore/verify").catch(() => null);
    if (typeof mod?.verify === "function") {
      return mod.verify as (bundle: any) => Promise<any>;
    }
  } catch (error) {
    console.warn("[sigstore] sigstore verifier unavailable:", error);
  }
  return null;
};

const fetchProvenance = async (
  digest: string
): Promise<ProvenanceResponse | null> => {
  const url = `${DEFAULT_SIGSTORE_BASE}/api/v1/provenance/${encodeURIComponent(
    digest
  )}`;

  try {
    const resp = await fetch(url, { headers: { Accept: "application/json" } });
    if (!resp.ok) {
      return null;
    }
    return (await resp.json()) as ProvenanceResponse;
  } catch {
    return null;
  }
};

export const verifyComposeProvenance = async (
  composeManifest: string
): Promise<{ verified: boolean; reasons: string[] }> => {
  const reasons: string[] = [];
  const digests = extractComposeImageDigests(composeManifest);
  if (digests.length === 0) {
    return { verified: false, reasons: ["No image digests found in compose manifest"] };
  }

  const verifier = await loadSigstoreVerifier();

  for (const digest of digests) {
    const cached = verifiedCache.get(digest);
    if (cached && cached.expiresAt > now()) {
      if (!cached.value) {
        reasons.push(`Cached unverified provenance for ${digest}`);
        continue;
      }
      // already verified previously
      continue;
    }

    const provenance = await fetchProvenance(digest);
    if (!provenance) {
      reasons.push(`Missing Sigstore provenance for ${digest}`);
      continue;
    }

    // Validate bundle and signatures when present
    const bundle = provenance.bundle;
    if (bundle && typeof bundle === "object") {
      const verificationResult =
        bundle.verification_result ||
        bundle.verificationResult ||
        bundle.verificationStatus;
      if (
        verificationResult &&
        String(verificationResult).toUpperCase() !== "VERIFIED"
      ) {
        reasons.push(`Sigstore bundle not verified for ${digest}`);
      }
      const signatures =
        bundle.signatures ||
        bundle.dsseEnvelope?.signatures ||
        bundle.envelope?.signatures;
      if (!signatures || signatures.length === 0) {
        reasons.push(`Sigstore bundle missing signatures for ${digest}`);
      }

      // Extract DSSE payload subjects and ensure digest + image name match
      const payloadEncoded =
        bundle.dsseEnvelope?.payload || bundle.envelope?.payload;
      const payloadType =
        bundle.dsseEnvelope?.payloadType || bundle.envelope?.payloadType;
      const payload = payloadEncoded ? decodeBase64Json(payloadEncoded) : null;
      if (payload) {
        const subjects: Array<{ name?: string; digest?: Record<string, string> }> =
          payload.subject || [];
        const hasMatchingSubject = subjects.some((subject) => {
          const name = subject.name || "";
          const sha = subject.digest?.sha256 || subject.digest?.sha384 || "";
          const nameMatches =
            name.includes(EXPECTED_IMAGE_PREFIX) || name.includes(EXPECTED_REPO);
          const digestMatches =
            typeof sha === "string" &&
            sha.length === 64 &&
            digest.toLowerCase().endsWith(sha.toLowerCase());
          return nameMatches && digestMatches;
        });
        if (!hasMatchingSubject) {
          reasons.push(
            `Sigstore subject mismatch for ${digest} (expected prefix ${EXPECTED_IMAGE_PREFIX})`
          );
        }
      } else if (payloadType) {
        reasons.push(`Unable to decode Sigstore payload for ${digest}`);
      }
    }

    if (
      provenance.repository &&
      provenance.repository.toLowerCase() !== EXPECTED_REPO.toLowerCase()
    ) {
      reasons.push(
        `Repository mismatch for ${digest}: expected ${EXPECTED_REPO}, got ${provenance.repository}`
      );
    }

    if (!provenance.tag) {
      reasons.push(`Missing release tag for ${digest}`);
    }

    if (
      provenance.workflow &&
      provenance.workflow.toLowerCase() !== EXPECTED_WORKFLOW.toLowerCase()
    ) {
      reasons.push(
        `Workflow mismatch for ${digest}: expected ${EXPECTED_WORKFLOW}, got ${provenance.workflow}`
      );
    }

    const imageNameMatches = digest.toLowerCase().includes(EXPECTED_IMAGE_PREFIX.toLowerCase());
    if (!imageNameMatches) {
      reasons.push(
        `Image name mismatch for ${digest}: expected prefix ${EXPECTED_IMAGE_PREFIX}`
      );
    }

    // Cryptographically verify bundle via sigstore verifier
    if (verifier) {
      try {
        await verifier(bundle);
      } catch (error: any) {
        const message =
          error instanceof Error
            ? error.message
            : `Sigstore verification failed for ${digest}`;
        reasons.push(message);
      }
    }

    if (!reasons.length) {
      verifiedCache.set(digest, { value: provenance, expiresAt: now() + CACHE_TTL_MS });
    } else {
      verifiedCache.delete(digest);
    }
  }

  return { verified: reasons.length === 0, reasons };
};

export const __sigstoreTestHooks = {
  clearCache: () => verifiedCache.clear(),
  cacheSize: () => verifiedCache.size,
  setVerifier: (fn: SigstoreVerifyFn) => {
    testVerifyImpl = fn;
  },
};
