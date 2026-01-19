/**
 * Data Management Routes
 * Handles backups, exports, recovery, and deletion
 */

import express, { Request, Response } from 'express';
import { verifyToken } from '../middleware/auth.js';
import * as backupService from '../services/backupService.js';
import * as recoveryService from '../services/recoveryService.js';
import * as exportService from '../services/exportService.js';
import * as deletionService from '../services/deletionService.js';

const router = express.Router();

// Mock database storage for backups, deletions, and recovery
const mockBackupMetadata: Record<string, backupService.BackupMetadata[]> = {};
const mockDeletionRequests: Record<string, deletionService.DeletionRequest[]> = {};
const mockRecoveryTokens: Record<string, { token: string; email: string; expiresAt: Date; used: boolean }> = {};
const mockUserData: Record<string, any> = {
  // Mock user data storage - in production, fetch from actual database
};

// Mock user data retrieval
function getUserData(userId: string) {
  if (!mockUserData[userId]) {
    mockUserData[userId] = {
      id: userId,
      email: `user${userId}@example.com`,
      profile: { name: 'User', bio: 'Recovery app user' },
      settings: { notifications: true },
      chatHistory: [
        { id: 'chat_1', message: 'Today was a good day', timestamp: new Date(Date.now() - 86400000) },
        { id: 'chat_2', message: 'Feeling better', timestamp: new Date() }
      ],
      checkIns: [
        { id: 'check_1', mood: 7, hasSetback: false, createdAt: new Date(Date.now() - 86400000) },
        { id: 'check_2', mood: 8, hasSetback: false, createdAt: new Date() }
      ],
      challenges: [
        { id: 'challenge_1', title: 'Morning walk', completed: true, createdAt: new Date(Date.now() - 604800000) }
      ],
      journalEntries: [
        { id: 'journal_1', content: 'Today was productive', createdAt: new Date(Date.now() - 259200000) }
      ],
      goals: [],
      emergencyContacts: [],
      preventionPlan: [],
      analyticsData: {
        totalSessions: 24,
        averageMood: 6.5,
        streakDays: 5
      }
    };
  }
  return mockUserData[userId];
}

// ==================== BACKUP ROUTES ====================

/**
 * POST /api/data/backup/create
 * Create a new backup (manual)
 */
router.post('/backup/create', verifyToken, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { encryptionKey, deviceInfo } = req.body;

    if (!encryptionKey) {
      return res.status(400).json({
        success: false,
        error: 'Encryption key required',
        code: 'MISSING_KEY'
      });
    }

    // Fetch user data from mock database
    const userData = getUserData(userId);

    // Create backup with encryption
    const { backup, metadata, checksum } = await backupService.createBackup(
      userId,
      userData,
      encryptionKey,
      { deviceInfo: deviceInfo || { os: 'unknown', appVersion: '1.0.0' } }
    );

    // Store backup metadata in mock database
    if (!mockBackupMetadata[userId]) {
      mockBackupMetadata[userId] = [];
    }

    mockBackupMetadata[userId].push(metadata);

    // In production, store backup to cloud storage (S3/Google Cloud/Azure)
    // For now, we're just storing metadata
    // Example: await s3Client.putObject({ Bucket: 'backups', Key: `${userId}/${metadata.id}`, Body: backup });

    console.log(`✓ Backup created for user ${userId}: ${metadata.id} (${metadata.dataSize} bytes)`);

    res.status(201).json({
      success: true,
      backup: {
        id: metadata.id,
        timestamp: metadata.timestamp,
        size: metadata.dataSize,
        deviceInfo: metadata.deviceInfo,
        checksum,
      },
      message: 'Backup created successfully'
    });
  } catch (error) {
    console.error('Backup creation failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create backup',
      code: 'BACKUP_ERROR'
    });
  }
});

/**
 * GET /api/data/backup/list
 * List all backups for user
 */
