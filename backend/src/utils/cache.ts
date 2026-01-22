/**
 * In-Memory Caching Layer
 * Reduces database queries by caching frequently accessed data
 *
 * Cached data types:
 * - User profiles (TTL: 5 minutes)
 * - User settings (TTL: 5 minutes)
 * - Challenges & facts (TTL: 24 hours)
 * - Statistics (TTL: 10 minutes)
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
  hits: number;
  createdAt: number;
}

interface CacheStats {
  size: number;
  hits: number;
  misses: number;
  hitRate: number;
}

class Cache<T> {
  private store = new Map<string, CacheEntry<T>>();
  private hits = 0;
  private misses = 0;

  /**
   * Get value from cache
   * Returns null if not found or expired
   */
  get(key: string): T | null {
    const entry = this.store.get(key);

    if (!entry) {
      this.misses++;
      return null;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.misses++;
      return null;
    }

    // Hit!
    entry.hits++;
    this.hits++;
    return entry.data;
  }

  /**
   * Set value in cache with TTL in milliseconds
   */
  set(key: string, data: T, ttlMs: number): void {
    this.store.set(key, {
      data,
      expiresAt: Date.now() + ttlMs,
      hits: 0,
      createdAt: Date.now()
    });
  }

  /**
   * Invalidate specific key
   */
  invalidate(key: string): void {
    this.store.delete(key);
  }

  /**
   * Invalidate by pattern (e.g., "user:123:*")
   */
  invalidatePattern(pattern: string): number {
    let count = 0;
    const regex = new RegExp(pattern.replace(/\*/g, '.*'));

    for (const key of this.store.keys()) {
      if (regex.test(key)) {
        this.store.delete(key);
        count++;
      }
    }

    return count;
  }

  /**
   * Clear entire cache
   */
  clear(): void {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    let totalSize = 0;
    for (const entry of this.store.values()) {
      totalSize += JSON.stringify(entry.data).length;
    }

    const total = this.hits + this.misses;
    const hitRate = total > 0 ? (this.hits / total) * 100 : 0;

    return {
      size: totalSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: parseFloat(hitRate.toFixed(2))
    };
  }

  /**
   * Get top hit keys (useful for monitoring)
   */
  getTopKeys(limit = 10): Array<{ key: string; hits: number }> {
    return Array.from(this.store.entries())
      .map(([key, entry]) => ({ key, hits: entry.hits }))
      .sort((a, b) => b.hits - a.hits)
      .slice(0, limit);
  }
}

// Initialize caches for different data types
export const userProfileCache = new Cache<Record<string, unknown>>();
export const userSettingsCache = new Cache<Record<string, unknown>>();
export const challengesCache = new Cache<unknown[]>();
export const factsCache = new Cache<unknown[]>();
export const statsCache = new Cache<Record<string, unknown>>();

// Cache TTLs (in milliseconds)
export const CACHE_TTLS = {
  USER_PROFILE: 5 * 60 * 1000,      // 5 minutes
  USER_SETTINGS: 5 * 60 * 1000,     // 5 minutes
  CHALLENGES: 24 * 60 * 60 * 1000,  // 24 hours
  FACTS: 24 * 60 * 60 * 1000,       // 24 hours
  STATS: 10 * 60 * 1000,            // 10 minutes
  SUBSCRIPTION: 5 * 60 * 1000       // 5 minutes (per user)
};

/**
 * Global cache for subscriptions (per user)
 */
export const subscriptionCache = new Cache<Record<string, unknown>>();

/**
 * Helper function to generate cache keys
 */
export function generateCacheKey(...parts: (string | number)[]): string {
  return parts.join(':');
}

/**
 * Get all cache statistics
 */
export function getAllCacheStats() {
  return {
    userProfiles: userProfileCache.getStats(),
    userSettings: userSettingsCache.getStats(),
    challenges: challengesCache.getStats(),
    facts: factsCache.getStats(),
    stats: statsCache.getStats(),
    subscriptions: subscriptionCache.getStats(),
    topProfileKeys: userProfileCache.getTopKeys(5),
    topSettingsKeys: userSettingsCache.getTopKeys(5)
  };
}

/**
 * Clear all caches (useful on server restart or for debugging)
 */
export function clearAllCaches(): void {
  userProfileCache.clear();
  userSettingsCache.clear();
  challengesCache.clear();
  factsCache.clear();
  statsCache.clear();
  subscriptionCache.clear();
  console.log('[Cache] All caches cleared');
}

/**
 * Invalidate user-specific data
 * Called when user updates profile or settings
 */
export function invalidateUserCache(userId: string): void {
  userProfileCache.invalidate(generateCacheKey('user', userId, 'profile'));
  userSettingsCache.invalidate(generateCacheKey('user', userId, 'settings'));
  statsCache.invalidatePattern(`user:${userId}:.*`);
  console.log(`[Cache] Invalidated cache for user ${userId}`);
}

export default {
  userProfileCache,
  userSettingsCache,
  challengesCache,
  factsCache,
  statsCache,
  subscriptionCache,
  CACHE_TTLS,
  generateCacheKey,
  getAllCacheStats,
  clearAllCaches,
  invalidateUserCache
};
