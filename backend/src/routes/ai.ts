/**
 * AI Routes - Server-side proxy for all AI API calls
 *
 * This module keeps all AI API keys server-side and provides secure endpoints
 * for the mobile app to access AI features without exposing API keys.
 *
 * Rate Limiting:
 * - AI Chat: 20 messages/hour (free), 100 messages/hour (premium)
 * - AI Voice: 3 calls/day (free), 10 calls/day (premium)
 * - Quote Generation: 10 per hour (free), 50 per hour (premium)
 */
import { Router, Request, Response } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { createAIChatLimiter, createAIVoiceLimiter } from '../middleware/rateLimiting.js';
import { logRateLimitEvent } from '../utils/rateLimitMonitoring.js';
import { fetchWithTimeout } from '../utils/httpClient.js';
import {
  validateAIChatRequest,
  validateTranscribeRequest,
  validateTTSRequest,
  containsPromptInjection
} from '../utils/validation.js';
import {
  checkAISafety,
  sanitizeAIResponse,
  logSafetyViolation
} from '../utils/aiSafetyFilter.js';
const router = Router();
// Get API keys from environment (server-side only)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GROK_API_KEY = process.env.GROK_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
// OpenAI endpoints
const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';
const OPENAI_TTS_URL = 'https://api.openai.com/v1/audio/speech';
// Helper to determine if user is premium
async function isPremiumUser(req: Request): Promise<boolean> {
  // Check if user has premium subscription via RevenueCat
  // In production, this would query RevenueCat API with the user's ID
  const userId = (req as any).user?.id;
  if (!userId) {
    return false;
  }
  // TODO: Implement actual RevenueCat verification
  // For now, always return false (assume free tier by default)
  // This ensures security: if premium status can't be verified, deny premium benefits
  return false;
}
/**
 * Check if AI services are configured
 */
const isAIConfigured = (): boolean => {
  return !!(OPENAI_API_KEY || GROK_API_KEY || ANTHROPIC_API_KEY);
};
/**
 * POST /ai/chat
 * Proxy for OpenAI chat completions
 * Requires authentication
 * Rate Limited: 20 messages/hour (free), 100 messages/hour (premium)
 */