router.get('/backup/list', verifyToken, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;

    // Query backup metadata from mock database
    const backups = mockBackupMetadata[userId] || [];

    res.json({
      success: true,
      backups: backups.map((b) => ({
        id: b.id,
        timestamp: b.timestamp,
        size: b.dataSize,
        deviceInfo: b.deviceInfo,
        version: b.version,
        checksumHash: b.checksumHash,
      })),
      count: backups.length,
      totalSize: backups.reduce((sum, b) => sum + b.dataSize, 0)
    });
  } catch (error) {
    console.error('Failed to list backups:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list backups',
      code: 'LIST_ERROR'
    });
  }
});

/**
 * POST /api/data/backup/restore
 * Restore from backup
 */
router.post('/backup/restore', verifyToken, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { backupId, encryptionKey } = req.body;

    if (!backupId || !encryptionKey) {
      return res.status(400).json({
        success: false,
        error: 'Backup ID and encryption key required',
        code: 'MISSING_PARAMS'
      });
    }

    // Fetch backup metadata from mock database
    const backups = mockBackupMetadata[userId] || [];
    const backupMetadata = backups.find(b => b.id === backupId);

    if (!backupMetadata) {
      return res.status(404).json({
        success: false,
        error: 'Backup not found',
        code: 'NOT_FOUND'
      });
    }

    // In production, fetch backup from cloud storage (S3/Google Cloud/Azure)
    // Example: const backupData = await s3Client.getObject({ Bucket: 'backups', Key: `${userId}/${backupId}` });
    // For mock, we'll simulate with encrypted data
    const backupData = JSON.stringify({ data: 'mock_encrypted_backup_data' });
    const checksum = backupMetadata.checksumHash;

    // Restore backup with decryption
    const restored = await backupService.restoreBackup(backupData, encryptionKey, checksum);

    // In production, validate restored data structure and merge with current user data
    console.log(`✓ Backup restored for user ${userId}: ${backupId}`);

    res.json({
      success: true,
      message: 'Backup restored successfully',
      dataRestored: {
        chatMessages: restored.data.chatHistory?.length || 0,
        checkIns: restored.data.checkIns?.length || 0,
        challenges: restored.data.challenges?.length || 0,
        journalEntries: restored.data.journalEntries?.length || 0,
        totalDataPoints: (restored.data.chatHistory?.length || 0) +
                        (restored.data.checkIns?.length || 0) +
                        (restored.data.challenges?.length || 0) +
                        (restored.data.journalEntries?.length || 0)
      },
    });
  } catch (error) {
    console.error('Backup restore failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to restore backup',
      code: 'RESTORE_ERROR'
    });
  }
});

// ==================== EXPORT ROUTES ====================

/**
 * POST /api/data/export
 * Export user data in requested format (JSON, CSV, or HTML)
 */
router.post('/export', verifyToken, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const {
      format = 'json',
      includeChat = true,
      includeCheckIns = true,
      includeChallenges = false,
      includeJournal = true,
      includeAnalytics = false,
      dateRange,
    } = req.body;

    if (!['json', 'csv', 'html'].includes(format)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid export format. Must be json, csv, or html',
        code: 'INVALID_FORMAT'
      });
    }

    // Fetch user data from mock database
    const userData = getUserData(userId);

    // Filter data based on date range if provided
    let filteredData = { ...userData };
    if (dateRange) {
      const startDate = new Date(dateRange.start);
      const endDate = new Date(dateRange.end);

      if (includeChat) {
        filteredData.chatHistory = userData.chatHistory.filter((msg: any) => {
          const msgDate = new Date(msg.timestamp);
          return msgDate >= startDate && msgDate <= endDate;
        });
      }
      if (includeCheckIns) {
        filteredData.checkIns = userData.checkIns.filter((ci: any) => {
          const ciDate = new Date(ci.createdAt);
          return ciDate >= startDate && ciDate <= endDate;
        });
      }
      if (includeJournal) {
        filteredData.journalEntries = userData.journalEntries.filter((je: any) => {
          const jeDate = new Date(je.createdAt);
          return jeDate >= startDate && jeDate <= endDate;
        });
      }
      if (includeChallenges) {
        filteredData.challenges = userData.challenges.filter((ch: any) => {
          const chDate = new Date(ch.createdAt);
          return chDate >= startDate && chDate <= endDate;
        });
      }
    }

    const options: exportService.ExportOptions = {
      format: format as 'json' | 'pdf',
      includeChat,
      includeCheckIns,
      includeChallenges,
      includeJournal,
      includeAnalytics,
      dateRange: dateRange
        ? {
            start: new Date(dateRange.start),
            end: new Date(dateRange.end),
          }
        : undefined,
    };

    let exportResult;

    switch (format) {
      case 'json':
        exportResult = exportService.generateJSONExport(filteredData, options);
        break;
      case 'csv':
        exportResult = exportService.generateCSVExport(filteredData, options);
        break;
      case 'html':
        exportResult = exportService.generateHTMLExport(filteredData, options);
        break;
      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid format',
          code: 'INVALID_FORMAT'
        });
    }

    // Log export action (in production, store in audit logs)
    console.log(`✓ User ${userId} exported data as ${format} (${exportResult.filename})`);

    // Send file
    res.setHeader('Content-Disposition', `attachment; filename="${exportResult.filename}"`);
    res.setHeader('Content-Type', exportResult.mimeType);
    res.send(exportResult.content);
  } catch (error) {
    console.error('Export failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to export data',
      code: 'EXPORT_ERROR'
    });
  }
});

