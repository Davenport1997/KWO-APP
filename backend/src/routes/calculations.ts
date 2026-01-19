/**
 * Calculations Routes - Server-side calculations for security
 *
 * All calculations happen server-side to prevent cheating.
 * Mobile app sends action data, server validates and calculates results.
 */

import { Router, Request, Response } from 'express';
import { verifyToken, requirePremium } from '../middleware/auth.js';
import {
  validateTimestamp,
  validatePoints,
  validateDailyLimit,
  detectSuspiciousActivity,
  calculateXP,
  verifyStreak,
  calculateRecoveryScore,
  calculateSavings,
  checkAchievementEligibility,
  VALIDATION_RULES,
  POINT_VALUES,
  ValidationError,
} from '../utils/calculationValidation.js';
import {
  createAuditLog,
  storeAuditLog,
  getAuditLogsForUser,
  getSuspiciousActivityLogs,
  getActivitySummary,
} from '../utils/auditLogging.js';

const router = Router();

/**
 * POST /calculations/complete-action
 * Submit an action and get calculated XP/points
 * Requires authentication
 */
router.post('/complete-action', verifyToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'User not authenticated',
        code: 'NOT_AUTHENTICATED',
      });
      return;
    }

    const {
      actionType, // challenge, checkin, micro_win, workout, nutrition, meditation, etc.
      actionData, // Relevant data for the action
      submittedTimestamp, // When the action actually happened
      difficulty, // optional: hard, medium, easy
    } = req.body;

    if (!actionType || !submittedTimestamp) {
      res.status(400).json({
        success: false,
        error: 'Missing actionType or submittedTimestamp',
        code: 'INVALID_REQUEST',
      });
      return;
    }

    const validationErrors: ValidationError[] = [];

    // Step 1: Validate timestamp
    const timestampError = validateTimestamp(submittedTimestamp);
    if (timestampError) {
      validationErrors.push(timestampError);
      if (timestampError.severity === 'error') {
        res.status(400).json({
          success: false,
          error: timestampError.message,
          code: timestampError.code,
          validationErrors,
        });
        return;
      }
    }

    // Step 2: Validate daily limits (would query database in production)
    const dailyLimitError = validateDailyLimit(actionType, 0); // 0 for now, would check DB
    if (dailyLimitError) {
      validationErrors.push(dailyLimitError);
      res.status(429).json({
        success: false,
        error: dailyLimitError.message,
        code: dailyLimitError.code,
        validationErrors,
      });
      return;
    }

    // Step 3: Calculate XP
    const { xp: calculatedXP, breakdown: xpBreakdown } = calculateXP(actionType, {
      ...actionData,
      difficulty,
    });

    // Step 4: Validate points are reasonable
    const pointsError = validatePoints(actionType, calculatedXP, POINT_VALUES[actionType as keyof typeof POINT_VALUES] || 0);
    if (pointsError && pointsError.severity === 'error') {
      validationErrors.push(pointsError);
    }

    // Step 5: Check for suspicious activity (would use real user data in production)
    const suspiciousErrors = detectSuspiciousActivity({
      recentPoints: [calculatedXP],
      recentChallenges: 1,
      recentActions: [{ timestamp: submittedTimestamp }],
    });
    validationErrors.push(...suspiciousErrors);

    const isSuspicious = suspiciousErrors.some((e) => e.severity === 'critical');

    // Step 6: Create audit log
    const auditLog = createAuditLog(
      req,
      userId,
      actionType,
      actionData,
      { xp: calculatedXP, breakdown: xpBreakdown },
      calculatedXP,
      calculatedXP,
      submittedTimestamp,
      validationErrors.filter((e) => e.severity !== 'warning'),
      isSuspicious
    );

    storeAuditLog(auditLog);

    // Return calculation results
    res.json({
      success: true,
      data: {
        actionId: auditLog.id,
        xpEarned: calculatedXP,
        pointsEarned: calculatedXP,
        breakdown: xpBreakdown,
        validationErrors: validationErrors.filter((e) => e.severity === 'warning'),
        flaggedAsSuspicious: isSuspicious,
        message: isSuspicious
          ? 'Action recorded but flagged for review'
          : 'XP calculated and awarded successfully',
      },
    });
  } catch (error) {
    console.error('[Calculations] Error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  }
});

/**
 * POST /calculations/verify-streak
 * Verify user's streak validity
 */
router.post('/verify-streak', verifyToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'User not authenticated',
        code: 'NOT_AUTHENTICATED',
      });
      return;
    }

    const { lastCheckInDate, currentDate } = req.body;

    if (!lastCheckInDate) {
      res.status(400).json({
        success: false,
        error: 'Missing lastCheckInDate',
        code: 'INVALID_REQUEST',
      });
      return;
    }

    const lastDate = new Date(lastCheckInDate);
    const currDate = currentDate ? new Date(currentDate) : new Date();

    const { isValid, daysInStreak, reason } = verifyStreak(lastDate, currDate);

    res.json({
      success: true,
      data: {
        isValid,
        daysInStreak,
        reason,
      },
    });
  } catch (error) {
    console.error('[Calculations] Streak error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  }
});

/**
 * POST /calculations/recovery-score
 * Calculate user's recovery score (0-100)
 */
