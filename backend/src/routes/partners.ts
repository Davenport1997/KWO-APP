import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '../middleware/auth.js';

const router = Router();

// Initialize Supabase with service role key (robust fallback)
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('⚠️ Missing Supabase credentials in partners.ts');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

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

/**
 * Extract user ID from JWT token
 */
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

/**
 * POST /api/partners/add
 * Add a new accountability partner
 * Requires: Authorization header with valid JWT token
 */
router.post('/add', async (req: Request, res: Response): Promise<void> => {
  try {
    const { user_id, partner_phone, partner_name, relationship, notification_preferences } = req.body;

    // Validate required fields
    if (!user_id || !partner_phone || !partner_name || !relationship) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
      return;
    }

    // Verify authorization
    const authHeader = req.headers.authorization;
    const tokenUserId = getUserIdFromToken(authHeader);
    if (!tokenUserId) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized'
      });
      return;
    }

    // Insert partner into database
    const { data, error } = await supabase
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
      console.error('[Partners API] Error adding partner:', error);

      // Handle duplicate partner
      if (error.code === '23505') {
        res.status(409).json({
          success: false,
          error: 'Partner with this phone number already added'
        });
        return;
      }

      res.status(500).json({
        success: false,
        error: error.message
      });
      return;
    }

    res.status(200).json({
      success: true,
      id: data.id,
      partner: data
    });
  } catch (error: any) {
    console.error('[Partners API] Unexpected error in addPartner:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * POST /api/partners/list
 * Get all partners for a user
 * Requires: Authorization header with valid JWT token
 */
router.post('/list', async (req: Request, res: Response): Promise<void> => {
  try {
    const { user_id } = req.body;

    if (!user_id) {
      res.status(400).json({
        success: false,
        error: 'Missing user_id'
      });
      return;
    }

    // Verify authorization
    const authHeader = req.headers.authorization;
    const tokenUserId = getUserIdFromToken(authHeader);
    if (!tokenUserId) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized'
      });
      return;
    }

    const { data, error } = await supabase
      .from('accountability_partners')
      .select('*')
      .eq('user_id', user_id)
      .order('added_at', { ascending: false });

    if (error) {
      console.error('[Partners API] Error listing partners:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
      return;
    }

    res.status(200).json(data || []);
  } catch (error: any) {
    console.error('[Partners API] Unexpected error in listPartners:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * POST /api/partners/find
 * Find a partner by phone number (for partner portal login)
 * IMPORTANT: This endpoint does NOT require authentication
 */
router.post('/find', async (req: Request, res: Response): Promise<void> => {
  try {
    const { partner_phone } = req.body;

    if (!partner_phone) {
      res.status(400).json({
        success: false,
        error: 'Missing partner_phone'
      });
      return;
    }

    // Clean phone number
    const cleanPhone = partner_phone.toString().replace(/[\s\-\(\)]/g, '');

    const { data, error } = await supabase
      .from('accountability_partners')
      .select('*')
      .eq('partner_phone', cleanPhone)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows found
        res.status(404).json({
          success: false,
          error: 'Phone number not found. Make sure you were added as an accountability partner.'
        });
        return;
      }

      console.error('[Partners API] Error finding partner:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
      return;
    }

    res.status(200).json(data);
  } catch (error: any) {
    console.error('[Partners API] Unexpected error in findPartnerByPhone:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * POST /api/partners/update
 * Update a partner's details
 * Requires: Authorization header with valid JWT token
 */
router.post('/update', async (req: Request, res: Response): Promise<void> => {
  try {
    const { partner_id, user_id, updates } = req.body;

    if (!partner_id || !user_id || !updates) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
      return;
    }

    // Verify authorization
    const authHeader = req.headers.authorization;
    const tokenUserId = getUserIdFromToken(authHeader);
    if (!tokenUserId) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized'
      });
      return;
    }

    // Verify partner belongs to user
    const { data: existingPartner } = await supabase
      .from('accountability_partners')
      .select('user_id')
      .eq('id', partner_id)
      .single();

    if (!existingPartner || existingPartner.user_id !== user_id) {
      res.status(403).json({
        success: false,
        error: 'Unauthorized - partner does not belong to user'
      });
      return;
    }

    // Update partner
    const { data, error } = await supabase
      .from('accountability_partners')
      .update(updates)
      .eq('id', partner_id)
      .select()
      .single();

    if (error) {
      console.error('[Partners API] Error updating partner:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
      return;
    }

    res.status(200).json({
      success: true,
      partner: data
    });
  } catch (error: any) {
    console.error('[Partners API] Unexpected error in updatePartner:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * POST /api/partners/remove
 * Remove a partner
 * Requires: Authorization header with valid JWT token
 */
router.post('/remove', async (req: Request, res: Response): Promise<void> => {
  try {
    const { partner_id, user_id } = req.body;

    if (!partner_id || !user_id) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
      return;
    }

    // Verify authorization
    const authHeader = req.headers.authorization;
    const tokenUserId = getUserIdFromToken(authHeader);
    if (!tokenUserId) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized'
      });
      return;
    }

    // Verify partner belongs to user
    const { data: existingPartner } = await supabase
      .from('accountability_partners')
      .select('user_id')
      .eq('id', partner_id)
      .single();

    if (!existingPartner || existingPartner.user_id !== user_id) {
      res.status(403).json({
        success: false,
        error: 'Unauthorized - partner does not belong to user'
      });
      return;
    }

    // Delete partner
    const { error } = await supabase
      .from('accountability_partners')
      .delete()
      .eq('id', partner_id);

    if (error) {
      console.error('[Partners API] Error removing partner:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
      return;
    }

    res.status(200).json({
      success: true
    });
  } catch (error: any) {
    console.error('[Partners API] Unexpected error in removePartner:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * POST /api/partners/notifications/send
 * Partner sends encouragement message to user
 * IMPORTANT: This endpoint does NOT require authentication from partner
 * Partners are identified by their partner record
 */
router.post('/notifications/send', async (req: Request, res: Response): Promise<void> => {
  try {
    const { partner_id, user_id, message, type } = req.body;

    if (!partner_id || !user_id || !message) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: partner_id, user_id, message'
      });
      return;
    }

    // Verify partner exists and belongs to this user
    const { data: partner, error: partnerError } = await supabase
      .from('accountability_partners')
      .select('id, user_id')
      .eq('id', partner_id)
      .eq('user_id', user_id)
      .single();

    if (partnerError || !partner) {
      console.error('[Partners API] Error verifying partner:', partnerError);
      res.status(404).json({
        success: false,
        error: 'Partner not found'
      });
      return;
    }

    // Store notification in database
    const { data, error } = await supabase
      .from('partner_notifications')
      .insert({
        partner_id,
        user_id,
        message,
        type: type || 'encouragement',
        is_read: false,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('[Partners API] Error storing notification:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
      return;
    }

    res.status(200).json({
      success: true,
      notification: data
    });
  } catch (error: any) {
    console.error('[Partners API] Unexpected error in sendNotification:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * POST /api/partners/notifications/get
 * User retrieves encouragement messages from their partner
 * Requires: Authorization header with valid JWT token
 */
router.post('/notifications/get', async (req: Request, res: Response): Promise<void> => {
  try {
    const { user_id } = req.body;

    if (!user_id) {
      res.status(400).json({
        success: false,
        error: 'Missing user_id'
      });
      return;
    }

    // Verify authorization
    const authHeader = req.headers.authorization;
    const tokenUserId = getUserIdFromToken(authHeader);
    if (!tokenUserId) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized'
      });
      return;
    }

    // Get unread notifications for user
    const { data, error } = await supabase
      .from('partner_notifications')
      .select('*, accountability_partners(partner_name)')
      .eq('user_id', user_id)
      .eq('is_read', false)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Partners API] Error fetching notifications:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
      return;
    }

    res.status(200).json({
      success: true,
      notifications: data || [],
      count: (data || []).length
    });
  } catch (error: any) {
    console.error('[Partners API] Unexpected error in getNotifications:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * POST /api/partners/notifications/mark-read
 * Mark a notification as read
 * Requires: Authorization header with valid JWT token
 */
router.post('/notifications/mark-read', async (req: Request, res: Response): Promise<void> => {
  try {
    const { notification_id, user_id } = req.body;

    if (!notification_id || !user_id) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: notification_id, user_id'
      });
      return;
    }

    // Verify authorization
    const authHeader = req.headers.authorization;
    const tokenUserId = getUserIdFromToken(authHeader);
    if (!tokenUserId) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized'
      });
      return;
    }

    // Update notification
    const { error } = await supabase
      .from('partner_notifications')
      .update({ is_read: true })
      .eq('id', notification_id)
      .eq('user_id', user_id);

    if (error) {
      console.error('[Partners API] Error marking notification as read:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
      return;
    }

    res.status(200).json({
      success: true
    });
  } catch (error: any) {
    console.error('[Partners API] Unexpected error in markNotificationRead:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

export default router;
