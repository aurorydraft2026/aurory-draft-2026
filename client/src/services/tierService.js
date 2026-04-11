import { getFunctions, httpsCallable } from 'firebase/functions';

// ─── TIER CONFIGURATION (mirrors backend) ───
export const TIER_CONFIG = {
  1: { name: 'Tier I', max: 30000, upgradeCost: 0, roman: 'I', badge: '/Tiers/tier1_loki.png' },
  2: { name: 'Tier II', max: 50000, upgradeCost: 30000, roman: 'II', badge: '/Tiers/tier2_thor.png' },
  3: { name: 'Tier III', max: 100000, upgradeCost: 50000, roman: 'III', badge: '/Tiers/tier3_odin.png' },
};

/**
 * Get the tier progress as a percentage (0-100) for the gauge.
 */
export const getTierProgress = (points, tier) => {
  const config = TIER_CONFIG[tier] || TIER_CONFIG[1];
  if (config.max === 0) return 100;
  return Math.min(100, Math.round((points / config.max) * 100));
};

/**
 * Get the next tier info (or null if at max).
 */
export const getNextTier = (currentTier) => {
  const next = currentTier + 1;
  return TIER_CONFIG[next] || null;
};

/**
 * Call the upgradeTier cloud function.
 */
export const upgradeTier = async () => {
  const functions = getFunctions();
  const fn = httpsCallable(functions, 'upgradeTier');
  const result = await fn();
  return result.data;
};

/**
 * Call the applyReferralCode cloud function.
 */
export const applyReferralCode = async (code) => {
  const functions = getFunctions();
  const fn = httpsCallable(functions, 'applyReferralCode');
  const result = await fn({ code });
  return result.data;
};

/**
 * Call the ensureReferralCode cloud function.
 * Generates one if the user doesn't have one yet.
 */
export const ensureReferralCode = async () => {
  const functions = getFunctions();
  const fn = httpsCallable(functions, 'ensureReferralCode');
  const result = await fn();
  return result.data;
};

/**
 * Generate a referral link for sharing.
 */
export const generateReferralLink = (code) => {
  const baseUrl = window.location.origin;
  return `${baseUrl}/?ref=${code}`;
};
