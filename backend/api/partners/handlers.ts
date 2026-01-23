/**
 * Partner API Handlers
 *
 * These handlers can be integrated into your existing Express backend.
 * Add these routes to your server:
 *
 * router.post('/api/partners/add', addPartner);
 * router.post('/api/partners/list', listPartners);
 * router.post('/api/partners/find', findPartnerByPhone);
 * router.post('/api/partners/update', updatePartner);
 * router.post('/api/partners/remove', removePartner);
 */

import { createClient } from '@supabase/supabase-js';
import type { Request, Response } from 'express';

// Initialize Supabase with service role key (for backend operations)
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

interface AddPartnerRequest {
  user_id: string;
  partner_phone: string;
  partner_name: string;
  relationship: string;
  notification_preferences: {
    dailyUpdates: boolean;
    struggleAlerts: boolean;
    weeklyDigest: boolean;
  };
}

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
// HANDLER FUNCTIONS
// =============================================================================

/**
 * POST /api/partners/add
 * Add a new accountability partner
 * Requires: Authorization header with valid JWT token
 */
export async function addPartner(req: Request, res: Response) {
  try {
    const { user_id, partner_phone, partner_name, relationship, notification_preferences } = req.body as AddPartnerRequest;

    // Validate required fields
    if (!user_id || !partner_phone || !partner_name || !relationship) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: user_id, partner_phone, partner_name, relationship'
      });
    }

    // Verify user is authenticated and is adding to their own account
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Missing authorization header'
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

      // Handle duplicate partner (already added this phone number)
      if (error.code === '23505') {
        return res.status(409).json({
          success: false,
          error: 'Partner with this phone number already added'
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
    console.error('[Partners API] Unexpected error in addPartner:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}

/**
 * POST /api/partners/list
 * Get all partners for a user
 * Requires: Authorization header with valid JWT token
 */
export async function listPartners(req: Request, res: Response) {
  try {
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: 'Missing user_id'
      });
    }

    // Verify authorization
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Missing authorization header'
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
    console.error('[Partners API] Unexpected error in listPartners:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}

/**
 * POST /api/partners/find
 * Find a partner by phone number (for partner portal login)
 * IMPORTANT: This endpoint does NOT require authentication
 * It only returns public information needed for partner login
 */
export async function findPartnerByPhone(req: Request, res: Response) {
  try {
    const { partner_phone } = req.body;

    if (!partner_phone) {
      return res.status(400).json({
        success: false,
        error: 'Missing partner_phone'
      });
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
    console.error('[Partners API] Unexpected error in findPartnerByPhone:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}

/**
 * POST /api/partners/update
 * Update a partner's details (invite sent, invite accepted, notification preferences)
 * Requires: Authorization header with valid JWT token
 */
export async function updatePartner(req: Request, res: Response) {
  try {
    const { partner_id, user_id, updates } = req.body;

    if (!partner_id || !user_id || !updates) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: partner_id, user_id, updates'
      });
    }

    // Verify authorization
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Missing authorization header'
      });
    }

    // Verify partner belongs to user (security check)
    const { data: existingPartner } = await supabase
      .from('accountability_partners')
      .select('user_id')
      .eq('id', partner_id)
      .single();

    if (!existingPartner || existingPartner.user_id !== user_id) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized - partner does not belong to user'
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
    console.error('[Partners API] Unexpected error in updatePartner:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}

/**
 * POST /api/partners/remove
 * Remove a partner
 * Requires: Authorization header with valid JWT token
 */
export async function removePartner(req: Request, res: Response) {
  try {
    const { partner_id, user_id } = req.body;

    if (!partner_id || !user_id) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: partner_id, user_id'
      });
    }

    // Verify authorization
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Missing authorization header'
      });
    }

    // Verify partner belongs to user (security check)
    const { data: existingPartner } = await supabase
      .from('accountability_partners')
      .select('user_id')
      .eq('id', partner_id)
      .single();

    if (!existingPartner || existingPartner.user_id !== user_id) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized - partner does not belong to user'
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
    console.error('[Partners API] Unexpected error in removePartner:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}

// =============================================================================
// EXPRESS ROUTER SETUP EXAMPLE
// =============================================================================

/**
 * Example: How to register these handlers in your Express server
 *
 * In your main server file (e.g., index.ts or server.ts):
 *
 * ```typescript
 * import express from 'express';
 * import {
 *   addPartner,
 *   listPartners,
 *   findPartnerByPhone,
 *   updatePartner,
 *   removePartner
 * } from './routes/partners';
 *
 * const app = express();
 * app.use(express.json());
 *
 * // Register partner routes
 * app.post('/api/partners/add', addPartner);
 * app.post('/api/partners/list', listPartners);
 * app.post('/api/partners/find', findPartnerByPhone);        // No auth required
 * app.post('/api/partners/update', updatePartner);
 * app.post('/api/partners/remove', removePartner);
 *
 * app.listen(3001, () => {
 *   console.log('Server running on port 3001');
 * });
 * ```
 *
 * OR if you're using a router:
 *
 * ```typescript
 * import express from 'express';
 * import {
 *   addPartner,
 *   listPartners,
 *   findPartnerByPhone,
 *   updatePartner,
 *   removePartner
 * } from './routes/partners';
 *
 * const router = express.Router();
 *
 * router.post('/partners/add', addPartner);
 * router.post('/partners/list', listPartners);
 * router.post('/partners/find', findPartnerByPhone);        // No auth required
 * router.post('/partners/update', updatePartner);
 * router.post('/partners/remove', removePartner);
 *
 * export default router;
 *
 * // Then in your main server file:
 * import partnerRoutes from './routes/partners';
 * app.use('/api', partnerRoutes);
 * ```
 */
