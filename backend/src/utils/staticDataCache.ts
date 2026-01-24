/**
 * Static Data Cache Service
 * Caches challenges, facts, and other static content that rarely changes
 * Reduces database queries for frequently accessed data
 */

import { challengesCache, factsCache, CACHE_TTLS, generateCacheKey } from './cache.js';
import { createClient } from '@supabase/supabase-js';

// ROBUST INITIALIZATION: Prevents Vercel Crash
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Get or fetch addiction facts (cached for 24 hours)
 */
export async function getAddictionFacts(limit = 50): Promise<unknown[]> {
  const cacheKey = generateCacheKey('facts', limit);

  // Try to get from cache
  const cached = factsCache.get(cacheKey);
  if (cached) {
    console.log(`[Cache HIT] Addiction facts (limit: ${limit})`);
    return cached;
  }

  console.log(`[Cache MISS] Fetching addiction facts from database`);

  try {
    const { data, error } = await supabase
      .from('addiction_facts')
      .select('*')
      .limit(limit);

    if (error) throw error;

    // Cache the results
    if (data) {
      factsCache.set(cacheKey, data, CACHE_TTLS.FACTS);
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching addiction facts:', error);
    return [];
  }
}

/**
 * Get random addiction fact
 */
export async function getRandomFact(): Promise<unknown | null> {
  const facts = await getAddictionFacts(100);
  return facts.length > 0 ? facts[Math.floor(Math.random() * facts.length)] : null;
}

/**
 * Get or fetch daily challenges (cached for 24 hours)
 */
export async function getDailyChallenges(limit = 30): Promise<unknown[]> {
  const cacheKey = generateCacheKey('challenges', 'daily', limit);

  // Try to get from cache
  const cached = challengesCache.get(cacheKey);
  if (cached) {
    console.log(`[Cache HIT] Daily challenges (limit: ${limit})`);
    return cached;
  }

  console.log(`[Cache MISS] Fetching daily challenges from database`);

  try {
    const { data, error } = await supabase
      .from('daily_challenges')
      .select('*')
      .limit(limit);

    if (error) throw error;

    // Cache the results
    if (data) {
      challengesCache.set(cacheKey, data, CACHE_TTLS.CHALLENGES);
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching daily challenges:', error);
    return [];
  }
}

/**
 * Get micro-lessons (cached for 24 hours)
 */
export async function getMicroLessons(limit = 20): Promise<unknown[]> {
  const cacheKey = generateCacheKey('lessons', limit);

  const cached = challengesCache.get(cacheKey);
  if (cached) {
    console.log(`[Cache HIT] Micro-lessons (limit: ${limit})`);
    return cached;
  }

  console.log(`[Cache MISS] Fetching micro-lessons from database`);

  try {
    const { data, error } = await supabase
      .from('micro_lessons')
      .select('*')
      .limit(limit);

    if (error) throw error;

    if (data) {
      challengesCache.set(cacheKey, data, CACHE_TTLS.CHALLENGES);
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching micro-lessons:', error);
    return [];
  }
}

/**
 * Invalidate static data caches
 * Call this when challenges or facts are updated in admin panel
 */
export function invalidateStaticDataCache(): void {
  // Clear all challenges and facts caches
  challengesCache.invalidatePattern('.*');
  factsCache.invalidatePattern('.*');
  console.log('[Cache] Static data caches invalidated');
}

export default {
  getAddictionFacts,
  getRandomFact,
  getDailyChallenges,
  getMicroLessons,
  invalidateStaticDataCache
};
