/**
 * Data Deletion Service
 * Handles GDPR-compliant data deletion with grace periods
 */

export enum DeletionStatus {
  SCHEDULED = 'scheduled', // Pending deletion
  CONFIRMING = 'confirming', // Grace period active
  DELETING = 'deleting', // In progress
  DELETED = 'deleted', // Complete
  CANCELLED = 'cancelled', // User cancelled during grace period
}

export interface DeletionRequest {
  id: string;
  userId: string;
  requestedAt: Date;
  confirmationDeadline: Date; // After this, deletion is permanent
  status: DeletionStatus;
  reason?: string;
  confirmationToken?: string;
  deletedAt?: Date;
  cancelledAt?: Date;
  dataDeletedSections: string[];
}

export interface DeletionScope {
  deleteProfile: boolean;
  deleteChatHistory: boolean;
  deleteCheckIns: boolean;
  deleteChallenges: boolean;
  deleteJournalEntries: boolean;
  deleteAnalytics: boolean;
  deleteAll: boolean;
}

export const DEFAULT_GRACE_PERIOD_DAYS = 30;
export const MIN_GRACE_PERIOD_DAYS = 14;

/**
 * Create a deletion request with grace period
 */
export function createDeletionRequest(
  userId: string,
  scope: DeletionScope,
  gracePeriodDays: number = DEFAULT_GRACE_PERIOD_DAYS
): DeletionRequest {
  // Enforce minimum grace period
  const actualGracePeriod = Math.max(gracePeriodDays, MIN_GRACE_PERIOD_DAYS);

  return {
    id: `del_${Date.now()}`,
    userId,
    requestedAt: new Date(),
    confirmationDeadline: new Date(Date.now() + actualGracePeriod * 24 * 60 * 60 * 1000),
    status: DeletionStatus.SCHEDULED,
    confirmationToken: generateConfirmationToken(),
    dataDeletedSections: Object.entries(scope)
      .filter(([_, value]) => value)
      .map(([key, _]) => key),
  };
}

/**
 * Cancel a deletion request (during grace period)
 */
export function cancelDeletionRequest(request: DeletionRequest): DeletionRequest {
  if (request.status === DeletionStatus.DELETED) {
    throw new Error('Cannot cancel deletion: data already deleted');
  }

  if (new Date() > request.confirmationDeadline) {
    throw new Error(
      'Cannot cancel deletion: grace period has expired. Deletion is now permanent.'
    );
  }

  return {
    ...request,
    status: DeletionStatus.CANCELLED,
    cancelledAt: new Date(),
  };
}

/**
 * Confirm deletion (user must confirm before permanent deletion)
 */
export function confirmDeletion(request: DeletionRequest): DeletionRequest {
  if (request.status === DeletionStatus.DELETED) {
    throw new Error('Data already deleted');
  }

  if (request.status === DeletionStatus.CANCELLED) {
    throw new Error('Deletion was cancelled');
  }

  if (new Date() > request.confirmationDeadline) {
    // Grace period expired - deletion can proceed automatically
    return {
      ...request,
      status: DeletionStatus.DELETING,
    };
  }

  // Within grace period - wait for user confirmation or expiration
  return {
    ...request,
    status: DeletionStatus.CONFIRMING,
  };
}

/**
 * Mark deletion as complete
 */
export function completeDeletion(request: DeletionRequest): DeletionRequest {
  return {
    ...request,
    status: DeletionStatus.DELETED,
    deletedAt: new Date(),
  };
}

/**
 * Check if deletion should proceed (grace period expired)
 */
export function shouldProceedWithDeletion(request: DeletionRequest): boolean {
  if (request.status === DeletionStatus.DELETED) {
    return false; // Already deleted
  }

  if (request.status === DeletionStatus.CANCELLED) {
    return false; // Cancelled
  }

  return new Date() >= request.confirmationDeadline;
}

/**
 * Get time remaining in grace period
 */
export function getTimeRemaining(request: DeletionRequest): {
  daysRemaining: number;
  hoursRemaining: number;
  minutesRemaining: number;
  totalMilliseconds: number;
  hasExpired: boolean;
} {
  const now = new Date();
  const deadline = request.confirmationDeadline;

  if (now >= deadline) {
    return {
      daysRemaining: 0,
      hoursRemaining: 0,
      minutesRemaining: 0,
      totalMilliseconds: 0,
      hasExpired: true,
    };
  }

  const diff = deadline.getTime() - now.getTime();
  const daysRemaining = Math.floor(diff / (24 * 60 * 60 * 1000));
  const hoursRemaining = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const minutesRemaining = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));

  return {
    daysRemaining,
    hoursRemaining,
    minutesRemaining,
    totalMilliseconds: diff,
    hasExpired: false,
  };
}

