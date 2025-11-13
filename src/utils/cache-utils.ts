/**
 * Simple In-Memory Cache for AI Summaries
 *
 * This provides a lightweight caching layer to reduce AI API costs
 * by storing summaries for a configurable time period.
 *
 * Cache TTL (Time To Live):
 * - Proposals: 1 hour
 * - Discussions: 5 minutes
 * - Replies: 30 minutes
 * - Revisions: 15 minutes
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  hits: number;
  expiresAt: number;
}

class SimpleCache<T> {
  private cache: Map<string, CacheEntry<T>>;
  private ttl: number;
  private name: string;
  private maxSize: number;

  constructor(
    ttlMinutes: number,
    name: string = "cache",
    maxSize: number = 1000
  ) {
    this.cache = new Map();
    this.ttl = ttlMinutes * 60 * 1000;
    this.name = name;
    this.maxSize = maxSize;
  }

  /**
   * Get item from cache if it exists and hasn't expired
   */
  get(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check if expired using pre-calculated timestamp
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      console.log(`[${this.name}] Cache MISS (expired) for key: ${key}`);
      return null;
    }

    // Update hit count
    entry.hits++;
    const age = Date.now() - entry.timestamp;
    console.log(
      `[${this.name}] Cache HIT for key: ${key} (age: ${Math.round(
        age / 1000
      )}s, hits: ${entry.hits})`
    );

    return entry.data;
  }

  /**
   * Store item in cache with optional custom TTL
   */
  set(key: string, data: T, customTtlMinutes?: number): void {
    // Evict oldest entries if at max size
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
        console.log(`[${this.name}] Cache EVICTED oldest entry: ${oldestKey}`);
      }
    }

    const now = Date.now();
    const ttl = customTtlMinutes ? customTtlMinutes * 60 * 1000 : this.ttl;

    this.cache.set(key, {
      data,
      timestamp: now,
      expiresAt: now + ttl,
      hits: 0,
    });
    console.log(
      `[${this.name}] Cache SET for key: ${key} (TTL: ${ttl / 1000}s)`
    );
  }

  /**
   * Get or set pattern
   */
  async getOrSet(
    key: string,
    factory: () => Promise<T>,
    customTtlMinutes?: number
  ): Promise<T> {
    const cached = this.get(key);
    if (cached !== null) {
      return cached;
    }

    const value = await factory();
    this.set(key, value, customTtlMinutes);
    return value;
  }

  /**
   * Check if key exists and is valid
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Get remaining TTL for a key (in seconds)
   */
  ttlRemaining(key: string): number | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const remaining = entry.expiresAt - Date.now();
    return remaining > 0 ? Math.floor(remaining / 1000) : null;
  }

  /**
   * Manually invalidate a cache entry
   */
  invalidate(key: string): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      console.log(`[${this.name}] Cache INVALIDATED for key: ${key}`);
    }
    return deleted;
  }

  /**
   * Invalidate multiple keys matching a pattern
   */
  invalidatePattern(pattern: string | RegExp): number {
    let count = 0;
    const regex = typeof pattern === "string" ? new RegExp(pattern) : pattern;

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        count++;
      }
    }

    if (count > 0) {
      console.log(
        `[${this.name}] Cache INVALIDATED ${count} entries matching pattern: ${pattern}`
      );
    }

    return count;
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    console.log(`[${this.name}] Cache CLEARED (${size} entries removed)`);
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const entries = Array.from(this.cache.entries());
    const now = Date.now();

    return {
      name: this.name,
      totalEntries: entries.length,
      totalHits: entries.reduce((sum, [, entry]) => sum + entry.hits, 0),
      avgAge:
        entries.length > 0
          ? Math.round(
              entries.reduce(
                (sum, [, entry]) => sum + (now - entry.timestamp),
                0
              ) /
                entries.length /
                1000
            )
          : 0,
      hitRate:
        entries.length > 0
          ? (
              entries.reduce((sum, [, entry]) => sum + entry.hits, 0) /
              entries.length
            ).toFixed(2)
          : 0,
      entries: entries.map(([key, entry]) => ({
        key,
        age: Math.round((now - entry.timestamp) / 1000),
        ttlRemaining: Math.max(0, Math.round((entry.expiresAt - now) / 1000)),
        hits: entry.hits,
      })),
    };
  }

  /**
   * Clean up expired entries
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      console.log(`[${this.name}] Cleanup removed ${removed} expired entries`);
    }

    return removed;
  }
}

// Cache instances remain the same...
export const proposalCache = new SimpleCache<any>(60, "ProposalCache");
export const discussionCache = new SimpleCache<any>(5, "DiscussionCache");
export const replyCache = new SimpleCache<any>(30, "ReplyCache");
export const revisionCache = new SimpleCache<any>(15, "RevisionCache");

// Cache keys remain the same...
export const CacheKeys = {
  proposal: (id: string) => `proposal:${id}`,
  discussion: (id: string) => `discussion:${id}`,
  reply: (id: string) => `reply:${id}`,
  proposalRevision: (topicId: string) => `proposal-revision:${topicId}`,
  postRevision: (postId: string) => `post-revision:${postId}`,
};

// Periodic cleanup remains the same...
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    proposalCache.cleanup();
    discussionCache.cleanup();
    replyCache.cleanup();
    revisionCache.cleanup();
  }, 10 * 60 * 1000);
}

export function getAllCacheStats() {
  return {
    proposals: proposalCache.getStats(),
    discussions: discussionCache.getStats(),
    replies: replyCache.getStats(),
    revisions: revisionCache.getStats(),
    timestamp: new Date().toISOString(),
  };
}
