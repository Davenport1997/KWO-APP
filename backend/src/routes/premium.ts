import { Router, Request, Response } from 'express';
import { verifyToken } from '../middleware/auth.js';
import {
  requirePremiumVerified,
  attachSubscriptionInfo
} from '../middleware/subscription.js';
import {
  getSubscriptionStatus,
  getUserAuditTrail
} from '../utils/subscriptionService.js';

const router = Router();

/**
 * GET /premium/verify
 * Verify premium subscription status from RevenueCat (protected)
 * Server-side verification - always checks RevenueCat API
 * Returns: { is_premium, subscription_type, expiry_date, status }
 */
router.get('/verify', verifyToken, attachSubscriptionInfo, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;

    // Get fresh subscription status from RevenueCat
    const status = await getSubscriptionStatus(userId!);

    res.json({
      success: true,
      data: {
        is_premium: status.isActive,
        user_id: userId,
        subscription_type: status.subscriptionType,
        status: status.status,
        expiry_date: status.expiryDate,
        grace_period_ends_at: status.gracePeriodEndsAt,
        last_verified: status.lastVerified,
        features: status.isActive ? [
          'AI workout generation',
          'Personalized nutrition plans',
          'Advanced analytics',
          'Priority support',
          'Custom recovery plans'
        ] : [
          'Basic check-ins',
          'Chat history',
          'Daily challenges',
          'Community feed'
        ],
        entitlements: status.entitlements
      }
    });
  } catch (error) {
    console.error('Premium verify error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to verify premium status',
      code: 'VERIFY_ERROR'
    });
  }
});

/**
 * POST /wellness/workout
 * Generate AI workout plan (premium only)
 * Server verifies premium status before generating
 * Returns: { workout_plan, duration, difficulty }
 */
router.post('/workout', verifyToken, requirePremiumVerified(true), async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { fitness_level = 'moderate', duration = 30, preferences = [] } = req.body;

    // Verify premium access (sensitive operation)
    console.log(`[PREMIUM] Generating workout for premium user ${userId}`);

    // Mock workout generation
    const workoutPlan = generateWorkoutPlan(fitness_level, duration, preferences);

    res.json({
      success: true,
      data: {
        workout_id: `workout_${Date.now()}`,
        user_id: userId,
        ...workoutPlan,
        generated_at: new Date().toISOString(),
        premium_feature: true,
        verified_at: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Workout generation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate workout',
      code: 'WORKOUT_ERROR'
    });
  }
});

/**
 * POST /wellness/nutrition
 * Generate personalized nutrition plan (premium only)
 * Server verifies premium status before generating
 * Returns: { nutrition_plan, daily_meals, nutritional_info }
 */
router.post('/nutrition', verifyToken, requirePremiumVerified(true), async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { dietary_restrictions = [], goals = [], duration = 7 } = req.body;

    // Verify premium access (sensitive operation)
    console.log(`[PREMIUM] Generating nutrition plan for premium user ${userId}`);

    // Mock nutrition plan generation
    const nutritionPlan = generateNutritionPlan(dietary_restrictions, goals, duration);

    res.json({
      success: true,
      data: {
        plan_id: `nutrition_${Date.now()}`,
        user_id: userId,
        ...nutritionPlan,
        generated_at: new Date().toISOString(),
        premium_feature: true,
        verified_at: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Nutrition generation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate nutrition plan',
      code: 'NUTRITION_ERROR'
    });
  }
});

/**
 * GET /wellness/workouts
 * Get user's workout history (premium only)
 * Server verifies premium status before returning data
 * Returns: { workouts array }
 */
