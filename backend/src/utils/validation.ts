/**
 * Input Validation Utilities
 *
 * Provides validation functions for user input to prevent injection attacks
 * and ensure data integrity. Uses manual validation since we can't install packages.
 */

import { Request, Response, NextFunction } from 'express';

// ============================================================================
// VALIDATION ERROR TYPE
// ============================================================================

export interface ValidationError {
  field: string;
  message: string;
  value?: unknown;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  sanitized: Record<string, unknown>;
}

// ============================================================================
// SANITIZATION FUNCTIONS
// ============================================================================

/**
 * Sanitize string input - removes dangerous characters
 */
export function sanitizeString(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== 'string') return null;

  // Remove null bytes, control characters, and trim
  return input
    .replace(/\0/g, '')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .trim();
}

/**
 * Escape HTML entities to prevent XSS
 */
export function escapeHtml(input: string): string {
  const htmlEntities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;',
  };
  return input.replace(/[&<>"'/]/g, (char) => htmlEntities[char] || char);
}

/**
 * Sanitize for SQL-like injection patterns (extra defense layer)
 */
export function containsSqlInjection(input: string): boolean {
  const sqlPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|CREATE|TRUNCATE)\b)/i,
    /(--)|(\/\*)|(\*\/)/,
    /(;.*--)/,
    /(\bOR\b.*=.*)/i,
    /(\bAND\b.*=.*)/i,
  ];
  return sqlPatterns.some(pattern => pattern.test(input));
}

/**
 * Check for potential prompt injection in AI inputs
 */
export function containsPromptInjection(input: string): boolean {
  const promptPatterns = [
    /ignore (previous|all|above) instructions/i,
    /disregard (previous|all|your) instructions/i,
    /forget (your|all) instructions/i,
    /you are now/i,
    /new instructions:/i,
    /system prompt:/i,
    /\[INST\]/i,
    /\[\/INST\]/i,
    /<\|im_start\|>/i,
    /<\|im_end\|>/i,
  ];
  return promptPatterns.some(pattern => pattern.test(input));
}

// ============================================================================
// FIELD VALIDATORS
// ============================================================================

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 254;
}

/**
 * Validate display name
 */
export function validateDisplayName(name: unknown): ValidationError | null {
  const sanitized = sanitizeString(name);

  if (!sanitized) {
    return { field: 'displayName', message: 'Display name is required' };
  }

  if (sanitized.length < 1) {
    return { field: 'displayName', message: 'Display name cannot be empty' };
  }

  if (sanitized.length > 100) {
    return { field: 'displayName', message: 'Display name must be 100 characters or less', value: sanitized.length };
  }

  // Check for potentially dangerous patterns
  if (containsSqlInjection(sanitized)) {
    return { field: 'displayName', message: 'Display name contains invalid characters' };
  }

  return null;
}

/**
 * Validate age
 */
export function validateAge(age: unknown): ValidationError | null {
  if (age === undefined || age === null) {
    return null; // Age is optional
  }

  const numAge = typeof age === 'string' ? parseInt(age, 10) : age;

  if (typeof numAge !== 'number' || isNaN(numAge)) {
    return { field: 'age', message: 'Age must be a number', value: age };
  }

  if (!Number.isInteger(numAge)) {
    return { field: 'age', message: 'Age must be a whole number', value: age };
  }

  if (numAge < 13) {
    return { field: 'age', message: 'You must be at least 13 years old', value: numAge };
  }

  if (numAge > 120) {
    return { field: 'age', message: 'Please enter a valid age', value: numAge };
  }

  return null;
}

/**
 * Validate recovery stage
 */
export function validateRecoveryStage(stage: unknown): ValidationError | null {
  if (stage === undefined || stage === null) {
    return null; // Optional field
  }

  const validStages = ['early', 'active', 'maintenance', 'recovered', 'seed', 'root', 'tree', 'fruit'];

  if (typeof stage !== 'string') {
    return { field: 'recovery_stage', message: 'Recovery stage must be a string', value: stage };
  }

  if (!validStages.includes(stage.toLowerCase())) {
    return { field: 'recovery_stage', message: `Invalid recovery stage. Must be one of: ${validStages.join(', ')}`, value: stage };
  }

  return null;
}

/**
 * Validate AI chat messages array
 */
