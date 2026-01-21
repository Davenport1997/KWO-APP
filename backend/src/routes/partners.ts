import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
const router = Router();
const getSupabase = () => {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
};
// 🛡️ SECURITY: Every query MUST filter by user_id
router.post('/add', async (req: Request, res: Response) => {
  const { user_id, partner_phone, partner_name, relationship } = req.body;
  if (!user_id || !partner_phone) return res.status(400).json({ error: 'Missing data' });
  const { data, error } = await getSupabase()
    .from('accountability_partners')
    .insert({ user_id, partner_phone, partner_name, relationship })
    .select().single();
  if (error) return res.status(500).json({ error: 'Database insertion failed' });
  res.json({ success: true, partner: data });
});
router.post('/list', async (req: Request, res: Response) => {
  const { user_id } = req.body;
  const { data, error } = await getSupabase()
    .from('accountability_partners')
    .select('*').eq('user_id', user_id); 
  res.json(data || []);
});
export default router;
