/**
 * Account Recovery Service
 * Handles password reset, security questions, and 2FA
 */

import crypto from 'crypto';

export interface SecurityQuestion {
  id: string;
  question: string;
  answer: string; // Hashed
}

export interface TwoFactorConfig {
  enabled: boolean;
  method: 'email' | 'sms' | 'authenticator';
  secret?: string; // For authenticator apps
  backupCodes?: string[];
  verifiedAt?: Date;
}

export interface PasswordResetToken {
  token: string;
  tokenHash: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  used: boolean;
  usedAt?: Date;
}

export interface TwoFactorVerification {
  code: string;
  codeHash: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  attempts: number;
  maxAttempts: number;
  verified: boolean;
  verifiedAt?: Date;
}

/**
 * Security questions pool (choose from these)
 */
export const SECURITY_QUESTIONS = [
  "What is the name of the city where you were born?",
  "What is your mother's maiden name?",
  "What is the name of your first pet?",
  "What was the name of your first school?",
  "What is your favorite book?",
  "What was your first job?",
  "What is the name of the street you grew up on?",
  "What is your favorite movie?",
  "What was the make and model of your first car?",
  "What is your favorite restaurant?",
  "What is the name of your childhood best friend?",
  "What is your favorite sport?",
];

/**
 * Generate password reset token
 */
export function generatePasswordResetToken(): {
  token: string;
  tokenHash: string;
} {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  return { token, tokenHash };
}

/**
 * Verify password reset token (constant time comparison)
 */
export function verifyPasswordResetToken(
  providedToken: string,
  storedTokenHash: string
): boolean {
  const providedTokenHash = crypto
    .createHash('sha256')
    .update(providedToken)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(providedTokenHash),
    Buffer.from(storedTokenHash)
  );
}

/**
 * Hash security question answer
 */
export function hashSecurityAnswer(answer: string): string {
  // Normalize answer: lowercase, trim, remove extra spaces
  const normalized = answer.toLowerCase().trim().replace(/\s+/g, ' ');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Verify security question answer (constant time comparison)
 */
export function verifySecurityAnswer(
  providedAnswer: string,
  storedAnswerHash: string
): boolean {
  const providedHash = hashSecurityAnswer(providedAnswer);

  try {
    return crypto.timingSafeEqual(
      Buffer.from(providedHash),
      Buffer.from(storedAnswerHash)
    );
  } catch {
    return false;
  }
}

/**
 * Generate 2FA code (email/SMS)
 */
export function generateTwoFactorCode(): {
  code: string;
  codeHash: string;
} {
  // 6-digit numeric code
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const codeHash = crypto.createHash('sha256').update(code).digest('hex');

  return { code, codeHash };
}

/**
 * Verify 2FA code (constant time comparison)
 */
export function verifyTwoFactorCode(
  providedCode: string,
  storedCodeHash: string
): boolean {
  const providedHash = crypto
    .createHash('sha256')
    .update(providedCode)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(providedHash),
      Buffer.from(storedCodeHash)
    );
  } catch {
    return false;
  }
}

/**
 * Generate TOTP secret for authenticator apps (base32 encoded)
 */
export function generateTOTPSecret(): string {
  // Generate 32 bytes of random data (256 bits)
  const secret = crypto.randomBytes(32);
  // Encode as base32
  return base32Encode(secret);
}

/**
 * Base32 encoding (RFC 4648)
 */
function base32Encode(buffer: Buffer): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;

    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 31];
  }

  // Add padding
  while (output.length % 8 !== 0) {
    output += '=';
  }

  return output;
}

/**
 * Generate backup codes for 2FA recovery
 */
export function generateBackupCodes(count: number = 10): string[] {
  const codes: string[] = [];

  for (let i = 0; i < count; i++) {
    // Generate 8 alphanumeric characters per code
    const code = crypto.randomBytes(6).toString('hex').toUpperCase();
    // Format as XXXX-XXXX
    codes.push(`${code.substring(0, 4)}-${code.substring(4, 8)}`);
  }

  return codes;
}

/**
 * Hash backup codes for storage
 */
export function hashBackupCode(code: string): string {
  // Remove dashes for comparison
  const normalized = code.replace(/-/g, '').toUpperCase();
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Verify backup code (constant time comparison)
 */
export function verifyBackupCode(
  providedCode: string,
  storedCodeHash: string
): boolean {
  const providedHash = hashBackupCode(providedCode);

  try {
    return crypto.timingSafeEqual(
      Buffer.from(providedHash),
      Buffer.from(storedCodeHash)
    );
  } catch {
    return false;
  }
}

/**
 * Create recovery context (JWT-like structure for recovery flow)
 */
export function createRecoveryToken(
  userId: string,
  recoveryType: 'email' | 'security_questions' | 'backup_code'
): {
  token: string;
  expiresAt: Date;
} {
  const token = {
    userId,
    recoveryType,
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
    nonce: crypto.randomBytes(16).toString('hex'),
  };

  // In production, use JWT with signing
  const tokenString = Buffer.from(JSON.stringify(token)).toString('base64');

  return {
    token: tokenString,
    expiresAt: token.expiresAt,
  };
}

/**
 * Verify recovery token
 */
export function verifyRecoveryToken(tokenString: string): {
  userId: string;
  recoveryType: 'email' | 'security_questions' | 'backup_code';
  valid: boolean;
} | null {
  try {
    const decoded = JSON.parse(
      Buffer.from(tokenString, 'base64').toString('utf8')
    );

    if (new Date(decoded.expiresAt) < new Date()) {
      return { ...decoded, valid: false };
    }

    return { ...decoded, valid: true };
  } catch {
    return null;
  }
}
