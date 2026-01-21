/**
 * Webhook Routes - RevenueCat Event Handlers
 *
 * This module handles incoming webhooks from RevenueCat
 * to update subscription status in real-time
 *
 * Events handled:
 * - INITIAL_PURCHASE: New subscription
 * - RENEWAL: Subscription renewed
 * - CANCELLATION: User cancelled (access continues until period end)
 * - EXPIRATION: Subscription expired
 * - REACTIVATION: User reactivated cancelled subscription
 * - BILLING_ISSUE: Payment failed
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
// FIXED: Remove .js extension from import
import { supabase } from '../db';

const router = Router();

// RevenueCat webhook signing secret - must be set in environment
const REVENUECAT_WEBHOOK_SECRET = process.env.REVENUECAT_WEBHOOK_SECRET;

/**
 * Verify RevenueCat webhook signature
 * RevenueCat signs webhooks with X-RevenueCat-Signature header
 */
function verifyWebhookSignature(
  body: string,
  signature: string | undefined
): boolean {
  if (!REVENUECAT_WEBHOOK_SECRET || !signature) {
    console.warn('[Webhook] Missing webhook secret or signature');
    return false;
  }

  try {
    // RevenueCat uses SHA256 HMAC
    const hash = crypto
      .createHmac('sha256', REVENUECAT_WEBHOOK_SECRET)
      .update(body)
      .digest('hex');

    // Signature format: sha256=<hex>
    const expectedSignature = `sha256=${hash}`;
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch (error) {
    console.error('[Webhook] Signature verification error:', error);
    return false;
  }
}

/**
 * Update user's subscription status in Supabase
 */
async function updateSubscriptionStatus(
  userId: string,
  status: 'trial' | 'active' | 'expired' | 'cancelled',
  data?: {
    subscription_id?: string;
    subscribed_at?: string;
    trial_end_date?: string;
  }
): Promise<boolean> {
  try {
    const updateData: Record<string, unknown> = {
      subscription_status: status,
      updated_at: new Date().toISOString(),
    };

    // Only update provided fields
    if (data?.subscription_id) {
      updateData.subscription_id = data.subscription_id;
    }
    if (data?.subscribed_at) {
      updateData.subscribed_at = data.subscribed_at;
    }
    if (data?.trial_end_date) {
      updateData.trial_end_date = data.trial_end_date;
    }

    const { error } = await supabase
      .from('user_profiles')
      .update(updateData)
      .eq('user_id', userId);

    if (error) {
      console.error('[Webhook] Error updating subscription status:', error);
      return false;
    }

    console.log(`[Webhook] Updated ${userId} subscription status to "${status}"`);
    return true;
  } catch (error) {
    console.error('[Webhook] Exception updating subscription status:', error);
    return false;
  }
}

/**
 * POST /webhooks/revenuecat
 * Handle RevenueCat webhook events
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    // Get raw body for signature verification
    const rawBody = JSON.stringify(req.body);
    const signature = req.headers['x-revenuecat-signature'] as string;

    // Verify webhook signature
    if (!verifyWebhookSignature(rawBody, signature)) {
      console.warn('[Webhook] Invalid signature - rejecting webhook');
      res.status(401).json({
        success: false,
        error: 'Invalid signature',
      });
      return;
    }

    const event = req.body;
    const type = event.event?.type;
    const subscriber = event.event?.subscriber_attributes || event.event?.app_user_id;

    if (!type || !subscriber) {
      console.warn('[Webhook] Missing event type or subscriber info');
      res.status(400).json({
        success: false,
        error: 'Missing required fields',
      });
      return;
    }

    const userId = event.event?.app_user_id || subscriber;
    const productId = event.event?.product_id;

    console.log(`[Webhook] Received event: ${type} for user: ${userId}`);

    let updateSuccess = false;

    switch (type) {
      /**
       * INITIAL_PURCHASE: User subscribed for the first time
       */
      case 'INITIAL_PURCHASE':
        updateSuccess = await updateSubscriptionStatus(userId, 'active', {
          subscription_id: event.event?.transaction_id || productId,
          subscribed_at: event.event?.purchased_at || new Date().toISOString(),
        });
        console.log(`[Webhook] ${userId} initiated purchase: ${productId}`);
        break;

      /**
       * RENEWAL: Subscription automatically renewed
       */
      case 'RENEWAL':
        updateSuccess = await updateSubscriptionStatus(userId, 'active', {
          subscription_id: event.event?.transaction_id || productId,
          subscribed_at: event.event?.purchased_at || new Date().toISOString(),
        });
        console.log(`[Webhook] ${userId} subscription renewed: ${productId}`);
        break;

      /**
       * CANCELLATION: User cancelled subscription
       * NOTE: Access continues until current period ends
       */
      case 'CANCELLATION':
        updateSuccess = await updateSubscriptionStatus(userId, 'cancelled');
        console.log(`[Webhook] ${userId} cancelled subscription`);
        // Access continues until period end - app doesn't lock yet
        break;

      /**
       * EXPIRATION: Subscription period ended
       * Lock app on next open
       */
      case 'EXPIRATION':
        updateSuccess = await updateSubscriptionStatus(userId, 'expired');
        console.log(`[Webhook] ${userId} subscription expired`);
        // App will show paywall-locked on next app open
        break;

      /**
       * REACTIVATION: User reactivated cancelled subscription
       */
      case 'REACTIVATION':
        updateSuccess = await updateSubscriptionStatus(userId, 'active', {
          subscription_id: event.event?.transaction_id || productId,
          subscribed_at: event.event?.purchased_at || new Date().toISOString(),
        });
        console.log(`[Webhook] ${userId} reactivated subscription`);
        break;

      /**
       * BILLING_ISSUE: Payment failed
       * Keep current status, app will retry at next renewal
       */
      case 'BILLING_ISSUE':
        console.log(
          `[Webhook] Billing issue for ${userId}: ${event.event?.reason || 'unknown'}`
        );
        // Don't change status - let subscriptionSync catch this on next app open
        updateSuccess = true;
        break;

      /**
       * SUBSCRIPTION_PAUSED: User paused subscription
       */
      case 'SUBSCRIPTION_PAUSED':
        console.log(`[Webhook] ${userId} paused subscription`);
        updateSuccess = true;
        // Could set custom 'paused' status if needed
        break;

      /**
       * TRIAL_STARTED: Trial started
       */
      case 'TRIAL_STARTED':
        updateSuccess = await updateSubscriptionStatus(userId, 'trial', {
          subscription_id: productId,
          trial_end_date: event.event?.expires_date || new Date(
            Date.now() + 15 * 24 * 60 * 60 * 1000
          ).toISOString(),
        });
        console.log(`[Webhook] ${userId} started trial`);
        break;

      /**
       * TRIAL_CONVERTED: Trial converted to paid subscription
       */
      case 'TRIAL_CONVERTED':
        updateSuccess = await updateSubscriptionStatus(userId, 'active', {
          subscription_id: event.event?.transaction_id || productId,
          subscribed_at: event.event?.purchased_at || new Date().toISOString(),
        });
        console.log(`[Webhook] ${userId} converted trial to paid subscription`);
        break;

      default:
        console.log(`[Webhook] Unhandled event type: ${type}`);
        updateSuccess = true; // Still acknowledge the webhook
    }

    // Always respond with 200 to acknowledge webhook received
    // RevenueCat will retry if we don't respond
    res.json({
      success: true,
      processed: updateSuccess,
      event_type: type,
      user_id: userId,
    });
  } catch (error) {
    console.error('[Webhook] Error processing webhook:', error);
    // Return 200 anyway to prevent RevenueCat retries on server errors
    res.status(200).json({
      success: false,
      error: 'Processing error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /webhooks/revenuecat/status
 * Check if webhook handler is configured
 */
router.get('/status', (req: Request, res: Response): void => {
  res.json({
    success: true,
    data: {
      configured: !!REVENUECAT_WEBHOOK_SECRET,
      message: REVENUECAT_WEBHOOK_SECRET
        ? 'Webhook handler configured'
        : 'Webhook handler NOT configured - set REVENUECAT_WEBHOOK_SECRET',
    },
  });
});

export default router;
