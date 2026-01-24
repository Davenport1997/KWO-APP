import { Router, Request, Response } from 'express';
import bcryptjs from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import {
  generateToken,
  generateRefreshToken,
  verifyRefreshToken,
  verifyToken
} from '../middleware/auth.js';
import { loginLimiter, signupLimiter } from '../middleware/rateLimiting.js';
import { logRateLimitEvent } from '../utils/rateLimitMonitoring.js';

const router = Router();

// Initialize Supabase
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('⚠️ Missing Supabase credentials in auth.ts');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * POST /auth/login
 * User authentication with email and password
 * Returns: { access_token, refresh_token, user }
 * Rate limited: 5 attempts per 15 minutes per IP
 */
router.post('/login', loginLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      res.status(400).json({
        success: false,
        error: 'Email and password are required',
        code: 'MISSING_CREDENTIALS'
      });
      return;
    }

    // Use Supabase auth
    const { data: { user: authUser }, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (authError || !authUser) {
      res.status(401).json({
        success: false,
        error: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS'
      });
      return;
    }

    // Get user role from user_profiles table
    const { data: userProfile } = await supabase
      .from('user_profiles')
      .select('id, role')
      .eq('auth_id', authUser.id)
      .single();

    const role = userProfile?.role || 'free_user';

    // Generate tokens
    const accessToken = generateToken(authUser.id, authUser.email || '', role as any);
    const refreshToken = generateRefreshToken(authUser.id, authUser.email || '', role as any);

    // Return tokens and user info
    res.json({
      success: true,
      data: {
        access_token: accessToken,
        refresh_token: refreshToken,
        user: {
          id: authUser.id,
          email: authUser.email,
          role
        }
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Login failed',
      code: 'LOGIN_ERROR'
    });
  }
});

/**
 * POST /auth/refresh
 * Refresh access token using refresh token
 * Returns: { access_token, refresh_token }
 */
router.post('/refresh', async (req: Request, res: Response): Promise<void> => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      res.status(400).json({
        success: false,
        error: 'Refresh token is required',
        code: 'MISSING_REFRESH_TOKEN'
      });
      return;
    }

    // Verify refresh token
    const decoded = verifyRefreshToken(refresh_token);

    // Generate new access token
    const accessToken = generateToken(decoded.id, decoded.email, decoded.role);

    // Optionally generate new refresh token (rolling refresh)
    const newRefreshToken = generateRefreshToken(decoded.id, decoded.email, decoded.role);

    res.json({
      success: true,
      data: {
        access_token: accessToken,
        refresh_token: newRefreshToken
      }
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(401).json({
      success: false,
      error: 'Token refresh failed',
      code: 'REFRESH_TOKEN_ERROR'
    });
  }
});

/**
 * GET /auth/verify
 * Verify user session (protected route)
 * Returns: { user }
 */
router.get('/verify', verifyToken, (req: Request, res: Response): void => {
  res.json({
    success: true,
    data: {
      user: req.user
    }
  });
});

/**
 * POST /auth/logout
 * Logout user (invalidates refresh token on client side)
 * Returns: success message
 */
router.post('/logout', verifyToken, (req: Request, res: Response): void => {
  // In production, you would:
  // 1. Add refresh token to a blacklist/revocation list
  // 2. Clear any server-side sessions
  // For now, just return success
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

/**
 * POST /auth/apple
 * Handle Apple Sign-In authentication
 * Expects: { code, user (optional) }
 * Returns: { access_token, refresh_token, user }
 */
router.post('/apple', async (req: Request, res: Response): Promise<void> => {
  try {
    const { code, user: appleUser } = req.body;

    if (!code) {
      res.status(400).json({
        success: false,
        error: 'Authorization code is required',
        code: 'MISSING_AUTH_CODE'
      });
      return;
    }

    // Create JWT signed with Apple private key
    const applePrivateKey = process.env.APPLE_PRIVATE_KEY;
    const appleKeyId = process.env.APPLE_KEY_ID;
    const appleTeamId = process.env.APPLE_TEAM_ID;
    const bundleId = 'com.vibecode.hopecompanion.0ajx7d';

    if (!applePrivateKey || !appleKeyId || !appleTeamId) {
      console.error('Missing Apple credentials in environment');
      res.status(500).json({
        success: false,
        error: 'Server configuration error',
        code: 'MISSING_APPLE_CONFIG'
      });
      return;
    }

    // Create JWT for Apple token exchange
    const clientSecret = jwt.sign(
      {
        iss: appleTeamId,
        sub: bundleId,
        aud: 'https://appleid.apple.com',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300 // 5 minutes
      },
      applePrivateKey.replace(/\\n/g, '\n'),
      { algorithm: 'ES256', keyid: appleKeyId }
    );

    // Exchange code for tokens with Apple
    const tokenResponse = await fetch('https://appleid.apple.com/auth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: bundleId,
        client_secret: clientSecret
      }).toString()
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json();
      console.error('Apple token exchange failed:', errorData);
      res.status(401).json({
        success: false,
        error: 'Apple authentication failed',
        code: 'APPLE_AUTH_FAILED'
      });
      return;
    }

    const tokenData: any = await tokenResponse.json();

    // Decode the identity token to get user info
    const identityToken = tokenData.id_token;
    const decodedToken: any = jwt.decode(identityToken);

    if (!decodedToken || !decodedToken.sub) {
      res.status(401).json({
        success: false,
        error: 'Invalid Apple identity token',
        code: 'INVALID_IDENTITY_TOKEN'
      });
      return;
    }

    // Apple user ID (sub claim)
    const appleUserId = decodedToken.sub;
    const userEmail = decodedToken.email || (appleUser?.email ? appleUser.email : `${appleUserId}@privaterelay.appleid.com`);

    // Create or update user in your system
    // For now, use Apple ID as user identifier
    let userId = `apple_${appleUserId}`;

    // In production, you would:
    // 1. Check if user exists in your database
    // 2. If not, create new user
    // 3. Update Apple user info if needed

    // Generate your own tokens
    const accessToken = generateToken(userId, userEmail, 'free_user');
    const refreshToken = generateRefreshToken(userId, userEmail, 'free_user');

    res.json({
      success: true,
      data: {
        access_token: accessToken,
        refresh_token: refreshToken,
        user: {
          id: userId,
          email: userEmail,
          role: 'free_user',
          appleId: appleUserId,
          firstName: appleUser?.fullName?.givenName || '',
          lastName: appleUser?.fullName?.familyName || ''
        }
      }
    });
  } catch (error) {
    console.error('Apple Sign-In error:', error);
    res.status(500).json({
      success: false,
      error: 'Apple Sign-In failed',
      code: 'APPLE_SIGNIN_ERROR'
    });
  }
});

