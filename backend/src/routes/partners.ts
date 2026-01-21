import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
const router = Router();
const getSupabase = () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase Config');
  return createClient(url, key);
};
router.post('/find', async (req: Request, res: Response): Promise<void> => {
  try {
    const { partner_phone } = req.body;
    if (!partner_phone) {
      res.status(400).json({ success: false, error: 'Missing phone' });
      return;
    }
    const cleanPhone = partner_phone.toString().replace(/[\s\-\(\)]/g, '');
    const { data, error } = await getSupabase()
      .from('accountability_partners')
      .select('*')
      .eq('partner_phone', cleanPhone)
      .single();
    if (error) {
      res.status(404).json({ success: false, error: 'Partner not found' });
      return;
    }
    res.status(200).json(data);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});
export default router;
