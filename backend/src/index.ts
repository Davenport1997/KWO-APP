/**
 * Secure KWO Backend (Vercel Serverless)
 *
 * Features:
 * - JWT token validation via Supabase
 * - Global + per-user rate limiting
 * - Audit logging
 * - Caching
 * - App Store–safe backend
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

import {
  userProfileCache,
  generateCacheKey,
  CACHE_TTLS,
  invalidateUserCache,
  getAllCacheStats,
  clearAllCaches
} from './utils/cache';

import adminRoutes from './routes/admin';
import partnersRoutes from './routes/partners';

dotenv.config();

/* -------------------------------------------------------------------------- */
/*                               App Bootstrap                                */
/* -------------------------------------------------------------------------- */

const app = express();

/* -------------------------------------------------------------------------- */
/*                               Middleware                                   */
/* -------------------------------------------------------------------------- */

app.use(helmet());
app.use(express.json({ limit: '10mb' }));

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || [
      'http://localhost:8081',
      'https://yourapp.com'
    ],
    credentials: true
  })
);

/* -------------------------------------------------------------------------- */
/*                               Rate Limits                                  */
/* -------------------------------------------------------------------------- */

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000
});

app.use(globalLimiter);

/* -------------------------------------------------------------------------- */
/*                              Supabase Setup                                 */
/* -------------------------------------------------------------------------- */

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

/* -------------------------------------------------------------------------- */
/*                              Types                                         */
/* -------------------------------------------------------------------------- */

interface AuthenticatedRequest extends express.Request {
  user?: {
    id: string;
    email: string;
  };
  token?: string;
}

/* -------------------------------------------------------------------------- */
/*                              Public Routes                                 */
/* -------------------------------------------------------------------------- */

app.get('/', (_req, res) => {
  res.status(200).json({
    status: 'KWO backend is live',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

/* -------------------------------------------------------------------------- */
/*                         Authentication Middleware                           */
/* -------------------------------------------------------------------------- */

app.use(async (req: AuthenticatedRequest, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }

  const token = authHeader.substring(7);
  req.token = token;

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!response.ok) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const userData = (await response.json()) as {
      id?: string;
      email?: string;
    };

    if (!userData.id) {
      return res.status(401).json({ error: 'Invalid user token' });
    }

    req.user = {
      id: userData.id,
      email: userData.email || ''
    };

    next();
  } catch (err) {
    console.error('Auth error:', err);
    res.status(401).json({ error: 'Authentication failed' });
  }
});

/* -------------------------------------------------------------------------- */
/*                           Per-User Rate Limit                               */
/* -------------------------------------------------------------------------- */

const userLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  keyGenerator: (req: AuthenticatedRequest) => req.user?.id || req.ip
});

app.use(userLimiter);

/* -------------------------------------------------------------------------- */
/*                               Admin Routes                                 */
/* -------------------------------------------------------------------------- */

app.get('/admin/cache-stats', (_req, res) => {
  res.json({
    success: true,
    data: getAllCacheStats()
  });
});

app.post('/admin/cache-clear', (_req, res) => {
  clearAllCaches();
  res.json({ success: true });
});

app.use('/admin', adminRoutes);

/* -------------------------------------------------------------------------- */
/*                               Profile APIs                                 */
/* -------------------------------------------------------------------------- */

app.post('/api/profile/get', async (req: AuthenticatedRequest, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const cacheKey = generateCacheKey('user', req.user.id, 'profile');

  const cached = userProfileCache.get(cacheKey);
  if (cached) {
    return res.json({ success: true, data: cached, cached: true });
  }

  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', req.user.id)
    .single();

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  userProfileCache.set(cacheKey, data, CACHE_TTLS.USER_PROFILE);

  res.json({ success: true, data, cached: false });
});

app.post('/api/profile/update', async (req: AuthenticatedRequest, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const { error, data } = await supabase
    .from('user_profiles')
    .update(req.body)
    .eq('user_id', req.user.id);

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  invalidateUserCache(req.user.id);

  res.json({ success: true, data });
});

/* -------------------------------------------------------------------------- */
/*                           Partners / Chat / Devices                         */
/* -------------------------------------------------------------------------- */

app.use('/api/partners', partnersRoutes);

/* -------------------------------------------------------------------------- */
/*                               Error Handler                                 */
/* -------------------------------------------------------------------------- */

app.use(
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
);

/* -------------------------------------------------------------------------- */
/*                         IMPORTANT FOR VERCEL                                */
/* -------------------------------------------------------------------------- */

export default app;