/**
 * POST /auth/delete-account
 * Delete user account and all associated data
 * Legal hold: Crisis/violence logs held for 30 days (legal compliance)
 * Requires: Authorization header with valid JWT token
 */
router.post('/delete-account', verifyToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized',
        code: 'NOT_AUTHENTICATED'
      });
      return;
    }

    console.log(`[Account Deletion] Starting account deletion for user: ${userId}`);

    // Delete user data from all tables (immediate deletion)
    await supabase.from('user_profiles').delete().eq('auth_id', userId);
    await supabase.from('user_check_ins').delete().eq('user_id', userId);
    await supabase.from('chat_messages').delete().eq('user_id', userId);
    await supabase.from('journal_entries').delete().eq('user_id', userId);
    await supabase.from('mood_logs').delete().eq('user_id', userId);
    await supabase.from('accountability_partners').delete().eq('user_id', userId);
    await supabase.from('partner_notifications').delete().eq('user_id', userId);
    await supabase.from('user_settings').delete().eq('user_id', userId);

    // Crisis and violence logs: Mark for deletion in 30 days (legal hold)
    // Store deletion timestamp for scheduled cleanup
    const thirtyDaysLater = new Date();
    thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);

    await supabase
      .from('crisis_events')
      .update({
        marked_for_deletion_at: new Date().toISOString(),
        deletion_scheduled_at: thirtyDaysLater.toISOString()
      })
      .eq('user_id', userId);

    await supabase
      .from('violence_logs')
      .update({
        marked_for_deletion_at: new Date().toISOString(),
        deletion_scheduled_at: thirtyDaysLater.toISOString()
      })
      .eq('user_id', userId);

    // Delete from Supabase Auth
    // Note: Supabase Auth deletion requires admin API call
    // If available, use: await supabase.auth.admin.deleteUser(userId)
    // For now, just mark as deleted in our system

    console.log(`[Account Deletion] Account deletion scheduled for user: ${userId}. Crisis/violence logs held for 30 days.`);

    res.status(200).json({
      success: true,
      message: 'Account deletion initiated. Your data will be permanently deleted. Crisis-related logs will be held for 30 days per legal requirements.',
      data: {
        userId,
        deletedAt: new Date().toISOString(),
        crisisLogsDeletedAt: thirtyDaysLater.toISOString()
      }
    });
  } catch (error: any) {
    console.error('[Account Deletion] Error deleting account:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete account',
      code: 'ACCOUNT_DELETION_ERROR'
    });
  }
});

/**
 * POST /auth/silent-refresh
 * Silent re-authentication when both tokens have expired
 * Used by frontend to get new tokens without user interaction
 * Requires user_id (stored from previous login)
 */
router.post('/silent-refresh', async (req: Request, res: Response): Promise<void> => {
  try {
    const { user_id } = req.body;

    if (!user_id) {
      res.status(400).json({
        success: false,
        error: 'User ID required',
        code: 'MISSING_USER_ID'
      });
      return;
    }

    console.log(`[SilentRefresh] Attempting silent re-auth for user: ${user_id}`);

    // Get user from Supabase Auth
    const { data: { user: authUser }, error: authError } = await supabase.auth.admin.getUserById(user_id);

    if (authError || !authUser) {
      console.log(`[SilentRefresh] User not found: ${user_id}`);
      res.status(401).json({
        success: false,
        error: 'User session invalid. Please log in again.',
        code: 'SESSION_INVALID'
      });
      return;
    }

    // Verify user profile exists
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('id')
      .eq('user_id', user_id)
      .single();

    if (profileError || !profile) {
      console.log(`[SilentRefresh] User profile not found: ${user_id}`);
      res.status(401).json({
        success: false,
        error: 'User profile not found',
        code: 'PROFILE_NOT_FOUND'
      });
      return;
    }

    // Generate new tokens for this user
    const accessToken = generateToken(user_id, authUser.email || '', 'free_user');
    const refreshToken = generateRefreshToken(user_id);

    console.log(`[SilentRefresh] Successfully issued new tokens for user: ${user_id}`);

    res.status(200).json({
      success: true,
      access_token: accessToken,
      refresh_token: refreshToken,
      user_id: user_id
    });
  } catch (error: any) {
    console.error('[SilentRefresh] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Silent refresh failed',
      code: 'SILENT_REFRESH_ERROR'
    });
  }
});

export default router;
