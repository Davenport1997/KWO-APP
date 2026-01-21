export class Cache<T> {
  private store = new Map<string, { data: T; expires: number }>();
  get(key: string): T | null {
    const item = this.store.get(key);
    if (!item || Date.now() > item.expires) return null;
    return item.data;
  }
  set(key: string, data: T, ttlMs: number): void {
    this.store.set(key, { data, expires: Date.now() + ttlMs });
  }
  clear(): void { this.store.clear(); }
}
export const userProfileCache = new Cache<any>();
export function generateCacheKey(...parts: string[]) { return parts.join(':'); }
export function getAllCacheStats() { return { status: 'ok' }; }
export function clearAllCaches() { userProfileCache.clear(); }
export function invalidateUserCache(id: string) { userProfileCache.clear(); }
export default { userProfileCache, generateCacheKey, getAllCacheStats, clearAllCaches, invalidateUserCache };
