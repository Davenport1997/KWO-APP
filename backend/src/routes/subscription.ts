/**
 * Subscription Routes - Server-side subscription verification
 *
 * This module handles all subscription verification server-side,
 * keeping RevenueCat secret keys secure.
 */

import { Router, Request, Response } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { fetchWithTimeout } from '../utils/httpClient.js';

const router = Router();

// RevenueCat server-side API
const REVENUECAT_SECRET_KEY = process.env.REVENUECAT_SECRET_KEY;
const REVENUECAT_API_URL = 'https://api.revenuecat.com/v1';

/**
 * POST /subscription/verify
 * Verify user's subscription status server-side
 * This is more secure than client-side verification
 */
router.post('/verify', verifyToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, entitlementId = 'premium' } = req.body;
    const userIdToCheck = userId || req.user?.id;

    if (!userIdToCheck) {
      res.status(400).json({
        success: false,
        error: 'User ID is required',
        code: 'INVALID_REQUEST'
      });
      return;
    }

    // If RevenueCat is not configured, return mock response for development
    if (!REVENUECAT_SECRET_KEY) {
      console.log('[Subscription] RevenueCat not configured, returning mock response');
      res.json({
        success: true,
        data: {
          hasEntitlement: false,
          entitlements: {},
          subscriptions: {},
          message: 'RevenueCat not configured on server'
        }
      });
      return;
    }

    // Call RevenueCat API to get subscriber info
    const response = await fetchWithTimeout(
      `${REVENUECAT_API_URL}/subscribers/${encodeURIComponent(userIdToCheck)}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${REVENUECAT_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000, // 15 seconds for payment API
      }
    );

    if (!response.ok) {
      // User might not exist in RevenueCat yet
      if (response.status === 404) {
        res.json({
          success: true,
          data: {
            hasEntitlement: false,
            entitlements: {},
            subscriptions: {},
            message: 'No subscription found'
          }
        });
        return;
      }

      const errorData = await response.json().catch(() => ({}));
      console.error('[Subscription] RevenueCat API error:', errorData);
      res.status(response.status).json({
        success: false,
        error: 'Failed to verify subscription',
        code: 'VERIFICATION_FAILED'
      });
      return;
    }

    const data = await response.json();
    const subscriber = data.subscriber;

    // Check if user has the requested entitlement
    const entitlements = subscriber?.entitlements || {};
    const hasEntitlement = entitlements[entitlementId]?.expires_date
      ? new Date(entitlements[entitlementId].expires_date) > new Date()
      : false;

    // Get active subscriptions
    const subscriptions = subscriber?.subscriptions || {};
    const activeSubscriptions: Record<string, {
      productId: string;
      expiresDate: string;
      isActive: boolean;
      willRenew: boolean;
    }> = {};

    for (const [productId, subscription] of Object.entries(subscriptions)) {
      const sub = subscription as {
        expires_date: string;
        unsubscribe_detected_at?: string;
      };
      const expiresDate = new Date(sub.expires_date);
      const isActive = expiresDate > new Date();

      if (isActive) {
        activeSubscriptions[productId] = {
          productId,
          expiresDate: sub.expires_date,
          isActive: true,
          willRenew: !sub.unsubscribe_detected_at
        };
      }
    }

    res.json({
      success: true,
      data: {
        hasEntitlement,
        entitlements: Object.keys(entitlements).reduce((acc: Record<string, { isActive: boolean; expiresDate: string | null }>, key) => {
          const ent = entitlements[key];
          acc[key] = {
            isActive: ent.expires_date ? new Date(ent.expires_date) > new Date() : false,
            expiresDate: ent.expires_date || null
          };
          return acc;
        }, {}),
        subscriptions: activeSubscriptions
      }
    });
  } catch (error) {
    console.error('[Subscription] Verification error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * POST /subscription/grant-entitlement
 * Grant entitlement to user (admin only, for testing/support)
 */
router.post('/grant-entitlement', verifyToken, async (req: Request, res: Response): Promise<void> => {
  try {
    // Only admins can grant entitlements
    if (req.user?.role !== 'admin') {
      res.status(403).json({
        success: false,
        error: 'Admin access required',
        code: 'FORBIDDEN'
      });
      return;
    }

    const { userId, entitlementId, durationDays = 30 } = req.body;

    if (!userId || !entitlementId) {
      res.status(400).json({
        success: false,
        error: 'User ID and entitlement ID are required',
        code: 'INVALID_REQUEST'
      });
      return;
    }

    if (!REVENUECAT_SECRET_KEY) {
      res.status(503).json({
        success: false,
        error: 'RevenueCat not configured',
        code: 'SERVICE_UNAVAILABLE'
      });
      return;
    }

    // Grant promotional entitlement via RevenueCat API
    const expiresDate = new Date();
    expiresDate.setDate(expiresDate.getDate() + durationDays);

    const response = await fetchWithTimeout(
      `${REVENUECAT_API_URL}/subscribers/${encodeURIComponent(userId)}/entitlements/${encodeURIComponent(entitlementId)}/promotional`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${REVENUECAT_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          duration: 'daily',
          duration_count: durationDays
        }),
        timeout: 15000, // 15 seconds for payment API
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[Subscription] Grant entitlement error:', errorData);
      res.status(response.status).json({
        success: false,
        error: 'Failed to grant entitlement',
        code: 'GRANT_FAILED'
      });
      return;
    }

    res.json({
      success: true,
      data: {
        userId,
        entitlementId,
        grantedUntil: expiresDate.toISOString(),
        message: `Entitlement "${entitlementId}" granted for ${durationDays} days`
      }
    });
  } catch (error) {
    console.error('[Subscription] Grant error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * POST /subscription/revoke-entitlement
 * Revoke entitlement from user (admin only)
 */
router.post('/revoke-entitlement', verifyToken, async (req: Request, res: Response): Promise<void> => {
  try {
    if (req.user?.role !== 'admin') {
      res.status(403).json({
        success: false,
        error: 'Admin access required',
        code: 'FORBIDDEN'
      });
      return;
    }

    const { userId, entitlementId } = req.body;

    if (!userId || !entitlementId) {
      res.status(400).json({
        success: false,
        error: 'User ID and entitlement ID are required',
        code: 'INVALID_REQUEST'
      });
      return;
    }

    if (!REVENUECAT_SECRET_KEY) {
      res.status(503).json({
        success: false,
        error: 'RevenueCat not configured',
        code: 'SERVICE_UNAVAILABLE'
      });
      return;
    }

    // Revoke promotional entitlement
    const response = await fetchWithTimeout(
      `${REVENUECAT_API_URL}/subscribers/${encodeURIComponent(userId)}/entitlements/${encodeURIComponent(entitlementId)}/revoke_promotionals`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${REVENUECAT_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000, // 15 seconds for payment API
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[Subscription] Revoke entitlement error:', errorData);
      res.status(response.status).json({
        success: false,
        error: 'Failed to revoke entitlement',
        code: 'REVOKE_FAILED'
      });
      return;
    }

    res.json({
      success: true,
      data: {
        userId,
        entitlementId,
        message: `Promotional entitlement "${entitlementId}" revoked`
      }
    });
  } catch (error) {
    console.error('[Subscription] Revoke error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * GET /subscription/status
 * Check if subscription service is configured
 */
router.get('/status', (req: Request, res: Response): void => {
  res.json({
    success: true,
    data: {
      configured: !!REVENUECAT_SECRET_KEY
    }
  });
});

export default router;
