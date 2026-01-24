import { Router, Request, Response } from 'express';
import { verifyToken, requireOwnership } from '../middleware/auth.js';
import OpenAI from 'openai';

const router = Router();

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Mock chat storage
const mockChatHistory: Record<string, Array<{
  id: string;
  user_id: string;
  message: string;
  response: string;
  type: 'text' | 'voice';
  created_at: string;
}>> = {};

/**
 * POST /chat/message
 * Send message to AI companion (protected)
 * Returns: { message_id, response, usage }
 */
router.post('/message', verifyToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { message, conversation_type } = req.body;

    if (!message) {
      res.status(400).json({
        success: false,
        error: 'Message is required',
        code: 'MISSING_MESSAGE'
      });
      return;
    }

    // Validate message length
    if (message.length > 5000) {
      res.status(400).json({
        success: false,
        error: 'Message exceeds maximum length',
        code: 'MESSAGE_TOO_LONG'
      });
      return;
    }

    // Get conversation history for context
    const userHistory = mockChatHistory[userId!] || [];
    const recentHistory = userHistory.slice(-10); // Last 10 messages for context

    // Prepare messages for OpenAI
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: `You are River, a supportive and empathetic AI companion focused on mental wellness, addiction recovery, and personal growth. You provide compassionate support while encouraging healthy habits and professional help when needed. Be warm, understanding, and non-judgmental.`
      },
      // Add conversation history
      ...recentHistory.flatMap(entry => [
        { role: 'user' as const, content: entry.message },
        { role: 'assistant' as const, content: entry.response }
      ]),
      // Add current message
      { role: 'user', content: message }
    ];

    // Call OpenAI API
    const completion = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview', // or 'gpt-3.5-turbo' for faster/cheaper
      messages: messages,
      max_tokens: 500,
      temperature: 0.7,
    });

    const aiResponse = completion.choices[0].message.content || 'I understand. How can I support you?';

    // Store in mock history
    if (!mockChatHistory[userId!]) {
      mockChatHistory[userId!] = [];
    }

    const chatEntry = {
      id: `msg_${Date.now()}`,
      user_id: userId!,
      message,
      response: aiResponse,
      type: 'text' as const,
      created_at: new Date().toISOString()
    };

    mockChatHistory[userId!].push(chatEntry);

    res.json({
      success: true,
      data: {
        message_id: chatEntry.id,
        response: aiResponse,
        usage: {
          input_tokens: completion.usage?.prompt_tokens || 0,
          output_tokens: completion.usage?.completion_tokens || 0
        }
      }
    });
  } catch (error: any) {
    console.error('Chat message error:', error);
    
    // Handle OpenAI API errors
    if (error.status === 401) {
      res.status(500).json({
        success: false,
        error: 'OpenAI API configuration error',
        code: 'API_CONFIG_ERROR'
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: 'Failed to process message',
      code: 'MESSAGE_ERROR'
    });
  }
});

/**
 * GET /chat/history
 * Retrieve chat history (protected)
 * Returns: { messages array, pagination }
 */
router.get('/history', verifyToken, (req: Request, res: Response): void => {
  try {
    const userId = req.user?.id;
    const { limit = 50, offset = 0 } = req.query;

    const history = mockChatHistory[userId!] || [];
    const paginatedHistory = history.slice(
      parseInt(offset as string),
      parseInt(offset as string) + parseInt(limit as string)
    );

    res.json({
      success: true,
      data: {
        messages: paginatedHistory,
        total: history.length,
        offset: parseInt(offset as string),
        limit: parseInt(limit as string)
      }
    });
  } catch (error) {
    console.error('Chat history error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve chat history',
      code: 'HISTORY_ERROR'
    });
  }
});

/**
 * POST /chat/voice
 * Handle voice transcription (protected)
 * Returns: { transcription, response }
 */
router.post('/voice', verifyToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { audio_url, language = 'en' } = req.body;

    if (!audio_url) {
      res.status(400).json({
        success: false,
        error: 'Audio URL is required',
        code: 'MISSING_AUDIO'
      });
      return;
    }

    // For now, use mock transcription
    // In production, implement OpenAI Whisper API
    const mockTranscription = 'How are you feeling today about your recovery?';
    
    // Get AI response using OpenAI
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are River, a supportive AI companion for mental wellness and recovery.'
        },
        { role: 'user', content: mockTranscription }
      ],
      max_tokens: 300,
      temperature: 0.7,
    });

    const aiResponse = completion.choices[0].message.content || 'I understand. How can I support you?';

    if (!mockChatHistory[userId!]) {
      mockChatHistory[userId!] = [];
    }

    const chatEntry = {
      id: `msg_${Date.now()}`,
      user_id: userId!,
      message: mockTranscription,
      response: aiResponse,
      type: 'voice' as const,
      created_at: new Date().toISOString()
    };

    mockChatHistory[userId!].push(chatEntry);

    res.json({
      success: true,
      data: {
        message_id: chatEntry.id,
        transcription: mockTranscription,
        response: aiResponse
      }
    });
  } catch (error) {
    console.error('Voice processing error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process voice',
      code: 'VOICE_ERROR'
    });
  }
});

/**
 * DELETE /chat/history/:messageId
 * Delete specific chat message (protected)
 * Returns: { success message }
 */
router.delete('/history/:messageId', verifyToken, (req: Request, res: Response): void => {
  try {
    const userId = req.user?.id;
    const { messageId } = req.params;

    const history = mockChatHistory[userId!];
    if (!history) {
      res.status(404).json({
        success: false,
        error: 'Chat history not found',
        code: 'HISTORY_NOT_FOUND'
      });
      return;
    }

    const messageIndex = history.findIndex(m => m.id === messageId);
    if (messageIndex === -1) {
      res.status(404).json({
        success: false,
        error: 'Message not found',
        code: 'MESSAGE_NOT_FOUND'
      });
      return;
    }

    history.splice(messageIndex, 1);

    res.json({
      success: true,
      message: 'Message deleted successfully'
    });
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete message',
      code: 'DELETE_ERROR'
    });
  }
});

export default router;