export function validateChatMessages(messages: unknown): ValidationError | null {
  if (!messages) {
    return { field: 'messages', message: 'Messages array is required' };
  }

  if (!Array.isArray(messages)) {
    return { field: 'messages', message: 'Messages must be an array', value: typeof messages };
  }

  if (messages.length === 0) {
    return { field: 'messages', message: 'Messages array cannot be empty' };
  }

  if (messages.length > 100) {
    return { field: 'messages', message: 'Too many messages (max 100)', value: messages.length };
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (!msg || typeof msg !== 'object') {
      return { field: `messages[${i}]`, message: 'Each message must be an object' };
    }

    if (!msg.role || !['system', 'user', 'assistant'].includes(msg.role)) {
      return { field: `messages[${i}].role`, message: 'Invalid message role', value: msg.role };
    }

    if (typeof msg.content !== 'string') {
      return { field: `messages[${i}].content`, message: 'Message content must be a string' };
    }

    if (msg.content.length > 50000) {
      return { field: `messages[${i}].content`, message: 'Message content too long (max 50000 chars)', value: msg.content.length };
    }

    // Check for prompt injection in user messages
    if (msg.role === 'user' && containsPromptInjection(msg.content)) {
      console.warn(`[SECURITY] Potential prompt injection detected in message ${i}`);
      // Don't block, but log for monitoring
    }
  }

  return null;
}

/**
 * Validate audio base64 data
 */
export function validateAudioBase64(audioBase64: unknown): ValidationError | null {
  if (!audioBase64) {
    return { field: 'audioBase64', message: 'Audio data is required' };
  }

  if (typeof audioBase64 !== 'string') {
    return { field: 'audioBase64', message: 'Audio data must be a string' };
  }

  // Check if valid base64
  const base64Regex = /^[A-Za-z0-9+/]+=*$/;
  if (!base64Regex.test(audioBase64.replace(/\s/g, ''))) {
    return { field: 'audioBase64', message: 'Invalid base64 encoding' };
  }

  // Max 25MB for audio (generous limit)
  const maxSize = 25 * 1024 * 1024;
  const estimatedSize = (audioBase64.length * 3) / 4;
  if (estimatedSize > maxSize) {
    return { field: 'audioBase64', message: 'Audio file too large (max 25MB)', value: `${Math.round(estimatedSize / 1024 / 1024)}MB` };
  }

  return null;
}

/**
 * Validate text for TTS
 */
export function validateTTSText(text: unknown): ValidationError | null {
  if (!text) {
    return { field: 'text', message: 'Text is required' };
  }

  if (typeof text !== 'string') {
    return { field: 'text', message: 'Text must be a string' };
  }

  if (text.length > 4096) {
    return { field: 'text', message: 'Text too long (max 4096 characters)', value: text.length };
  }

  return null;
}

/**
 * Validate TTS voice option
 */
export function validateTTSVoice(voice: unknown): ValidationError | null {
  if (voice === undefined) {
    return null; // Optional, defaults to 'nova'
  }

  const validVoices = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];

  if (typeof voice !== 'string' || !validVoices.includes(voice)) {
    return { field: 'voice', message: `Invalid voice. Must be one of: ${validVoices.join(', ')}`, value: voice };
  }

  return null;
}

/**
 * Validate user ID format
 */
export function validateUserId(userId: unknown): ValidationError | null {
  if (!userId) {
    return { field: 'userId', message: 'User ID is required' };
  }

  if (typeof userId !== 'string') {
    return { field: 'userId', message: 'User ID must be a string' };
  }

  // Allow alphanumeric, hyphens, underscores (UUID-like or custom IDs)
  const userIdRegex = /^[a-zA-Z0-9_-]{1,128}$/;
  if (!userIdRegex.test(userId)) {
    return { field: 'userId', message: 'Invalid user ID format' };
  }

  return null;
}

// ============================================================================
// SCHEMA VALIDATORS (Composite)
// ============================================================================

/**
 * Validate user profile update request
 */
