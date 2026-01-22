import { Router, Request, Response } from 'express';
import bcryptjs from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import {
  generateToken,
  generateRefreshToken,
  verifyRefreshToken,
  verifyToken
} from '../middleware/auth';
import { loginLimiter, signupLimiter } from '../middleware/rateLimiting';
import { logRateLimitEvent } from '../utils/rateLimitMonitoring';

const router = Router();

// Mock user database (replace with real database in production)
const mockUsers: Record<string, {
  id: string;
  email: string;
  password: string;
  role: 'free_user' | 'premium_user' | 'admin';
}> = {
  'user1': {
    id: 'user1',
    email: 'user@example.com',
    password: '', // Will be hashed
    role: 'free_user'
  }
};

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

    // Find user by email (mock implementation)
    const user = Object.values(mockUsers).find(u => u.email === email);

    if (!user) {
      res.status(401).json({
        success: false,
        error: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS'
      });
      return;
    }

    // Verify password using bcrypt
    const passwordMatch = await bcryptjs.compare(password, user.password);
    if (!passwordMatch) {
      res.status(401).json({
        success: false,
        error: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS'
      });
      return;
    }

    // Generate tokens
    const accessToken = generateToken(user.id, user.email, user.role);
    const refreshToken = generateRefreshToken(user.id, user.email, user.role);

    // Return tokens and user info
    res.json({
      success: true,
      data: {
        access_token: accessToken,
        refresh_token: refreshToken,
        user: {
          id: user.id,
          email: user.email,
          role: user.role
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

export default router;
