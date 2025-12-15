import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";
import type { Evaluation } from "@/types/evaluation";
import type { NextApiRequest, NextApiResponse } from "next";

const mockDb = {
  select: vi.fn(),
};

const loadHandler = async () => {
  vi.doMock("@/lib/db", () => ({
    db: mockDb,
  }));
  const handlerModule = await import("@/pages/api/getAnalysis/[topicId]");
  return handlerModule.default;
};

const createBuilder = (rows: unknown[]) => {
  const builder = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockImplementation(() => Promise.resolve(rows)),
  };
  return builder;
};

const baseEvaluation: Evaluation = {
  complete: { pass: true, reason: "complete" },
  legible: { pass: true, reason: "legible" },
  consistent: { pass: true, reason: "consistent" },
  compliant: { pass: true, reason: "compliant" },
  justified: { pass: true, reason: "justified" },
  measurable: { pass: true, reason: "measurable" },
  relevant: { score: "high", reason: "relevant" },
  material: { score: "medium", reason: "material" },
  qualityScore: 0.9,
  attentionScore: 0.8,
  overallPass: true,
  summary: "summary",
};

const createScreeningRow = (revision: number) => ({
  revisionNumber: revision,
  evaluation: {
    ...baseEvaluation,
    model: `ai-model-${revision}`,
  },
  nearAccount: "account.near",
  timestamp: new Date(`2024-04-${revision.toString().padStart(2, "0")}T00:00:00Z`),
  title: `proposal-${revision}`,
  qualityScore: 1,
  attentionScore: 1,
});

const createReq = (query: Record<string, unknown>): NextApiRequest =>
  ({
    method: "GET",
    query,
  } as NextApiRequest);

const createRes = () => {
  const res: Partial<NextApiResponse> & {
    status: (code: number) => NextApiResponse;
    json: (body: unknown) => NextApiResponse;
    body?: unknown;
  } = {
    status: vi.fn(function (this: typeof res, code: number) {
      this.statusCode = code;
      return this as unknown as NextApiResponse;
    }),
    json: vi.fn(function (this: typeof res, body: unknown) {
      this.body = body;
      return this as unknown as NextApiResponse;
    }),
    body: undefined,
  };
  return res as unknown as NextApiResponse;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.select = vi.fn();
});

describe("GET /api/getAnalysis/[topicId]", () => {
  it("returns paginated results and includes hasMore metadata", async () => {
    const rows = [createScreeningRow(3), createScreeningRow(2)];
    const builder = createBuilder(rows);
    mockDb.select.mockImplementation(() => builder);

    const handler = await loadHandler();
    const req = createReq({ topicId: "123", all: "true", limit: "2" });
    const res = createRes();

    await handler(req, res);

    expect(builder.limit).toHaveBeenCalledWith(3);
    expect(res.status).toHaveBeenCalledWith(200);
    const responseBody = (res.json as Mock).mock.calls[0][0];
    expect(responseBody.results).toHaveLength(2);
    expect(responseBody.hasMore).toBe(false);
    expect(responseBody.nextCursor).toBeUndefined();
  });

  it("signals more pages when limit+1 rows are returned", async () => {
    const rows = [
      createScreeningRow(5),
      createScreeningRow(4),
      createScreeningRow(3),
    ];
    const builder = createBuilder(rows);
    mockDb.select.mockImplementation(() => builder);

    const req = createReq({ topicId: "42", all: "true", limit: "2" });
    const res = createRes();

    const handler = await loadHandler();
    await handler(req, res);

    const body = (res.json as Mock).mock.calls[0][0];
    expect(body.results).toHaveLength(2);
    expect(body.hasMore).toBe(true);
    expect(body.nextCursor).toBe("4");
  });

  it("rejects non-numeric cursor values", async () => {
    const handler = await loadHandler();
    const req = createReq({ topicId: "42", all: "true", cursor: "abc" });
    const res = createRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockDb.select).not.toHaveBeenCalled();
  });
});
