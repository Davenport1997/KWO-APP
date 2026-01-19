import { Request, Response, NextFunction } from 'express';
import {
  verifyPremiumAccess,
  isPremiumUser,
  getSubscriptionStatus
} from '../utils/subscriptionService.js';

/**
 * Premium verification middleware
 * Checks server-side subscription status with RevenueCat
 * Uses cache but can force fresh verification for sensitive operations
 */
export const requirePremiumVerified = (sensitiveOperation: boolean = false) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: 'User not authenticated',
          code: 'NOT_AUTHENTICATED'
        });
        return;
      }

      const { id: userId } = req.user;
      const endpoint = req.path;

      // Verify premium access with RevenueCat
      const { hasAccess, status, gracePeriod } = await verifyPremiumAccess(
        userId,
        endpoint,
        sensitiveOperation
      );

      if (!hasAccess) {
        res.status(403).json({
          success: false,
          error: 'This feature requires an active premium subscription',
          code: 'PREMIUM_SUBSCRIPTION_REQUIRED',
          subscriptionStatus: status.status,
          expiryDate: status.expiryDate
        });
        return;
      }

      // Attach subscription info to request
      req.subscription = {
        isActive: true,
        status: status.status,
        gracePeriod,
        expiryDate: status.expiryDate,
        subscriptionType: status.subscriptionType
      };

      next();
    } catch (error) {
      console.error('Premium verification error:', error);

      res.status(500).json({
        success: false,
        error: 'Failed to verify premium status',
        code: 'PREMIUM_VERIFICATION_ERROR'
      });
    }
  };
};

/**
 * Get subscription info middleware
 * Attaches subscription data to request without blocking
 * Useful for returning subscription info along with feature data
 */
export const attachSubscriptionInfo = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      next();
      return;
    }

    const status = await getSubscriptionStatus(req.user.id);
    req.subscription = {
      isActive: status.isActive,
      status: status.status,
      gracePeriod: status.status === 'grace_period',
      expiryDate: status.expiryDate,
      subscriptionType: status.subscriptionType
    };

    next();
  } catch (error) {
    console.error('Failed to attach subscription info:', error);
    // Don't block request on error, just continue
    next();
  }
};

declare global {
  namespace Express {
    interface Request {
      subscription?: {
        isActive: boolean;
        status: 'active' | 'trial' | 'cancelled' | 'expired' | 'grace_period' | 'none';
        gracePeriod: boolean;
        expiryDate: string | null;
        subscriptionType: 'monthly' | 'annual' | 'trial' | 'none';
      };
    }
  }
}
