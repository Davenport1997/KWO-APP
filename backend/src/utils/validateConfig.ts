/**
 * Environment configuration validation
 * Ensures all required secrets are present at startup
 * Fails fast if critical configuration is missing
 */

interface ValidationError {
  variable: string;
  message: string;
}

const errors: ValidationError[] = [];

// Explicitly declare env variables to avoid dynamic access linting errors
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const NODE_ENV = process.env.NODE_ENV;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const REVENUECAT_SECRET_KEY = process.env.REVENUECAT_SECRET_KEY;
const API_BASE_URL = process.env.API_BASE_URL;

/**
 * Validate required environment variables exist and have minimum length
 */
export function validateEnvironmentConfig(): void {
  // Critical secrets that must be set (not allow fallbacks)
  const requiredSecrets = [
    {
      name: 'JWT_SECRET',
      value: JWT_SECRET,
      minLength: 32,
      message: 'Must be at least 32 characters (use openssl rand -base64 32)'
    },
    {
      name: 'JWT_REFRESH_SECRET',
      value: JWT_REFRESH_SECRET,
      minLength: 32,
      message: 'Must be at least 32 characters (use openssl rand -base64 32)'
    }
  ];

  // Optional but should be set in production
  const productionSecrets = [
    { name: 'OPENAI_API_KEY', value: OPENAI_API_KEY },
    { name: 'ELEVENLABS_API_KEY', value: ELEVENLABS_API_KEY },
    { name: 'REVENUECAT_SECRET_KEY', value: REVENUECAT_SECRET_KEY }
  ];

  // Validate required secrets
  requiredSecrets.forEach(secret => {
    if (!secret.value) {
      errors.push({
        variable: secret.name,
        message: `Missing required environment variable. ${secret.message}`
      });
    } else if (secret.value.length < secret.minLength) {
      errors.push({
        variable: secret.name,
        message: `Too short (${secret.value.length}/${secret.minLength} chars). ${secret.message}`
      });
    }
  });

  // Validate production-only secrets
  if (NODE_ENV === 'production') {
    productionSecrets.forEach(secret => {
      if (!secret.value) {
        errors.push({
          variable: secret.name,
          message: `Missing in production environment`
        });
      }
    });
  }

  // Validate API base URL
  validateAPIBaseURL();

  // Fail startup if any errors
  if (errors.length > 0) {
    console.error('\n❌ Configuration validation failed:\n');
    errors.forEach(error => {
      console.error(`  ${error.variable}: ${error.message}`);
    });
    console.error('\n⚠️  Cannot start server without proper configuration.\n');
    process.exit(1);
  }

  console.log('✅ Configuration validation passed');
}

/**
 * Validate API base URL configuration
 */
function validateAPIBaseURL(): void {
  if (NODE_ENV === 'production' && API_BASE_URL) {
    if (!API_BASE_URL.startsWith('https://')) {
      errors.push({
        variable: 'API_BASE_URL',
        message: 'Must use HTTPS in production (starts with https://)'
      });
    }
  }
}

/**
 * Get JWT secret (validated)
 */
export function getJWTSecret(): string {
  if (!JWT_SECRET) {
    throw new Error(
      'Missing JWT_SECRET environment variable. ' +
      'Generate with: openssl rand -base64 32'
    );
  }
  if (JWT_SECRET.length < 32) {
    throw new Error(`JWT_SECRET too short (${JWT_SECRET.length}/32 chars)`);
  }
  return JWT_SECRET;
}

/**
 * Get JWT refresh secret (validated)
 */
export function getJWTRefreshSecret(): string {
  if (!JWT_REFRESH_SECRET) {
    throw new Error(
      'Missing JWT_REFRESH_SECRET environment variable. ' +
      'Generate with: openssl rand -base64 32'
    );
  }
  if (JWT_REFRESH_SECRET.length < 32) {
    throw new Error(
      `JWT_REFRESH_SECRET too short (${JWT_REFRESH_SECRET.length}/32 chars)`
    );
  }
  return JWT_REFRESH_SECRET;
}

/**
 * Generate a secure random secret for development
 * Usage: node -e "require('./utils/validateConfig.js').generateDevSecret()"
 */
export function generateDevSecret(length: number = 32): string {
  const crypto = require('crypto');
  return crypto.randomBytes(length).toString('base64');
}
