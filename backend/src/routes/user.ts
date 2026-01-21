import { Router, Request, Response } from 'express';
import { verifyToken, requireOwnership, requireAdmin } from '../middleware/auth.js';
import { validateProfileUpdate, validateUserId, escapeHtml, sanitizeString } from '../utils/validation.js';
import { createClient } from '@supabase/supabase-js';

const router = Router();

const getSupabase = () => {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
};

// Mock user database
const mockUserProfiles: Record<string, {
  id: string;
  email: string;
  displayName: string;
  age?: number;
  recovery_stage: string;
  created_at: string;
  updated_at: string;
}> = {
  'user1': {
    id: 'user1',
    email: 'user@example.com',
    displayName: 'John Doe',
    age: 28,
    recovery_stage: 'active',
    created_at: '2024-01-14T00:00:00Z',
    updated_at: '2024-01-14T00:00:00Z'
  }
};

/**
 * GET /user/:userId/profile
 * Get user profile (protected - user can access own, admin can access any)
 * Returns: { user profile data }
 */
router.get('/:userId/profile', verifyToken, requireOwnership, (req: Request, res: Response): void => {
  try {
    const { userId } = req.params;

    const userProfile = mockUserProfiles[userId];

    if (!userProfile) {
      res.status(404).json({
        success: false,
        error: 'User profile not found',
        code: 'PROFILE_NOT_FOUND'
      });
      return;
    }

    res.json({
      success: true,
      data: userProfile
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get profile',
      code: 'GET_PROFILE_ERROR'
    });
  }
});

/**
 * PUT /user/:userId/profile
 * Update user profile (protected - user can update own, admin can update any)
 * Returns: { updated user profile }
 */
router.put('/:userId/profile', verifyToken, requireOwnership, (req: Request, res: Response): void => {
  try {
    const { userId } = req.params;

    // Validate userId format
    const userIdError = validateUserId(userId);
    if (userIdError) {
      res.status(400).json({
        success: false,
        error: userIdError.message,
        code: 'VALIDATION_ERROR',
        field: userIdError.field
      });
      return;
    }

    // Validate and sanitize input
    const validation = validateProfileUpdate(req.body);
    if (!validation.valid) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: validation.errors
      });
      return;
    }

    const { displayName, age, recovery_stage } = validation.sanitized;

    const userProfile = mockUserProfiles[userId];

    if (!userProfile) {
      res.status(404).json({
        success: false,
        error: 'User profile not found',
        code: 'PROFILE_NOT_FOUND'
      });
      return;
    }

    // Update only provided fields with sanitized values
    if (displayName !== undefined) userProfile.displayName = displayName as string;
    if (age !== undefined) userProfile.age = age as number;
    if (recovery_stage !== undefined) userProfile.recovery_stage = recovery_stage as string;
    userProfile.updated_at = new Date().toISOString();

    res.json({
      success: true,
      data: userProfile
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update profile',
      code: 'UPDATE_PROFILE_ERROR'
    });
  }
});

/**
 * DELETE /user/:userId/data
 * Delete user data (GDPR compliance - protected)
 * User can only delete own data, admin can delete any
 * Returns: { success message }
 */
router.delete('/:userId/data', verifyToken, requireOwnership, async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;

    // In production, this would:
    // 1. Delete user record from database
    // 2. Delete all associated data (chat history, check-ins, etc.)
    // 3. Log the deletion for compliance
    // 4. Optionally anonymize instead of delete for analytics

    const userProfile = mockUserProfiles[userId];

    if (!userProfile) {
      res.status(404).json({
        success: false,
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
      return;
    }

    // Simulate deletion
    delete mockUserProfiles[userId];

    res.json({
      success: true,
      message: 'User data has been deleted successfully',
      deletedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Delete user data error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete user data',
      code: 'DELETE_DATA_ERROR'
    });
  }
});

/**
 * GET /user/:userId/settings
 * Get user settings (protected)
 * Returns: { language, notifications, privacy_settings, etc. }
 */
router.get('/:userId/settings', verifyToken, requireOwnership, (req: Request, res: Response): void => {
  try {
    const { userId } = req.params;

    // Mock settings
    const settings = {
      user_id: userId,
      language: 'en',
      notifications_enabled: true,
      push_notifications: true,
      email_notifications: false,
      data_sharing: false,
      analytics_enabled: true,
      two_factor_enabled: false
    };

    res.json({
      success: true,
      data: settings
    });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get settings',
      code: 'GET_SETTINGS_ERROR'
    });
  }
});

/**
 * PUT /user/:userId/settings
 * Update user settings (protected)
 * Returns: { updated settings }
 */
router.put('/:userId/settings', verifyToken, requireOwnership, (req: Request, res: Response): void => {
  try {
    const { userId } = req.params;
    const updates = req.body;

    // In production, validate and update settings in database
    const settings = {
      user_id: userId,
      language: updates.language || 'en',
      notifications_enabled: updates.notifications_enabled ?? true,
      push_notifications: updates.push_notifications ?? true,
      email_notifications: updates.email_notifications ?? false,
      data_sharing: updates.data_sharing ?? false,
      analytics_enabled: updates.analytics_enabled ?? true,
      two_factor_enabled: updates.two_factor_enabled ?? false
    };

    res.json({
      success: true,
      data: settings
    });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update settings',
      code: 'UPDATE_SETTINGS_ERROR'
    });
  }
});

/**
 * SUPABASE DRIVEN ENDPOINTS (Migrated from index.ts)
 */

router.post('/get', verifyToken, async (req: Request, res: Response) => {
  try {
    const { data, error } = await getSupabase()
      .from('user_profiles')
      .select('*')
      .eq('user_id', req.user!.id)
      .single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/update', verifyToken, async (req: Request, res: Response) => {
  try {
    const { data, error } = await getSupabase()
      .from('user_profiles')
      .update(req.body)
      .eq('user_id', req.user!.id);
    if (error) throw error;
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/devices/register', verifyToken, async (req: Request, res: Response) => {
  try {
    const { expo_push_token, device_type } = req.body;
    const { data, error } = await getSupabase()
      .from('user_devices')
      .upsert({ user_id: req.user!.id, expo_push_token, device_type }, { onConflict: 'user_id' });
    if (error) throw error;
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

export default router;