// ==================== ACCOUNT RECOVERY ROUTES ====================

/**
 * POST /api/recovery/start
 * Start account recovery process
 */
router.post('/recovery/start', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required',
        code: 'MISSING_EMAIL'
      });
    }

    // In production, find user by email from database
    // For mock, generate a recovery token
    const tokenId = `recovery_${Date.now()}`;
    const recoveryToken = recoveryService.generatePasswordResetToken().token;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Store recovery token in mock storage
    mockRecoveryTokens[tokenId] = {
      token: recoveryToken,
      email,
      expiresAt,
      used: false
    };

    // In production, send email with recovery options
    console.log(`✓ Recovery started for ${email} (token: ${tokenId})`);

    res.json({
      success: true,
      message: 'Recovery instructions sent to email',
      recoveryToken: tokenId, // In production, don't return actual token
      expiresIn: '15 minutes'
    });
  } catch (error) {
    console.error('Recovery start failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to start recovery',
      code: 'RECOVERY_ERROR'
    });
  }
});

/**
 * POST /api/recovery/verify-security-questions
 * Verify security questions for recovery
 */
router.post('/recovery/verify-security-questions', async (req: Request, res: Response) => {
  try {
    const { recoveryToken, answers } = req.body;

    if (!recoveryToken || !answers || answers.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Recovery token and answers required',
        code: 'MISSING_PARAMS'
      });
    }

    // Verify recovery token is valid and not expired
    const tokenData = mockRecoveryTokens[recoveryToken];
    if (!tokenData || tokenData.used || tokenData.expiresAt < new Date()) {
      return res.status(401).json({
        success: false,
        error: 'Recovery token is invalid or expired',
        code: 'INVALID_TOKEN'
      });
    }

    // In production: verify answers match stored hashes for user
    // For mock, assume answers are correct
    console.log(`✓ Security questions verified for ${tokenData.email}`);

    // Create temporary reset token
    const resetToken = recoveryService.createRecoveryToken('user_id', 'security_questions');

    // Mark recovery token as used
    tokenData.used = true;

    res.json({
      success: true,
      resetToken: resetToken.token,
      expiresAt: resetToken.expiresAt,
      message: 'Security questions verified successfully'
    });
  } catch (error) {
    console.error('Security question verification failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to verify security questions',
      code: 'VERIFICATION_ERROR'
    });
  }
});

/**
 * POST /api/recovery/verify-2fa
 * Verify 2FA code for recovery
 */