router.post('/chat', verifyToken, async (req: Request, res: Response, next) => {
  const isPremium = await isPremiumUser(req);
  const chatLimiter = createAIChatLimiter(isPremium);
  chatLimiter(req, res, next);
}, async (req: Request, res: Response): Promise<void> => {
  try {
    if (!OPENAI_API_KEY) {
      res.status(503).json({
        success: false,
        error: 'AI service not configured',
        code: 'AI_NOT_CONFIGURED'
      });
      return;
    }
    // Validate input
    const validation = validateAIChatRequest(req.body);
    if (!validation.valid) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: validation.errors
      });
      return;
    }
    const { messages } = validation.sanitized as { messages: Array<{ role: string; content: string }> };
    const model = (validation.sanitized.model as string) || 'gpt-4o';
    const max_tokens = (validation.sanitized.max_tokens as number) || 300;
    const temperature = (validation.sanitized.temperature as number) || 1;
    // SECURITY: Block prompt injection attempts
    const userMessages = messages.filter(m => m.role === 'user');
    for (const msg of userMessages) {
      if (containsPromptInjection(msg.content)) {
        console.warn('[SECURITY] Prompt injection BLOCKED:', {
          userId: (req as any).user?.id,
          timestamp: new Date().toISOString()
        });
        res.status(400).json({
          success: false,
          error: 'Your message contains content that cannot be processed. Please rephrase your message.',
          code: 'INVALID_MESSAGE_CONTENT'
        });
        return;
      }
    }
    const response = await fetchWithTimeout(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens,
        temperature,
      }),
      timeout: 45000, // 45 seconds for AI operations
    });
    if (!response.ok) {
      let errorData: any = {};
      try {
        errorData = await response.json();
      } catch (e) {
        const text = await response.text();
        errorData = { raw: text };
      }
      console.error('[AI] OpenAI chat error:', { status: response.status, error: errorData });
      res.status(response.status).json({
        success: false,
        error: errorData.error?.message || 'AI request failed',
        code: 'AI_REQUEST_FAILED'
      });
      return;
    }
    const data = await response.json();
    // FIXED: Added 'as any' to bypass the TS unknown error
    const rawContent = (data as any).choices?.[0]?.message?.content || '';
    // CRITICAL: Apply safety filter to AI response before sending to user
    const safetyCheck = checkAISafety(rawContent);
    const { sanitizedResponse, disclaimer, wasFiltered } = sanitizeAIResponse(rawContent, safetyCheck);
    // Log safety violations for monitoring
    if (!safetyCheck.isSafe) {
      const userId = (req as any).user?.id || 'unknown';
      const userMessage = messages[messages.length - 1]?.content || '';
      logSafetyViolation(userId, safetyCheck, userMessage, rawContent);
    }
    res.json({
      success: true,
      data: {
        content: sanitizedResponse,
        disclaimer: disclaimer || undefined,
        filtered: wasFiltered,
        // FIXED: Added 'as any'
        usage: (data as any).usage
      }
    });
  } catch (error) {
    console.error('[AI] Chat error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});
/**
 * POST /ai/voice/transcribe
 * Proxy for OpenAI Whisper transcription
 * Requires authentication
 * Rate Limited: 3 calls/day (free), 10 calls/day (premium)
 */
router.post('/voice/transcribe', verifyToken, async (req: Request, res: Response, next) => {
  const isPremium = await isPremiumUser(req);
  const voiceLimiter = createAIVoiceLimiter(isPremium);
  voiceLimiter(req, res, next);
}, async (req: Request, res: Response): Promise<void> => {
  try {
    if (!OPENAI_API_KEY) {
      res.status(503).json({
        success: false,
        error: 'AI service not configured',
        code: 'AI_NOT_CONFIGURED'
      });
      return;
    }
    const { audioBase64, language = 'en' } = req.body;
    if (!audioBase64) {
      res.status(400).json({
        success: false,
        error: 'Audio data is required',
        code: 'INVALID_REQUEST'
      });
      return;
    }
    // Convert base64 to buffer
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    // Create form data for Whisper API
    const formData = new FormData();
    const audioBlob = new Blob([audioBuffer], { type: 'audio/m4a' });
    formData.append('file', audioBlob, 'recording.m4a');
    formData.append('model', 'whisper-1');
    formData.append('language', language);
    const response = await fetchWithTimeout(OPENAI_WHISPER_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: formData,
      timeout: 45000, // 45 seconds for AI transcription
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[AI] Whisper error:', errorData);
      res.status(response.status).json({
        success: false,
        error: 'Transcription failed',
        code: 'TRANSCRIPTION_FAILED'
      });
      return;
    }
    const data = await response.json();
    res.json({
      success: true,
      data: {
        // FIXED: Added 'as any'
        text: (data as any).text || ''
      }
    });
  } catch (error) {
    console.error('[AI] Transcription error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});
/**
 * POST /ai/voice/synthesize
 * Proxy for OpenAI TTS
 * Requires authentication
 * Rate Limited: 3 calls/day (free), 10 calls/day (premium)
 */
router.post('/voice/synthesize', verifyToken, async (req: Request, res: Response, next) => {
  const isPremium = await isPremiumUser(req);
  const voiceLimiter = createAIVoiceLimiter(isPremium);
  voiceLimiter(req, res, next);
}, async (req: Request, res: Response): Promise<void> => {
  try {
    if (!OPENAI_API_KEY) {
      res.status(503).json({
        success: false,
        error: 'AI service not configured',
        code: 'AI_NOT_CONFIGURED'
      });
      return;
    }
    const { text, voice = 'nova' } = req.body;
    if (!text) {
      res.status(400).json({
        success: false,
        error: 'Text is required',
        code: 'INVALID_REQUEST'
      });
      return;
    }
    const response = await fetchWithTimeout(OPENAI_TTS_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: text,
        voice: voice,
        response_format: 'mp3',
      }),
      timeout: 45000, // 45 seconds for AI voice synthesis
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[AI] TTS error:', errorData);
      res.status(response.status).json({
        success: false,
        error: 'Speech synthesis failed',
        code: 'TTS_FAILED'
      });
      return;
    }
    // Convert response to base64
    const audioBuffer = await response.arrayBuffer();
    const base64Audio = Buffer.from(audioBuffer).toString('base64');
    res.json({
      success: true,
      data: {
        audioBase64: base64Audio,
        contentType: 'audio/mp3'
      }
    });
  } catch (error) {
    console.error('[AI] TTS error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});
/**
 * POST /ai/generate-quote
 * Generate personalized motivational quote
 * Requires authentication
 * Rate Limited: 10 per hour (free), 50 per hour (premium)
 */
router.post('/generate-quote', verifyToken, async (req: Request, res: Response, next) => {
  const isPremium = await isPremiumUser(req);
  const chatLimiter = createAIChatLimiter(isPremium);
  chatLimiter(req, res, next);
}, async (req: Request, res: Response): Promise<void> => {
  try {
    if (!OPENAI_API_KEY) {
      // Return a fallback quote if AI not configured
      res.json({
        success: true,
        data: {
          quote: 'Every step forward, no matter how small, is a step toward the person you were meant to be.',
          attribution: 'KWO'
        }
      });
      return;
    }
    const { userName, context, faithPreference, mood, language } = req.body;
    const systemPrompt = `You are a wise, compassionate source of inspiration for people in recovery.
Generate a SHORT, powerful, original quote (1-2 sentences max) that feels like a sign from above.
Context: ${JSON.stringify(context || {})}
User: ${userName || 'Friend'}
Faith preference: ${faithPreference || 'subtle'}
Mood: ${mood || 'neutral'}
Language: ${language || 'English'}
Guidelines:
- Be profound but not preachy
- Feel personal
- Be encouraging without toxic positivity
- Keep it under 30 words
- Respond ONLY with the quote text, nothing else.`;
    const response = await fetchWithTimeout(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: systemPrompt }],
        max_tokens: 100,
        temperature: 0.9,
      }),
      timeout: 45000, // 45 seconds for quote generation
    });
    if (!response.ok) {
      // Return fallback on error
      res.json({
        success: true,
        data: {
          quote: 'Every day you choose to grow is a victory worth celebrating.',
          attribution: 'KWO'
        }
      });
      return;
    }
    const data = await response.json();
    // FIXED: Added 'as any'
    const quote = (data as any).choices?.[0]?.message?.content?.trim() || '';
    res.json({
      success: true,
      data: {
        quote: quote.replace(/^["']|["']$/g, ''),
        attribution: `For ${userName || 'You'}`
      }
    });
  } catch (error) {
    console.error('[AI] Quote generation error:', error);
    res.json({
      success: true,
      data: {
        quote: 'Every step forward, no matter how small, is a step toward the person you were meant to be.',
        attribution: 'KWO'
      }
    });
  }
});
/**
 * GET /ai/status
 * Check if AI services are configured
 * No authentication required
 */
router.get('/status', (req: Request, res: Response): void => {
  res.json({
    success: true,
    data: {
      configured: isAIConfigured(),
      services: {
        openai: !!OPENAI_API_KEY,
        grok: !!GROK_API_KEY,
        anthropic: !!ANTHROPIC_API_KEY,
        elevenlabs: !!ELEVENLABS_API_KEY,
        google: !!GOOGLE_API_KEY
      }
    }
  });
});
export default router;