router.post('/recovery-score', verifyToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'User not authenticated',
        code: 'NOT_AUTHENTICATED',
      });
      return;
    }

    const {
      totalCheckIns,
      consistencyDays,
      averageMood,
      challengesCompletedThisWeek,
      crisisSessionsSurvived,
      currentStreak,
    } = req.body;

    if (
      totalCheckIns === undefined ||
      consistencyDays === undefined ||
      averageMood === undefined
    ) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields',
        code: 'INVALID_REQUEST',
      });
      return;
    }

    const { score, breakdown } = calculateRecoveryScore({
      totalCheckIns,
      consistencyDays,
      averageMood,
      challengesCompletedThisWeek: challengesCompletedThisWeek || 0,
      crisisSessionsSurvived: crisisSessionsSurvived || 0,
      currentStreak: currentStreak || 0,
    });

    // Create audit log for score calculation
    const auditLog = createAuditLog(
      req,
      userId,
      'recovery_score_calculation',
      req.body,
      { score, breakdown },
      0,
      0,
      new Date().toISOString()
    );
    storeAuditLog(auditLog);

    res.json({
      success: true,
      data: {
        score,
        breakdown,
        scoreLevel: getScoreLevel(score),
      },
    });
  } catch (error) {
    console.error('[Calculations] Recovery score error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  }
});

/**
 * POST /calculations/savings
 * Calculate financial savings
 */
router.post('/savings', verifyToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'User not authenticated',
        code: 'NOT_AUTHENTICATED',
      });
      return;
    }

    const { addictionCosts, streakDays, addictionsStopped } = req.body;

    if (!addictionCosts || streakDays === undefined || !addictionsStopped) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields',
        code: 'INVALID_REQUEST',
      });
      return;
    }

    const { totalSavings, savingsByAddiction } = calculateSavings(
      addictionCosts,
      streakDays,
      addictionsStopped
    );

    // Create audit log
    const auditLog = createAuditLog(
      req,
      userId,
      'savings_calculation',
      req.body,
      { totalSavings, savingsByAddiction },
      0,
      0,
      new Date().toISOString()
    );
    storeAuditLog(auditLog);

    res.json({
      success: true,
      data: {
        totalSavings,
        savingsByAddiction,
        formattedSavings: `$${totalSavings.toFixed(2)}`,
      },
    });
  } catch (error) {
    console.error('[Calculations] Savings error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  }
});

/**
 * POST /calculations/check-achievement
 * Check if user has earned an achievement
 */
router.post('/check-achievement', verifyToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'User not authenticated',
        code: 'NOT_AUTHENTICATED',
      });
      return;
    }

    const { achievementType, userData } = req.body;

    if (!achievementType || !userData) {
      res.status(400).json({
        success: false,
        error: 'Missing achievementType or userData',
        code: 'INVALID_REQUEST',
      });
      return;
    }

    const { eligible, reason } = checkAchievementEligibility(achievementType, userData);

    // Create audit log
    const auditLog = createAuditLog(
      req,
      userId,
      `achievement_check_${achievementType}`,
      { achievementType, userData },
      { eligible },
      0,
      0,
      new Date().toISOString()
    );
    storeAuditLog(auditLog);

    res.json({
      success: true,
      data: {
        eligible,
        reason,
      },
    });
  } catch (error) {
    console.error('[Calculations] Achievement error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  }
});

/**
 * GET /calculations/audit-logs
 * Get audit logs for a user (admin only)
 */
router.get('/audit-logs', verifyToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'User not authenticated',
        code: 'NOT_AUTHENTICATED',
      });
      return;
    }

    // Only admins can view audit logs
    if (req.user?.role !== 'admin') {
      res.status(403).json({
        success: false,
        error: 'Admin access required',
        code: 'FORBIDDEN',
      });
      return;
    }

    const { targetUserId, limit = 100 } = req.query;

    if (!targetUserId) {
      res.status(400).json({
        success: false,
        error: 'Missing targetUserId',
        code: 'INVALID_REQUEST',
      });
      return;
    }

    const logs = getAuditLogsForUser(targetUserId as string, Math.min(Number(limit), 1000));

    res.json({
      success: true,
      data: {
        logs,
        count: logs.length,
      },
    });
  } catch (error) {
    console.error('[Calculations] Audit logs error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  }
});

/**
 * GET /calculations/suspicious-activity
 * Get suspicious activity logs (admin only)
 */
router.get('/suspicious-activity', verifyToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'User not authenticated',
        code: 'NOT_AUTHENTICATED',
      });
      return;
    }

    // Only admins can view suspicious activity
    if (req.user?.role !== 'admin') {
      res.status(403).json({
        success: false,
        error: 'Admin access required',
        code: 'FORBIDDEN',
      });
      return;
    }

    const { limit = 50 } = req.query;
    const logs = getSuspiciousActivityLogs(Math.min(Number(limit), 500));

    res.json({
      success: true,
      data: {
        logs,
        count: logs.length,
      },
    });
  } catch (error) {
    console.error('[Calculations] Suspicious activity error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  }
});

/**
 * GET /calculations/activity-summary/:userId
 * Get activity summary for a user (admin only)
 */
router.get('/activity-summary/:userId', verifyToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const adminId = req.user?.id;
    if (!adminId || req.user?.role !== 'admin') {
      res.status(403).json({
        success: false,
        error: 'Admin access required',
        code: 'FORBIDDEN',
      });
      return;
    }

    const { userId } = req.params;
    const { hoursBack = 24 } = req.query;

    const summary = getActivitySummary(userId, Number(hoursBack));

    res.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    console.error('[Calculations] Activity summary error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  }
});

/**
 * Helper: Get score level description
 */
function getScoreLevel(score: number): string {
  if (score >= 80) return 'Excellent';
  if (score >= 60) return 'Good';
  if (score >= 40) return 'Fair';
  if (score >= 20) return 'Starting';
  return 'Beginning';
}

export default router;
