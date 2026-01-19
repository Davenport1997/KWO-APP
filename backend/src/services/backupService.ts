/**
 * Data Backup Service
 * Handles encrypted cloud backups and restore functionality
 */

import crypto from 'crypto';

export interface BackupConfig {
  enabled: boolean;
  encryptionKey?: string; // User's password used as part of encryption
  autoBackupEnabled: boolean;
  backupFrequency: 'daily' | 'weekly' | 'monthly'; // Default: daily
  lastBackupTime?: Date;
  nextBackupTime?: Date;
}

export interface BackupMetadata {
  id: string;
  userId: string;
  timestamp: Date;
  dataSize: number;
  encryptionAlgorithm: string;
  version: string;
  checksumHash: string;
  deviceInfo?: {
    os: string;
    appVersion: string;
  };
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  errorMessage?: string;
}

export interface BackupPayload {
  user: {
    id: string;
    email: string;
    profile: any;
    settings: any;
  };
  data: {
    chatHistory: any[];
    checkIns: any[];
    challenges: any[];
    journalEntries: any[];
    goals: any[];
    emergencyContacts: any[];
    preventionPlan: any[];
  };
  metadata: {
    backupTime: Date;
    appVersion: string;
    dataVersion: number;
  };
}

/**
 * Encrypt data using AES-256-GCM
 */
export function encryptBackup(data: BackupPayload, encryptionKey: string): {
  encrypted: string;
  iv: string;
  authTag: string;
  salt: string;
} {
  // Derive key from password using PBKDF2
  const salt = crypto.randomBytes(32);
  const key = crypto.pbkdf2Sync(encryptionKey, salt, 100000, 32, 'sha256');

  // Generate IV and cipher
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  // Encrypt data
  const jsonData = JSON.stringify(data);
  const encrypted = Buffer.concat([
    cipher.update(jsonData, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return {
    encrypted: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    salt: salt.toString('base64'),
  };
}

/**
 * Decrypt backup data
 */
export function decryptBackup(
  encryptedData: string,
  iv: string,
  authTag: string,
  salt: string,
  encryptionKey: string
): BackupPayload {
  try {
    // Derive key using same parameters
    const keyBuffer = crypto.pbkdf2Sync(
      encryptionKey,
      Buffer.from(salt, 'base64'),
      100000,
      32,
      'sha256'
    );

    // Create decipher
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      keyBuffer,
      Buffer.from(iv, 'base64')
    );

    decipher.setAuthTag(Buffer.from(authTag, 'base64'));

    // Decrypt
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedData, 'base64')),
      decipher.final(),
    ]);

    const jsonData = decrypted.toString('utf8');
    return JSON.parse(jsonData);
  } catch (error) {
    throw new Error(`Failed to decrypt backup: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Generate checksum hash for backup integrity verification
 */
export function generateBackupChecksum(data: BackupPayload): string {
  const jsonData = JSON.stringify(data);
  return crypto.createHash('sha256').update(jsonData).digest('hex');
}

/**
 * Verify backup integrity
 */
export function verifyBackupIntegrity(
  data: BackupPayload,
  expectedChecksum: string
): boolean {
  const actualChecksum = generateBackupChecksum(data);
  return actualChecksum === expectedChecksum;
}

/**
 * Calculate backup size
 */
export function calculateBackupSize(data: BackupPayload): number {
  const jsonData = JSON.stringify(data);
  return Buffer.byteLength(jsonData, 'utf8');
}

/**
 * Create backup from user data
 */
export async function createBackup(
  userId: string,
  userData: any,
  encryptionKey: string,
  metadata?: Partial<BackupMetadata>
): Promise<{ backup: string; metadata: BackupMetadata; checksum: string }> {
  const backupPayload: BackupPayload = {
    user: {
      id: userData.id,
      email: userData.email,
      profile: userData.profile || {},
      settings: userData.settings || {},
    },
    data: {
      chatHistory: userData.chatHistory || [],
      checkIns: userData.checkIns || [],
      challenges: userData.challenges || [],
      journalEntries: userData.journalEntries || [],
      goals: userData.goals || [],
      emergencyContacts: userData.emergencyContacts || [],
      preventionPlan: userData.preventionPlan || [],
    },
    metadata: {
      backupTime: new Date(),
      appVersion: metadata?.deviceInfo?.appVersion || '1.0.0',
      dataVersion: 1,
    },
  };

  // Calculate checksum before encryption
  const checksum = generateBackupChecksum(backupPayload);

  // Encrypt backup
  const encrypted = encryptBackup(backupPayload, encryptionKey);
  const backupJson = JSON.stringify(encrypted);

  // Create metadata
  const backupMetadata: BackupMetadata = {
    id: `backup_${Date.now()}`,
    userId,
    timestamp: new Date(),
    dataSize: calculateBackupSize(backupPayload),
    encryptionAlgorithm: 'aes-256-gcm',
    version: '1.0',
    checksumHash: checksum,
    deviceInfo: metadata?.deviceInfo,
    status: 'completed',
  };

  return {
    backup: backupJson,
    metadata: backupMetadata,
    checksum,
  };
}

/**
 * Restore backup
 */
export async function restoreBackup(
  backupData: string,
  encryptionKey: string,
  expectedChecksum: string
): Promise<BackupPayload> {
  // Parse encrypted backup
  const encrypted = JSON.parse(backupData);

  // Decrypt
  const decrypted = decryptBackup(
    encrypted.encrypted,
    encrypted.iv,
    encrypted.authTag,
    encrypted.salt,
    encryptionKey
  );

  // Verify integrity
  if (!verifyBackupIntegrity(decrypted, expectedChecksum)) {
    throw new Error('Backup integrity check failed. Data may be corrupted.');
  }

  return decrypted;
}
