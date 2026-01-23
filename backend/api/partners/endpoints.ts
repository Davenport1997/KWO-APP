/**
 * Backend API Endpoints for Accountability Partners
 *
 * These endpoints handle partner operations in Supabase.
 * Deploy these to your backend server (Node.js/Express or similar).
 */

import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!; // Use service key for backend
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// =============================================================================
// API ENDPOINTS
// =============================================================================

/**
 * POST /api/partners/add
 * Add a new accountability partner
 */
export async function addPartner(req: any, res: any) {
  try {
    const {
      user_id,
      partner_phone,
      partner_name,
      relationship,
      notification_preferences,
    } = req.body;

    // Validate required fields
    if (!user_id || !partner_phone || !partner_name || !relationship) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
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
        return res.status(409).json({
          success: false,
          error: 'Partner already added'
        });
      }

      return res.status(500).json({
        success: false,
        error: error.message
      });
    }

    return res.status(200).json({
      success: true,
      id: data.id,
      partner: data
    });
  } catch (error: any) {
    console.error('[Partners API] Unexpected error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}

/**
 * POST /api/partners/list
 * Get all partners for a user
 */
export async function listPartners(req: any, res: any) {
  try {
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: 'Missing user_id'
      });
    }

    const { data, error } = await supabase
      .from('accountability_partners')
      .select('*')
      .eq('user_id', user_id)
      .order('added_at', { ascending: false });

    if (error) {
      console.error('[Partners API] Error listing partners:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }

    return res.status(200).json(data || []);
  } catch (error: any) {
    console.error('[Partners API] Unexpected error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}

/**
 * POST /api/partners/find
 * Find a partner by phone number (for partner portal login)
 * This endpoint does NOT require authentication
 */
export async function findPartnerByPhone(req: any, res: any) {
  try {
    const { partner_phone } = req.body;

    if (!partner_phone) {
      return res.status(400).json({
        success: false,
        error: 'Missing partner_phone'
      });
    }

    // Clean phone number
    const cleanPhone = partner_phone.replace(/[\s\-\(\)]/g, '');

    const { data, error } = await supabase
      .from('accountability_partners')
      .select('*')
      .eq('partner_phone', cleanPhone)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows found
        return res.status(404).json({
          success: false,
          error: 'Phone number not found. Make sure you were added as an accountability partner.'
        });
      }

      console.error('[Partners API] Error finding partner:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }

    return res.status(200).json(data);
  } catch (error: any) {
    console.error('[Partners API] Unexpected error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}

/**
 * POST /api/partners/update
 * Update a partner's details
 */
export async function updatePartner(req: any, res: any) {
  try {
    const { partner_id, user_id, updates } = req.body;

    if (!partner_id || !user_id || !updates) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }

    // Verify partner belongs to user
    const { data: existingPartner } = await supabase
      .from('accountability_partners')
      .select('user_id')
      .eq('id', partner_id)
      .single();

    if (!existingPartner || existingPartner.user_id !== user_id) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized'
      });
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
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }

    return res.status(200).json({
      success: true,
      partner: data
    });
  } catch (error: any) {
    console.error('[Partners API] Unexpected error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}

/**
 * POST /api/partners/remove
 * Remove a partner
 */
export async function removePartner(req: any, res: any) {
  try {
    const { partner_id, user_id } = req.body;

    if (!partner_id || !user_id) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }

    // Verify partner belongs to user before deleting
    const { data: existingPartner } = await supabase
      .from('accountability_partners')
      .select('user_id')
      .eq('id', partner_id)
      .single();

    if (!existingPartner || existingPartner.user_id !== user_id) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized'
      });
    }

    // Delete partner
    const { error } = await supabase
      .from('accountability_partners')
      .delete()
      .eq('id', partner_id);

    if (error) {
      console.error('[Partners API] Error removing partner:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }

    return res.status(200).json({
      success: true
    });
  } catch (error: any) {
    console.error('[Partners API] Unexpected error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}

// =============================================================================
// EXPRESS ROUTE SETUP (Example)
// =============================================================================

/**
 * Example Express.js route setup
 *
 * In your backend server:
 *
 * import express from 'express';
 * import { addPartner, listPartners, findPartnerByPhone, updatePartner, removePartner } from './api/partners/endpoints';
 *
 * const app = express();
 * app.use(express.json());
 *
 * app.post('/api/partners/add', addPartner);
 * app.post('/api/partners/list', listPartners);
 * app.post('/api/partners/find', findPartnerByPhone);
 * app.post('/api/partners/update', updatePartner);
 * app.post('/api/partners/remove', removePartner);
 *
 * app.listen(3001, () => console.log('Server running on port 3001'));
 */
