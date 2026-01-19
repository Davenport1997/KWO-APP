/**
 * Calculation Validation Layer
 *
 * Server-side validation for all user statistics to prevent cheating:
 * - Points/XP calculations
 * - Streak verification
 * - Recovery score
 * - Financial savings
 * - Achievement eligibility
 *
 * This layer ensures all calculations are tamper-proof and audited.
 */

// Validation constants
export const VALIDATION_RULES = {
  // Timestamp validation
  MAX_FUTURE_SECONDS: 60, // Can't submit events > 1 minute in future
  MAX_AGE_HOURS: 24, // Can't submit events > 24 hours old

  // Rate limiting
  MAX_CHALLENGES_PER_DAY: 10,
  MAX_CHECKINS_PER_DAY: 4, // Morning, afternoon, evening, night
  MAX_MICRO_WINS_PER_DAY: 3,
  MAX_EXERCISES_PER_DAY: 1,
  MAX_NUTRITION_PER_DAY: 2,

  // Points caps (daily and per-action)
  MAX_POINTS_PER_ACTION: 50,
  MAX_POINTS_PER_DAY: 200,
  MIN_POINTS_PER_ACTION: 1,

  // Suspicious activity detection
  POINTS_PER_HOUR_THRESHOLD: 150, // Alert if user earns > 150 points/hour
  CHALLENGES_PER_HOUR_THRESHOLD: 8, // Alert if > 8 challenges/hour
  STREAK_BREAK_GRACE_PERIOD_DAYS: 3, // Grace period before streak breaks
};

// Point values for different actions
export const POINT_VALUES = {
  CHALLENGE_COMPLETE: 10,
  MORNING_CHECKIN: 5,
  AFTERNOON_CHECKIN: 5,
  EVENING_CHECKIN: 5,
  NIGHT_CHECKIN: 5,
  MICRO_WIN: 2,
  WORKOUT_COMPLETE: 15,
  NUTRITION_CHALLENGE: 8,
  MEDITATION_SESSION: 5,
  CRISIS_SURVIVED: 20,
  JOURNAL_ENTRY: 8,
  PRAYER_SESSION: 5,
  GRATITUDE_ENTRY: 3,
};

export interface ValidationError {
  code: string;
  message: string;
  severity: 'warning' | 'error' | 'critical';
}

/**
 * Validate timestamp is reasonable
 */
export function validateTimestamp(timestamp: string): ValidationError | null {
  try {
    const submittedTime = new Date(timestamp);
    const now = new Date();

    // Check if timestamp is in the future
    const secondsInFuture = (submittedTime.getTime() - now.getTime()) / 1000;
    if (secondsInFuture > VALIDATION_RULES.MAX_FUTURE_SECONDS) {
      return {
        code: 'TIMESTAMP_FUTURE',
        message: `Timestamp cannot be more than ${VALIDATION_RULES.MAX_FUTURE_SECONDS} seconds in the future`,
        severity: 'error',
      };
    }

    // Check if timestamp is too old
    const millisecondsOld = now.getTime() - submittedTime.getTime();
    const hoursOld = millisecondsOld / (1000 * 60 * 60);
    if (hoursOld > VALIDATION_RULES.MAX_AGE_HOURS) {
      return {
        code: 'TIMESTAMP_TOO_OLD',
        message: `Timestamp cannot be older than ${VALIDATION_RULES.MAX_AGE_HOURS} hours`,
        severity: 'error',
      };
    }

    return null;
  } catch (error) {
    return {
      code: 'INVALID_TIMESTAMP_FORMAT',
      message: 'Timestamp is not in valid ISO 8601 format',
      severity: 'error',
    };
  }
}

/**
 * Validate points are within reasonable bounds
 */
export function validatePoints(
  actionType: string,
  points: number,
  expectedPoints: number
): ValidationError | null {
  // Points should not exceed expected value by more than 10%
  const maxAllowed = expectedPoints * 1.1;
  const minAllowed = expectedPoints * 0.9;

  if (points > maxAllowed || points < minAllowed) {
    return {
      code: 'POINTS_OUT_OF_RANGE',
      message: `Points ${points} out of expected range ${minAllowed}-${maxAllowed} for action ${actionType}`,
      severity: 'warning',
    };
  }

  if (points > VALIDATION_RULES.MAX_POINTS_PER_ACTION) {
    return {
      code: 'POINTS_EXCEED_MAX',
      message: `Points exceed maximum ${VALIDATION_RULES.MAX_POINTS_PER_ACTION} per action`,
      severity: 'critical',
    };
  }

  if (points < VALIDATION_RULES.MIN_POINTS_PER_ACTION) {
    return {
      code: 'POINTS_BELOW_MIN',
      message: `Points must be at least ${VALIDATION_RULES.MIN_POINTS_PER_ACTION}`,
      severity: 'error',
    };
  }

  return null;
}