export function validateProfileUpdate(body: Record<string, unknown>): ValidationResult {
  const errors: ValidationError[] = [];
  const sanitized: Record<string, unknown> = {};

  // Validate displayName if provided
  if (body.displayName !== undefined) {
    const error = validateDisplayName(body.displayName);
    if (error) {
      errors.push(error);
    } else {
      sanitized.displayName = escapeHtml(sanitizeString(body.displayName) || '');
    }
  }

  // Validate age if provided
  if (body.age !== undefined) {
    const error = validateAge(body.age);
    if (error) {
      errors.push(error);
    } else {
      sanitized.age = typeof body.age === 'string' ? parseInt(body.age, 10) : body.age;
    }
  }

  // Validate recovery_stage if provided
  if (body.recovery_stage !== undefined) {
    const error = validateRecoveryStage(body.recovery_stage);
    if (error) {
      errors.push(error);
    } else {
      sanitized.recovery_stage = (body.recovery_stage as string).toLowerCase();
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    sanitized
  };
}

/**
 * Validate AI chat request
 */
export function validateAIChatRequest(body: Record<string, unknown>): ValidationResult {
  const errors: ValidationError[] = [];
  const sanitized: Record<string, unknown> = {};

  // Validate messages (required)
  const messagesError = validateChatMessages(body.messages);
  if (messagesError) {
    errors.push(messagesError);
  } else {
    sanitized.messages = body.messages;
  }

  // Validate model (optional)
  if (body.model !== undefined) {
    const validModels = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'];
    if (typeof body.model !== 'string' || !validModels.includes(body.model)) {
      errors.push({ field: 'model', message: `Invalid model. Must be one of: ${validModels.join(', ')}`, value: body.model });
    } else {
      sanitized.model = body.model;
    }
  }

  // Validate max_tokens (optional)
  if (body.max_tokens !== undefined) {
    const maxTokens = typeof body.max_tokens === 'string' ? parseInt(body.max_tokens, 10) : body.max_tokens;
    if (typeof maxTokens !== 'number' || isNaN(maxTokens) || maxTokens < 1 || maxTokens > 4096) {
      errors.push({ field: 'max_tokens', message: 'max_tokens must be between 1 and 4096', value: body.max_tokens });
    } else {
      sanitized.max_tokens = maxTokens;
    }
  }

  // Validate temperature (optional)
  if (body.temperature !== undefined) {
    const temp = typeof body.temperature === 'string' ? parseFloat(body.temperature) : body.temperature;
    if (typeof temp !== 'number' || isNaN(temp) || temp < 0 || temp > 2) {
      errors.push({ field: 'temperature', message: 'temperature must be between 0 and 2', value: body.temperature });
    } else {
      sanitized.temperature = temp;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    sanitized
  };
}

/**
 * Validate voice transcription request
 */
export function validateTranscribeRequest(body: Record<string, unknown>): ValidationResult {
  const errors: ValidationError[] = [];
  const sanitized: Record<string, unknown> = {};

  const audioError = validateAudioBase64(body.audioBase64);
  if (audioError) {
    errors.push(audioError);
  } else {
    sanitized.audioBase64 = body.audioBase64;
  }

  // Validate language (optional)
  if (body.language !== undefined) {
    const validLanguages = ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'ru', 'ja', 'ko', 'zh'];
    if (typeof body.language !== 'string' || !validLanguages.includes(body.language)) {
      errors.push({ field: 'language', message: 'Invalid language code', value: body.language });
    } else {
      sanitized.language = body.language;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    sanitized
  };
}

/**
 * Validate TTS request
 */
export function validateTTSRequest(body: Record<string, unknown>): ValidationResult {
  const errors: ValidationError[] = [];
  const sanitized: Record<string, unknown> = {};

  const textError = validateTTSText(body.text);
  if (textError) {
    errors.push(textError);
  } else {
    sanitized.text = body.text;
  }

  const voiceError = validateTTSVoice(body.voice);
  if (voiceError) {
    errors.push(voiceError);
  } else {
    sanitized.voice = body.voice || 'nova';
  }

  return {
    valid: errors.length === 0,
    errors,
    sanitized
  };
}

// ============================================================================
// MIDDLEWARE
// ============================================================================

/**
 * Create validation middleware for a specific validator
 */
export function createValidationMiddleware(
  validator: (body: Record<string, unknown>) => ValidationResult
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = validator(req.body);

    if (!result.valid) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: result.errors
      });
      return;
    }

    // Attach sanitized data to request
    (req as any).validatedBody = result.sanitized;
    next();
  };
}

// Pre-built middleware exports
export const validateProfileUpdateMiddleware = createValidationMiddleware(validateProfileUpdate);
export const validateAIChatMiddleware = createValidationMiddleware(validateAIChatRequest);
export const validateTranscribeMiddleware = createValidationMiddleware(validateTranscribeRequest);
export const validateTTSMiddleware = createValidationMiddleware(validateTTSRequest);
