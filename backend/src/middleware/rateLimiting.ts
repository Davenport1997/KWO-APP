/**
 * Rate Limiting Configuration & Middleware
 *
 * Comprehensive rate limiting to prevent abuse:
 * - User-based limits (authenticated requests)
 * - IP-based limits (for unauthenticated or abuse scenarios)
 * - Graduated limits for premium vs free users
 * - Violation logging for fraud detection
 * - CAPTCHA integration for repeated violations
 */

import rateLimit from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';

// Store for tracking rate limit violations
interface RateLimitViolation {
  identifier: string; // IP or user ID
  violationType: string; // endpoint or action type
  timestamp: string;
  count: number;
  lastResetTime: string;
}

const violations: Map<string, RateLimitViolation> = new Map();

// Configuration for different limit scenarios
export const RATE_LIMIT_CONFIG = {
  // Authentication endpoints
  login: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts
    skipSuccessfulRequests: true,
    message: 'Too many login attempts, please try again later',
  },
  signup: {
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // 3 attempts per IP per hour
    message: 'Too many account creation attempts, please try again later',
  },

  // AI Endpoints
  aiChat: {
    freeUser: {
      windowMs: 60 * 60 * 1000, // 1 hour
      max: 20, // 20 messages per hour for free users
    },
    premiumUser: {
      windowMs: 60 * 60 * 1000,
      max: 100, // 100 messages per hour for premium users
    },
  },
  aiVoice: {
    freeUser: {
      windowMs: 24 * 60 * 60 * 1000, // 1 day
      max: 3, // 3 voice calls per day for free users
    },
    premiumUser: {
      windowMs: 24 * 60 * 60 * 1000,
      max: 10, // 10 voice calls per day for premium users
    },
  },
  aiGeneration: {
    freeUser: {
      windowMs: 60 * 60 * 1000, // 1 hour
      max: 10, // 10 generations per hour
    },
    premiumUser: {
      windowMs: 60 * 60 * 1000,
      max: 50, // 50 generations per hour
    },
  },

  // User Actions
  checkin: {
    windowMs: 24 * 60 * 60 * 1000, // 1 day
    max: 4, // 4 check-ins per day (morning, afternoon, evening, night)
  },
  challenges: {
    windowMs: 24 * 60 * 60 * 1000, // 1 day
    max: 10, // 10 challenge completions per day
  },
  microWins: {
    windowMs: 24 * 60 * 60 * 1000, // 1 day
    max: 3, // 3 micro-wins per day
  },
  imageUpload: {
    windowMs: 24 * 60 * 60 * 1000, // 1 day
    max: 20, // 20 images per day per user
    fileSize: 5 * 1024 * 1024, // 5MB per file
  },
  voiceRecording: {
    freeUser: {
      windowMs: 24 * 60 * 60 * 1000, // 1 day
      max: 10, // 10 recordings per day
    },
    premiumUser: {
      windowMs: 24 * 60 * 60 * 1000,
      max: 50, // 50 recordings per day
    },
  },

  // Community & Social
  communityPost: {
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // 3 posts per hour
  },
  communityComment: {
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // 10 comments per hour
  },
};

/**
 * Track rate limit violations for abuse detection
 */
export function trackViolation(
  identifier: string,
  violationType: string
): void {
  const key = `${identifier}:${violationType}`;
  const now = new Date().toISOString();

  if (violations.has(key)) {
    const violation = violations.get(key)!;
    violation.count++;
    violation.timestamp = now;
  } else {
    violations.set(key, {
      identifier,
      violationType,
      timestamp: now,
      count: 1,
      lastResetTime: now,
    });
  }

  // Log violation
  console.warn(`[RATE_LIMIT] Violation: ${identifier} - ${violationType} (count: ${violations.get(key)!.count})`);

  // Track repeated violations
  if (violations.get(key)!.count >= 3) {
    console.error(`[ABUSE_ALERT] Repeated violations: ${identifier} for ${violationType}`);
    // In production, trigger CAPTCHA or temporary block
  }
}

/**
 * Get current violation count for an identifier
 */
export function getViolationCount(identifier: string, violationType: string): number {
  const key = `${identifier}:${violationType}`;
  const violation = violations.get(key);
  return violation ? violation.count : 0;
}

/**
 * Get all violations (admin only)
 */
export function getAllViolations(): RateLimitViolation[] {
  return Array.from(violations.values());
}

/**
 * Clear old violations (run periodically)
 */
export function clearOldViolations(olderThanHours: number = 24): void {
  const cutoffTime = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);

  for (const [key, violation] of violations.entries()) {
    if (new Date(violation.lastResetTime) < cutoffTime) {
      violations.delete(key);
    }
  }
}

/**
 * Create rate limiters for different endpoints
 */

// Authentication limiters
export const loginLimiter = rateLimit({
  windowMs: RATE_LIMIT_CONFIG.login.windowMs,
  max: RATE_LIMIT_CONFIG.login.max,
  skipSuccessfulRequests: RATE_LIMIT_CONFIG.login.skipSuccessfulRequests,
  message: RATE_LIMIT_CONFIG.login.message,
  standardHeaders: true, // Return info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  handler: (req: Request, res: Response) => {
    const ip = getClientIP(req);
    trackViolation(ip, 'login');

    res.status(429).json({
      success: false,
      error: RATE_LIMIT_CONFIG.login.message,
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: RATE_LIMIT_CONFIG.login.windowMs / 1000,
    });
  },
});

