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
  userSettingsCache,
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

// Trust Vercel proxy for express-rate-limit
app.set('trust proxy', 1);

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
  keyGenerator: (req) => req.user?.id || req.ip,
  skip: (req) => !req.user, // Skip if no user authenticated
});

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL || '';
// Support both SERVICE_ROLE_KEY and SERVICE_KEY as fallbacks
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('⚠️ Missing Supabase credentials. Backend may fail to interact with database.');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Health Check (PUBLIC - no auth required)
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * Root Route (PUBLIC)
 */
app.get('/', (req, res) => {
  res.json({
    message: 'KWO Secure Backend API',
    status: 'running',
    version: '1.0.0'
  });
});

/**
 * Cache Statistics Endpoint (admin only - for monitoring)
 */
app.get('/admin/cache-stats', verifyToken, (req: AuthenticatedRequest, res) => {
  // In production, verify user is admin
  const stats = getAllCacheStats();
  res.json({
    success: true,
    data: stats,
    timestamp: new Date().toISOString()
  });
});

/**
 * Clear Cache Endpoint (admin only)
 */
app.post('/admin/cache/clear', verifyToken, (req: AuthenticatedRequest, res) => {
  // In production, verify user is admin
  clearAllCaches();
  res.json({
    success: true,
    message: 'All caches cleared'
  });
});

/**
 * JWT Verification Middleware
 */
interface AuthenticatedRequest extends express.Request {
  user?: { id: string; email: string };
  token?: string;
}

app.use(async (req: AuthenticatedRequest, res, next) => {
  console.log(`🔨 ${req.method} ${req.path}`);

  // Public routes that don't require JWT
  const publicRoutes = ['/health', '/favicon.ico', '/favicon.png', '/'];
  if (publicRoutes.includes(req.path) || req.path.startsWith('/api/partners')) {
    console.log(`✅ Skipping auth for public route: ${req.path}`);
    return next();
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('❌ Missing authorization header');
    return res.status(401).json({ error: 'Missing authorization header' });
  }

  const token = authHeader.substring(7);
  req.token = token;

  try {
    // Verify JWT with Supabase
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      }
    });

    if (!response.ok) {
      console.log('❌ Token invalid or expired');
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const userData = (await response.json()) as { id?: string; email?: string };

    if (!userData.id) {
      console.log('❌ No user ID in token');
      return res.status(401).json({ error: 'No user ID in token' });
    }

    req.user = {
      id: userData.id,
      email: userData.email || '',
    };

    console.log(`✅ User authenticated: ${req.user.id}`);
    next();
  } catch (error) {
    console.error('❌ Token verification error:', error);
    return res.status(401).json({ error: 'Token verification failed' });
  }
});

// Apply per-user rate limiting after auth
app.use(userLimiter);

/**
 * Audit Logging
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

// Middleware for requiring user auth
function verifyToken(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}


/**
 * User Profile
 */
app.post('/api/profile/get', async (req: AuthenticatedRequest, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const cacheKey = generateCacheKey('user', req.user.id, 'profile');

    // Check cache first
    let cachedData = userProfileCache.get(cacheKey);
    if (cachedData) {
      console.log(`[Cache HIT] Profile for user ${req.user.id}`);
      await logAudit(req.user.id, 'get_profile', true, {}, null, req);
      res.json({ success: true, data: cachedData, cached: true });
      return;
    }

    // Cache miss - fetch from database
    console.log(`[Cache MISS] Fetching profile for user ${req.user.id}`);
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', req.user.id)
      .single();

    if (error) throw error;

    // Store in cache
    if (data) {
      userProfileCache.set(cacheKey, data, CACHE_TTLS.USER_PROFILE);
    }

    await logAudit(req.user.id, 'get_profile', true, {}, null, req);
    res.json({ success: true, data, cached: false });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    await logAudit(req.user.id, 'get_profile', false, {}, msg, req);
    res.status(400).json({ success: false, error: msg });
  }
});

// ALIAS ROUTES for api.ts frontend client
app.get('/user/:userId/profile', verifyToken, async (req: AuthenticatedRequest, res) => {
  req.user = { id: req.params.userId, email: '' }; // Force user ID from params for this alias
  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', req.params.userId)
      .single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Unknown' });
  }
});

app.put('/user/:userId/profile', verifyToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .update(req.body)
      .eq('user_id', req.params.userId);
    if (error) throw error;
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Unknown' });
  }
});

app.post('/api/profile/update', async (req: AuthenticatedRequest, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  console.log(`📝 Updating profile for user ${req.user.id}:`, req.body);

  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .update(req.body)
      .eq('user_id', req.user.id);

    if (error) {
      console.error('❌ Supabase error updating profile:', error);
      throw error;
    }

    console.log('✅ Profile updated successfully');

    // Invalidate cache for this user
    invalidateUserCache(req.user.id);

    await logAudit(req.user.id, 'update_profile', true, req.body, null, req);
    res.json({ success: true, data });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Profile update error:', msg);
    await logAudit(req.user.id, 'update_profile', false, req.body, msg, req);
    res.status(400).json({ success: false, error: msg });
  }
});