router.get('/workouts', verifyToken, requirePremiumVerified(false), (req: Request, res: Response): void => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    const userId = req.user?.id;

    // Premium access already verified by middleware
    console.log(`[PREMIUM] Retrieving workout history for premium user ${userId}`);

    // Mock workout history
    const workouts = [
      {
        id: 'workout_1',
        title: 'Morning Run',
        duration: 30,
        calories_burned: 300,
        completed_at: new Date(Date.now() - 86400000).toISOString()
      },
      {
        id: 'workout_2',
        title: 'Strength Training',
        duration: 45,
        calories_burned: 400,
        completed_at: new Date(Date.now() - 172800000).toISOString()
      }
    ];

    res.json({
      success: true,
      data: {
        workouts: workouts.slice(0, parseInt(limit as string)),
        total: workouts.length,
        premium_verified: true
      }
    });
  } catch (error) {
    console.error('Workout history error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve workouts',
      code: 'HISTORY_ERROR'
    });
  }
});

/**
 * GET /premium/audit-trail
 * Get user's premium access audit trail (protected, admin only for other users)
 * Shows all premium access attempts
 */
router.get('/audit-trail', verifyToken, (req: Request, res: Response): void => {
  try {
    const userId = req.user?.id;
    const { limit = 50 } = req.query;

    // Get audit trail for current user
    const auditTrail = getUserAuditTrail(userId!, parseInt(limit as string));

    res.json({
      success: true,
      data: {
        user_id: userId,
        audit_trail: auditTrail,
        total: auditTrail.length
      }
    });
  } catch (error) {
    console.error('Audit trail error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve audit trail',
      code: 'AUDIT_ERROR'
    });
  }
});

/**
 * GET /premium/subscription-info
 * Get detailed subscription information
 * Includes grace period info and entitlements
 */
router.get('/subscription-info', verifyToken, attachSubscriptionInfo, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;

    const status = await getSubscriptionStatus(userId!);

    res.json({
      success: true,
      data: {
        user_id: userId,
        ...status,
        grace_period_days: 3,
        can_use_premium: status.isActive,
        subscription_details: {
          type: status.subscriptionType,
          status: status.status,
          expires_at: status.expiryDate,
          grace_period_expires_at: status.gracePeriodEndsAt
        }
      }
    });
  } catch (error) {
    console.error('Subscription info error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get subscription info',
      code: 'INFO_ERROR'
    });
  }
});

// Helper functions
function generateWorkoutPlan(fitnessLevel: string, duration: number, preferences: string[]) {
  const exercises = {
    beginner: ['Walking', 'Stretching', 'Light Yoga'],
    moderate: ['Jogging', 'Strength Training', 'HIIT'],
    advanced: ['Running', 'Weight Training', 'CrossFit']
  };

  const level = fitnessLevel as keyof typeof exercises;
  const selectedExercises = exercises[level] || exercises.moderate;

  return {
    title: `${fitnessLevel.charAt(0).toUpperCase() + fitnessLevel.slice(1)} Workout Plan`,
    duration,
    difficulty: fitnessLevel,
    exercises: selectedExercises.map((exercise) => ({
      name: exercise,
      duration: Math.round(duration / selectedExercises.length),
      sets: 3,
      reps: 12,
      rest_seconds: 60
    })),
    total_calories_estimate: fitnessLevel === 'beginner' ? 200 : fitnessLevel === 'moderate' ? 350 : 500
  };
}

function generateNutritionPlan(
  dietaryRestrictions: string[],
  goals: string[],
  duration: number
) {
  const meals = [
    {
      name: 'Breakfast',
      time: '08:00',
      calories: 400,
      macros: { protein: 20, carbs: 50, fat: 10 }
    },
    {
      name: 'Lunch',
      time: '12:30',
      calories: 600,
      macros: { protein: 35, carbs: 70, fat: 15 }
    },
    {
      name: 'Dinner',
      time: '18:30',
      calories: 500,
      macros: { protein: 30, carbs: 60, fat: 12 }
    }
  ];

  return {
    title: 'Personalized 7-Day Nutrition Plan',
    duration,
    dietary_restrictions: dietaryRestrictions,
    goals,
    daily_calories: 1500,
    meals,
    nutritional_summary: {
      daily_protein: 85,
      daily_carbs: 180,
      daily_fat: 37
    }
  };
}

export default router;