/**
 * Build deletion queries based on scope
 */
export function buildDeletionQueries(
  userId: string,
  scope: DeletionScope
): { table: string; condition: string }[] {
  const queries: { table: string; condition: string }[] = [];

  if (scope.deleteAll) {
    // Delete everything associated with user
    queries.push(
      { table: 'users', condition: `WHERE id = '${userId}'` },
      { table: 'user_profiles', condition: `WHERE user_id = '${userId}'` },
      { table: 'chat_messages', condition: `WHERE user_id = '${userId}'` },
      { table: 'checkins', condition: `WHERE user_id = '${userId}'` },
      { table: 'challenges', condition: `WHERE user_id = '${userId}'` },
      { table: 'journal_entries', condition: `WHERE user_id = '${userId}'` },
      { table: 'user_analytics', condition: `WHERE user_id = '${userId}'` },
      { table: 'emergency_contacts', condition: `WHERE user_id = '${userId}'` },
      { table: 'prevention_plans', condition: `WHERE user_id = '${userId}'` },
      { table: 'crisis_events', condition: `WHERE user_id = '${userId}'` },
      { table: 'backup_metadata', condition: `WHERE user_id = '${userId}'` }
    );
  } else {
    // Selective deletion
    if (scope.deleteProfile) {
      queries.push({ table: 'users', condition: `WHERE id = '${userId}'` });
      queries.push({ table: 'user_profiles', condition: `WHERE user_id = '${userId}'` });
    }

    if (scope.deleteChatHistory) {
      queries.push({ table: 'chat_messages', condition: `WHERE user_id = '${userId}'` });
    }

    if (scope.deleteCheckIns) {
      queries.push({ table: 'checkins', condition: `WHERE user_id = '${userId}'` });
    }

    if (scope.deleteChallenges) {
      queries.push({ table: 'challenges', condition: `WHERE user_id = '${userId}'` });
    }

    if (scope.deleteJournalEntries) {
      queries.push({ table: 'journal_entries', condition: `WHERE user_id = '${userId}'` });
    }

    if (scope.deleteAnalytics) {
      queries.push({ table: 'user_analytics', condition: `WHERE user_id = '${userId}'` });
      queries.push({ table: 'crisis_events', condition: `WHERE user_id = '${userId}'` });
    }
  }

  return queries;
}

/**
 * Anonymize user data instead of hard delete (softer alternative)
 */
export function anonymizeUserData(userData: any): any {
  return {
    ...userData,
    email: `deleted_${Date.now()}@deleted.local`,
    profile: {
      ...userData.profile,
      name: '[Deleted User]',
      profilePhoto: null,
    },
    phone: null,
    dateOfBirth: null,
    settings: {},
  };
}

/**
 * Create audit log entry for deletion
 */
export function createDeletionAuditLog(
  request: DeletionRequest,
  ipAddress?: string,
  userAgent?: string
): any {
  return {
    id: `audit_${Date.now()}`,
    userId: request.userId,
    action: 'DATA_DELETION',
    status: request.status,
    scope: request.dataDeletedSections,
    requestedAt: request.requestedAt,
    completedAt: request.deletedAt,
    gracePeriodDays: Math.ceil(
      (request.confirmationDeadline.getTime() - request.requestedAt.getTime()) /
        (24 * 60 * 60 * 1000)
    ),
    ipAddress,
    userAgent,
    timestamp: new Date(),
  };
}

/**
 * Generate confirmation token for deletion
 */
function generateConfirmationToken(): string {
  return require('crypto').randomBytes(32).toString('hex');
}

/**
 * Scheduled deletion check (run via cron job)
 */
export async function processPendingDeletions(
  deletionRequests: DeletionRequest[]
): Promise<{
  processed: DeletionRequest[];
  failed: { request: DeletionRequest; error: string }[];
}> {
  const processed: DeletionRequest[] = [];
  const failed: { request: DeletionRequest; error: string }[] = [];

  for (const request of deletionRequests) {
    try {
      if (request.status === DeletionStatus.SCHEDULED && shouldProceedWithDeletion(request)) {
        // Grace period expired without cancellation - proceed with deletion
        processed.push(completeDeletion(request));
      }
    } catch (error) {
      failed.push({
        request,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return { processed, failed };
}
