import { AxiosError } from 'axios';
import { paymentHttpClient } from './httpClient.js';

/**
 * RevenueCat Subscription Service
 * Handles all subscription verification and status checks
 */

interface RevenueCatSubscription {
  entitlements: Record<string, any>;
  non_subscriptions: Record<string, any>;
  original_app_user_id: string;
  subscriber_attributes: Record<string, any>;
  request_date_ms: number;
}

interface SubscriptionStatus {
  userId: string;
  isActive: boolean;
  status: 'active' | 'trial' | 'cancelled' | 'expired' | 'grace_period' | 'none';
  subscriptionType: 'monthly' | 'annual' | 'trial' | 'none';
  expiryDate: string | null;
  gracePeriodEndsAt: string | null;
  lastVerified: string;
  entitlements: string[];
}

interface AuditLog {
  userId: string;
  timestamp: string;
  action: 'VERIFY_PREMIUM' | 'ACCESS_GRANTED' | 'ACCESS_DENIED' | 'GRACE_PERIOD_USED' | 'EXPIRED';
  endpoint: string;
  reason?: string;
  subscriptionStatus?: string;
}

// Cache structure: userId -> { data, expiresAt }
const subscriptionCache = new Map<
  string,
  { data: SubscriptionStatus; expiresAt: number }
>();

// Audit logs (in production, write to database)
const auditLogs: AuditLog[] = [];

const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const GRACE_PERIOD_DAYS = 3;
const REVENUECAT_API_URL = 'https://api.revenuecat.com/v1';

/**
 * Get RevenueCat API key from environment
 */
function getApiKey(): string {
  const key = process.env.REVENUECAT_API_KEY;
  if (!key) {
    throw new Error('REVENUECAT_API_KEY environment variable not set');
  }
  return key;
}

/**
 * Verify subscription status with RevenueCat
 * Always makes fresh API call to RevenueCat (respects cache separately)
 */