/**
 * Check for suspicious activity patterns
 */
export function detectSuspiciousActivity(userActivity: {
  recentPoints: number[]; // Points earned in last hour
  recentChallenges: number; // Challenges completed in last hour
  recentActions: any[]; // Recent action timestamps
}): ValidationError[] {
  const errors: ValidationError[] = [];

  // Check if earning points too fast
  const pointsLastHour = userActivity.recentPoints.reduce((a, b) => a + b, 0);
  if (pointsLastHour > VALIDATION_RULES.POINTS_PER_HOUR_THRESHOLD) {
    errors.push({
      code: 'SUSPICIOUS_POINT_VELOCITY',
      message: `User earned ${pointsLastHour} points in last hour (threshold: ${VALIDATION_RULES.POINTS_PER_HOUR_THRESHOLD})`,
      severity: 'warning',
    });
  }

  // Check if completing challenges too fast
  if (userActivity.recentChallenges > VALIDATION_RULES.CHALLENGES_PER_HOUR_THRESHOLD) {
    errors.push({
      code: 'SUSPICIOUS_CHALLENGE_VELOCITY',
      message: `User completed ${userActivity.recentChallenges} challenges in last hour (threshold: ${VALIDATION_RULES.CHALLENGES_PER_HOUR_THRESHOLD})`,
      severity: 'warning',
    });
  }

  // Check for timestamp manipulation (rapid submissions with very old timestamps)
  if (userActivity.recentActions.length >= 3) {
    const timeDifferences: number[] = [];
    for (let i = 1; i < userActivity.recentActions.length; i++) {
      const diff = (
        new Date(userActivity.recentActions[i].timestamp).getTime() -
        new Date(userActivity.recentActions[i - 1].timestamp).getTime()
      ) / 1000; // In seconds
      timeDifferences.push(diff);
    }

    // If actions are submitted rapidly but with large timestamp gaps, that's suspicious
    const avgTimestampGap = timeDifferences.reduce((a, b) => a + b, 0) / timeDifferences.length;
    if (avgTimestampGap > 3600 && timeDifferences.length > 0) {
      // Actions have ~1 hour gaps in timestamps but submitted rapidly
      const submissionGap = (
        new Date(userActivity.recentActions[userActivity.recentActions.length - 1].submitted_at).getTime() -
        new Date(userActivity.recentActions[0].submitted_at).getTime()
      ) / 1000;

      if (submissionGap < 60) {
        // Submitted 3+ actions in <1 minute but with hours between them in timestamps
        errors.push({
          code: 'SUSPICIOUS_TIMESTAMP_PATTERN',
          message: 'Multiple actions with large timestamp gaps submitted too quickly',
          severity: 'critical',
        });
      }
    }
  }

  return errors;
}

/**
 * Validate daily action limit
 */
export function validateDailyLimit(
  actionType: string,
  countToday: number
): ValidationError | null {
  const limits: Record<string, number> = {
    challenge: VALIDATION_RULES.MAX_CHALLENGES_PER_DAY,
    checkin: VALIDATION_RULES.MAX_CHECKINS_PER_DAY,
    micro_win: VALIDATION_RULES.MAX_MICRO_WINS_PER_DAY,
    workout: VALIDATION_RULES.MAX_EXERCISES_PER_DAY,
    nutrition: VALIDATION_RULES.MAX_NUTRITION_PER_DAY,
  };

  const limit = limits[actionType];
  if (!limit) return null;

  if (countToday >= limit) {
    return {
      code: 'DAILY_LIMIT_EXCEEDED',
      message: `Daily limit of ${limit} ${actionType}s exceeded`,
      severity: 'error',
    };
  }

  return null;
}

/**
 * Calculate XP from verified actions
 */
export function calculateXP(
  actionType: string,
  actionData: any
): { xp: number; breakdown: string } {
  let xp = POINT_VALUES[actionType as keyof typeof POINT_VALUES] || 0;
  let breakdown = `Base XP for ${actionType}: ${xp}`;

  // Bonus XP for consistency
  if (actionData.streakDays && actionData.streakDays > 0) {
    const streakBonus = Math.min(actionData.streakDays * 0.5, 10); // Max 10 bonus
    xp += streakBonus;
    breakdown += ` + Streak bonus: ${streakBonus}`;
  }

  // Bonus XP for difficult challenges
  if (actionData.difficulty === 'hard' || actionData.difficulty === 'challenging') {
    xp += 5;
    breakdown += ` + Difficulty bonus: 5`;
  }

  return { xp, breakdown };
}

/**
 * Verify streak is valid (hasn't been broken)
 */
