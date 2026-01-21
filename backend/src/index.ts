/**
 * Secure KWO Backend
 * Includes Lazy Supabase Initialization & Permissive CORS
 */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import partnersRoutes from './routes/partners.js';
dotenv.config();
const app = express();
const PORT = process.env.PORT || 3001;
app.use(helmet());
app.use(express.json({ limit: '10mb' }));
// Permissive CORS for development/testing
app.use(cors({
  origin: '*',
  credentials: true,
}));
// Lazy Initialize Supabase
let _supabase: any = null;
const getSupabase = () => {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('CONFIG ERROR: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.');
  }
  _supabase = createClient(url, key);
  return _supabase;
};
// ... (Authentication Middleware & Routes)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
app.use('/api/partners', partnersRoutes);
app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`);
});
export default app;
