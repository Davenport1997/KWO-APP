import { Router, Request, Response } from 'express';
import { verifyToken, requireOwnership } from '../middleware/auth.js';

const router = Router();

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

    // Mock AI response
    const mockResponse = generateMockResponse(message, conversation_type);

    // Store in mock history
    if (!mockChatHistory[userId!]) {
      mockChatHistory[userId!] = [];
    }

    const chatEntry = {
      id: `msg_${Date.now()}`,
      user_id: userId!,
      message,
      response: mockResponse,
      type: 'text' as const,
      created_at: new Date().toISOString()
    };

    mockChatHistory[userId!].push(chatEntry);

    res.json({
      success: true,
      data: {
        message_id: chatEntry.id,
        response: mockResponse,
        usage: {
          input_tokens: Math.ceil(message.length / 4),
          output_tokens: Math.ceil(mockResponse.length / 4)
        }
      }
    });
  } catch (error) {
    console.error('Chat message error:', error);
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

    // Mock transcription (in production, call OpenAI Whisper API)
    const mockTranscription = 'How are you feeling today about your recovery?';
    const mockResponse = generateMockResponse(mockTranscription, 'check-in');

    if (!mockChatHistory[userId!]) {
      mockChatHistory[userId!] = [];
    }

    const chatEntry = {
      id: `msg_${Date.now()}`,
      user_id: userId!,
      message: mockTranscription,
      response: mockResponse,
      type: 'voice' as const,
      created_at: new Date().toISOString()
    };

    mockChatHistory[userId!].push(chatEntry);

    res.json({
      success: true,
      data: {
        message_id: chatEntry.id,
        transcription: mockTranscription,
        response: mockResponse
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

// Helper function to generate mock AI responses
function generateMockResponse(message: string, type?: string): string {
  const responses: Record<string, string[]> = {
    'check-in': [
      'I appreciate you checking in with me. How are you feeling about your progress today?',
      'Thank you for sharing. Remember that small steps are still progress.',
      'I\'m here to support you on your journey. What would help you most right now?'
    ],
    'default': [
      'That\'s an important thought. Tell me more about how you\'re feeling.',
      'I understand. Recovery is a journey, and I\'m here to help.',
      'Thank you for opening up. Let\'s work through this together.'
    ]
  };

  const responseList = responses[type || 'default'] || responses['default'];
  return responseList[Math.floor(Math.random() * responseList.length)];
}

export default router;
