import { Router, Request, Response } from 'express';
import bcryptjs from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {
  generateToken,
  generateRefreshToken,
  verifyRefreshToken,
  verifyToken
} from '../middleware/auth.js';
import { loginLimiter, signupLimiter } from '../middleware/rateLimiting.js';
const router = Router();
// Mock users for testing
const mockUsers: Record<string, any> = {};
router.post('/login', loginLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ success: false, error: 'Email and password are required' });
      return;
    }
    const user = Object.values(mockUsers).find((u: any) => u.email === email);
    if (!user || !(await bcryptjs.compare(password, user.password))) {
      res.status(401).json({ success: false, error: 'Invalid email or password' });
      return;
    }
    const accessToken = generateToken(user.id, user.email, user.role);
    const refreshToken = generateRefreshToken(user.id, user.email, user.role);
    res.json({ success: true, data: { access_token: accessToken, refresh_token: refreshToken, user } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Login failed' });
  }
});
router.post('/refresh', async (req: Request, res: Response): Promise<void> => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) {
      res.status(400).json({ success: false, error: 'Refresh token is required' });
      return;
    }
    const decoded = verifyRefreshToken(refresh_token);
    const accessToken = generateToken(decoded.id, decoded.email, decoded.role);
    const newRefreshToken = generateRefreshToken(decoded.id, decoded.email, decoded.role);
    res.json({ success: true, data: { access_token: accessToken, refresh_token: newRefreshToken } });
  } catch (error) {
    res.status(401).json({ success: false, error: 'Session expired' });
  }
});
router.get('/verify', verifyToken, (req: Request, res: Response) => {
  res.json({ success: true, data: { user: req.user } });
});
router.post('/apple', async (req: Request, res: Response): Promise<void> => {
  try {
    const { code, user: appleUser } = req.body;
    if (!code) {
      res.status(400).json({ success: false, error: 'Authorization code is required' });
      return;
    }
    // Using native fetch (No node-fetch needed!)
    const response = await fetch('https://appleid.apple.com/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ 
        grant_type: 'authorization_code', 
        code, 
        client_id: 'com.vibecode.hopecompanion.0ajx7d', 
        client_secret: process.env.APPLE_CLIENT_SECRET || '' 
      }).toString()
    });
    const tokenData: any = await response.json();
    if (!response.ok) throw new Error(tokenData.error || 'Apple Auth Failed');
    
    // ... rest of logic for decoding token ...
    res.json({ success: true, data: tokenData });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});
export default router;
