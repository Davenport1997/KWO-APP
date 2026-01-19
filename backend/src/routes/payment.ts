import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const router = Router();

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || '';
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

// Mock user subscriptions (for when Supabase is not available)
const userSubscriptions: Record<string, {
  user_id: string;
  subscription_id: string;
  status: 'active' | 'canceled' | 'expired';
  plan_type: 'monthly' | 'annual';
  started_at: string;
  expires_at: string;
}> = {};

/**
 * POST /payment/webhook
 * Handle RevenueCat webhook events (no auth required - but signature verified)
 * Returns: { success }
 */
router.post('/webhook', async (req: Request, res: Response): Promise<void> => {
  try {
    // Verify webhook signature
    const signature = req.headers['x-revenuecat-signature'] as string;
    const body = JSON.stringify(req.body);

    if (!verifyWebhookSignature(body, signature)) {
      res.status(401).json({
        success: false,
        error: 'Invalid webhook signature',
        code: 'INVALID_SIGNATURE'
      });
      return;
    }

    const { event, data } = req.body;

    // Log webhook event
    console.log(`[RevenueCat Webhook] Received event: ${event?.type} for user ${data?.app_user_id}`);

    // Handle different event types
    switch (event?.type) {
      case 'INITIAL_PURCHASE':
        await handleInitialPurchase(data);
        break;
      case 'RENEWAL':
        await handleRenewal(data);
        break;
      case 'REACTIVATION':
        await handleReactivation(data);
        break;
      case 'CANCELLATION':
        await handleCancellation(data);
        break;
      case 'EXPIRATION':
        await handleExpiration(data);
        break;
      default:
        console.log('Unknown event type:', event?.type);
    }

    res.json({
      success: true,
      message: 'Webhook processed successfully'
    });
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process webhook',
      code: 'WEBHOOK_ERROR'
    });
  }
});

/**
 * GET /payment/subscriptions/:userId
 * Get user subscription status
 * Returns: { subscription data }
 */
router.get('/subscriptions/:userId', (req: Request, res: Response): void => {
  try {
    const { userId } = req.params;

    const subscription = userSubscriptions[userId];

    if (!subscription) {
      res.json({
        success: true,
        data: {
          user_id: userId,
          has_active_subscription: false,
          subscription: null
        }
      });
      return;
    }

    res.json({
      success: true,
      data: {
        user_id: userId,
        has_active_subscription: subscription.status === 'active',
        subscription
      }
    });
  } catch (error) {
    console.error('Get subscription error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get subscription',
      code: 'SUBSCRIPTION_ERROR'
    });
  }
});

/**
 * POST /payment/test-webhook
 * Test webhook endpoint (development only)
 * Sends test payload to verify webhook integration
 */
router.post('/test-webhook', (req: Request, res: Response): void => {
  try {
    const testPayload = {
      event: {
        type: 'INITIAL_PURCHASE',
        id: `test_${Date.now()}`
      },
      data: {
        app_user_id: 'test_user_123',
        product_id: '$rc_monthly',
        purchase_date: new Date().toISOString(),
        expiration_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        original_transaction_id: 'test_transaction_123'
      }
    };

    res.json({
      success: true,
      message: 'Test webhook would process the following payload',
      payload: testPayload
    });
  } catch (error) {
    console.error('Test webhook error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate test webhook',
      code: 'TEST_ERROR'
    });
  }
});

// Helper functions

function verifyWebhookSignature(body: string, signature: string): boolean {
  // In production, use your actual RevenueCat webhook secret
  const webhookSecret = process.env.REVENUECAT_WEBHOOK_SECRET || 'test-secret';

  // RevenueCat uses SHA256 HMAC
  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(body)
    .digest('hex');

  // Compare signatures (constant-time to prevent timing attacks)
  return crypto.timingSafeEqual(
    Buffer.from(signature || ''),
    Buffer.from(expectedSignature)
  );
}

/**
 * Update user subscription status in Supabase
 */
async function updateUserSubscriptionStatus(
  userId: string,
  status: 'active' | 'expired' | 'cancelled'
): Promise<void> {
  if (!supabase) {
    console.warn('[Payment] Supabase not configured, skipping subscription status update');
    return;
  }

  try {
    const { error } = await supabase
      .from('auth')
      .update({
        subscription_status: status,
        updated_at: new Date().toISOString(),
      })
      .eq('email', userId); // Assuming userId is email in auth table

    if (error) {
      console.error(`[Payment] Failed to update subscription status for ${userId}:`, error);
    } else {
      console.log(`[Payment] Updated subscription status for ${userId} to ${status}`);
    }
  } catch (err) {
    console.error('[Payment] Error updating subscription status:', err);
  }
}

async function handleInitialPurchase(data: any): Promise<void> {
  const { app_user_id, product_id, purchase_date, expiration_date } = data;

  const planType = product_id.includes('annual') ? 'annual' : 'monthly';

  // Update in-memory store
  userSubscriptions[app_user_id] = {
    user_id: app_user_id,
    subscription_id: `sub_${Date.now()}`,
    status: 'active',
    plan_type: planType,
    started_at: purchase_date,
    expires_at: expiration_date
  };

  // Update database
  await updateUserSubscriptionStatus(app_user_id, 'active');

  console.log(`✓ New subscription created for user ${app_user_id} (${planType})`);
}

async function handleRenewal(data: any): Promise<void> {
  const { app_user_id, expiration_date } = data;

  if (userSubscriptions[app_user_id]) {
    userSubscriptions[app_user_id].expires_at = expiration_date;
  }

  // Update database
  await updateUserSubscriptionStatus(app_user_id, 'active');

  console.log(`✓ Subscription renewed for user ${app_user_id}`);
}

/**
 * Handle subscription reactivation (user resubscribes after cancellation)
 */
async function handleReactivation(data: any): Promise<void> {
  const { app_user_id, product_id, purchase_date, expiration_date } = data;

  const planType = product_id.includes('annual') ? 'annual' : 'monthly';

  // Update in-memory store
  if (userSubscriptions[app_user_id]) {
    userSubscriptions[app_user_id].status = 'active';
    userSubscriptions[app_user_id].plan_type = planType;
    userSubscriptions[app_user_id].started_at = purchase_date;
    userSubscriptions[app_user_id].expires_at = expiration_date;
  }

  // Update database
  await updateUserSubscriptionStatus(app_user_id, 'active');

  console.log(`✓ Subscription reactivated for user ${app_user_id}`);
}

async function handleCancellation(data: any): Promise<void> {
  const { app_user_id } = data;

  if (userSubscriptions[app_user_id]) {
    userSubscriptions[app_user_id].status = 'canceled';
  }

  // Update database
  await updateUserSubscriptionStatus(app_user_id, 'cancelled');

  console.log(`✓ Subscription cancelled for user ${app_user_id} (access until expiration)`);
}

async function handleExpiration(data: any): Promise<void> {
  const { app_user_id } = data;

  if (userSubscriptions[app_user_id]) {
    userSubscriptions[app_user_id].status = 'expired';
  }

  // Update database
  await updateUserSubscriptionStatus(app_user_id, 'expired');

  console.log(`✓ Subscription expired for user ${app_user_id} (app access locked)`);
}

export default router;
