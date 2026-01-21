import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
const router = Router();
const getSupabase = () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return createClient(url, key);
};
// ... (All register/login/list routes using getSupabase())
export default router;
