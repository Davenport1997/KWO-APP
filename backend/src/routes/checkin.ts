import { Router, Request, Response } from 'express';
import { verifyToken, requireOwnership } from '../middleware/auth.js';
import { createActionLimiter } from '../middleware/rateLimiting.js';
import { logRateLimitEvent } from '../utils/rateLimitMonitoring.js';
import { createClient } from '@supabase/supabase-js';
const router = Router();
const getSupabase = () => {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
};
// Mock check-in storage
const mockCheckIns: Record<string, Array<{
  id: string;
  user_id: string;
  mood: number;
  has_setback: boolean;
  notes?: string;
  created_at: string;
}>> = {};
router.post('/submit', verifyToken, (req: Request, res: Response, next) => {
  const checkinLimiter = createActionLimiter('checkin', false);
  checkinLimiter(req, res, next);
}, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { mood, has_setback, notes } = req.body;
    if (mood === undefined || mood < 1 || mood > 10) {
      res.status(400).json({ success: false, error: 'Mood must be between 1 and 10', code: 'INVALID_MOOD' });
      return;
    }
    if (typeof has_setback !== 'boolean') {
      res.status(400).json({ success: false, error: 'has_setback must be a boolean', code: 'INVALID_SETBACK' });
      return;
    }
    if (!mockCheckIns[userId!]) mockCheckIns[userId!] = [];
    const today = new Date().toDateString();
    const checkedInToday = mockCheckIns[userId!].some(ci => new Date(ci.created_at).toDateString() === today);
    if (checkedInToday) {
      res.status(400).json({ success: false, error: 'You have already checked in today', code: 'ALREADY_CHECKED_IN' });
      return;
    }
    const checkIn = { id: `checkin_${Date.now()}`, user_id: userId!, mood, has_setback, notes, created_at: new Date().toISOString() };
    mockCheckIns[userId!].push(checkIn);
    const streak = calculateStreak(mockCheckIns[userId!]);
    const pointsEarned = calculatePoints(mood, has_setback);
    res.json({ success: true, data: { checkin_id: checkIn.id, streak, points_earned: pointsEarned, bonus_milestone: streak > 0 && streak % 7 === 0 } });
  } catch (error) {
    console.error('Check-in error:', error);
    res.status(500).json({ success: false, error: 'Failed to submit check-in', code: 'CHECKIN_ERROR' });
  }
});
router.get('/history', verifyToken, (req: Request, res: Response): void => {
  try {
    const userId = req.user?.id;
    const { limit = 30, offset = 0 } = req.query;
    const history = mockCheckIns[userId!] || [];
    const paginatedHistory = history.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(parseInt(offset as string), parseInt(offset as string) + parseInt(limit as string));
    const stats = {
      total_checkins: history.length,
      average_mood: history.length > 0 ? (history.reduce((sum, ci) => sum + ci.mood, 0) / history.length).toFixed(1) : 0,
      setback_count: history.filter(ci => ci.has_setback).length,
      current_streak: calculateStreak(history)
    };
    res.json({ success: true, data: { checkins: paginatedHistory, statistics: stats, total: history.length, offset: parseInt(offset as string), limit: parseInt(limit as string) } });
  } catch (error) {
    console.error('Check-in history error:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve check-in history', code: 'HISTORY_ERROR' });
  }
});
router.get('/today', verifyToken, (req: Request, res: Response): void => {
  try {
    const userId = req.user?.id;
    const history = mockCheckIns[userId!] || [];
    const today = new Date().toDateString();
    const todayCheckIn = history.find(ci => new Date(ci.created_at).toDateString() === today);
    res.json({ success: true, data: { has_checked_in: !!todayCheckIn, checkin: todayCheckIn || null } });
  } catch (error) {
    console.error('Today check-in error:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve today\'s check-in', code: 'TODAY_ERROR' });
  }
});
router.get('/stats', verifyToken, (req: Request, res: Response): void => {
  try {
    const userId = req.user?.id;
    const history = mockCheckIns[userId!] || [];
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const weeklyCheckIns = history.filter(ci => new Date(ci.created_at) > oneWeekAgo);
    const oneMonthAgo = new Date();
    oneMonthAgo.setDate(oneMonthAgo.getDate() - 30);
    const monthlyCheckIns = history.filter(ci => new Date(ci.created_at) > oneMonthAgo);
    res.json({
      success: true,
      data: {
        weekly: { total: weeklyCheckIns.length, average_mood: weeklyCheckIns.length > 0 ? (weeklyCheckIns.reduce((sum, ci) => sum + ci.mood, 0) / weeklyCheckIns.length).toFixed(1) : 0, setbacks: weeklyCheckIns.filter(ci => ci.has_setback).length },
        monthly: { total: monthlyCheckIns.length, average_mood: monthlyCheckIns.length > 0 ? (monthlyCheckIns.reduce((sum, ci) => sum + ci.mood, 0) / monthlyCheckIns.length).toFixed(1) : 0, setbacks: monthlyCheckIns.filter(ci => ci.has_setback).length },
        insights: generateInsights(history)
      }
    });
  } catch (error) {
    console.error('Check-in stats error:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve statistics', code: 'STATS_ERROR' });
  }
});
function calculateStreak(checkIns: any[]): number {
  if (checkIns.length === 0) return 0;
  const sorted = checkIns.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  let streak = 0;
  let currentDate = new Date();
  for (const checkIn of sorted) {
    const checkInDate = new Date(checkIn.created_at);
    const expectedDate = new Date(currentDate);
    expectedDate.setDate(expectedDate.getDate() - streak);
    const diff = Math.floor((expectedDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24));
    if (diff === 0) streak++; else break;
  }
  return streak;
}
function calculatePoints(mood: number, hasSetback: boolean): number {
  let points = 10;
  points += Math.floor(mood * 2);
  if (!hasSetback) points += 5;
  return points;
}
function generateInsights(checkIns: any[]): string[] {
  const insights: string[] = [];
  if (checkIns.length === 0) return ['Start checking in daily to build insights about your recovery journey.'];
  const avgMood = checkIns.reduce((sum, ci) => sum + ci.mood, 0) / checkIns.length;
  const setbackCount = checkIns.filter(ci => ci.has_setback).length;
  if (avgMood >= 7) insights.push('Your overall mood trend is positive! Keep up the momentum.');
  else if (avgMood < 5) insights.push('You\'ve been having a tough time. Remember to reach out for support.');
  if (setbackCount > 0) insights.push(`You've experienced ${setbackCount} setback(s). This is part of recovery - each one is a learning opportunity.`);
  else insights.push('Amazing! You haven\'t reported any setbacks. You\'re on a great path.');
  return insights;
}
router.post('/list', verifyToken, async (req: Request, res: Response) => {
  const { limit = 50, offset = 0 } = req.body;
  const { data, error } = await getSupabase()
    .from('user_check_ins')
    .select('*')
    .eq('user_id', req.user!.id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, data });
});
router.post('/create', verifyToken, async (req: Request, res: Response) => {
  const { data, error } = await getSupabase()
    .from('user_check_ins')
    .insert({ ...req.body, user_id: req.user!.id });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, data });
});
export default router;
