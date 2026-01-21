/**
 * Secure KWO Backend - CRASH-PROOF VERSION
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Trust proxy - required for Railway/Heroku/etc
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());
app.use(express.json({ limit: '10mb' }));

// CORS - only allow your app domain
app.use(cors({
  origin: process.env.CORS_ORIGIN || ['http://localhost:8081', 'https://yourapp.com'],
  credentials: true,
}));

// Global rate limiter
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: 'Too many requests, please try again later',
});
app.use(globalLimiter);

// Per-user rate limiter
const userLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  keyGenerator: (req: any) => req.user?.id || req.ip,
  skip: (req: any) => !req.user,
});

/**
 * FIXED: Lazy Initialization of Supabase
 * This prevents the 502 error by allowing the server to start even if variables are missing.
 */
let _supabase: any = null;
const getSupabase = () => {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    // This error will now be returned as JSON instead of crashing the server
    throw new Error('CONFIG ERROR: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in Vercel settings.');
  }

  _supabase = createClient(url, key);
  return _supabase;
};

/**
 * Health Check (PUBLIC)
 */
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: 'free_user' | 'premium_user' | 'admin';
    iat: number;
    exp: number;
  };
  token?: string;
}

/**
 * Auth Middleware
 */
app.use(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (req.path === '/health' || req.path === '/favicon.ico') return next();

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }

  const token = authHeader.substring(7);
  req.token = token;

  try {
    const url = process.env.SUPABASE_URL;
    if (!url) throw new Error('SUPABASE_URL is not set');

    const response = await fetch(`${url}/auth/v1/user`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!response.ok) return res.status(401).json({ error: 'Invalid or expired token' });

    const userData = (await response.json()) as any;
    if (!userData.id) return res.status(401).json({ error: 'No user ID in token' });

    req.user = {
      id: userData.id,
      email: userData.email || '',
      role: userData.user_metadata?.role || 'free_user',
      iat: userData.iat || Math.floor(Date.now() / 1000),
      exp: userData.exp || Math.floor(Date.now() / 1000) + 3600,
    };
    next();
  } catch (error: any) {
    res.status(401).json({ error: error.message || 'Token verification failed' });
  }
});

app.use(userLimiter);

/**
 * Audit Logging Helper
 */
async function logAudit(userId: string, action: string, success: boolean, data?: any, errorMessage?: string, req?: Request) {
  try {
    await getSupabase().from('audit_logs').insert({
      user_id: userId,
      action,
      success,
      data: data ? JSON.stringify(data) : null,
      error_message: errorMessage || null,
      ip_address: (req as any)?.ip || 'unknown',
      user_agent: req?.get('user-agent') || 'unknown',
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Audit failed:', err);
  }
}

/**
 * API Routes
 */

app.post('/api/profile/get', async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { data, error } = await getSupabase().from('user_profiles').select('*').eq('user_id', req.user.id).single();
    if (error) throw error;
    await logAudit(req.user.id, 'get_profile', true, {}, undefined, req);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/profile/update', async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { data, error } = await getSupabase().from('user_profiles').update(req.body).eq('user_id', req.user.id);
    if (error) throw error;
    await logAudit(req.user.id, 'update_profile', true, req.body, undefined, req);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Check-ins
app.post('/api/check-ins/list', async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { limit = 50, offset = 0 } = req.body || {};
    const { data, error } = await getSupabase().from('user_check_ins').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false }).range(offset, offset + limit - 1);
    if (error) throw error;
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Device Registration
app.post('/api/devices/register', async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { expo_push_token, device_type } = req.body || {};
    const { error } = await getSupabase().from('user_devices').upsert({ user_id: req.user.id, expo_push_token, device_type, last_active: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Error handling
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`);
});

export default app;
