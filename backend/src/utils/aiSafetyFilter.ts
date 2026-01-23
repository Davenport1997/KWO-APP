/**
 * AI Safety Filter for Backend
 *
 * Filters AI responses before sending to users to prevent:
 * - Medical diagnoses or prescriptions
 * - Medication/dosage advice
 * - Emergency bypass suggestions
 * - Self-harm instructions
 * - Harmful content
 */

export enum SafetyViolationType {
  MEDICAL_DIAGNOSIS = 'medical_diagnosis',
  MEDICATION_ADVICE = 'medication_advice',
  DOSAGE_CHANGE = 'dosage_change',
  EMERGENCY_BYPASS = 'emergency_bypass',
  HARMFUL_INSTRUCTION = 'harmful_instruction',
}

export interface SafetyCheckResult {
  isSafe: boolean;
  violations: SafetyViolationType[];
  confidence: number;
  message: string;
  requiredDisclaimer?: string;
}

// Medical diagnosis keywords
const DIAGNOSIS_KEYWORDS = [
  'you have depression',
  'you have anxiety',
  'you are depressed',
  'you are bipolar',
  'you have ptsd',
  'you have adhd',
  'you have ocd',
  'i diagnose',
  'diagnosis is',
  'you suffer from',
  'you\'re addicted',
  'substance use disorder',
  'alcohol use disorder',
  'clinically depressed',
  'clinical diagnosis',
];

// Medication/dosage keywords
const MEDICATION_KEYWORDS = [
  'take this medication',
  'take these pills',
  'mg of',
  'milligrams of',
  'dosage of',
  'increase your dose',
  'decrease your dose',
  'stop taking your',
  'start taking',
  'prescribe',
  'xanax',
  'valium',
  'ativan',
  'klonopin',
  'adderall',
  'oxycodone',
  'hydrocodone',
  'fentanyl',
  'methadone',
  'suboxone',
];

// Emergency bypass keywords
const EMERGENCY_BYPASS_KEYWORDS = [
  'instead of calling 911',
  'don\'t go to the hospital',
  'avoid the emergency room',
  'skip the er',
  'you don\'t need emergency',
  'try this before calling',
  'no need to call for help',
];

// Harmful instruction keywords
const HARMFUL_KEYWORDS = [
  'how to kill',
  'how to die',
  'suicide method',
  'ways to end your life',
  'painless way to',
  'overdose on',
  'cut yourself',
  'hurt yourself',
  'self harm method',
  'hang yourself',
  'jump off',
  'lethal dose',
];

// Hard stop phrases that should NEVER appear in responses
const HARD_STOP_PHRASES = [
  'god is disappointed in you',
  'you deserve to suffer',
  'you\'re a failure',
  'you\'ll never recover',
  'no one can help you',
  'you should give up',
  'you\'re hopeless',
  'you\'re worthless',
  'you deserve this pain',
  'god has abandoned you',
  'you\'re beyond saving',
  'relapse is inevitable',
  'you can\'t be helped',
];

/**
 * Check AI response for safety violations
 */
export function checkAISafety(aiResponse: string): SafetyCheckResult {
  const lowerResponse = aiResponse.toLowerCase();
  const violations: SafetyViolationType[] = [];
  let highestConfidence = 0;

  // Check for medical diagnosis
  for (const keyword of DIAGNOSIS_KEYWORDS) {
    if (lowerResponse.includes(keyword)) {
      violations.push(SafetyViolationType.MEDICAL_DIAGNOSIS);
      highestConfidence = Math.max(highestConfidence, 0.9);
      break;
    }
  }

  // Check for medication advice
  for (const keyword of MEDICATION_KEYWORDS) {
    if (lowerResponse.includes(keyword)) {
      // Context check: "talk to your doctor about medication" is OK
      if (!lowerResponse.includes('talk to') &&
          !lowerResponse.includes('consult') &&
          !lowerResponse.includes('doctor') &&
          !lowerResponse.includes('professional')) {
        violations.push(SafetyViolationType.MEDICATION_ADVICE);
        highestConfidence = Math.max(highestConfidence, 0.85);
        break;
      }
    }
  }

  // Check for emergency bypass
  for (const keyword of EMERGENCY_BYPASS_KEYWORDS) {
    if (lowerResponse.includes(keyword)) {
      violations.push(SafetyViolationType.EMERGENCY_BYPASS);
      highestConfidence = Math.max(highestConfidence, 0.95);
      break;
    }
  }

  // Check for harmful instructions
  for (const keyword of HARMFUL_KEYWORDS) {
    if (lowerResponse.includes(keyword)) {
      violations.push(SafetyViolationType.HARMFUL_INSTRUCTION);
      highestConfidence = Math.max(highestConfidence, 0.98);
      break;
    }
  }

  // Check for hard stop phrases
  for (const phrase of HARD_STOP_PHRASES) {
    if (lowerResponse.includes(phrase)) {
      violations.push(SafetyViolationType.HARMFUL_INSTRUCTION);
      highestConfidence = 1.0;
      break;
    }
  }

  const isSafe = violations.length === 0;

  return {
    isSafe,
    violations: [...new Set(violations)],
    confidence: highestConfidence,
    message: isSafe
      ? 'Response is safe'
      : `Detected ${violations.length} safety violation(s): ${violations.join(', ')}`,
    requiredDisclaimer: generateDisclaimer(violations),
  };
}

