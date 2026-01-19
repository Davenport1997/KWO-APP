import { Router, Request, Response } from 'express';
import { verifyToken } from '../middleware/auth.js';

const router = Router();

// Mock crisis session storage
const mockCrisisSessions: Record<string, Array<{
  id: string;
  user_id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  trigger?: string;
  coping_strategy?: string;
  duration_minutes: number;
  outcome: 'resolved' | 'escalated' | 'ongoing';
  created_at: string;
}>> = {};

/**
 * POST /crisis/session
 * Record crisis session (protected)
 * Returns: { session_id, resources, support_contacts }
 */
router.post('/session', verifyToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { severity, trigger, coping_strategy, duration_minutes, outcome } = req.body;

    if (!severity || !['low', 'medium', 'high', 'critical'].includes(severity)) {
      res.status(400).json({
        success: false,
        error: 'Valid severity level is required',
        code: 'INVALID_SEVERITY'
      });
      return;
    }

    if (!mockCrisisSessions[userId!]) {
      mockCrisisSessions[userId!] = [];
    }

    const session = {
      id: `crisis_${Date.now()}`,
      user_id: userId!,
      severity: severity as 'low' | 'medium' | 'high' | 'critical',
      trigger,
      coping_strategy,
      duration_minutes,
      outcome: outcome || 'ongoing',
      created_at: new Date().toISOString()
    };

    mockCrisisSessions[userId!].push(session);

    // Provide immediate support resources
    const resources = getResourcesByServerity(severity);

    res.json({
      success: true,
      data: {
        session_id: session.id,
        resources,
        support_contacts: getSupportContacts(),
        escalation_available: severity === 'critical'
      }
    });
  } catch (error) {
    console.error('Crisis session error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to record crisis session',
      code: 'SESSION_ERROR'
    });
  }
});

/**
 * GET /crisis/analytics
 * Get crisis patterns and analytics (protected)
 * Returns: { triggers, patterns, improvement_areas }
 */
router.get('/analytics', verifyToken, (req: Request, res: Response): void => {
  try {
    const userId = req.user?.id;
    const sessions = mockCrisisSessions[userId!] || [];

    // Analyze patterns
    const severityCounts = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0
    };

    sessions.forEach(s => {
      severityCounts[s.severity]++;
    });

    // Calculate averages
    const avgDuration = sessions.length > 0
      ? Math.round(sessions.reduce((sum, s) => sum + s.duration_minutes, 0) / sessions.length)
      : 0;

    const resolutionRate = sessions.length > 0
      ? Math.round((sessions.filter(s => s.outcome === 'resolved').length / sessions.length) * 100)
      : 0;

    res.json({
      success: true,
      data: {
        total_sessions: sessions.length,
        severity_breakdown: severityCounts,
        average_duration_minutes: avgDuration,
        resolution_rate: resolutionRate,
        insights: generateCrisisInsights(sessions),
        trends: analyzeTrends(sessions)
      }
    });
  } catch (error) {
    console.error('Crisis analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve crisis analytics',
      code: 'ANALYTICS_ERROR'
    });
  }
});

/**
 * GET /crisis/history
 * Get crisis session history (protected)
 * Returns: { sessions array, statistics }
 */
router.get('/history', verifyToken, (req: Request, res: Response): void => {
  try {
    const userId = req.user?.id;
    const { limit = 20, offset = 0 } = req.query;

    const history = mockCrisisSessions[userId!] || [];
    const paginatedHistory = history
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(
        parseInt(offset as string),
        parseInt(offset as string) + parseInt(limit as string)
      );

    res.json({
      success: true,
      data: {
        sessions: paginatedHistory,
        total: history.length,
        offset: parseInt(offset as string),
        limit: parseInt(limit as string)
      }
    });
  } catch (error) {
    console.error('Crisis history error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve crisis history',
      code: 'HISTORY_ERROR'
    });
  }
});

// Helper functions
function getResourcesByServerity(severity: string) {
  const resources: Record<string, string[]> = {
    low: [
      'Take a 10-minute break',
      'Practice deep breathing',
      'Contact a trusted friend'
    ],
    medium: [
      'Practice grounding techniques (5-4-3-2-1)',
      'Call your sponsor or accountability partner',
      'Engage in a healthy coping activity'
    ],
    high: [
      'Call a crisis hotline immediately',
      'Contact mental health professional',
      'Go to nearest emergency room if needed'
    ],
    critical: [
      'CALL 911 or emergency services',
      'Go to nearest emergency room',
      'Call National Suicide Prevention Lifeline: 988'
    ]
  };

  return resources[severity] || resources.low;
}

function getSupportContacts() {
  return [
    {
      name: 'Crisis Hotline',
      phone: '988',
      available: '24/7'
    },
    {
      name: 'SAMHSA National Helpline',
      phone: '1-800-662-4357',
      available: '24/7'
    },
    {
      name: 'Emergency Services',
      phone: '911',
      available: '24/7'
    }
  ];
}

function generateCrisisInsights(sessions: any[]): string[] {
  const insights: string[] = [];

  if (sessions.length === 0) {
    return ['No crisis sessions recorded. Stay strong on your recovery journey.'];
  }

  const recentSessions = sessions.slice(0, 7);
  const highSessions = recentSessions.filter(s => s.severity === 'high' || s.severity === 'critical');

  if (highSessions.length > 0) {
    insights.push(`You've had ${highSessions.length} high-severity crisis event(s) in the last week. Consider reaching out to your support network.`);
  }

  const resolutionRate = (recentSessions.filter(s => s.outcome === 'resolved').length / recentSessions.length) * 100;
  if (resolutionRate > 80) {
    insights.push('Your crisis resolution rate is excellent! Your coping strategies are working well.');
  }

  return insights;
}

function analyzeTrends(sessions: any[]) {
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const oneMonthAgo = new Date();
  oneMonthAgo.setDate(oneMonthAgo.getDate() - 30);

  const weekSessions = sessions.filter(s => new Date(s.created_at) > oneWeekAgo);
  const monthSessions = sessions.filter(s => new Date(s.created_at) > oneMonthAgo);

  return {
    weekly_trend: weekSessions.length > 0 ? 'stable' : 'improving',
    monthly_trend: monthSessions.length > monthSessions.length / 4 ? 'increasing' : 'decreasing',
    frequency_per_week: (weekSessions.length).toFixed(1)
  };
}

export default router;
