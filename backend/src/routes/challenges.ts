import { Router, Request, Response } from 'express';
import { verifyToken, requirePremium } from '../middleware/auth.js';
import { createActionLimiter } from '../middleware/rateLimiting.js';
import { logRateLimitEvent } from '../utils/rateLimitMonitoring.js';

const router = Router();

// Mock challenges storage
const mockChallenges: Record<string, Array<{
  id: string;
  user_id: string;
  title: string;
  description: string;
  difficulty: 'easy' | 'medium' | 'hard';
  completed: boolean;
  created_at: string;
  completed_at?: string;
}>> = {};

/**
 * POST /challenges/generate
 * Generate daily challenges (protected)
 * Returns: { challenges array }
 */
router.post('/generate', verifyToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;

    // Initialize if doesn't exist
    if (!mockChallenges[userId!]) {
      mockChallenges[userId!] = [];
    }

    // Check if already generated today
    const today = new Date().toDateString();
    const generatedToday = mockChallenges[userId!].some(
      c => new Date(c.created_at).toDateString() === today
    );

    if (generatedToday) {
      // Return existing challenges
      const todaysChallenges = mockChallenges[userId!].filter(
        c => new Date(c.created_at).toDateString() === today
      );
      res.json({
        success: true,
        data: { challenges: todaysChallenges }
      });
      return;
    }

    // Generate new challenges
    const challenges = generateDailyChallenges(userId!);
    mockChallenges[userId!].push(...challenges);

    res.json({
      success: true,
      data: { challenges }
    });
  } catch (error) {
    console.error('Generate challenges error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate challenges',
      code: 'GENERATE_ERROR'
    });
  }
});

/**
 * POST /challenges/complete
 * Mark challenge complete (protected)
 * Rate Limited: 10 per day per user
 * Returns: { challenge, points_earned }
 */
router.post('/complete', verifyToken, (req: Request, res: Response, next) => {
  const chLimiter = createActionLimiter('challenge', false);
  chLimiter(req, res, next);
}, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { challengeId } = req.body;

    if (!challengeId) {
      res.status(400).json({
        success: false,
        error: 'Challenge ID is required',
        code: 'MISSING_CHALLENGE_ID'
      });
      return;
    }

    const challenges = mockChallenges[userId!];
    if (!challenges) {
      res.status(404).json({
        success: false,
        error: 'No challenges found',
        code: 'NO_CHALLENGES'
      });
      return;
    }

    const challenge = challenges.find(c => c.id === challengeId);
    if (!challenge) {
      res.status(404).json({
        success: false,
        error: 'Challenge not found',
        code: 'CHALLENGE_NOT_FOUND'
      });
      return;
    }

    if (challenge.completed) {
      res.status(400).json({
        success: false,
        error: 'Challenge already completed',
        code: 'ALREADY_COMPLETED'
      });
      return;
    }

    challenge.completed = true;
    challenge.completed_at = new Date().toISOString();

    const pointsEarned = challenge.difficulty === 'easy' ? 10 : challenge.difficulty === 'medium' ? 20 : 30;

    res.json({
      success: true,
      data: {
        challenge,
        points_earned: pointsEarned
      }
    });
  } catch (error) {
    console.error('Complete challenge error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to complete challenge',
      code: 'COMPLETE_ERROR'
    });
  }
});

/**
 * GET /challenges/history
 * Get challenge history (protected)
 * Returns: { challenges array, completion rate }
 */
router.get('/history', verifyToken, (req: Request, res: Response): void => {
  try {
    const userId = req.user?.id;
    const { limit = 50, offset = 0 } = req.query;

    const history = mockChallenges[userId!] || [];
    const paginatedHistory = history
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(
        parseInt(offset as string),
        parseInt(offset as string) + parseInt(limit as string)
      );

    const completedCount = history.filter(c => c.completed).length;
    const completionRate = history.length > 0
      ? Math.round((completedCount / history.length) * 100)
      : 0;

    res.json({
      success: true,
      data: {
        challenges: paginatedHistory,
        statistics: {
          total: history.length,
          completed: completedCount,
          completion_rate: completionRate
        },
        offset: parseInt(offset as string),
        limit: parseInt(limit as string)
      }
    });
  } catch (error) {
    console.error('Challenge history error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve challenge history',
      code: 'HISTORY_ERROR'
    });
  }
});

// Helper function to generate daily challenges
function generateDailyChallenges(userId: string) {
  const difficulties: Array<'easy' | 'medium' | 'hard'> = ['easy', 'medium', 'hard'];
  const challengeTemplates = [
    {
      title: 'Morning Reflection',
      description: 'Spend 5 minutes reflecting on your recovery goals',
      difficulty: 'easy' as const
    },
    {
      title: 'Reach Out to Support',
      description: 'Contact a friend or support group member',
      difficulty: 'medium' as const
    },
    {
      title: 'Healthy Activity',
      description: 'Engage in a physical activity for 30 minutes',
      difficulty: 'medium' as const
    },
    {
      title: 'Gratitude Practice',
      description: 'List 3 things you\'re grateful for today',
      difficulty: 'easy' as const
    },
    {
      title: 'Mindfulness Session',
      description: 'Complete a 10-minute mindfulness or meditation session',
      difficulty: 'hard' as const
    }
  ];

  const challenges = challengeTemplates.slice(0, 3).map((template, index) => ({
    id: `challenge_${Date.now()}_${index}`,
    user_id: userId,
    ...template,
    completed: false,
    created_at: new Date().toISOString()
  }));

  return challenges;
}

export default router;
