import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
const router = Router();
const getSupabase = () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase configuration');
  return createClient(url, key);
};
const getUserIdFromToken = (authHeader: string | undefined): string | null => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try {
    const token = authHeader.substring(7);
    const decoded = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    return decoded.sub || null;
  } catch (error) { return null; }
};
router.post('/add', async (req: Request, res: Response) => {
  try {
    const { user_id, partner_phone, partner_name, relationship } = req.body;
    if (!user_id || !partner_phone || !partner_name || !relationship) return res.status(400).json({ error: 'Missing fields' });
    const { data, error } = await getSupabase().from('accountability_partners').insert({ user_id, partner_phone, partner_name, relationship }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(200).json({ success: true, partner: data });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});
router.post('/list', async (req: Request, res: Response) => {
  try {
    const { user_id } = req.body;
    const { data, error } = await getSupabase().from('accountability_partners').select('*').eq('user_id', user_id);
    if (error) return res.status(500).json({ error: error.message });
    res.status(200).json(data || []);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});
router.post('/find', async (req: Request, res: Response) => {
  try {
    const { partner_phone } = req.body;
    const cleanPhone = partner_phone.toString().replace(/[\s\-\(\)]/g, '');
    const { data, error } = await getSupabase().from('accountability_partners').select('*').eq('partner_phone', cleanPhone).single();
    if (error) return res.status(404).json({ error: 'Partner not found' });
    res.status(200).json(data);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});
router.post('/update', async (req: Request, res: Response) => {
  try {
    const { partner_id, updates } = req.body;
    const { data, error } = await getSupabase().from('accountability_partners').update(updates).eq('id', partner_id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(200).json({ success: true, partner: data });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});
router.post('/remove', async (req: Request, res: Response) => {
  try {
    const { partner_id } = req.body;
    const { error } = await getSupabase().from('accountability_partners').delete().eq('id', partner_id);
    if (error) return res.status(500).json({ error: error.message });
    res.status(200).json({ success: true });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});
export default router;
