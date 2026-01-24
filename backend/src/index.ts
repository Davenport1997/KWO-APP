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

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';
import {
  userProfileCache,
  userSettingsCache,
  generateCacheKey,
  CACHE_TTLS,
  invalidateUserCache,
  getAllCacheStats,
  clearAllCaches
} from './utils/cache.js';
import { verifyToken } from './middleware/auth.js';
import adminRoutes from './routes/admin.js';
import partnersRoutes from './routes/partners.js';

// MISSION CRITICAL: Importing missing modular routes
import authRoutes from './routes/auth.js';
import aiRoutes from './routes/ai.js';
import chatRoutes from './routes/chat.js';
import checkinRoutes from './routes/checkin.js';
import communityRoutes from './routes/community.js';
import challengeRoutes from './routes/challenges.js';
import wellnessRoutes from './routes/calculations.js';
import paymentRoutes from './routes/payment.js';
import subscriptionRoutes from './routes/subscription.js';

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
  keyGenerator: (req) => (req as any).user?.id || req.ip,
  skip: (req) => !(req as any).user, // Skip if no user authenticated
});

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL || '';
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
 * Extended Request type for authenticated requests
 */
type AuthenticatedRequest = Omit<express.Request, 'user'> & {
  user?: any;
  token?: string;
};

/**
 * Public Route Checker - No auth required for these
 */
app.use((req: AuthenticatedRequest, res, next) => {
  console.log(`🔨 ${req.method} ${req.path}`);

  // Public routes that don't require authentication
  const publicRoutes = [
    '/health',
    '/favicon.ico',
    '/favicon.png',
    '/',
    '/auth/register',
    '/auth/login',
    '/auth/refresh',
    '/ai/status'
  ];

  // Check if route is public
  const isPublicRoute = publicRoutes.some(route => req.path === route) ||
                        req.path.startsWith('/api/partners');

  if (isPublicRoute) {
    console.log(`✅ Skipping auth for public route: ${req.path}`);
    return next();
  }

  // All other routes will be protected by verifyToken middleware
  // applied to individual route groups below
  next();
});

// Apply per-user rate limiting after public route check
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

/**
 * SECURITY: Admin Authorization Middleware
 * Only allows 'service_role' or specific emails to access admin routes
 */
function verifyAdmin(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) {
  const isAdmin = (req.user as any)?.role === 'service_role' ||
    (req.user as any)?.role === 'admin' ||
    process.env.ADMIN_EMAILS?.split(',').includes(req.user?.email || '');

  if (!isAdmin) {
    console.warn(`🛑 Unauthorized admin attempt by user ${req.user?.id}`);
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

/**
 * Cache Statistics Endpoint (admin only - for monitoring)
 */
app.get('/admin/cache-stats', verifyToken, verifyAdmin, (req: AuthenticatedRequest, res) => {
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
app.post('/admin/cache/clear', verifyToken, verifyAdmin, (req: AuthenticatedRequest, res) => {
  clearAllCaches();
  res.json({
    success: true,
    message: 'All caches cleared'
  });
});

/**
 * User Profile
 */
app.post('/api/profile/get', verifyToken, async (req: AuthenticatedRequest, res) => {
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
  // SECURITY FIX: IDOR Protection
  if (req.user?.id !== req.params.userId) {
    return res.status(403).json({ success: false, error: 'Access denied: You can only access your own profile' });
  }

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
  // SECURITY FIX: IDOR Protection
  if (req.user?.id !== req.params.userId) {
    return res.status(403).json({ success: false, error: 'Access denied: You can only update your own profile' });
  }

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

app.post('/api/profile/update', verifyToken, async (req: AuthenticatedRequest, res) => {
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
app.post('/api/check-ins/list', verifyToken, async (req: AuthenticatedRequest, res) => {
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

app.post('/api/check-ins/create', verifyToken, async (req: AuthenticatedRequest, res) => {
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
    const checkinId = (data as any)?.[0]?.id || 'ok';
    res.json({ success: true, data: { checkin_id: checkinId, streak: 0, points_earned: 10 } });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Unknown' });
  }
});

/**
 * Push Notifications
 */
app.post('/api/devices/register', verifyToken, async (req: AuthenticatedRequest, res) => {
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

app.post('/api/devices/get', verifyToken, async (req: AuthenticatedRequest, res) => {
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

app.post('/api/devices/update-active', verifyToken, async (req: AuthenticatedRequest, res) => {
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
app.post('/api/chat/messages', verifyToken, async (req: AuthenticatedRequest, res) => {
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

app.post('/api/chat/send', verifyToken, async (req: AuthenticatedRequest, res) => {
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
 * MISSING MISSION-CRITICAL MODULE MOUNTS
 * These preserve all original logic but layer in the modular features.
 */
app.use('/auth', authRoutes);
app.use('/chat', verifyToken, chatRoutes);
app.use('/checkin', verifyToken, checkinRoutes);
app.use('/ai', verifyToken, aiRoutes); // ✅ Protected with JWT auth
app.use('/community', verifyToken, communityRoutes);
app.use('/challenges', verifyToken, challengeRoutes);
app.use('/wellness', verifyToken, wellnessRoutes);
app.use('/payment', verifyToken, paymentRoutes);
app.use('/subscription', verifyToken, subscriptionRoutes);

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