export const signupLimiter = rateLimit({
  windowMs: RATE_LIMIT_CONFIG.signup.windowMs,
  max: RATE_LIMIT_CONFIG.signup.max,
  message: RATE_LIMIT_CONFIG.signup.message,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    const ip = getClientIP(req);
    trackViolation(ip, 'signup');

    res.status(429).json({
      success: false,
      error: RATE_LIMIT_CONFIG.signup.message,
      code: 'RATE_LIMIT_EXCEEDED',
      requiresCaptcha: getViolationCount(ip, 'signup') >= 2,
      retryAfter: RATE_LIMIT_CONFIG.signup.windowMs / 1000,
    });
  },
});

/**
 * Middleware factories for user-based rate limiting
 */

/**
 * Create AI chat rate limiter (based on user tier)
 */
export function createAIChatLimiter(isPremium: boolean = false) {
  const config = isPremium
    ? RATE_LIMIT_CONFIG.aiChat.premiumUser
    : RATE_LIMIT_CONFIG.aiChat.freeUser;

  return rateLimit({
    windowMs: config.windowMs,
    max: config.max,
    message: `AI chat limit exceeded (${config.max} per hour)`,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req: Request, res: Response) => {
      const userId = req.user?.id || getClientIP(req);
      trackViolation(userId, 'ai_chat');

      res.status(429).json({
        success: false,
        error: `You've reached your chat limit (${config.max} per hour)`,
        code: 'RATE_LIMIT_EXCEEDED',
        tier: isPremium ? 'premium' : 'free',
        retryAfter: config.windowMs / 1000,
        message: isPremium
          ? 'Please upgrade for higher limits'
          : 'Upgrade to premium for 100 messages/hour',
      });
    },
  });
}

/**
 * Create AI voice rate limiter
 */
export function createAIVoiceLimiter(isPremium: boolean = false) {
  const config = isPremium
    ? RATE_LIMIT_CONFIG.aiVoice.premiumUser
    : RATE_LIMIT_CONFIG.aiVoice.freeUser;

  return rateLimit({
    windowMs: config.windowMs,
    max: config.max,
    message: `Voice call limit exceeded (${config.max} per day)`,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req: Request, res: Response) => {
      const userId = req.user?.id || getClientIP(req);
      trackViolation(userId, 'ai_voice');

      res.status(429).json({
        success: false,
        error: `Voice call limit reached (${config.max} per day)`,
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: config.windowMs / 1000,
      });
    },
  });
}

/**
 * Create user action rate limiter (check-ins, challenges, etc.)
 */
export function createActionLimiter(
  actionType: 'checkin' | 'challenge' | 'micro_win' | 'image' | 'voice_recording',
  isPremium: boolean = false
) {
  const configKey = {
    checkin: 'checkin',
    challenge: 'challenges',
    micro_win: 'microWins',
    image: 'imageUpload',
    voice_recording: 'voiceRecording',
  }[actionType];

  let config: any = RATE_LIMIT_CONFIG[configKey as keyof typeof RATE_LIMIT_CONFIG];

  // Some actions have different limits for premium users
  if (typeof config === 'object' && config.freeUser && config.premiumUser) {
    config = isPremium ? config.premiumUser : config.freeUser;
  }

  return rateLimit({
    windowMs: config.windowMs,
    max: config.max,
    message: `${actionType} limit exceeded`,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req: Request, res: Response) => {
      const userId = req.user?.id || getClientIP(req);
      trackViolation(userId, actionType);

      res.status(429).json({
        success: false,
        error: `You've exceeded your ${actionType} limit (${config.max} per day)`,
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: config.windowMs / 1000,
        unlockAt: new Date(Date.now() + config.windowMs).toISOString(),
      });
    },
  });
}

/**
 * Helper: Get client IP from request
 */
function getClientIP(req: Request): string {
  return (
    (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ||
    (req.headers['x-real-ip'] as string) ||
    req.socket.remoteAddress ||
    'unknown'
  );
}

/**
 * Middleware to add client IP to request object
 */
export function ipMiddleware(req: Request, res: Response, next: NextFunction): void {
  (req as any).clientIP = getClientIP(req);
  next();
}

/**
 * Admin whitelist middleware
 */
interface AdminWhitelist {
  ips: string[];
  lastUpdated: string;
}

let adminWhitelist: AdminWhitelist = {
  ips: process.env.ADMIN_WHITELIST_IPS?.split(',').map((ip) => ip.trim()) || [],
  lastUpdated: new Date().toISOString(),
};

export function isAdminIP(ip: string): boolean {
  return adminWhitelist.ips.includes(ip);
}

export function addAdminIP(ip: string): void {
  if (!adminWhitelist.ips.includes(ip)) {
    adminWhitelist.ips.push(ip);
    adminWhitelist.lastUpdated = new Date().toISOString();
    console.log(`[ADMIN_WHITELIST] Added IP: ${ip}`);
  }
}

export function removeAdminIP(ip: string): void {
  adminWhitelist.ips = adminWhitelist.ips.filter((whitelistedIP) => whitelistedIP !== ip);
  adminWhitelist.lastUpdated = new Date().toISOString();
  console.log(`[ADMIN_WHITELIST] Removed IP: ${ip}`);
}

export function getAdminWhitelist(): AdminWhitelist {
  return adminWhitelist;
}

/**
 * Bypass rate limit for admin IPs
 */
export function bypassRateLimitForAdmin(req: Request, res: Response, next: NextFunction): void {
  const ip = (req as any).clientIP || getClientIP(req);

  if (isAdminIP(ip)) {
    // Skip rate limiting for whitelisted admins
    console.log(`[RATE_LIMIT] Bypassed for admin IP: ${ip}`);
  }

  next();
}