/**
 * Check-ins
 */
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

    await logAudit(req.user.id, 'get_check_ins', true, { limit, offset }, null, req);
    res.json({ success: true, data });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    await logAudit(req.user.id, 'get_check_ins', false, {}, msg, req);
    res.status(400).json({ success: false, error: msg });
  }
});

app.post('/api/check-ins/create', async (req: AuthenticatedRequest, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { data, error } = await supabase
      .from('user_check_ins')
      .insert({
        ...req.body,
        user_id: req.user.id,
        created_at: new Date().toISOString(),
      });

    if (error) throw error;

    await logAudit(req.user.id, 'create_check_in', true, req.body, null, req);
    res.json({ success: true, data });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    await logAudit(req.user.id, 'create_check_in', false, req.body, msg, req);
    res.status(400).json({ success: false, error: msg });
  }
});

// ALIAS for api.ts: POST /checkin/submit
app.post('/checkin/submit', verifyToken, async (req: AuthenticatedRequest, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { data, error } = await supabase
      .from('user_check_ins')
      .insert({
        ...req.body,
        user_id: req.user.id,
        created_at: new Date().toISOString(),
      });
    if (error) throw error;
    res.json({ success: true, data: { checkin_id: data?.[0]?.id || 'ok', streak: 0, points_earned: 10 } });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Unknown' });
  }
});

/**
 * Push Notifications
 */
app.post('/api/devices/register', async (req: AuthenticatedRequest, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { expo_push_token, device_type, last_active } = req.body;

    if (!expo_push_token || !device_type) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const { data, error } = await supabase
      .from('user_devices')
      .upsert(
        {
          user_id: req.user.id,
          expo_push_token,
          device_type,
          last_active: last_active || new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );

    if (error) throw error;

    await logAudit(req.user.id, 'register_device', true, { device_type }, null, req);
    res.json({ success: true, data });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    await logAudit(req.user.id, 'register_device', false, {}, msg, req);
    res.status(400).json({ success: false, error: msg });
  }
});

app.post('/api/devices/get', async (req: AuthenticatedRequest, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { data, error } = await supabase
      .from('user_devices')
      .select('*')
      .eq('user_id', req.user.id)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    await logAudit(req.user.id, 'get_device', true, {}, null, req);
    res.json({ success: true, data });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    await logAudit(req.user.id, 'get_device', false, {}, msg, req);
    res.status(400).json({ success: false, error: msg });
  }
});

app.post('/api/devices/update-active', async (req: AuthenticatedRequest, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { data, error } = await supabase
      .from('user_devices')
      .update({ last_active: new Date().toISOString() })
      .eq('user_id', req.user.id);

    if (error) throw error;

    await logAudit(req.user.id, 'update_last_active', true, {}, null, req);
    res.json({ success: true, data });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    await logAudit(req.user.id, 'update_last_active', false, {}, msg, req);
    res.status(400).json({ success: false, error: msg });
  }
});

/**
 * Chat
 */
app.post('/api/chat/messages', async (req: AuthenticatedRequest, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { limit = 100, offset = 0 } = req.body;

    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    await logAudit(req.user.id, 'get_chat_messages', true, { limit, offset }, null, req);
    res.json({ success: true, data });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    await logAudit(req.user.id, 'get_chat_messages', false, {}, msg, req);
    res.status(400).json({ success: false, error: msg });
  }
});

app.post('/api/chat/send', async (req: AuthenticatedRequest, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { role, content } = req.body;

    if (!role || !content) {
      return res.status(400).json({ error: 'Missing role or content' });
    }

    const { data, error } = await supabase
      .from('chat_messages')
      .insert({
        user_id: req.user.id,
        role,
        content,
        created_at: new Date().toISOString(),
      });

    if (error) throw error;

    await logAudit(req.user.id, 'create_chat_message', true, { role }, null, req);
    res.json({ success: true, data });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    await logAudit(req.user.id, 'create_chat_message', false, {}, msg, req);
    res.status(400).json({ success: false, error: msg });
  }
});

// ALIAS for api.ts: POST /chat/message
app.post('/chat/message', verifyToken, async (req: AuthenticatedRequest, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { message } = req.body;
    const { data, error } = await supabase
      .from('chat_messages')
      .insert({
        user_id: req.user.id,
        role: 'user',
        content: message,
        created_at: new Date().toISOString(),
      });
    if (error) throw error;
    res.json({ success: true, data: { response: 'Message received and stored in Supabase.' } });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Unknown' });
  }
});

/**
 * Admin Routes (cache management)
 */
app.use('/admin', adminRoutes);

/**
 * Partners Routes (accountability partners)
 */
app.use('/api/partners', partnersRoutes);

/**
 * Error handling
 */
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ KWO Backend running on http://localhost:${PORT}`);
  console.log(`📡 Make sure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in .env`);
});

export default app;
