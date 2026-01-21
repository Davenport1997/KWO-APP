/**
 * Secure KWO Backend
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
app.use(helmet());
app.use(express.json({ limit: '10mb' }));
app.use(cors({
  origin: '*',
  credentials: true,
}));
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: 'Too many requests, please try again later',
});
app.use(globalLimiter);
const userLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  keyGenerator: (req) => (req as any).user?.id || req.ip,
  skip: (req) => !(req as any).user,
});
let _supabase: any = null;
const getSupabase = () => {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('CONFIG ERROR: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing.');
  }
  _supabase = createClient(url, key);
  return _supabase;
};
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
app.get('/admin/cache-stats', (req, res) => {
  const stats = getAllCacheStats();
  res.json({ success: true, data: stats });
});
app.post('/admin/cache/clear', (req, res) => {
  clearAllCaches();
  res.json({ success: true, message: 'All caches cleared' });
});
interface AuthenticatedRequest extends express.Request {
  user?: { id: string; email: string };
  token?: string;
}
app.use(async (req: AuthenticatedRequest, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }
  const token = authHeader.substring(7);
  req.token = token;
  try {
    const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) return res.status(401).json({ error: 'Invalid token' });
    const userData = (await response.json()) as { id?: string; email?: string };
    if (!userData.id) return res.status(401).json({ error: 'No user ID' });
    req.user = { id: userData.id, email: userData.email || '' };
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token verification failed' });
  }
});
app.use(userLimiter);
async function logAudit(userId: string, action: string, success: boolean, data?: any, errMsg?: string, req?: any) {
  try {
    await getSupabase().from('audit_logs').insert({
      user_id: userId,
      action,
      success,
      data: data ? JSON.stringify(data) : null,
      error_message: errMsg || null,
      ip_address: req?.ip || 'unknown',
      user_agent: req?.get('user-agent') || 'unknown',
      created_at: new Date().toISOString(),
    });
  } catch (err) {}
}
app.post('/api/profile/get', async (req: AuthenticatedRequest, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const cacheKey = generateCacheKey('user', req.user.id, 'profile');
    let cachedData = userProfileCache.get(cacheKey);
    if (cachedData) {
      await logAudit(req.user.id, 'get_profile', true, {}, null, req);
      return res.json({ success: true, data: cachedData, cached: true });
    }
    const { data, error } = await getSupabase().from('user_profiles').select('*').eq('user_id', req.user.id).single();
    if (error) throw error;
    if (data) userProfileCache.set(cacheKey, data, CACHE_TTLS.USER_PROFILE);
    await logAudit(req.user.id, 'get_profile', true, {}, null, req);
    res.json({ success: true, data, cached: false });
  } catch (error: any) {
    await logAudit(req.user?.id || 'unknown', 'get_profile', false, {}, error.message, req);
    res.status(400).json({ success: false, error: error.message });
  }
});
app.post('/api/profile/update', async (req: AuthenticatedRequest, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { error } = await getSupabase().from('user_profiles').update(req.body).eq('user_id', req.user.id);
    if (error) throw error;
    invalidateUserCache(req.user.id);
    await logAudit(req.user.id, 'update_profile', true, req.body, null, req);
    res.json({ success: true });
  } catch (error: any) {
    await logAudit(req.user.id, 'update_profile', false, req.body, error.message, req);
    res.status(400).json({ success: false, error: error.message });
  }
});
app.post('/api/check-ins/list', async (req: AuthenticatedRequest, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { limit = 50, offset = 0 } = req.body;
    const { data, error } = await getSupabase().from('user_check_ins').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false }).range(offset, offset + limit - 1);
    if (error) throw error;
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});
app.post('/api/check-ins/create', async (req: AuthenticatedRequest, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { error } = await getSupabase().from('user_check_ins').insert({ ...req.body, user_id: req.user.id, created_at: new Date().toISOString() });
    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});
app.post('/api/devices/register', async (req: AuthenticatedRequest, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { expo_push_token, device_type, last_active } = req.body;
    const { error } = await getSupabase().from('user_devices').upsert({ user_id: req.user.id, expo_push_token, device_type, last_active: last_active || new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});
app.post('/api/chat/messages', async (req: AuthenticatedRequest, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { limit = 100, offset = 0 } = req.body;
    const { data, error } = await getSupabase().from('chat_messages').select('*').eq('user_id', req.user.id).order('created_at', { ascending: true }).range(offset, offset + limit - 1);
    if (error) throw error;
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});
app.post('/api/chat/send', async (req: AuthenticatedRequest, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { role, content } = req.body;
    const { error } = await getSupabase().from('chat_messages').insert({ user_id: req.user.id, role, content, created_at: new Date().toISOString() });
    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});
app.use('/admin', adminRoutes);
app.use('/api/partners', partnersRoutes);
app.use((err: any, req: any, res: any, next: any) => {
  res.status(500).json({ error: 'Internal server error' });
});
app.listen(PORT, () => {
  console.log(`✅ Running on port ${PORT}`);
});
export default app;
