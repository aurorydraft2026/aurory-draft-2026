import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';

// ─── TIER CONFIGURATION ───
interface TierInfo {
  max: number;
  upgradeCost: number | null;
  gaugeMax: number;
  subName: string;
}

const TIER_CONFIG: Record<number, TierInfo> = {
  1: { max: 150000, upgradeCost: null, gaugeMax: 100000, subName: 'Loki' },     // Tier I: 150k cap, 100k exp to upgrade
  2: { max: 350000, upgradeCost: 30000, gaugeMax: 300000, subName: 'Thor' },    // Tier II: 350k cap, 300k exp to upgrade
  3: { max: 800000, upgradeCost: 50000, gaugeMax: 700000, subName: 'Odin' },    // Tier III: 800k cap, 700k exp max
};

const UPGRADE_BONUS = 1000;

const REFERRAL_BONUS = 20000;

/**
 * Generate a unique 6-character alphanumeric referral code.
 */
function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed ambiguous: I, O, 0, 1
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Ensure a user has a referral code. If not, generate one.
 * Called lazily when the profile modal opens or on login.
 */
export const ensureReferralCode = onCall(
  { region: 'us-central1', maxInstances: 10 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required');
    const uid = request.auth.uid;
    const db = admin.firestore();

    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();

    let userData: any = {};
    if (userDoc.exists) {
      userData = userDoc.data()!;
      // Already has a code
      if (userData.referralCode) {
        return { code: userData.referralCode, tier: userData.tier || 1 };
      }
    }

    // Generate a unique code with collision check
    let code = '';
    let attempts = 0;
    while (attempts < 10) {
      code = generateCode();
      const existing = await db.collection('users')
        .where('referralCode', '==', code)
        .limit(1)
        .get();
      if (existing.empty) break;
      attempts++;
    }

    if (attempts >= 10) {
      throw new HttpsError('internal', 'Failed to generate unique referral code');
    }

    // Set tier to 1 if not already set, and assign the referral code
    const updates: Record<string, any> = {
      referralCode: code,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (!userData.tier) {
      updates.tier = 1;
    }

    await userRef.set(updates, { merge: true });

    return { code, tier: userData.tier || 1 };
  }
);

/**
 * Upgrade the user's tier level.
 * Deducts the upgrade cost from their Valcoin balance.
 */
export const upgradeTier = onCall(
  { region: 'us-central1', maxInstances: 10 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required');
    const uid = request.auth.uid;
    const db = admin.firestore();

    const userRef = db.collection('users').doc(uid);
    const historyRef = userRef.collection('pointsHistory');

    const result = await db.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userRef);
      if (!userDoc.exists) throw new HttpsError('not-found', 'User not found');

      const userData = userDoc.data()!;
      const currentTier = userData.tier || 1;
      const nextTier = currentTier + 1;

      if (nextTier > 3) {
        throw new HttpsError('failed-precondition', 'Already at max tier');
      }

      const upgradeCost = TIER_CONFIG[nextTier].upgradeCost!;
      const currentPoints = userData.points || 0;
      
      const requiredExp = TIER_CONFIG[currentTier].gaugeMax;
      // Fallback approximation for old users who haven't earned raw exp since the update
      let spentApproximation = 0;
      if (currentTier > 1) spentApproximation += 30000;
      if (currentTier > 2) spentApproximation += 50000;
      const currentExp = userData.exp !== undefined ? userData.exp : (currentPoints + spentApproximation);

      if (currentExp < requiredExp) {
        throw new HttpsError(
          'failed-precondition',
          `Not enough EXP to upgrade. Need ${requiredExp} EXP, have ${currentExp} EXP.`
        );
      }

      if (currentPoints < upgradeCost) {
        throw new HttpsError(
          'failed-precondition',
          `Not enough Valcoins. Need ${upgradeCost}, have ${currentPoints}`
        );
      }

      // Deduct cost and upgrade tier
      // NEW: Add 1,000 Valcoins promotion bonus
      const netChange = (-upgradeCost) + UPGRADE_BONUS;

      transaction.update(userRef, {
        tier: nextTier,
        points: admin.firestore.FieldValue.increment(netChange),
        exp: admin.firestore.FieldValue.increment(UPGRADE_BONUS),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Record in history
      const newHistoryRef = historyRef.doc();
      transaction.set(newHistoryRef, {
        amount: -upgradeCost,
        type: 'tier_upgrade',
        description: `Upgraded to Tier ${nextTier === 2 ? 'II' : 'III'}`,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Record the bonus separately in history for clarity
      const bonusHistoryRef = historyRef.doc();
      transaction.set(bonusHistoryRef, {
        amount: UPGRADE_BONUS,
        type: 'tier_promotion_bonus',
        description: `Promotion reward for reaching Tier ${nextTier === 2 ? 'II' : 'III'}!`,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      return { 
        newTier: nextTier, 
        cost: upgradeCost, 
        bonus: UPGRADE_BONUS,
        remainingPoints: currentPoints + netChange 
      };
    });

    // After upgrading to Tier II, check if this user was referred — might trigger bonus
    if (result.newTier === 2) {
      await checkAndAwardReferralBonus(uid, db);
    }

    return {
      success: true,
      message: `Upgraded to Tier ${result.newTier === 2 ? 'II' : 'III'}!`,
      ...result,
    };
  }
);

/**
 * Apply a referral code. Links the current user to the referrer.
 * Bonus is NOT awarded yet — only when referral is validated.
 */
export const applyReferralCode = onCall(
  { region: 'us-central1', maxInstances: 10 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required');
    const uid = request.auth.uid;
    const code = (request.data?.code || '').toString().toUpperCase().trim();
    const db = admin.firestore();

    if (!code || code.length !== 6) {
      throw new HttpsError('invalid-argument', 'Invalid referral code');
    }

    const userRef = db.collection('users').doc(uid);
    // Move existing user check inside transaction for atomicity

    // Find the referrer by code
    const referrerQuery = await db.collection('users')
      .where('referralCode', '==', code)
      .limit(1)
      .get();

    if (referrerQuery.empty) {
      throw new HttpsError('not-found', 'Referral code not found');
    }

    const referrerDoc = referrerQuery.docs[0];
    const referrerUid = referrerDoc.id;

    // Can't refer yourself
    if (referrerUid === uid) {
      throw new HttpsError('invalid-argument', 'Cannot refer yourself');
    }

    // Link referral - Perform everything atomically
    const finalResult = await db.runTransaction(async (transaction) => {
      const userSnap = await transaction.get(userRef);
      const userData = userSnap.data() || {};

      // 1. Idempotency Check: Already has THIS referrer?
      if (userData.referredBy === referrerUid) {
        return { success: true, alreadyLinked: true };
      }

      // 2. Conflict Check: Already has a DIFFERENT referrer?
      if (userData.referredBy) {
        throw new HttpsError('already-exists', 'You already have a referral applied');
      }

      // 3. Security: Can't refer yourself (check again in transaction)
      const myReferralCode = userData.referralCode;
      if (myReferralCode === code) {
        throw new HttpsError('invalid-argument', 'Cannot use your own referral code');
      }

      const updates: any = {
        referredBy: referrerUid,
        referralBonusClaimed: false,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (!userSnap.exists) {
        transaction.set(userRef, {
          uid: uid,
          tier: 1,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          ...updates
        });
      } else {
        transaction.update(userRef, updates);
      }

      // 4. Increment referrer's total referral count (Atomics)
      const referrerRef = db.collection('users').doc(referrerUid);
      transaction.update(referrerRef, {
        referralCount: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return { success: true, alreadyLinked: false };
    });

    if (finalResult.alreadyLinked) {
      return {
        success: true,
        message: 'Referral was already applied!',
        referrerName: referrerDoc.data().displayName || referrerDoc.data().username || 'Unknown',
      };
    }

    // Check if bonus should be awarded immediately (if user already qualifies)
    await checkAndAwardReferralBonus(uid, db);

    return {
      success: true,
      message: 'Referral code applied successfully!',
      referrerName: referrerDoc.data().displayName || referrerDoc.data().username || 'Unknown',
    };
  }
);

/**
 * Internal helper: Check if a referred user qualifies for the referral bonus.
 * Conditions: Has auroryPlayerId + is Tier II or above.
 * Awards 20k Valcoins to BOTH users (clamped to tier max).
 */
async function checkAndAwardReferralBonus(
  referredUid: string,
  db: admin.firestore.Firestore
): Promise<boolean> {
  const userRef = db.collection('users').doc(referredUid);

  try {
    const result = await db.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userRef);
      if (!userDoc.exists) return { success: false, reason: 'User not found' };
      
      const userData = userDoc.data()!;
      
      // 1. Core Eligibility Checks (Atomic)
      if (!userData.referredBy) return { success: false, reason: 'No referrer linked' };
      if (userData.referralBonusClaimed) return { success: false, reason: 'Bonus already claimed' };
      if (!userData.auroryPlayerId) return { success: false, reason: 'Aurory account not linked' };
      if ((userData.tier || 1) < 2) return { success: false, reason: 'Tier requirement not met' };

      const referrerUid = userData.referredBy;
      const referrerRef = db.collection('users').doc(referrerUid);
      const referrerDoc = await transaction.get(referrerRef);
      if (!referrerDoc.exists) return { success: false, reason: 'Referrer not found' };

      const referrerData = referrerDoc.data()!;

      // 2. Load Reward Config (Inside transaction)
      let bonusAmountConfig = 20000;
      const configRef = db.collection('settings').doc('valcoin_rewards');
      const configSnap = await transaction.get(configRef);
      if (configSnap.exists) {
        bonusAmountConfig = Number(configSnap.data()?.referralBonus ?? 20000);
      }

      // 3. Calculate Clamped Rewards
      const referredTier = userData.tier || 1;
      const referrerTier = referrerData.tier || 1;
      
      const referredPoints = Number(userData.points || 0);
      const referrerPoints = Number(referrerData.points || 0);

      const referredNewPointsRaw = referredPoints + bonusAmountConfig;
      const referrerNewPointsRaw = referrerPoints + bonusAmountConfig;

      const referredClamped = clampPointsToTierMax(referredNewPointsRaw, referredTier, referredPoints);
      const referrerClamped = clampPointsToTierMax(referrerNewPointsRaw, referrerTier, referrerPoints);

      const referredActualBonus = referredClamped - referredPoints;
      const referrerActualBonus = referrerClamped - referrerPoints;

      // 4. Update Both Users
      transaction.update(userRef, {
        points: referredClamped,
        exp: admin.firestore.FieldValue.increment(bonusAmountConfig),
        referralBonusClaimed: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      transaction.update(referrerRef, {
        points: referrerClamped,
        exp: admin.firestore.FieldValue.increment(bonusAmountConfig),
        validReferralCount: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // 5. Create History Entries
      const refHistoryRef = userRef.collection('pointsHistory').doc();
      transaction.set(refHistoryRef, {
        amount: referredActualBonus > 0 ? referredActualBonus : bonusAmountConfig,
        type: 'referral_bonus',
        description: 'Referral bonus — welcome reward!',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      const referrerHistoryRef = referrerRef.collection('pointsHistory').doc();
      transaction.set(referrerHistoryRef, {
        amount: referrerActualBonus > 0 ? referrerActualBonus : bonusAmountConfig,
        type: 'referral_bonus',
        description: `Referral bonus — ${userData.displayName || userData.username || 'a user'} validated!`,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {
        success: true,
        referredBonus: referredActualBonus > 0 ? referredActualBonus : bonusAmountConfig,
        referrerBonus: referrerActualBonus > 0 ? referrerActualBonus : bonusAmountConfig,
        referrerUid,
        referredName: userData.displayName || userData.username || 'User',
        referrerName: referrerData.displayName || referrerData.username || 'Inviter',
        referredPhoto: userData.auroryProfilePicture || userData.photoURL || '',
        referrerPhoto: referrerData.auroryProfilePicture || referrerData.photoURL || ''
      };
    });

    if (!result.success) {
      console.log(`[Referral] Skipping bonus for ${referredUid}: ${result.reason}`);
      return false;
    }

    // ─── POST-TRANSACTION: Notifications & Leaderboards ───
    const { 
      referredBonus, referrerBonus, referrerUid, 
      referredName, referrerName, referredPhoto, referrerPhoto 
    } = result as any;

    // Send notifications
    await db.collection('users').doc(referredUid).collection('notifications').add({
      title: '🎉 Referral Bonus!',
      message: `You earned ${referredBonus.toLocaleString()} Valcoins as a referral bonus!`,
      type: 'points',
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await db.collection('users').doc(referrerUid).collection('notifications').add({
      title: '🎉 Referral Validated!',
      message: `${referredName} you referred has been validated! You earned ${referrerBonus.toLocaleString()} Valcoins.`,
      type: 'points',
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Update Leaderboards (Visibility)
    try {
      const { updateLeaderboardStats } = require('./leaderboardUtils');
      await updateLeaderboardStats(referredUid, referredName, referredPhoto, referredBonus, 'valcoins', 'referral');
      await updateLeaderboardStats(referrerUid, referrerName, referrerPhoto, referrerBonus, 'valcoins', 'referral');
    } catch (e) {
      console.warn('[Referral] Leaderboard update failed, but points were awarded:', e);
    }

    console.log(`[Referral] ✅ Successfully awarded bonus to ${referredName} and inviter ${referrerName}`);
    return true;

  } catch (error) {
    console.error(`[Referral] ❌ Transaction error for user ${referredUid}:`, error);
    return false;
  }
}

/**
 * Clamp a user's points to their tier maximum.
 * Exported for use by other cloud functions (e.g., rewards, miniGames).
 */
export function clampPointsToTierMax(newPointsRaw: number, tier: number, oldPoints: number = 0): number {
  const config = TIER_CONFIG[tier] || TIER_CONFIG[1];
  if (oldPoints > config.max) {
      return Math.max(config.max, Math.min(newPointsRaw, oldPoints));
  }
  return Math.min(newPointsRaw, config.max);
}


export { TIER_CONFIG };

/**
 * ─── FIRESTORE TRIGGER: onUserUpdated ───
 * Automatically checks for referral bonus eligibility whenever a user's
 * profile is updated (e.g. linking Aurory account).
 */
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';

export const onUserUpdatedReferralCheck = onDocumentUpdated('users/{userId}', async (event) => {
  const newData = event.data?.after.data();
  const oldData = event.data?.before.data();
  
  if (!newData) return;

  const uid = event.params.userId;
  const db = admin.firestore();

  // 1. Check if Aurory account was just linked
  const wasLinked = !oldData?.auroryPlayerId && !!newData.auroryPlayerId;
  const changedLinking = oldData?.auroryPlayerId && newData.auroryPlayerId && oldData.auroryPlayerId !== newData.auroryPlayerId;

  // 2. Check if user just reached Tier II (already handled in upgradeTier, but this is a safety net)
  const reachedTierII = (oldData?.tier || 1) < 2 && (newData.tier || 1) >= 2;

  // If any relevant condition changed, check for bonus
  if (wasLinked || changedLinking || reachedTierII) {
    if (newData.referredBy && !newData.referralBonusClaimed) {
      console.log(`[Referral] Triggering check for user ${uid} (Linked: ${wasLinked}, Reached T2: ${reachedTierII})`);
      await checkAndAwardReferralBonus(uid, db);
    }
  }
});