router.post('/recovery/verify-2fa', async (req: Request, res: Response) => {
  try {
    const { recoveryToken, code } = req.body;

    if (!recoveryToken || !code) {
      return res.status(400).json({
        success: false,
        error: 'Recovery token and code required',
        code: 'MISSING_PARAMS'
      });
    }

    // Verify recovery token is valid and not expired
    const tokenData = mockRecoveryTokens[recoveryToken];
    if (!tokenData || tokenData.used || tokenData.expiresAt < new Date()) {
      return res.status(401).json({
        success: false,
        error: 'Recovery token is invalid or expired',
        code: 'INVALID_TOKEN'
      });
    }

    // In production: verify 2FA code against user's stored 2FA secret
    // For mock, assume code is correct if it's 6 digits
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid 2FA code format',
        code: 'INVALID_CODE'
      });
    }

    console.log(`✓ 2FA code verified for ${tokenData.email}`);

    // Create temporary reset token
    const resetToken = recoveryService.createRecoveryToken('user_id', 'email');

    // Mark recovery token as used
    tokenData.used = true;

    res.json({
      success: true,
      resetToken: resetToken.token,
      expiresAt: resetToken.expiresAt,
      message: '2FA verification successful'
    });
  } catch (error) {
    console.error('2FA verification failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to verify 2FA code',
      code: 'VERIFICATION_ERROR'
    });
  }
});

/**
 * POST /api/recovery/reset-password
 * Reset password with valid recovery token
 */
router.post('/recovery/reset-password', async (req: Request, res: Response) => {
  try {
    const { resetToken, newPassword } = req.body;

    if (!resetToken || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Reset token and new password required',
        code: 'MISSING_PARAMS'
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 8 characters',
        code: 'WEAK_PASSWORD'
      });
    }

    // In production: verify reset token and update user password
    // For mock, just confirm the operation
    console.log(`✓ Password reset for reset token: ${resetToken}`);

    res.json({
      success: true,
      message: 'Password reset successfully',
      nextStep: 'Login with your new password'
    });
  } catch (error) {
    console.error('Password reset failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reset password',
      code: 'RESET_ERROR'
    });
  }
});

// ==================== DATA DELETION ROUTES ====================

/**
 * POST /api/data/delete/request
 * Request data deletion (starts grace period)
 */
router.post('/data/delete/request', verifyToken, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { scope, reason, gracePeriodDays } = req.body;

    if (!scope) {
      return res.status(400).json({
        success: false,
        error: 'Deletion scope required',
        code: 'MISSING_SCOPE'
      });
    }

    // Create deletion request
    const deletionRequest = deletionService.createDeletionRequest(userId, scope, gracePeriodDays);

    // Store deletion request in mock database
    if (!mockDeletionRequests[userId]) {
      mockDeletionRequests[userId] = [];
    }

    mockDeletionRequests[userId].push(deletionRequest);

    // In production, send confirmation email with 30-day warning
    console.log(`✓ Deletion request created for user ${userId}: ${deletionRequest.id}`);

    res.status(201).json({
      success: true,
      message: 'Deletion request created. You have 30 days to cancel.',
      deletionRequest: {
        id: deletionRequest.id,
        status: deletionRequest.status,
        requestedAt: deletionRequest.requestedAt,
        confirmationDeadline: deletionRequest.confirmationDeadline,
        gracePeriodDays: Math.ceil(
          (deletionRequest.confirmationDeadline.getTime() - deletionRequest.requestedAt.getTime()) /
            (24 * 60 * 60 * 1000)
        ),
        scope,
        reason
      },
    });
  } catch (error) {
    console.error('Deletion request failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to request data deletion',
      code: 'DELETION_ERROR'
    });
  }
});

/**
 * GET /api/data/delete/status
 * Check status of deletion request
 */
router.get('/data/delete/status', verifyToken, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;

    // Fetch active deletion request from mock database
    const userDeletionRequests = mockDeletionRequests[userId] || [];
    const activeDeletionRequest = userDeletionRequests.find(
      (dr) => dr.status !== deletionService.DeletionStatus.DELETED && dr.status !== deletionService.DeletionStatus.CANCELLED
    );

    if (!activeDeletionRequest) {
      return res.json({
        success: true,
        hasDeletionRequest: false,
        message: 'No active deletion request'
      });
    }

    const timeRemaining = deletionService.getTimeRemaining(activeDeletionRequest);

    res.json({
      success: true,
      hasDeletionRequest: true,
      deletionRequest: {
        id: activeDeletionRequest.id,
        status: activeDeletionRequest.status,
        requestedAt: activeDeletionRequest.requestedAt,
        confirmationDeadline: activeDeletionRequest.confirmationDeadline,
        timeRemaining,
        scope: activeDeletionRequest.dataDeletedSections,
      },
    });
  } catch (error) {
    console.error('Failed to check deletion status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check deletion status',
      code: 'STATUS_ERROR'
    });
  }
});

