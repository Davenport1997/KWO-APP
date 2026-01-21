import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '../middleware/auth.js';
const router = Router();
/**
 * Helper to get Supabase client lazily
 * This prevents the server from crashing on startup!
 */
const getSupabase = () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing Supabase configuration: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set');
  }
  return createClient(url, key);
};
// =============================================================================
// TYPE DEFINITIONS
// =============================================================================
interface PartnerRecord {
  id: string;
  user_id: string;
  partner_phone: string;
  partner_name: string;
  relationship: string;
  notification_preferences: {
    dailyUpdates: boolean;
    struggleAlerts: boolean;
    weeklyDigest: boolean;
  };
  invite_sent: boolean;
  invite_accepted: boolean;
  added_at: string;
  updated_at: string;
}
// =============================================================================
// HELPER FUNCTIONS
// =============================================================================
const getUserIdFromToken = (authHeader: string | undefined): string | null => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  try {
    const token = authHeader.substring(7);
    const decoded = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    return decoded.sub || null;
  } catch (error) {
    return null;
  }
};
// =============================================================================
// ROUTES
// =============================================================================
router.post('/add', async (req: Request, res: Response): Promise<void> => {
  try {
    const { user_id, partner_phone, partner_name, relationship, notification_preferences } = req.body;
    if (!user_id || !partner_phone || !partner_name || !relationship) {
      res.status(400).json({ success: false, error: 'Missing required fields' });
      return;
    }
    const authHeader = req.headers.authorization;
    const tokenUserId = getUserIdFromToken(authHeader);
    if (!tokenUserId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    const { data, error } = await getSupabase()
      .from('accountability_partners')
      .insert({
        user_id,
        partner_phone,
        partner_name,
        relationship,
        notification_preferences: notification_preferences || {
          dailyUpdates: true,
          struggleAlerts: true,
          weeklyDigest: false,
        },
        invite_sent: false,
        invite_accepted: false,
      })
      .select()
      .single();
    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ success: false, error: 'Partner already added' });
        return;
      }
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.status(200).json({ success: true, id: data.id, partner: data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Internal server error' });
  }
});
router.post('/list', async (req: Request, res: Response): Promise<void> => {
  try {
    const { user_id } = req.body;
    if (!user_id) {
      res.status(400).json({ success: false, error: 'Missing user_id' });
      return;
    }
    const authHeader = req.headers.authorization;
    const tokenUserId = getUserIdFromToken(authHeader);
    if (!tokenUserId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    const { data, error } = await getSupabase()
      .from('accountability_partners')
      .select('*')
      .eq('user_id', user_id)
      .order('added_at', { ascending: false });
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.status(200).json(data || []);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Internal server error' });
  }
});
router.post('/find', async (req: Request, res: Response): Promise<void> => {
  try {
    const { partner_phone } = req.body;
    if (!partner_phone) {
      res.status(400).json({ success: false, error: 'Missing partner_phone' });
      return;
    }
    const cleanPhone = partner_phone.toString().replace(/[\s\-\(\)]/g, '');
    const { data, error } = await getSupabase()
      .from('accountability_partners')
      .select('*')
      .eq('partner_phone', cleanPhone)
      .single();
    if (error) {
      if (error.code === 'PGRST116') {
        res.status(404).json({ success: false, error: 'Phone number not found' });
        return;
      }
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.status(200).json(data);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Internal server error' });
  }
});
router.post('/update', async (req: Request, res: Response): Promise<void> => {
  try {
    const { partner_id, user_id, updates } = req.body;
    if (!partner_id || !user_id || !updates) {
      res.status(400).json({ success: false, error: 'Missing required fields' });
      return;
    }
    const authHeader = req.headers.authorization;
    const tokenUserId = getUserIdFromToken(authHeader);
    if (!tokenUserId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    const { data: existingPartner } = await getSupabase()
      .from('accountability_partners')
      .select('user_id')
      .eq('id', partner_id)
      .single();
    if (!existingPartner || existingPartner.user_id !== user_id) {
      res.status(403).json({ success: false, error: 'Unauthorized' });
      return;
    }
    const { data, error } = await getSupabase()
      .from('accountability_partners')
      .update(updates)
      .eq('id', partner_id)
      .select()
      .single();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.status(200).json({ success: true, partner: data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Internal server error' });
  }
});
router.post('/remove', async (req: Request, res: Response): Promise<void> => {
  try {
    const { partner_id, user_id } = req.body;
    if (!partner_id || !user_id) {
      res.status(400).json({ success: false, error: 'Missing fields' });
      return;
    }
    const authHeader = req.headers.authorization;
    const tokenUserId = getUserIdFromToken(authHeader);
    if (!tokenUserId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    const { data: existingPartner } = await getSupabase()
      .from('accountability_partners')
      .select('user_id')
      .eq('id', partner_id)
      .single();
    if (!existingPartner || existingPartner.user_id !== user_id) {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }
    const { error } = await getSupabase()
      .from('accountability_partners')
      .delete()
      .eq('id', partner_id);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.status(200).json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Internal server error' });
  }
});
export default router;
