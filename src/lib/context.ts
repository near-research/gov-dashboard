import type { IncomingHttpHeaders } from "http";
import type { NextApiRequest, NextApiResponse } from "next";
import type { GetServerSidePropsContext } from "next";
import { auth } from "@/lib/auth";

type VerificationContext = {
  verificationId?: string;
  verificationNonce?: string;
};

const VERIFICATION_ID_HEADER = "x-verification-id";
const VERIFICATION_NONCE_HEADER = "x-nonce";

/**
 * Session type from Better Auth
 */
export type Session = NonNullable<
  Awaited<ReturnType<typeof getSessionFromReq>>
>;
export type User = Session["user"];

/**
 * Context interface (backwards compatible)
 */
export interface Context {
  session?: Session | null;
  verification?: VerificationContext;
}

export class UnauthorizedError extends Error {
  status: number;

  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
    this.status = 401;
  }
}

const appendHeader = (headers: Headers, key: string, value: string | string[]) => {
  if (Array.isArray(value)) {
    value.filter(Boolean).forEach((entry) => headers.append(key, entry));
    return;
  }
  headers.append(key, value);
};

const toHeaders = (headers: IncomingHttpHeaders) => {
  const normalized = new Headers();
  Object.entries(headers).forEach(([key, value]) => {
    if (typeof value === "undefined") return;
    appendHeader(normalized, key, value);
  });
  return normalized;
};

const getHeader = (headers: IncomingHttpHeaders, name: string) => {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value.find((item) => typeof item === "string") as string | undefined;
  }
  return typeof value === "string" ? value : undefined;
};

const extractVerification = (
  headers: IncomingHttpHeaders
): VerificationContext | undefined => {
  const verificationId = getHeader(headers, VERIFICATION_ID_HEADER);
  const verificationNonce = getHeader(headers, VERIFICATION_NONCE_HEADER);

  if (!verificationId && !verificationNonce) {
    return undefined;
  }

  return { verificationId, verificationNonce };
};

/**
 * Get session from API route request
 */
export async function getSessionFromReq(req: NextApiRequest) {
  return auth.api.getSession({
    headers: toHeaders(req.headers),
  });
}

/**
 * Get session from getServerSideProps context
 */
export async function getSessionFromContext(ctx: GetServerSidePropsContext) {
  return auth.api.getSession({
    headers: toHeaders(ctx.req.headers),
  });
}

/**
 * Require authentication in API route - throws if not authenticated
 */
export async function requireAuth(req: NextApiRequest) {
  const session = await getSessionFromReq(req);
  if (!session?.user) {
    throw new UnauthorizedError();
  }
  return session;
}

export function formatApiResponse<T>(
  res: NextApiResponse<T>,
  status: number,
  body: T
) {
  res.status(status);
  return res.json(body);
}

/**
 * Create context for API route (useful for tRPC or similar)
 */
export async function createContext(req: NextApiRequest): Promise<Context> {
  const session = await getSessionFromReq(req);
  const verification = extractVerification(req.headers);
  return { session, verification };
}
