/**
 * CAPTCHA Verification Middleware
 *
 * Integrates CAPTCHA verification for rate limit violations.
 * Supports both hCaptcha and reCAPTCHA.
 */

import { Request, Response, NextFunction } from 'express';
import { fetchWithTimeout } from '../utils/httpClient.js';

const CAPTCHA_SECRET_KEY = process.env.CAPTCHA_SECRET_KEY;
const CAPTCHA_PROVIDER = (process.env.CAPTCHA_PROVIDER || 'hcaptcha') as 'hcaptcha' | 'recaptcha';

interface CaptchaVerificationRequest extends Request {
  captchaToken?: string;
  captchaVerified?: boolean;
}

/**
 * Verify CAPTCHA token with provider
 */
export async function verifyCaptchaToken(token: string): Promise<boolean> {
  if (!CAPTCHA_SECRET_KEY) {
    console.warn('[CAPTCHA] No secret key configured, skipping verification');
    return true;
  }

  try {
    let verificationUrl: string;
    let payload: Record<string, string>;

    if (CAPTCHA_PROVIDER === 'hcaptcha') {
      verificationUrl = 'https://hcaptcha.com/siteverify';
      payload = {
        secret: CAPTCHA_SECRET_KEY,
        response: token,
      };
    } else {
      // reCAPTCHA
      verificationUrl = 'https://www.google.com/recaptcha/api/siteverify';
      payload = {
        secret: CAPTCHA_SECRET_KEY,
        response: token,
      };
    }

    const response = await fetchWithTimeout(verificationUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(payload).toString(),
      timeout: 10000, // 10 seconds for CAPTCHA verification
    });

    const data = await response.json() as any;

    if (CAPTCHA_PROVIDER === 'hcaptcha') {
      return data.success === true;
    } else {
      // reCAPTCHA
      return data.success === true && (data.score ?? 1) > 0.5;
    }
  } catch (error) {
    console.error('[CAPTCHA] Verification error:', error);
    return false;
  }
}

/**
 * Middleware to verify CAPTCHA if required
 * Checks for captcha token in request body or headers
 */
export async function requireCaptchaIfNeeded(
  req: CaptchaVerificationRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const captchaToken = req.body?.captchaToken || req.headers['x-captcha-token'];

  if (!captchaToken) {
    // CAPTCHA not provided - check if it's required
    const requiresCaptcha = req.body?.requiresCaptcha || (req as any).requiresCaptcha;

    if (requiresCaptcha) {
      res.status(403).json({
        success: false,
        error: 'CAPTCHA verification required',
        code: 'CAPTCHA_REQUIRED',
        requiresCaptcha: true,
        message: 'Please complete the CAPTCHA and retry',
      });
      return;
    }

    // CAPTCHA not required, proceed
    next();
    return;
  }

  try {
    const isValid = await verifyCaptchaToken(captchaToken as string);

    if (!isValid) {
      res.status(403).json({
        success: false,
        error: 'CAPTCHA verification failed',
        code: 'CAPTCHA_FAILED',
        requiresCaptcha: true,
        message: 'CAPTCHA verification failed, please try again',
      });
      return;
    }

    // CAPTCHA verified
    req.captchaVerified = true;
    next();
  } catch (error) {
    console.error('[CAPTCHA] Middleware error:', error);
    res.status(500).json({
      success: false,
      error: 'CAPTCHA verification error',
      code: 'CAPTCHA_ERROR',
    });
  }
}

/**
 * Helper to check if CAPTCHA is configured
 */
export function isCaptchaConfigured(): boolean {
  return !!CAPTCHA_SECRET_KEY;
}

/**
 * Get CAPTCHA provider name
 */
export function getCaptchaProvider(): string {
  return CAPTCHA_PROVIDER;
}

/**
 * Get CAPTCHA site key for frontend (from environment)
 */
export function getCaptchaSiteKey(): string | undefined {
  return process.env.CAPTCHA_SITE_KEY;
}
