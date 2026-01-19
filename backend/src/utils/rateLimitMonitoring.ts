/**
 * Rate Limit Monitoring & Abuse Detection Service
 *
 * Tracks, logs, and analyzes rate limit violations for:
 * - Abuse detection (repeated violations)
 * - CAPTCHA triggers
 * - IP blocking recommendations
 * - User behavior patterns
 */

interface RateLimitEvent {
  id: string;
  timestamp: string;
  identifier: string; // IP or user ID
  identifierType: 'ip' | 'user';
  endpoint: string;
  actionType: string;
  violationCount: number;
  clientIP: string;
  userAgent?: string;
  requiresCaptcha: boolean;
  blocked: boolean;
  blockReason?: string;
}

interface AbusePattern {
  identifier: string;
  pattern: string; // 'brute_force', 'resource_exhaustion', 'api_scanning', 'credential_stuffing'
  severity: 'low' | 'medium' | 'high' | 'critical';
  evidenceCount: number;
  firstSeen: string;
  lastSeen: string;
  recommendation: string;
}

const rateLimitEvents: RateLimitEvent[] = [];
const abusePatterns: Map<string, AbusePattern> = new Map();
const blockedIdentifiers: Set<string> = new Set();

/**
 * Log a rate limit event
 */
export function logRateLimitEvent(
  identifier: string,
  identifierType: 'ip' | 'user',
  endpoint: string,
  actionType: string,
  violationCount: number,
  clientIP: string,
  userAgent?: string
): RateLimitEvent {
  const event: RateLimitEvent = {
    id: `rle_${Date.now()}_${Math.random().toString(36).substring(7)}`,
    timestamp: new Date().toISOString(),
    identifier,
    identifierType,
    endpoint,
    actionType,
    violationCount,
    clientIP,
    userAgent,
    requiresCaptcha: violationCount >= 2,
    blocked: blockedIdentifiers.has(identifier),
    blockReason: blockedIdentifiers.has(identifier) ? 'Repeated abuse' : undefined,
  };

  rateLimitEvents.push(event);

  // Analyze for abuse patterns
  analyzeForAbusePatterns(identifier, actionType, violationCount);

  console.log('[RATE_LIMIT_EVENT]', {
    id: event.id,
    identifier,
    endpoint,
    violations: violationCount,
    blocked: event.blocked,
  });

  return event;
}

/**
 * Analyze violations for abuse patterns
 */
function analyzeForAbusePatterns(identifier: string, actionType: string, violationCount: number): void {
  const recentEvents = rateLimitEvents.filter(
    (e) =>
      e.identifier === identifier &&
      new Date(e.timestamp) > new Date(Date.now() - 24 * 60 * 60 * 1000)
  );

  // Detect brute force (repeated failed login)
  const loginViolations = recentEvents.filter((e) => e.actionType === 'login').length;
  if (loginViolations >= 5) {
    detectAbusePattern(identifier, 'brute_force', 'critical', 'Repeated login attempts detected');
  }

  // Detect account creation spam (signup from same IP)
  const signupViolations = recentEvents.filter((e) => e.actionType === 'signup').length;
  if (signupViolations >= 3) {
    detectAbusePattern(identifier, 'credential_stuffing', 'high', 'Multiple account creation attempts');
  }

  // Detect resource exhaustion (API scanning or DDoS-like behavior)
  if (recentEvents.length >= 10) {
    detectAbusePattern(identifier, 'resource_exhaustion', 'high', 'High request rate detected');
  }

  // Detect API scanning (trying many different endpoints)
  const uniqueEndpoints = new Set(recentEvents.map((e) => e.endpoint)).size;
  if (uniqueEndpoints >= 5 && recentEvents.length >= 10) {
    detectAbusePattern(identifier, 'api_scanning', 'medium', 'Scanning multiple endpoints');
  }
}

/**
 * Record an abuse pattern
 */
function detectAbusePattern(
  identifier: string,
  pattern: string,
  severity: 'low' | 'medium' | 'high' | 'critical',
  recommendation: string
): void {
  const key = identifier;

  if (abusePatterns.has(key)) {
    const existing = abusePatterns.get(key)!;
    existing.evidenceCount++;
    existing.lastSeen = new Date().toISOString();
  } else {
    abusePatterns.set(key, {
      identifier,
      pattern,
      severity,
      evidenceCount: 1,
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      recommendation,
    });
  }

  // Auto-block on critical severity
  if (severity === 'critical' && !blockedIdentifiers.has(identifier)) {
    blockIdentifier(identifier, recommendation);
  }

  console.error(`[ABUSE_PATTERN] ${pattern.toUpperCase()}: ${identifier} - ${recommendation}`);
}