/**
 * Generate disclaimer based on violations
 */
function generateDisclaimer(violations: SafetyViolationType[]): string | undefined {
  if (violations.length === 0) return undefined;

  const messages: string[] = [];

  if (violations.includes(SafetyViolationType.MEDICAL_DIAGNOSIS) ||
      violations.includes(SafetyViolationType.MEDICATION_ADVICE)) {
    messages.push('I cannot provide medical advice. Please consult a healthcare professional.');
  }

  if (violations.includes(SafetyViolationType.EMERGENCY_BYPASS)) {
    messages.push('If you are in immediate danger, please call 911 or go to the nearest emergency room.');
  }

  if (violations.includes(SafetyViolationType.HARMFUL_INSTRUCTION)) {
    messages.push('If you are having thoughts of self-harm, please call 988 (Suicide & Crisis Lifeline) immediately.');
  }

  return messages.join('\n\n');
}

/**
 * Sanitize AI response - replace unsafe content with safe alternative
 */
export function sanitizeAIResponse(
  aiResponse: string,
  safetyCheck: SafetyCheckResult
): { sanitizedResponse: string; disclaimer: string; wasFiltered: boolean } {
  if (safetyCheck.isSafe) {
    return {
      sanitizedResponse: aiResponse,
      disclaimer: '',
      wasFiltered: false,
    };
  }

  // For critical violations, replace entirely
  const hasCriticalViolation =
    safetyCheck.violations.includes(SafetyViolationType.MEDICAL_DIAGNOSIS) ||
    safetyCheck.violations.includes(SafetyViolationType.MEDICATION_ADVICE) ||
    safetyCheck.violations.includes(SafetyViolationType.DOSAGE_CHANGE);

  if (hasCriticalViolation) {
    return {
      sanitizedResponse: "I appreciate you sharing that with me, but I'm not able to provide medical or medication advice. This is really important to discuss with a healthcare professional who knows your full medical history.\n\nIf you're struggling, I'm here to listen and support you in other ways.",
      disclaimer: safetyCheck.requiredDisclaimer || '',
      wasFiltered: true,
    };
  }

  // For harmful instructions, replace with crisis resources
  if (safetyCheck.violations.includes(SafetyViolationType.HARMFUL_INSTRUCTION)) {
    return {
      sanitizedResponse: "I'm concerned about your safety. Please reach out for immediate support:\n\n📞 Call or text 988 (Suicide & Crisis Lifeline)\n🚨 Or go to your nearest emergency room\n\nYou are not alone, and help is available right now.",
      disclaimer: safetyCheck.requiredDisclaimer || '',
      wasFiltered: true,
    };
  }

  // For emergency bypass, add disclaimer but keep response
  return {
    sanitizedResponse: aiResponse,
    disclaimer: safetyCheck.requiredDisclaimer || '',
    wasFiltered: true,
  };
}

/**
 * Log safety violation for monitoring
 */
export function logSafetyViolation(
  userId: string,
  violation: SafetyCheckResult,
  userMessage: string,
  aiResponse: string
): void {
  console.error('[SAFETY VIOLATION]', {
    timestamp: new Date().toISOString(),
    userId,
    violations: violation.violations,
    confidence: violation.confidence,
    userMessage: userMessage.substring(0, 200), // Truncate for privacy
    aiResponse: aiResponse.substring(0, 200),
  });
}
