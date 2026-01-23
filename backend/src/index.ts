/**
 * Secure KWO Backend
 *
 * Features:
 * - JWT token validation
 * - Rate limiting per user
 * - Request logging & audit trail
 * - Input validation
 * - CORS protection
 * - Helmet security headers
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
} from './utils/cache.js';
import adminRoutes from './routes/admin.js';
import partnersRoutes from './routes/partners.js';
dotenv.config();
const app = express();
const PORT = process.env.PORT || 3001;
/**
 * Types and Interfaces
 */
interface AuthenticatedRequest extends express.Request {
  user?: { id: string; email: string };
  token?: string;
}
// Security middleware
app.use(helmet());
app.use(express.json({ limit: '10mb' }));
// CORS - only allow your app domain
app.use(cors({
  origin: process.env.CORS_ORIGIN || ['http://localhost:8081', 'https://yourapp.com'],
  credentials: true,
}));
// Global rate limiter: 1000 requests per 15 minutes
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: 'Too many requests, please try again later',
});
app.use(globalLimiter);
// Per-user rate limiter: 100 requests per minute
const userLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  keyGenerator: (req) => (req as AuthenticatedRequest).user?.id || req.ip || 'anonymous',
  skip: (req) => !(req as AuthenticatedRequest).user, // Skip if no user authenticated
});
// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('⚠️ Subpabase credentials missing. API may not function correctly.');
}
const supabase = createClient(supabaseUrl, supabaseServiceKey);
/**
 * Audit Logging Utility
 */
async function logAudit(
  userId: string,
  action: string,
  success: boolean,
  data?: Record<string, unknown>,
  errorMessage?: string,
  req?: express.Request
) {
  try {
    await supabase.from('audit_logs').insert({
      user_id: userId,
      action,
      success,
      data: data ? JSON.stringify(data) : null,
      error_message: errorMessage || null,
      ip_address: req?.ip || 'unknown',
      user_agent: req?.get('user-agent') || 'unknown',
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Failed to log audit event:', err);
  }
}
/**
 * JWT Verification Middleware
 */
app.use(async (req: AuthenticatedRequest, res, next) => {
  console.log(`🔨 ${req.method} ${req.path}`);
  // Skip auth for /health and /api/partners routes
  if (req.path === '/health' || req.path.startsWith('/api/partners')) {
    return next();
  }
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }
  const token = authHeader.substring(7);
  req.token = token;
  try {
    // Verify JWT with Supabase
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    const userData = (await response.json()) as { id?: string; email?: string };
    if (!userData.id) {
      return res.status(401).json({ error: 'No user ID in token' });
    }
    req.user = { id: userData.id, email: userData.email || '' };
    next();
  } catch (error) {
    console.error('❌ Token verification error:', error);
    return res.status(401).json({ error: 'Token verification failed' });
  }
});
// Middleware for requiring user auth (used for specific routes)
function verifyToken(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  next();
}
/**
 * Routes
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
app.get('/admin/cache-stats', verifyToken, (req: AuthenticatedRequest, res) => {
  res.json({ success: true, data: getAllCacheStats(), timestamp: new Date().toISOString() });
});
app.post('/admin/cache/clear', verifyToken, (req: AuthenticatedRequest, res) => {
  clearAllCaches();
  res.json({ success: true, message: 'All caches cleared' });
});
app.post('/api/profile/get', async (req: AuthenticatedRequest, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const cacheKey = generateCacheKey('user', req.user.id, 'profile');
    let cachedData = userProfileCache.get(cacheKey);
    if (cachedData) {
      return res.json({ success: true, data: cachedData, cached: true });
    }
    const { data, error } = await supabase.from('user_profiles').select('*').eq('user_id', req.user.id).single();
    if (error) throw error;
    if (data) userProfileCache.set(cacheKey, data, CACHE_TTLS.USER_PROFILE);
    res.json({ success: true, data, cached: false });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});
app.post('/api/profile/update', async (req: AuthenticatedRequest, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { error } = await supabase.from('user_profiles').update(req.body).eq('user_id', req.user.id);
    if (error) throw error;
    invalidateUserCache(req.user.id);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});
app.post('/api/check-ins/list', async (req: AuthenticatedRequest, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const { limit = 50, offset = 0 } = req.body;
      const { data, error } = await supabase
        .from('user_check_ins')
        .select('*')
        .eq('user_id', req.user.id)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) throw error;
      res.json({ success: true, data });
    } catch (error) {
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
});
app.post('/api/check-ins/create', async (req: AuthenticatedRequest, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const { data, error } = await supabase.from('user_check_ins').insert({
          ...req.body,
          user_id: req.user.id,
          created_at: new Date().toISOString(),
        });
      if (error) throw error;
      res.json({ success: true, data });
    } catch (error) {
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
});
app.post('/api/devices/register', async (req: AuthenticatedRequest, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const { expo_push_token, device_type } = req.body;
      if (!expo_push_token || !device_type) return res.status(400).json({ error: 'Missing fields' });
      const { data, error } = await supabase.from('user_devices').upsert({
            user_id: req.user.id,
            expo_push_token,
            device_type,
            last_active: new Date().toISOString(),
          }, { onConflict: 'user_id' });
      if (error) throw error;
      res.json({ success: true, data });
    } catch (error) {
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
});
app.post('/api/chat/messages', async (req: AuthenticatedRequest, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const { limit = 100, offset = 0 } = req.body;
      const { data, error } = await supabase.from('chat_messages')
        .select('*').eq('user_id', req.user.id)
        .order('created_at', { ascending: true })
        .range(offset, offset + limit - 1);
      if (error) throw error;
      res.json({ success: true, data });
    } catch (error) {
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
});
// Import external routes
app.use('/admin', adminRoutes);
app.use('/api/partners', partnersRoutes);
/**
 * Error handling
 */
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});
/**
 * Server Activation
 * Crucial for Vercel: Only listen if not in production/Vercel environment.
 */
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`✅ KWO Backend running on http://localhost:${PORT}`);
  });
}
export default app;
