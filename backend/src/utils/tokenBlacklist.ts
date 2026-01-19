/**
 * Token Blacklist Service
 *
 * Provides functionality to revoke JWT tokens before their natural expiration.
 * This enables:
 * - Logout from all devices
 * - Force logout on password change
 * - Session termination for suspicious activity
 *
 * In production, this should use Redis or a database for persistence.
 * Current implementation uses in-memory storage with automatic cleanup.
 */

interface BlacklistedToken {
  token: string;
  userId: string;
  reason: 'logout' | 'logout_all' | 'password_change' | 'security' | 'admin_action';
  blacklistedAt: Date;
  expiresAt: Date;
}

interface UserSession {
  tokenId: string;
  userId: string;
  createdAt: Date;
  lastUsed: Date;
  userAgent?: string;
  ip?: string;
}

// In-memory storage (use Redis in production)
const blacklistedTokens: Map<string, BlacklistedToken> = new Map();
const activeSessions: Map<string, UserSession[]> = new Map();

// Cleanup interval (every 15 minutes)
const CLEANUP_INTERVAL = 15 * 60 * 1000;

/**
 * Add a token to the blacklist
 */
export function blacklistToken(
  token: string,
  userId: string,
  reason: BlacklistedToken['reason'],
  expiresAt: Date
): void {
  const entry: BlacklistedToken = {
    token: hashToken(token),
    userId,
    reason,
    blacklistedAt: new Date(),
    expiresAt
  };

  blacklistedTokens.set(entry.token, entry);

  console.log('[TOKEN] Token blacklisted:', {
    userId,
    reason,
    expiresAt: expiresAt.toISOString()
  });
}

/**
 * Check if a token is blacklisted
 */
export function isTokenBlacklisted(token: string): boolean {
  const hashedToken = hashToken(token);
  return blacklistedTokens.has(hashedToken);
}

/**
 * Blacklist all tokens for a user (logout from all devices)
 */
export function blacklistAllUserTokens(
  userId: string,
  reason: BlacklistedToken['reason'] = 'logout_all'
): void {
  // In production, query database for all active tokens for this user
  // For now, we track a "blacklist all before" timestamp

  const entry: BlacklistedToken = {
    token: `all_tokens_${userId}`,
    userId,
    reason,
    blacklistedAt: new Date(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
  };

  blacklistedTokens.set(entry.token, entry);

  // Clear active sessions for this user
  activeSessions.delete(userId);

  console.log('[TOKEN] All tokens blacklisted for user:', {
    userId,
    reason
  });
}

/**
 * Check if all tokens for a user are blacklisted (after a certain time)
 */
export function areAllUserTokensBlacklisted(userId: string, tokenIssuedAt: Date): boolean {
  const entry = blacklistedTokens.get(`all_tokens_${userId}`);

  if (!entry) {
    return false;
  }

  // Token is blacklisted if it was issued before the blacklist timestamp
  return tokenIssuedAt < entry.blacklistedAt;
}

/**
 * Register an active session
 */
export function registerSession(
  tokenId: string,
  userId: string,
  userAgent?: string,
  ip?: string
): void {
  const session: UserSession = {
    tokenId,
    userId,
    createdAt: new Date(),
    lastUsed: new Date(),
    userAgent,
    ip
  };

  const userSessions = activeSessions.get(userId) || [];
  userSessions.push(session);
  activeSessions.set(userId, userSessions);
}

/**
 * Update session last used time
 */
export function updateSessionActivity(tokenId: string, userId: string): void {
  const userSessions = activeSessions.get(userId);
  if (userSessions) {
    const session = userSessions.find(s => s.tokenId === tokenId);
    if (session) {
      session.lastUsed = new Date();
    }
  }
}

/**
 * Get all active sessions for a user
 */
export function getUserSessions(userId: string): UserSession[] {
  return activeSessions.get(userId) || [];
}

/**
 * Revoke a specific session
 */
export function revokeSession(tokenId: string, userId: string): boolean {
  const userSessions = activeSessions.get(userId);
  if (userSessions) {
    const index = userSessions.findIndex(s => s.tokenId === tokenId);
    if (index !== -1) {
      userSessions.splice(index, 1);
      activeSessions.set(userId, userSessions);

      // Blacklist the token
      blacklistedTokens.set(tokenId, {
        token: tokenId,
        userId,
        reason: 'logout',
        blacklistedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
      });

      return true;
    }
  }
  return false;
}

/**
 * Simple hash function for tokens (use proper crypto in production)
 */
function hashToken(token: string): string {
  // In production, use crypto.createHash('sha256').update(token).digest('hex')
  // For now, use a simple hash to reduce memory usage
  let hash = 0;
  for (let i = 0; i < token.length; i++) {
    const char = token.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `tk_${hash.toString(16)}`;
}

/**
 * Cleanup expired blacklist entries
 */
function cleanupExpiredEntries(): void {
  const now = new Date();
  let cleaned = 0;

  for (const [key, entry] of blacklistedTokens.entries()) {
    if (entry.expiresAt < now) {
      blacklistedTokens.delete(key);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    console.log(`[TOKEN] Cleaned up ${cleaned} expired blacklist entries`);
  }
}

/**
 * Get blacklist stats (for monitoring)
 */
export function getBlacklistStats(): {
  totalBlacklisted: number;
  totalActiveSessions: number;
  oldestEntry: Date | null;
} {
  let oldestEntry: Date | null = null;

  for (const entry of blacklistedTokens.values()) {
    if (!oldestEntry || entry.blacklistedAt < oldestEntry) {
      oldestEntry = entry.blacklistedAt;
    }
  }

  let totalActiveSessions = 0;
  for (const sessions of activeSessions.values()) {
    totalActiveSessions += sessions.length;
  }

  return {
    totalBlacklisted: blacklistedTokens.size,
    totalActiveSessions,
    oldestEntry
  };
}

// Start cleanup interval
setInterval(cleanupExpiredEntries, CLEANUP_INTERVAL);

// Export for testing
export const _internal = {
  blacklistedTokens,
  activeSessions,
  cleanupExpiredEntries
};
