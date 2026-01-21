import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import adminRoutes from './routes/admin.js';
import partnersRoutes from './routes/partners.js';
dotenv.config();
const app = express();
const PORT = process.env.PORT || 3001;
// Trust proxy for external hosting
app.set('trust proxy', 1);
// Security middleware
app.use(helmet());
app.use(express.json({ limit: '10mb' }));
/**
 * FIXED: CORS loose policy for testing
 * This solves the "TypeError: Failed to fetch"
 */
app.use(cors({
  origin: '*',
  credentials: true,
}));
// Global rate limiter
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: 'Too many requests, please try again later',
});
app.use(globalLimiter);
/**
 * CRASH-PROOF: Supabase Lazy Loader
 * Prevents 502 error if keys are missing during startup
 */
let _supabase: any = null;
const getSupabase = () => {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('CONFIG ERROR: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in Vercel settings.');
  }
  _supabase = createClient(url, key);
  return _supabase;
};
/**
 * Health Check (Public)
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
// Auth Middleware and Routes follow...
// (Important: All routes should use getSupabase() instead of global supabase)
app.use('/api/partners', partnersRoutes);
// Error handling
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
  });
});
app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`);
});
export default app;
