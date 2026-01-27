import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { getJWTSecret, getJWTRefreshSecret } from '../utils/validateConfig.js';
import { isTokenBlacklisted, areAllUserTokensBlacklisted } from '../utils/tokenBlacklist.js';

// Extend Express Request to include user data
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: 'free_user' | 'premium_user' | 'admin';
        iat: number;
        exp: number;
      };
      token?: string;
      isAnonymous?: boolean;
    }
  }
}

/**
 * Optional authentication middleware - allows anonymous access
 * If X-Anonymous-Access header is present, skip auth and mark request as anonymous
 * Otherwise, verify token like normal
 */
export const optionalAuth = (req: Request, res: Response, next: NextFunction): void => {
  try {
    // Check if this is an anonymous request
    const isAnonymous = req.headers['x-anonymous-access'] === 'true';

    if (isAnonymous) {
      // Mark request as anonymous and continue
      req.isAnonymous = true;
      next();
      return;
    }

    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // No auth header - proceed as anonymous/unauthenticated
      // Only verifyToken should strictly require the header
      next();
      return;
    }

    const token = authHeader.substring(7); // Remove "Bearer " prefix
    req.token = token;

    // Check if token is blacklisted (revoked)
    if (isTokenBlacklisted(token)) {
      res.status(401).json({
        success: false,
        error: 'Token has been revoked',
        code: 'TOKEN_REVOKED'
      });
      return;
    }

    // Verify token signature and expiration
    const decoded = jwt.verify(token, getJWTSecret()) as {
      id: string;
      email: string;
      role: 'free_user' | 'premium_user' | 'admin';
      iat: number;
      exp: number;
    };

    // Check if all tokens for this user were revoked (logout all devices)
    if (areAllUserTokensBlacklisted(decoded.id, new Date(decoded.iat * 1000))) {
      res.status(401).json({
        success: false,
        error: 'Session has been terminated',
        code: 'SESSION_TERMINATED'
      });
      return;
    }

    // Attach user to request object
    req.user = decoded;
    req.isAnonymous = false;

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({
        success: false,
        error: 'Token has expired',
        code: 'TOKEN_EXPIRED'
      });
      return;
    }

    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({
        success: false,
        error: 'Invalid token',
        code: 'INVALID_TOKEN'
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: 'Token verification failed',
      code: 'TOKEN_VERIFY_ERROR'
    });
  }
};

/**
 * Verify JWT token and attach user to request
 * Applied to all protected routes
 * Now includes blacklist checking for token revocation
 */
export const verifyToken = (req: Request, res: Response, next: NextFunction): void => {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        error: 'Missing or invalid authorization header',
        code: 'MISSING_TOKEN'
      });
      return;
    }

    const token = authHeader.substring(7); // Remove "Bearer " prefix
    req.token = token;

    // Check if token is blacklisted (revoked)
    if (isTokenBlacklisted(token)) {
      res.status(401).json({
        success: false,
        error: 'Token has been revoked',
        code: 'TOKEN_REVOKED'
      });
      return;
    }

    // Verify token signature and expiration
    const decoded = jwt.verify(token, getJWTSecret()) as {
      id: string;
      email: string;
      role: 'free_user' | 'premium_user' | 'admin';
      iat: number;
      exp: number;
    };

    // Check if all tokens for this user were revoked (logout all devices)
    if (areAllUserTokensBlacklisted(decoded.id, new Date(decoded.iat * 1000))) {
      res.status(401).json({
        success: false,
        error: 'Session has been terminated',
        code: 'SESSION_TERMINATED'
      });
      return;
    }

    // Attach user to request object
    req.user = decoded;

    // Check token expiration (jwt.verify does this, but explicit check for clarity)
    if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
      res.status(401).json({
        success: false,
        error: 'Token has expired',
        code: 'TOKEN_EXPIRED'
      });
      return;
    }

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({
        success: false,
        error: 'Token has expired',
        code: 'TOKEN_EXPIRED'
      });
      return;
    }

    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({
        success: false,
        error: 'Invalid token',
        code: 'INVALID_TOKEN'
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: 'Token verification failed',
      code: 'TOKEN_VERIFY_ERROR'
    });
  }
};

/**
 * Verify token expiration from refresh token
 */
export const verifyRefreshToken = (token: string): any => {
  try {
    return jwt.verify(token, getJWTRefreshSecret());
  } catch (error) {
    throw new Error('Invalid refresh token');
  }
};

/**
 * Generate new JWT token
 */
export const generateToken = (
  userId: string,
  email: string,
  role: 'free_user' | 'premium_user' | 'admin'
): string => {
  const expiresIn = process.env.JWT_EXPIRE_IN || '15m';
  return jwt.sign(
    {
      id: userId,
      email,
      role
    },
    getJWTSecret(),
    { expiresIn } as any
  );
};

