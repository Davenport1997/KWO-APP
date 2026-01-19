/**
 * CSRF Protection Middleware
 *
 * Provides Cross-Site Request Forgery protection for state-changing operations.
 * Uses the double-submit cookie pattern since this is a mobile app API.
 *
 * For mobile apps, CSRF is less of a concern than web apps, but we implement
 * protection for any web-based access (admin panels, web views, etc.)
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

// CSRF token storage (use Redis in production)
const csrfTokens: Map<string, { token: string; userId: string; createdAt: Date }> = new Map();

// Token expiration time (1 hour)
const TOKEN_EXPIRY = 60 * 60 * 1000;

// Cleanup interval (every 30 minutes)
const CLEANUP_INTERVAL = 30 * 60 * 1000;

/**
 * Generate a new CSRF token for a user
 */
export function generateCSRFToken(userId: string): string {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenId = crypto.randomBytes(16).toString('hex');

  csrfTokens.set(tokenId, {
    token,
    userId,
    createdAt: new Date()
  });

  // Return combined token (id:token)
  return `${tokenId}:${token}`;
}

/**
 * Validate a CSRF token
 */
export function validateCSRFToken(fullToken: string, userId: string): boolean {
  if (!fullToken || !fullToken.includes(':')) {
    return false;
  }

  const [tokenId, token] = fullToken.split(':');
  const stored = csrfTokens.get(tokenId);

  if (!stored) {
    return false;
  }

  // Check if token matches and belongs to the user
  if (stored.token !== token || stored.userId !== userId) {
    return false;
  }

  // Check if token has expired
  if (Date.now() - stored.createdAt.getTime() > TOKEN_EXPIRY) {
    csrfTokens.delete(tokenId);
    return false;
  }

  return true;
}

/**
 * Invalidate a CSRF token (after use or on logout)
 */
export function invalidateCSRFToken(fullToken: string): void {
  if (!fullToken || !fullToken.includes(':')) {
    return;
  }

  const [tokenId] = fullToken.split(':');
  csrfTokens.delete(tokenId);
}

/**
 * Invalidate all CSRF tokens for a user
 */
export function invalidateAllUserCSRFTokens(userId: string): void {
  for (const [tokenId, data] of csrfTokens.entries()) {
    if (data.userId === userId) {
      csrfTokens.delete(tokenId);
    }
  }
}

/**
 * CSRF Protection Middleware
 *
 * Validates CSRF token for state-changing requests (POST, PUT, DELETE, PATCH).
 * Skips validation for:
 * - GET, HEAD, OPTIONS requests
 * - Requests with valid API key authentication (server-to-server)
 * - Mobile app requests (identified by custom header)
 */
export const csrfProtection = (req: Request, res: Response, next: NextFunction): void => {
  // Skip for safe HTTP methods
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    next();
    return;
  }

  // Skip for mobile app requests (they use JWT, not cookies)
  // Mobile apps should include X-Client-Type: mobile header
  const clientType = req.headers['x-client-type'];
  if (clientType === 'mobile' || clientType === 'ios' || clientType === 'android') {
    next();
    return;
  }

  // Skip for API key authenticated requests (server-to-server)
  if (req.headers['x-api-key']) {
    next();
    return;
  }

  // For web requests, validate CSRF token
  const csrfToken = req.headers['x-csrf-token'] as string;
  const userId = (req as any).user?.id;

  if (!userId) {
    // No user context, can't validate CSRF
    res.status(401).json({
      success: false,
      error: 'Authentication required',
      code: 'AUTH_REQUIRED'
    });
    return;
  }

  if (!csrfToken) {
    res.status(403).json({
      success: false,
      error: 'CSRF token missing',
      code: 'CSRF_MISSING'
    });
    return;
  }

  if (!validateCSRFToken(csrfToken, userId)) {
    console.warn('[SECURITY] CSRF validation failed:', {
      userId,
      ip: req.ip,
      endpoint: req.originalUrl,
      method: req.method
    });

    res.status(403).json({
      success: false,
      error: 'CSRF validation failed',
      code: 'CSRF_INVALID'
    });
    return;
  }

  next();
};

/**
 * Middleware to generate and attach CSRF token to response
 * Use on login/auth endpoints
 */
export const attachCSRFToken = (req: Request, res: Response, next: NextFunction): void => {
  const userId = (req as any).user?.id;

  if (userId) {
    const token = generateCSRFToken(userId);
    res.setHeader('X-CSRF-Token', token);
  }

  next();
};

/**
 * Cleanup expired tokens
 */
function cleanupExpiredTokens(): void {
  const now = Date.now();
  let cleaned = 0;

  for (const [tokenId, data] of csrfTokens.entries()) {
    if (now - data.createdAt.getTime() > TOKEN_EXPIRY) {
      csrfTokens.delete(tokenId);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    console.log(`[CSRF] Cleaned up ${cleaned} expired tokens`);
  }
}

// Start cleanup interval
setInterval(cleanupExpiredTokens, CLEANUP_INTERVAL);

/**
 * Get CSRF stats (for monitoring)
 */
export function getCSRFStats(): { totalTokens: number; oldestToken: Date | null } {
  let oldestToken: Date | null = null;

  for (const data of csrfTokens.values()) {
    if (!oldestToken || data.createdAt < oldestToken) {
      oldestToken = data.createdAt;
    }
  }

  return {
    totalTokens: csrfTokens.size,
    oldestToken
  };
}