export async function verifySubscriptionWithRevenueCat(
  userId: string
): Promise<SubscriptionStatus> {
  try {
    const apiKey = getApiKey();

    // Call RevenueCat API with timeout
    const response = await paymentHttpClient.get<RevenueCatSubscription>(
      `${REVENUECAT_API_URL}/subscribers/${userId}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const data = response.data;
    const now = new Date();
    const entitlements = Object.keys(data.entitlements || {});

    // Check if user has active entitlements
    const hasActiveEntitlements = entitlements.some(
      (ent) => data.entitlements[ent].is_active
    );

    // Determine subscription status
    let status: SubscriptionStatus['status'] = 'none';
    let subscriptionType: SubscriptionStatus['subscriptionType'] = 'none';
    let expiryDate: string | null = null;
    let gracePeriodEndsAt: string | null = null;

    if (hasActiveEntitlements) {
      status = 'active';
      subscriptionType = entitlements.includes('premium_monthly')
        ? 'monthly'
        : 'annual';

      // Get expiry date from first active entitlement
      const activeEntitlement = Object.values(data.entitlements).find(
        (ent: any) => ent.is_active
      ) as any;
      if (activeEntitlement && activeEntitlement.expires_date) {
        expiryDate = activeEntitlement.expires_date;
      }
    } else if (Object.values(data.entitlements).some((ent: any) => ent.expires_date)) {
      // Check for grace period
      const expiredEntitlement = Object.values(data.entitlements).find(
        (ent: any) => ent.expires_date
      ) as any;

      if (expiredEntitlement) {
        expiryDate = expiredEntitlement.expires_date;
        const expiryTime = new Date(expiredEntitlement.expires_date).getTime();
        const gracePeriodTime = expiryTime + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;

        if (now.getTime() < gracePeriodTime) {
          status = 'grace_period';
          gracePeriodEndsAt = new Date(gracePeriodTime).toISOString();
        } else {
          status = 'expired';
        }
      }
    }

    const subscriptionStatus: SubscriptionStatus = {
      userId,
      isActive: status === 'active' || status === 'grace_period',
      status,
      subscriptionType,
      expiryDate,
      gracePeriodEndsAt,
      lastVerified: now.toISOString(),
      entitlements
    };

    // Update cache
    subscriptionCache.set(userId, {
      data: subscriptionStatus,
      expiresAt: now.getTime() + CACHE_DURATION_MS
    });

    return subscriptionStatus;
  } catch (error) {
    const axiosError = error as AxiosError;
    console.error('RevenueCat API error:', axiosError.message);

    if (axiosError.response?.status === 404) {
      // User not found in RevenueCat
      return {
        userId,
        isActive: false,
        status: 'none',
        subscriptionType: 'none',
        expiryDate: null,
        gracePeriodEndsAt: null,
        lastVerified: new Date().toISOString(),
        entitlements: []
      };
    }

    throw error;
  }
}

/**
 * Get cached subscription status (uses cache if valid)
 */
export async function getSubscriptionStatus(userId: string): Promise<SubscriptionStatus> {
  const now = Date.now();
  const cached = subscriptionCache.get(userId);

  // Return cached data if valid
  if (cached && cached.expiresAt > now) {
    console.log(`[Cache HIT] Subscription status for user ${userId}`);
    return cached.data;
  }

  // Fetch fresh data from RevenueCat
  console.log(`[Cache MISS] Fetching fresh subscription status for user ${userId}`);
  return verifySubscriptionWithRevenueCat(userId);
}

/**
 * Check if user has premium access
 * Includes grace period handling
 */
export async function isPremiumUser(userId: string): Promise<boolean> {
  const status = await getSubscriptionStatus(userId);
  return status.isActive; // active or grace_period
}

/**
 * Verify premium access and audit log
 * For sensitive operations, always verify (ignore cache)
 */
export async function verifyPremiumAccess(
  userId: string,
  endpoint: string,
  sensitiveOperation: boolean = false
): Promise<{
  hasAccess: boolean;
  status: SubscriptionStatus;
  gracePeriod: boolean;
}> {
  try {
    // For sensitive operations, always fetch fresh data
    let status: SubscriptionStatus;
    if (sensitiveOperation) {
      status = await verifySubscriptionWithRevenueCat(userId);
    } else {
      status = await getSubscriptionStatus(userId);
    }

    const hasAccess = status.isActive;
    const gracePeriod = status.status === 'grace_period';

    // Log audit trail
    logAuditEntry({
      userId,
      timestamp: new Date().toISOString(),
      action: hasAccess ? 'ACCESS_GRANTED' : 'ACCESS_DENIED',
      endpoint,
      subscriptionStatus: status.status,
      reason: gracePeriod ? 'Grace period active' : undefined
    });

    return {
      hasAccess,
      status,
      gracePeriod
    };
  } catch (error) {
    console.error(`Premium verification failed for user ${userId}:`, error);

    // Log failure
    logAuditEntry({
      userId,
      timestamp: new Date().toISOString(),
      action: 'ACCESS_DENIED',
      endpoint,
      reason: 'Verification service error'
    });

    throw error;
  }
}

/**
 * Log premium access attempts for fraud detection
 */
function logAuditEntry(entry: AuditLog): void {
  auditLogs.push(entry);

  // In production, write to database
  console.log(`[AUDIT] ${entry.action} - User: ${entry.userId} - Endpoint: ${entry.endpoint}`);

  // Keep last 1000 logs in memory
  if (auditLogs.length > 1000) {
    auditLogs.shift();
  }
}

/**
 * Get audit logs (for admin dashboard)
 */
export function getAuditLogs(
  limit: number = 100,
  offset: number = 0
): AuditLog[] {
  return auditLogs.slice(offset, offset + limit);
}

/**
 * Get user's audit trail
 */
export function getUserAuditTrail(userId: string, limit: number = 50): AuditLog[] {
  return auditLogs
    .filter((log) => log.userId === userId)
    .slice(-limit);
}

/**
 * Clear cache for user (useful after manual changes in RevenueCat dashboard)
 */
export function clearUserCache(userId: string): void {
  subscriptionCache.delete(userId);
  console.log(`[Cache CLEAR] Subscription cache cleared for user ${userId}`);
}

/**
 * Get cache statistics
 */
export function getCacheStats(): {
  cachedUsers: number;
  cacheSize: string;
} {
  return {
    cachedUsers: subscriptionCache.size,
    cacheSize: `${(subscriptionCache.size * 100).toLocaleString()} bytes (approx)`
  };
}

/**
 * Get fraud detection alerts
 * Detects suspicious patterns
 */
export function getFraudAlerts(): string[] {
  const alerts: string[] = [];
  const now = Date.now();
  const last5Minutes = now - 5 * 60 * 1000;

  // Check for multiple failed access attempts
  const recentFailures = auditLogs.filter(
    (log) => new Date(log.timestamp).getTime() > last5Minutes && log.action === 'ACCESS_DENIED'
  );

  const failuresByUser = new Map<string, number>();
  recentFailures.forEach((log) => {
    failuresByUser.set(log.userId, (failuresByUser.get(log.userId) || 0) + 1);
  });

  // Alert if user has >10 failed attempts in 5 minutes
  failuresByUser.forEach((count, userId) => {
    if (count > 10) {
      alerts.push(
        `⚠️ FRAUD ALERT: User ${userId} had ${count} failed premium access attempts in last 5 minutes`
      );
    }
  });

  return alerts;
}

export default {
  verifySubscriptionWithRevenueCat,
  getSubscriptionStatus,
  isPremiumUser,
  verifyPremiumAccess,
  clearUserCache,
  getCacheStats,
  getAuditLogs,
  getUserAuditTrail,
  getFraudAlerts
};