export function verifyStreak(
  lastCheckInDate: Date,
  currentDate: Date
): { isValid: boolean; daysInStreak: number; reason?: string } {
  const daysDifference = Math.floor(
    (currentDate.getTime() - lastCheckInDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  // Grace period: allow up to 3 days without check-in before breaking
  if (daysDifference > VALIDATION_RULES.STREAK_BREAK_GRACE_PERIOD_DAYS) {
    return {
      isValid: false,
      daysInStreak: 0,
      reason: `More than ${VALIDATION_RULES.STREAK_BREAK_GRACE_PERIOD_DAYS} days since last check-in`,
    };
  }

  return {
    isValid: true,
    daysInStreak: daysDifference,
  };
}

/**
 * Calculate recovery score (0-100)
 * Based on: check-in consistency, mood trends, challenge completion, crisis resilience
 */
export function calculateRecoveryScore(userData: {
  totalCheckIns: number;
  consistencyDays: number; // Days with at least one check-in
  averageMood: number; // 1-5 scale
  challengesCompletedThisWeek: number;
  crisisSessionsSurvived: number;
  currentStreak: number;
}): { score: number; breakdown: Record<string, number> } {
  let score = 0;
  const breakdown: Record<string, number> = {};

  // Check-in consistency (max 30 points)
  const consistencyScore = Math.min(userData.consistencyDays * 0.3, 30);
  score += consistencyScore;
  breakdown.consistency = consistencyScore;

  // Mood trending positive (max 20 points)
  const moodScore = (userData.averageMood / 5) * 20;
  score += moodScore;
  breakdown.mood = moodScore;

  // Challenge completion (max 25 points)
  const challengeScore = Math.min(userData.challengesCompletedThisWeek * 2.5, 25);
  score += challengeScore;
  breakdown.challenges = challengeScore;

  // Crisis resilience (max 15 points)
  const resilienceScore = Math.min(userData.crisisSessionsSurvived * 1.5, 15);
  score += resilienceScore;
  breakdown.resilience = resilienceScore;

  // Streak consistency (max 10 points)
  const streakScore = Math.min(userData.currentStreak * 0.1, 10);
  score += streakScore;
  breakdown.streak = streakScore;

  return {
    score: Math.round(score),
    breakdown,
  };
}

/**
 * Calculate financial savings
 */
export function calculateSavings(
  addictionCosts: Record<string, number>, // Daily cost per addiction in dollars
  streakDays: number,
  addictionsStopped: string[]
): { totalSavings: number; savingsByAddiction: Record<string, number> } {
  const savingsByAddiction: Record<string, number> = {};
  let totalSavings = 0;

  for (const addiction of addictionsStopped) {
    const dailyCost = addictionCosts[addiction] || 0;
    const savings = dailyCost * streakDays;
    savingsByAddiction[addiction] = savings;
    totalSavings += savings;
  }

  return {
    totalSavings: Math.round(totalSavings * 100) / 100, // Round to cents
    savingsByAddiction,
  };
}

/**
 * Check achievement eligibility
 */
export function checkAchievementEligibility(
  achievementType: string,
  userData: any
): { eligible: boolean; reason?: string } {
  const achievements: Record<string, (userData: any) => boolean> = {
    // Streak achievements
    '7_day_streak': (u) => u.currentStreak >= 7,
    '30_day_streak': (u) => u.currentStreak >= 30,
    '90_day_streak': (u) => u.currentStreak >= 90,
    '365_day_streak': (u) => u.currentStreak >= 365,

    // Challenge achievements
    '10_challenges': (u) => u.totalChallengesCompleted >= 10,
    '50_challenges': (u) => u.totalChallengesCompleted >= 50,
    '100_challenges': (u) => u.totalChallengesCompleted >= 100,

    // Check-in achievements
    '7_checkins': (u) => u.totalCheckIns >= 7,
    '30_checkins': (u) => u.totalCheckIns >= 30,
    '100_checkins': (u) => u.totalCheckIns >= 100,

    // Recovery achievements
    '100_dollars_saved': (u) => u.totalSavings >= 100,
    '500_dollars_saved': (u) => u.totalSavings >= 500,
    '1000_dollars_saved': (u) => u.totalSavings >= 1000,

    // Crisis resilience
    '5_crises_survived': (u) => u.crisisSessionsSurvived >= 5,
    '10_crises_survived': (u) => u.crisisSessionsSurvived >= 10,

    // Mood improvement
    'mood_trend_positive': (u) => u.averageMood >= 3.5 && u.recentMoodTrend === 'positive',
  };

  const checkFn = achievements[achievementType];
  if (!checkFn) {
    return { eligible: false, reason: 'Unknown achievement type' };
  }

  const eligible = checkFn(userData);
  return { eligible };
}