/**
 * Block an identifier (IP or user ID)
 */
export function blockIdentifier(identifier: string, reason: string): void {
  blockedIdentifiers.add(identifier);
  console.error(`[BLOCKED] ${identifier} - Reason: ${reason}`);

  // In production, persist to database
  // await BlockedIdentifier.create({ identifier, reason, blockedAt: new Date() });
}

/**
 * Unblock an identifier
 */
export function unblockIdentifier(identifier: string): void {
  blockedIdentifiers.delete(identifier);
  console.log(`[UNBLOCKED] ${identifier}`);
}

/**
 * Check if an identifier is blocked
 */
export function isBlocked(identifier: string): boolean {
  return blockedIdentifiers.has(identifier);
}

/**
 * Get rate limit events (admin)
 */
export function getRateLimitEvents(
  options: {
    identifier?: string;
    actionType?: string;
    severity?: 'warning' | 'critical';
    limit?: number;
    offsetHours?: number;
  } = {}
): RateLimitEvent[] {
  const { identifier, actionType, severity, limit = 100, offsetHours = 24 } = options;

  let events = rateLimitEvents.filter(
    (e) => new Date(e.timestamp) > new Date(Date.now() - offsetHours * 60 * 60 * 1000)
  );

  if (identifier) {
    events = events.filter((e) => e.identifier === identifier);
  }

  if (actionType) {
    events = events.filter((e) => e.actionType === actionType);
  }

  if (severity === 'critical') {
    events = events.filter((e) => e.blocked);
  }

  return events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, limit);
}

/**
 * Get detected abuse patterns
 */
export function getAbusePatterns(): AbusePattern[] {
  return Array.from(abusePatterns.values()).sort((a, b) => {
    const severityMap = { low: 1, medium: 2, high: 3, critical: 4 };
    return severityMap[b.severity] - severityMap[a.severity];
  });
}

/**
 * Get blocked identifiers
 */
export function getBlockedIdentifiers(): string[] {
  return Array.from(blockedIdentifiers);
}

/**
 * Get rate limiting statistics
 */
export function getRateLimitingStats(): {
  totalEvents: number;
  eventsLast24h: number;
  uniqueIdentifiers: number;
  blockedIdentifiers: number;
  abusePatterns: number;
  topViolators: Array<{ identifier: string; count: number }>;
  topActions: Array<{ action: string; count: number }>;
} {
  const last24h = rateLimitEvents.filter(
    (e) => new Date(e.timestamp) > new Date(Date.now() - 24 * 60 * 60 * 1000)
  );

  const identifierCounts = new Map<string, number>();
  last24h.forEach((e) => {
    identifierCounts.set(e.identifier, (identifierCounts.get(e.identifier) || 0) + 1);
  });

  const actionCounts = new Map<string, number>();
  last24h.forEach((e) => {
    actionCounts.set(e.actionType, (actionCounts.get(e.actionType) || 0) + 1);
  });

  return {
    totalEvents: rateLimitEvents.length,
    eventsLast24h: last24h.length,
    uniqueIdentifiers: new Set(last24h.map((e) => e.identifier)).size,
    blockedIdentifiers: blockedIdentifiers.size,
    abusePatterns: abusePatterns.size,
    topViolators: Array.from(identifierCounts.entries())
      .map(([identifier, count]) => ({ identifier, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    topActions: Array.from(actionCounts.entries())
      .map(([action, count]) => ({ action, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
  };
}

/**
 * Clear old events (run periodically, e.g., daily)
 */
export function clearOldEvents(olderThanDays: number = 30): void {
  const cutoffTime = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

  const originalLength = rateLimitEvents.length;
  rateLimitEvents.splice(
    0,
    rateLimitEvents.length,
    ...rateLimitEvents.filter((e) => new Date(e.timestamp) > cutoffTime)
  );

  const removed = originalLength - rateLimitEvents.length;
  if (removed > 0) {
    console.log(`[CLEANUP] Removed ${removed} old rate limit events`);
  }
}

/**
 * Export for analysis
 */
export function exportRateLimitData(): {
  events: RateLimitEvent[];
  abusePatterns: AbusePattern[];
  blockedIdentifiers: string[];
  statistics: ReturnType<typeof getRateLimitingStats>;
} {
  return {
    events: rateLimitEvents,
    abusePatterns: Array.from(abusePatterns.values()),
    blockedIdentifiers: Array.from(blockedIdentifiers),
    statistics: getRateLimitingStats(),
  };
}
