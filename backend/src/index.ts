/**
 * 🛡️ KWO Production Backend (App Store Ready)
 */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import {
  userProfileCache,
  invalidateUserCache,
  generateCacheKey,
  CACHE_TTLS,
  getAllCacheStats,
  clearAllCaches
} from './utils/cache.js';
import adminRoutes from './routes/admin.js';
import partnersRoutes from './routes/partners.js';
dotenv.config();
const app = express();
const PORT = process.env.PORT || 3001;
// 1. Security Headers
app.use(helmet());
app.use(express.json({ limit: '10mb' }));
// 2. 🛡️ PRODUCTION CORS: Allow your web portal and mobile traffic
const allowedOrigins = [
  'https://vibecodeapp.com',       // Your development platform
  'https://www.vibecodeapp.com',
  'https://kwo-app.vercel.app',    // Your Vercel deployment
];
app.use(cors({
  origin: (origin, callback) => {
    // 💡 IMPORTANT: Mobile apps (App Store) often don't send an 'Origin' header.
    // We allow requests with no origin so the Mobile App can connect.
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Unauthorized by CORS'));
    }
  },
  credentials: true,
}));
// 3. Brute-Force Protection
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: { error: 'Request limit exceeded' },
}));
// 4. Supabase Setup
let _supabase: any = null;
const getSupabase = () => {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('CONFIG ERROR: Missing Supabase keys in Vercel');
  _supabase = createClient(url, key);
  return _supabase;
};
// 5. Hardened Auth Middleware
interface AuthenticatedRequest extends express.Request {
  user?: { id: string; email: string };
}
app.use(async (req: AuthenticatedRequest, res, next) => {
  if (req.path === '/health' || req.path === '/api/partners/find') return next();
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Auth token required' });
  try {
    const token = authHeader.substring(7);
    const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error();
    const userData = (await response.json()) as any;
    req.user = { id: userData.id, email: userData.email };
    next();
  } catch {
    res.status(401).json({ error: 'Session expired' });
  }
});
// ... (Routes)
app.post('/api/profile/get', async (req: AuthenticatedRequest, res) => {
  try {
    const { data, error } = await getSupabase().from('user_profiles').select('*').eq('user_id', req.user!.id).single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(400).json({ success: false, error: 'Database error' });
  }
});
app.use('/admin', adminRoutes);
app.use('/api/partners', partnersRoutes);
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.listen(PORT, () => console.log(`🚀 Production Backend Live`));
export default app;