/**
 * POST /api/data/delete/cancel
 * Cancel deletion request during grace period
 */
router.post('/data/delete/cancel', verifyToken, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;

    // Fetch active deletion request from mock database
    const userDeletionRequests = mockDeletionRequests[userId] || [];
    let deletionRequest = userDeletionRequests.find(
      (dr) => dr.status !== deletionService.DeletionStatus.DELETED && dr.status !== deletionService.DeletionStatus.CANCELLED
    );

    if (!deletionRequest) {
      return res.status(404).json({
        success: false,
        error: 'No active deletion request to cancel',
        code: 'NOT_FOUND'
      });
    }

    // Check if still within grace period
    if (deletionRequest.confirmationDeadline < new Date()) {
      return res.status(400).json({
        success: false,
        error: 'Grace period has expired. Deletion cannot be cancelled.',
        code: 'GRACE_PERIOD_EXPIRED'
      });
    }

    // Cancel the deletion request
    deletionRequest = deletionService.cancelDeletionRequest(deletionRequest);

    // Update in mock database
    const index = userDeletionRequests.indexOf(deletionRequest);
    if (index > -1) {
      userDeletionRequests[index] = deletionRequest;
    }

    // In production, send cancellation confirmation email
    console.log(`✓ Deletion request cancelled for user ${userId}: ${deletionRequest.id}`);

    res.json({
      success: true,
      message: 'Deletion request cancelled successfully',
      deletionRequest: {
        id: deletionRequest.id,
        status: deletionRequest.status,
        cancelledAt: deletionRequest.cancelledAt
      }
    });
  } catch (error) {
    console.error('Cancellation failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cancel deletion request',
      code: 'CANCEL_ERROR'
    });
  }
});

/**
 * POST /api/data/delete/confirm
 * Confirm deletion (user must confirm before permanent deletion)
 */
router.post('/data/delete/confirm', verifyToken, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { deletionRequestId } = req.body;

    if (!deletionRequestId) {
      return res.status(400).json({
        success: false,
        error: 'Deletion request ID required',
        code: 'MISSING_ID'
      });
    }

    // Fetch deletion request from mock database
    const userDeletionRequests = mockDeletionRequests[userId] || [];
    let deletionRequest = userDeletionRequests.find((dr) => dr.id === deletionRequestId);

    if (!deletionRequest) {
      return res.status(404).json({
        success: false,
        error: 'Deletion request not found',
        code: 'NOT_FOUND'
      });
    }

    // Check if still within grace period
    const isGracePeriodExpired = deletionService.shouldProceedWithDeletion(deletionRequest);

    // Confirm deletion
    deletionRequest = deletionService.confirmDeletion(deletionRequest);

    // Update in mock database
    const index = userDeletionRequests.indexOf(deletionRequest);
    if (index > -1) {
      userDeletionRequests[index] = deletionRequest;
    }

    // In production:
    // - If grace period expired, immediately process deletion
    // - Otherwise, schedule cron job to process at deadline

    console.log(`✓ Deletion confirmed for user ${userId}: ${deletionRequest.id} (grace period expired: ${isGracePeriodExpired})`);

    res.json({
      success: true,
      message: isGracePeriodExpired ? 'Account and data deleted permanently' : 'Deletion confirmed. Will be processed at deadline.',
      deletionRequest: {
        id: deletionRequest.id,
        status: deletionRequest.status,
        deletedAt: deletionRequest.deletedAt,
        willBeProcessedAt: isGracePeriodExpired ? new Date() : deletionRequest.confirmationDeadline
      },
      immediatelyDeleted: isGracePeriodExpired
    });
  } catch (error) {
    console.error('Deletion confirmation failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to confirm deletion',
      code: 'CONFIRM_ERROR'
    });
  }
});

export default router;
