import { Router, Request, Response } from 'express';
import bcryptjs from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import {
  generateToken,
  generateRefreshToken,
  verifyRefreshToken,
  verifyToken
} from '../middleware/auth.js';
import { loginLimiter, signupLimiter } from '../middleware/rateLimiting.js';
import { logRateLimitEvent } from '../utils/rateLimitMonitoring.js';
const router = Router();
const mockUsers: Record<string, {
  id: string;
  email: string;
  password: string;
  role: 'free_user' | 'premium_user' | 'admin';
}> = {
  'user1': {
    id: 'user1',
    email: 'user@example.com',
    password: '', 
    role: 'free_user'
  }
};
router.post('/login', loginLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ success: false, error: 'Email and password are required', code: 'MISSING_CREDENTIALS' });
      return;
    }
    const user = Object.values(mockUsers).find(u => u.email === email);
    if (!user) {
      res.status(401).json({ success: false, error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' });
      return;
    }
    const passwordMatch = await bcryptjs.compare(password, user.password);
    if (!passwordMatch) {
      res.status(401).json({ success: false, error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' });
      return;
    }
    const accessToken = generateToken(user.id, user.email, user.role);
    const refreshToken = generateRefreshToken(user.id, user.email, user.role);
    res.json({
      success: true,
      data: {
        access_token: accessToken,
        refresh_token: refreshToken,
        user: { id: user.id, email: user.email, role: user.role }
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: 'Login failed', code: 'LOGIN_ERROR' });
  }
});
router.post('/refresh', async (req: Request, res: Response): Promise<void> => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) {
      res.status(400).json({ success: false, error: 'Refresh token is required', code: 'MISSING_REFRESH_TOKEN' });
      return;
    }
    const decoded = verifyRefreshToken(refresh_token);
    const accessToken = generateToken(decoded.id, decoded.email, decoded.role);
    const newRefreshToken = generateRefreshToken(decoded.id, decoded.email, decoded.role);
    res.json({ success: true, data: { access_token: accessToken, refresh_token: newRefreshToken } });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(401).json({ success: false, error: 'Token refresh failed', code: 'REFRESH_TOKEN_ERROR' });
  }
});
router.get('/verify', verifyToken, (req: Request, res: Response): void => {
  res.json({ success: true, data: { user: req.user } });
});
router.post('/logout', verifyToken, (req: Request, res: Response): void => {
  res.json({ success: true, message: 'Logged out successfully' });
});
router.post('/apple', async (req: Request, res: Response): Promise<void> => {
  try {
    const { code, user: appleUser } = req.body;
    if (!code) {
      res.status(400).json({ success: false, error: 'Authorization code is required', code: 'MISSING_AUTH_CODE' });
      return;
    }
    const applePrivateKey = process.env.APPLE_PRIVATE_KEY;
    const appleKeyId = process.env.APPLE_KEY_ID;
    const appleTeamId = process.env.APPLE_TEAM_ID;
    const bundleId = 'com.vibecode.hopecompanion.0ajx7d';
    if (!applePrivateKey || !appleKeyId || !appleTeamId) {
      console.error('Missing Apple credentials in environment');
      res.status(500).json({ success: false, error: 'Server configuration error', code: 'MISSING_APPLE_CONFIG' });
      return;
    }
    const clientSecret = jwt.sign(
      { iss: appleTeamId, sub: bundleId, aud: 'https://appleid.apple.com', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300 },
      applePrivateKey.replace(/\\n/g, '\n'),
      { algorithm: 'ES256', keyid: appleKeyId }
    );
    const tokenResponse = await fetch('https://appleid.apple.com/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: bundleId, client_secret: clientSecret }).toString()
    });
    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json();
      console.error('Apple token exchange failed:', errorData);
      res.status(401).json({ success: false, error: 'Apple authentication failed', code: 'APPLE_AUTH_FAILED' });
      return;
    }
    const tokenData: any = await tokenResponse.json();
    const identityToken = tokenData.id_token;
    const decodedToken: any = jwt.decode(identityToken);
    if (!decodedToken || !decodedToken.sub) {
      res.status(401).json({ success: false, error: 'Invalid Apple identity token', code: 'INVALID_IDENTITY_TOKEN' });
      return;
    }
    const appleUserId = decodedToken.sub;
    const userEmail = decodedToken.email || (appleUser?.email ? appleUser.email : `${appleUserId}@privaterelay.appleid.com`);
    let userId = `apple_${appleUserId}`;
    const accessToken = generateToken(userId, userEmail, 'free_user');
    const refreshToken = generateRefreshToken(userId, userEmail, 'free_user');
    res.json({
      success: true,
      data: {
        access_token: accessToken,
        refresh_token: refreshToken,
        user: { id: userId, email: userEmail, role: 'free_user', appleId: appleUserId, firstName: appleUser?.fullName?.givenName || '', lastName: appleUser?.fullName?.familyName || '' }
      }
    });
  } catch (error) {
    console.error('Apple Sign-In error:', error);
    res.status(500).json({ success: false, error: 'Apple Sign-In failed', code: 'APPLE_SIGNIN_ERROR' });
  }
});
export default router;
