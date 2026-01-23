/**
 * Admin Endpoints
 * Cache management and monitoring endpoints
 */

import { verifyToken } from '../middleware/auth';
import {
  getAllCacheStats,
  clearAllCaches,
  invalidateUserCache,
  generateCacheKey
} from '../utils/cache';

const router = Router();

/**
 * Middleware to verify admin role (add to requests that need it)
 */
export const requireAdmin = (req: Request, res: Response, next: Function) => {
  // In production, check user role from JWT
  // For now, just allow authenticated users
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
};

/**
 * GET /admin/cache-stats
 * Get comprehensive cache statistics and monitoring data
 */
router.get('/cache-stats', verifyToken, requireAdmin, (req: Request, res: Response) => {
  try {
    const stats = getAllCacheStats();

    res.json({
      success: true,
      data: {
        ...stats,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage()
      }
    });
  } catch (error) {
    console.error('Cache stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get cache statistics'
    });
  }
});

/**
 * POST /admin/cache/clear
 * Clear all caches (for debugging or maintenance)
 */
router.post('/cache/clear', verifyToken, requireAdmin, (req: Request, res: Response) => {
  try {
    clearAllCaches();

    res.json({
      success: true,
      message: 'All caches cleared',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Cache clear error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clear caches'
    });
  }
});

/**
 * POST /admin/cache/invalidate-user
 * Invalidate cache for a specific user (after profile update)
 */
router.post('/cache/invalidate-user', verifyToken, requireAdmin, (req: Request, res: Response) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      res.status(400).json({
        success: false,
        error: 'userId is required'
      });
      return;
    }

    invalidateUserCache(userId);

    res.json({
      success: true,
      message: `Cache invalidated for user ${userId}`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('User cache invalidation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to invalidate user cache'
    });
  }
});

/**
 * POST /admin/cache/warm
 * Pre-populate cache with frequently accessed data
 * Useful after cache clear or server restart
 */
router.post('/cache/warm', verifyToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    // Import here to avoid circular dependency
 const { getAddictionFacts, getDailyChallenges, getMicroLessons } = await import('../utils/staticDataCache');
    console.log('[Admin] Warming up caches...');

    // Pre-load static data
    await Promise.all([
      getAddictionFacts(100),
      getDailyChallenges(50),
      getMicroLessons(30)
    ]);

    const stats = getAllCacheStats();

    res.json({
      success: true,
      message: 'Cache warmed up successfully',
      stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Cache warm error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to warm cache'
    });
  }
});

export default router;
