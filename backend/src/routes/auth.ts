import { Router, Request, Response } from 'express';
import bcryptjs from 'bcryptjs';
import {
  generateToken,
  generateRefreshToken,
  verifyRefreshToken,
  verifyToken
} from '../middleware/auth.js';
import { loginLimiter, signupLimiter } from '../middleware/rateLimiting.js';
import { logRateLimitEvent } from '../utils/rateLimitMonitoring.js';

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

export default router;
