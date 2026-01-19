/**
 * Rate Limiting Admin Routes
 *
 * Endpoints for monitoring and managing rate limits:
 * - View rate limit statistics
 * - View violation logs
 * - View abuse patterns
 * - Block/unblock identifiers
 * - Configure rate limit rules
 * - Export data for analysis
 */

import { Router, Request, Response } from 'express';
import { verifyToken, requireAdmin } from '../middleware/auth.js';
import { ipMiddleware, isAdminIP, addAdminIP, removeAdminIP, getAdminWhitelist } from '../middleware/rateLimiting.js';
import {
  getRateLimitEvents,
  getAbusePatterns,
  getBlockedIdentifiers,
  getRateLimitingStats,
  blockIdentifier,
  unblockIdentifier,
  isBlocked,
  exportRateLimitData,
} from '../utils/rateLimitMonitoring.js';

const router = Router();

/**
 * GET /admin/rate-limit/stats
 * Get rate limiting statistics
 * Admin only
 */
router.get('/stats', verifyToken, requireAdmin, (req: Request, res: Response): void => {
  try {
    const stats = getRateLimitingStats();

    res.json({
      success: true,
      data: {
        ...stats,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('[RateLimit] Stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch statistics',
      code: 'INTERNAL_ERROR',
    });
  }
});

/**
 * GET /admin/rate-limit/events
 * Get rate limit violation events
 * Admin only
 */
router.get('/events', verifyToken, requireAdmin, (req: Request, res: Response): void => {
  try {
    const { identifier, actionType, severity, limit = 100, offsetHours = 24 } = req.query;

    const events = getRateLimitEvents({
      identifier: identifier as string | undefined,
      actionType: actionType as string | undefined,
      severity: severity as any,
      limit: Number(limit),
      offsetHours: Number(offsetHours),
    });

    res.json({
      success: true,
      data: {
        count: events.length,
        events,
      },
    });
  } catch (error) {
    console.error('[RateLimit] Events error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch events',
      code: 'INTERNAL_ERROR',
    });
  }
});

/**
 * GET /admin/rate-limit/abuse-patterns
 * Get detected abuse patterns
 * Admin only
 */
router.get('/abuse-patterns', verifyToken, requireAdmin, (req: Request, res: Response): void => {
  try {
    const patterns = getAbusePatterns();

    res.json({
      success: true,
      data: {
        count: patterns.length,
        patterns,
      },
    });
  } catch (error) {
    console.error('[RateLimit] Patterns error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch patterns',
      code: 'INTERNAL_ERROR',
    });
  }
});

/**
 * GET /admin/rate-limit/blocked
 * Get list of blocked identifiers
 * Admin only
 */
router.get('/blocked', verifyToken, requireAdmin, (req: Request, res: Response): void => {
  try {
    const blocked = getBlockedIdentifiers();

    res.json({
      success: true,
      data: {
        count: blocked.length,
        blocked,
      },
    });
  } catch (error) {
    console.error('[RateLimit] Blocked error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch blocked identifiers',
      code: 'INTERNAL_ERROR',
    });
  }
});

/**
 * POST /admin/rate-limit/block
 * Manually block an identifier
 * Admin only
 */
router.post('/block', verifyToken, requireAdmin, (req: Request, res: Response): void => {
  try {
    const { identifier, reason = 'Manual block by admin' } = req.body;

    if (!identifier) {
      res.status(400).json({
        success: false,
        error: 'Missing identifier',
        code: 'INVALID_REQUEST',
      });
      return;
    }

    if (isBlocked(identifier)) {
      res.status(400).json({
        success: false,
        error: 'Identifier already blocked',
        code: 'ALREADY_BLOCKED',
      });
      return;
    }

    blockIdentifier(identifier, reason);

    res.json({
      success: true,
      data: {
        blocked: true,
        identifier,
        reason,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('[RateLimit] Block error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to block identifier',
      code: 'INTERNAL_ERROR',
    });
  }
});

/**
 * POST /admin/rate-limit/unblock
 * Unblock an identifier
 * Admin only
 */
router.post('/unblock', verifyToken, requireAdmin, (req: Request, res: Response): void => {
  try {
    const { identifier } = req.body;

    if (!identifier) {
      res.status(400).json({
        success: false,
        error: 'Missing identifier',
        code: 'INVALID_REQUEST',
      });
      return;
    }

    if (!isBlocked(identifier)) {
      res.status(400).json({
        success: false,
        error: 'Identifier is not blocked',
        code: 'NOT_BLOCKED',
      });
      return;
    }

    unblockIdentifier(identifier);

    res.json({
      success: true,
      data: {
        unblocked: true,
        identifier,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('[RateLimit] Unblock error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to unblock identifier',
      code: 'INTERNAL_ERROR',
    });
  }
});

/**
 * GET /admin/rate-limit/export
 * Export all rate limiting data for analysis
 * Admin only
 */
router.get('/export', verifyToken, requireAdmin, (req: Request, res: Response): void => {
  try {
    const data = exportRateLimitData();

    res.json({
      success: true,
      data: {
        exportedAt: new Date().toISOString(),
        ...data,
      },
    });
  } catch (error) {
    console.error('[RateLimit] Export error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to export data',
      code: 'INTERNAL_ERROR',
    });
  }
});

/**
 * GET /admin/rate-limit/whitelist
 * Get admin IP whitelist
 * Admin only
 */
router.get('/whitelist', verifyToken, requireAdmin, (req: Request, res: Response): void => {
  try {
    const whitelist = getAdminWhitelist();

    res.json({
      success: true,
      data: whitelist,
    });
  } catch (error) {
    console.error('[RateLimit] Whitelist error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch whitelist',
      code: 'INTERNAL_ERROR',
    });
  }
});

/**
 * POST /admin/rate-limit/whitelist/add
 * Add IP to admin whitelist
 * Admin only
 */
router.post('/whitelist/add', verifyToken, requireAdmin, (req: Request, res: Response): void => {
  try {
    const { ip } = req.body;

    if (!ip || !isValidIP(ip)) {
      res.status(400).json({
        success: false,
        error: 'Invalid IP address',
        code: 'INVALID_REQUEST',
      });
      return;
    }

    addAdminIP(ip);

    res.json({
      success: true,
      data: {
        added: true,
        ip,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('[RateLimit] Whitelist add error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add to whitelist',
      code: 'INTERNAL_ERROR',
    });
  }
});

/**
 * POST /admin/rate-limit/whitelist/remove
 * Remove IP from admin whitelist
 * Admin only
 */
router.post('/whitelist/remove', verifyToken, requireAdmin, (req: Request, res: Response): void => {
  try {
    const { ip } = req.body;

    if (!ip) {
      res.status(400).json({
        success: false,
        error: 'Missing IP address',
        code: 'INVALID_REQUEST',
      });
      return;
    }

    removeAdminIP(ip);

    res.json({
      success: true,
      data: {
        removed: true,
        ip,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('[RateLimit] Whitelist remove error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to remove from whitelist',
      code: 'INTERNAL_ERROR',
    });
  }
});

/**
 * Helper: Validate IP address
 */
function isValidIP(ip: string): boolean {
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6Regex = /^([\da-f]{0,4}:){2,7}[\da-f]{0,4}$/i;

  if (ipv4Regex.test(ip)) {
    const parts = ip.split('.');
    return parts.every((part) => {
      const num = parseInt(part, 10);
      return num >= 0 && num <= 255;
    });
  }

  return ipv6Regex.test(ip);
}

export default router;
