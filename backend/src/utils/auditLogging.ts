/**
 * Audit Logging System
 *
 * Logs all calculations and suspicious activity for fraud detection and debugging.
 * Creates an immutable audit trail of all user actions affecting points/achievements.
 */

import { Request } from 'express';

export interface AuditLog {
  id: string;
  userId: string;
  actionType: string;
  actionData: Record<string, unknown>;
  resultData: Record<string, unknown>;
  pointsEarned: number;
  xpEarned: number;
  timestamp: string;
  submittedTimestamp: string;
  ipAddress: string;
  userAgent: string;
  validationErrors: Array<{
    code: string;
    message: string;
    severity: string;
  }>;
  flaggedAsScream: boolean;
  notes?: string;
}

/**
 * Create audit log entry
 */
export function createAuditLog(
  req: Request,
  userId: string,
  actionType: string,
  actionData: Record<string, unknown>,
  resultData: Record<string, unknown>,
  pointsEarned: number,
  xpEarned: number,
  submittedTimestamp: string,
  validationErrors: any[] = [],
  flaggedAsSuspicious: boolean = false
): AuditLog {
  return {
    id: `audit_${Date.now()}_${Math.random().toString(36).substring(7)}`,
    userId,
    actionType,
    actionData,
    resultData,
    pointsEarned,
    xpEarned,
    timestamp: new Date().toISOString(),
    submittedTimestamp,
    ipAddress: getClientIP(req),
    userAgent: req.get('user-agent') || 'unknown',
    validationErrors,
    flaggedAsScream: flaggedAsSuspicious,
  };
}

/**
 * Get client IP address from request
 */
export function getClientIP(req: Request): string {
  return (
    (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ||
    (req.headers['x-real-ip'] as string) ||
    req.socket.remoteAddress ||
    'unknown'
  );
}

/**
 * Store audit log (in production, use database)
 * For now, logs to console and in-memory store
 */
const auditLogs: AuditLog[] = [];

export function storeAuditLog(log: AuditLog): void {
  auditLogs.push(log);

  // Log to console for debugging
  console.log('[AUDIT]', {
    id: log.id,
    userId: log.userId,
    action: log.actionType,
    points: log.pointsEarned,
    xp: log.xpEarned,
    suspicious: log.flaggedAsScream,
    timestamp: log.timestamp,
    ip: log.ipAddress,
  });

  // In production, persist to database:
  // await AuditLogModel.create(log);
}

/**
 * Get audit logs for a user (admin only)
 */
export function getAuditLogsForUser(userId: string, limit: number = 100): AuditLog[] {
  return auditLogs
    .filter((log) => log.userId === userId)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);
}

/**
 * Get suspicious activity logs (admin only)
 */
export function getSuspiciousActivityLogs(limit: number = 50): AuditLog[] {
  return auditLogs
    .filter((log) => log.flaggedAsScream)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);
}

/**
 * Get activity summary for fraud detection
 */
export function getActivitySummary(
  userId: string,
  hoursBack: number = 24
): {
  totalPoints: number;
  totalXP: number;
  actionCount: number;
  uniqueActionTypes: string[];
  suspiciousCount: number;
  averagePointsPerAction: number;
} {
  const cutoffTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

  const userLogs = auditLogs.filter(
    (log) =>
      log.userId === userId && new Date(log.timestamp) > cutoffTime
  );

  const suspiciousCount = userLogs.filter((log) => log.flaggedAsScream).length;
  const totalPoints = userLogs.reduce((sum, log) => sum + log.pointsEarned, 0);
  const totalXP = userLogs.reduce((sum, log) => sum + log.xpEarned, 0);
  const actionCount = userLogs.length;
  const uniqueActionTypes = Array.from(new Set(userLogs.map((log) => log.actionType)));

  return {
    totalPoints,
    totalXP,
    actionCount,
    uniqueActionTypes,
    suspiciousCount,
    averagePointsPerAction: actionCount > 0 ? totalPoints / actionCount : 0,
  };
}
