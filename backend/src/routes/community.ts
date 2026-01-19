import { Router, Request, Response } from 'express';
import { verifyToken, requireAdmin } from '../middleware/auth.js';

const router = Router();

// Mock community posts storage
const mockCommunityPosts: Array<{
  id: string;
  user_id: string;
  content: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  likes: number;
  comments: number;
}> = [];

/**
 * POST /community/post
 * Submit community post (moderated - protected)
 * Returns: { post_id, status, moderation_note }
 */
router.post('/post', verifyToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { content, type = 'general' } = req.body;

    if (!content) {
      res.status(400).json({
        success: false,
        error: 'Post content is required',
        code: 'MISSING_CONTENT'
      });
      return;
    }

    if (content.length > 5000) {
      res.status(400).json({
        success: false,
        error: 'Post exceeds maximum length',
        code: 'CONTENT_TOO_LONG'
      });
      return;
    }

    // Check content for inappropriate language (mock check)
    const isInappropriate = checkContentAppropriate(content);

    const post = {
      id: `post_${Date.now()}`,
      user_id: userId!,
      content,
      status: isInappropriate ? 'rejected' as const : 'pending' as const,
      created_at: new Date().toISOString(),
      likes: 0,
      comments: 0
    };

    mockCommunityPosts.push(post);

    res.json({
      success: true,
      data: {
        post_id: post.id,
        status: post.status,
        moderation_note: isInappropriate
          ? 'Your post contains content that violates our community guidelines.'
          : 'Your post is under review. It will appear once approved by moderators.'
      }
    });
  } catch (error) {
    console.error('Post creation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create post',
      code: 'POST_ERROR'
    });
  }
});

/**
 * GET /community/feed
 * Get community feed (protected)
 * Returns: { posts array, pagination }
 */
router.get('/feed', verifyToken, (req: Request, res: Response): void => {
  try {
    const { limit = 20, offset = 0, sort = 'recent' } = req.query;

    // Filter approved posts only
    let feed = mockCommunityPosts.filter(p => p.status === 'approved');

    // Sort
    if (sort === 'trending') {
      feed.sort((a, b) => b.likes - a.likes);
    } else {
      feed.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }

    const paginatedFeed = feed.slice(
      parseInt(offset as string),
      parseInt(offset as string) + parseInt(limit as string)
    );

    res.json({
      success: true,
      data: {
        posts: paginatedFeed,
        total: feed.length,
        offset: parseInt(offset as string),
        limit: parseInt(limit as string)
      }
    });
  } catch (error) {
    console.error('Feed retrieval error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve feed',
      code: 'FEED_ERROR'
    });
  }
});

/**
 * GET /community/post/:postId
 * Get specific post with comments (protected)
 * Returns: { post, comments }
 */
router.get('/post/:postId', verifyToken, (req: Request, res: Response): void => {
  try {
    const { postId } = req.params;

    const post = mockCommunityPosts.find(p => p.id === postId);

    if (!post) {
      res.status(404).json({
        success: false,
        error: 'Post not found',
        code: 'POST_NOT_FOUND'
      });
      return;
    }

    if (post.status !== 'approved') {
      res.status(403).json({
        success: false,
        error: 'This post is not available',
        code: 'POST_NOT_AVAILABLE'
      });
      return;
    }

    res.json({
      success: true,
      data: {
        post,
        comments: [] // Mock - would load actual comments from database
      }
    });
  } catch (error) {
    console.error('Get post error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve post',
      code: 'GET_ERROR'
    });
  }
});

/**
 * POST /community/post/:postId/like
 * Like a post (protected)
 * Returns: { likes_count }
 */
router.post('/post/:postId/like', verifyToken, (req: Request, res: Response): void => {
  try {
    const { postId } = req.params;

    const post = mockCommunityPosts.find(p => p.id === postId);

    if (!post) {
      res.status(404).json({
        success: false,
        error: 'Post not found',
        code: 'POST_NOT_FOUND'
      });
      return;
    }

    post.likes++;

    res.json({
      success: true,
      data: {
        post_id: postId,
        likes_count: post.likes
      }
    });
  } catch (error) {
    console.error('Like post error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to like post',
      code: 'LIKE_ERROR'
    });
  }
});

/**
 * Admin endpoints for moderation
 */

/**
 * GET /community/admin/pending
 * Get pending posts for moderation (admin only)
 * Returns: { posts array }
 */
router.get('/admin/pending', verifyToken, requireAdmin, (req: Request, res: Response): void => {
  try {
    const pendingPosts = mockCommunityPosts.filter(p => p.status === 'pending');

    res.json({
      success: true,
      data: {
        pending_posts: pendingPosts,
        count: pendingPosts.length
      }
    });
  } catch (error) {
    console.error('Get pending posts error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve pending posts',
      code: 'PENDING_ERROR'
    });
  }
});

/**
 * POST /community/admin/moderate
 * Approve or reject post (admin only)
 * Returns: { post_id, new_status }
 */
router.post('/admin/moderate', verifyToken, requireAdmin, (req: Request, res: Response): void => {
  try {
    const { postId, action, reason } = req.body;

    if (!['approve', 'reject'].includes(action)) {
      res.status(400).json({
        success: false,
        error: 'Action must be approve or reject',
        code: 'INVALID_ACTION'
      });
      return;
    }

    const post = mockCommunityPosts.find(p => p.id === postId);

    if (!post) {
      res.status(404).json({
        success: false,
        error: 'Post not found',
        code: 'POST_NOT_FOUND'
      });
      return;
    }

    post.status = action === 'approve' ? 'approved' : 'rejected';

    res.json({
      success: true,
      data: {
        post_id: postId,
        new_status: post.status,
        moderator_id: req.user?.id
      }
    });
  } catch (error) {
    console.error('Moderation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to moderate post',
      code: 'MODERATION_ERROR'
    });
  }
});

// Helper function to check content appropriateness
function checkContentAppropriate(content: string): boolean {
  // Mock check - in production, use a content moderation API
  const inappropriate = ['hate', 'violence', 'abuse'];
  const lowerContent = content.toLowerCase();
  return inappropriate.some(word => lowerContent.includes(word));
}

export default router;