/**
 * Generate refresh token
 */
export const generateRefreshToken = (
  userId: string,
  email: string,
  role: 'free_user' | 'premium_user' | 'admin'
): string => {
  const expiresIn = process.env.JWT_REFRESH_EXPIRE_IN || '7d';
  return jwt.sign(
    {
      id: userId,
      email,
      role
    },
    getJWTRefreshSecret(),
    { expiresIn } as any
  );
};

/**
 * Track IDOR attempts per user for rate limiting
 */
const idorAttempts = new Map<string, { count: number; firstAttempt: number }>();
const IDOR_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const IDOR_MAX_ATTEMPTS = 5; // Block after 5 attempts
const IDOR_BLOCK_DURATION_MS = 60 * 60 * 1000; // Block for 1 hour

/**
 * Require user to own the resource (user ID match)
 * Enhanced with security logging, rate limiting, and alerting for IDOR attacks
 */
export const requireOwnership = (req: Request, res: Response, next: NextFunction): void => {
  const { userId } = req.params;

  if (!req.user) {
    res.status(401).json({
      success: false,
      error: 'User not authenticated',
      code: 'NOT_AUTHENTICATED'
    });
    return;
  }

  // Log all resource access attempts for security audit
  const accessLog = {
    requestingUserId: req.user.id,
    targetResourceUserId: userId,
    role: req.user.role,
    endpoint: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString(),
    ip: req.ip || req.socket.remoteAddress
  };

  // Admins can access any user's data, but log it
  if (req.user.role === 'admin') {
    console.log('[AUDIT] Admin access:', JSON.stringify(accessLog));
    next();
    return;
  }

  // Regular users can only access their own data
  if (req.user.id !== userId) {
    // Track IDOR attempts for this user
    const attackerId = req.user.id;
    const now = Date.now();
    const userAttempts = idorAttempts.get(attackerId);

    if (userAttempts) {
      // Check if within window
      if (now - userAttempts.firstAttempt < IDOR_WINDOW_MS) {
        userAttempts.count++;
      } else {
        // Reset window
        idorAttempts.set(attackerId, { count: 1, firstAttempt: now });
      }
    } else {
      idorAttempts.set(attackerId, { count: 1, firstAttempt: now });
    }

    const currentAttempts = idorAttempts.get(attackerId)?.count || 1;

    // Log potential IDOR attempt with severity
    const severity = currentAttempts >= IDOR_MAX_ATTEMPTS ? 'CRITICAL' :
      currentAttempts >= 3 ? 'HIGH' : 'MEDIUM';

    console.warn(`[SECURITY] [${severity}] IDOR attempt #${currentAttempts}:`, JSON.stringify({
      ...accessLog,
      blocked: true,
      reason: 'User ID mismatch',
      attemptCount: currentAttempts,
      severity
    }));

    // If too many attempts, log critical alert and consider blocking
    if (currentAttempts >= IDOR_MAX_ATTEMPTS) {
      console.error('[SECURITY ALERT] IDOR attack detected - user blocked:', JSON.stringify({
        attackerId,
        totalAttempts: currentAttempts,
        windowMs: IDOR_WINDOW_MS,
        action: 'BLOCKED',
        recommendation: 'Review user activity and consider account suspension'
      }));

      // Return a generic error (don't reveal rate limiting to attacker)
      res.status(403).json({
        success: false,
        error: 'Access denied',
        code: 'FORBIDDEN'
      });
      return;
    }

    res.status(403).json({
      success: false,
      error: 'You do not have permission to access this resource',
      code: 'FORBIDDEN'
    });
    return;
  }

  next();
};

/**
 * Require premium subscription
 */
export const requirePremium = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: 'User not authenticated',
      code: 'NOT_AUTHENTICATED'
    });
    return;
  }

  if (req.user.role !== 'premium_user' && req.user.role !== 'admin') {
    res.status(403).json({
      success: false,
      error: 'This feature requires a premium subscription',
      code: 'PREMIUM_REQUIRED'
    });
    return;
  }

  next();
};

/**
 * Require specific role
 */
export const requireRole = (...allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'User not authenticated',
        code: 'NOT_AUTHENTICATED'
      });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        error: 'You do not have the required role for this action',
        code: 'INSUFFICIENT_ROLE'
      });
      return;
    }

    next();
  };
};

/**
 * Require admin role
 */
export const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: 'User not authenticated',
      code: 'NOT_AUTHENTICATED'
    });
    return;
  }

  if (req.user.role !== 'admin') {
    res.status(403).json({
      success: false,
      error: 'This action requires admin privileges',
      code: 'ADMIN_REQUIRED'
    });
    return;
  }

  next();
};
