import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __signatureCacheTestHooks,
  type SignatureCacheEntry,
} from "@/verification/server/service";

const {
  clear,
  cleanup,
  setEntry,
  size,
  keys,
  setMaxEntries,
  resetMaxEntries,
} = __signatureCacheTestHooks;

const futureEntry = (expiresAt: number): SignatureCacheEntry => ({
  expiresAt,
  hashes: { requestHash: "req", responseHash: "res" },
});

describe("verification signature cache", () => {
  beforeEach(() => {
    clear();
    resetMaxEntries();
  });

  afterEach(() => {
    clear();
    resetMaxEntries();
  });

  it("removes expired entries during cleanup", () => {
    setEntry("expired", futureEntry(500));
    setEntry("fresh", futureEntry(1_500));

    cleanup(1_000);

    expect(size()).toBe(1);
    expect(keys()).toEqual(["fresh"]);
  });

  it("evicts oldest entries when exceeding max size", () => {
    setMaxEntries(2);
    setEntry("first", futureEntry(Date.now() + 1_000));
    setEntry("second", futureEntry(Date.now() + 1_000));
    setEntry("third", futureEntry(Date.now() + 1_000));

    expect(size()).toBe(2);
    expect(keys()).toEqual(["second", "third"]);
  });
});
