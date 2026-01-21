import { Router, Request, Response } from 'express';
import { verifyToken, requireOwnership, requireAdmin } from '../middleware/auth.js';
import { validateProfileUpdate, validateUserId, escapeHtml, sanitizeString } from '../utils/validation.js';
import { createClient } from '@supabase/supabase-js';
const router = Router();
const getSupabase = () => {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
};
// ... copy the rest from your local user.ts file ...
