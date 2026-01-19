import { Router, Request, Response } from 'express';
import { verifyToken, requireAdmin } from '../middleware/auth.js';
import {
  getAuditLogs,
  getFraudAlerts,
  getCacheStats,
  clearUserCache
} from '../utils/subscriptionService.js';

const router = Router();

/**
 * GET /premium/admin/monitoring
 * Admin dashboard for premium subscription monitoring
 * Shows fraud alerts, cache stats, and recent access attempts
 */
router.get(
  '/admin/monitoring',
  verifyToken,
  requireAdmin,
  (req: Request, res: Response): void => {
    try {
      const { limit = 50, offset = 0 } = req.query;

      // Get fraud alerts
      const fraudAlerts = getFraudAlerts();

      // Get cache statistics
      const cacheStats = getCacheStats();

      // Get recent audit logs
      const auditLogs = getAuditLogs(
        parseInt(limit as string),
        parseInt(offset as string)
      );

      res.json({
        success: true,
        data: {
          fraud_alerts: fraudAlerts,
          fraud_alert_count: fraudAlerts.length,
          cache_stats: cacheStats,
          recent_access: {
            logs: auditLogs,
            total: auditLogs.length,
            limit: parseInt(limit as string),
            offset: parseInt(offset as string)
          },
          monitoring_status: {
            status: fraudAlerts.length > 0 ? 'warning' : 'healthy',
            timestamp: new Date().toISOString()
          }
        }
      });
    } catch (error) {
      console.error('Monitoring error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve monitoring data',
        code: 'MONITORING_ERROR'
      });
    }
  }
);

/**
 * POST /premium/admin/clear-cache
 * Admin endpoint to clear subscription cache for a user
 * Useful after manual RevenueCat dashboard changes
 */
router.post(
  '/admin/clear-cache',
  verifyToken,
  requireAdmin,
  (req: Request, res: Response): void => {
    try {
      const { userId } = req.body;

      if (!userId) {
        res.status(400).json({
          success: false,
          error: 'userId is required',
          code: 'MISSING_USERID'
        });
        return;
      }

      clearUserCache(userId);

      res.json({
        success: true,
        message: `Cache cleared for user ${userId}`,
        data: {
          user_id: userId,
          cleared_at: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Cache clear error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to clear cache',
        code: 'CACHE_CLEAR_ERROR'
      });
    }
  }
);

/**
 * GET /premium/admin/audit-logs
 * Get all audit logs (admin only)
 * Shows all premium access attempts across all users
 */
router.get(
  '/admin/audit-logs',
  verifyToken,
  requireAdmin,
  (req: Request, res: Response): void => {
    try {
      const { limit = 100, offset = 0 } = req.query;

      const logs = getAuditLogs(
        parseInt(limit as string),
        parseInt(offset as string)
      );

      res.json({
        success: true,
        data: {
          audit_logs: logs,
          total: logs.length,
          limit: parseInt(limit as string),
          offset: parseInt(offset as string),
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Audit logs error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve audit logs',
        code: 'AUDIT_LOGS_ERROR'
      });
    }
  }
);

export default router;
