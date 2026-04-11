import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';

// ─── TIER CONFIGURATION ───
const TIER_CONFIG: Record<number, { max: number; upgradeCost: number | null }> = {
  1: { max: 30000, upgradeCost: null },      // Tier I: 30k cap
  2: { max: 50000, upgradeCost: 30000 },     // Tier II: 50k cap
  3: { max: 100000, upgradeCost: 50000 },    // Tier III: 100k cap
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

    await userRef.update(updates);

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
  const userDoc = await userRef.get();
  if (!userDoc.exists) return false;

  const userData = userDoc.data()!;

  // Check conditions
  if (!userData.referredBy) return false;
  if (userData.referralBonusClaimed) return false;
  if (!userData.auroryPlayerId) return false;
  if ((userData.tier || 1) < 2) return false;

  const referrerUid = userData.referredBy;
  const referrerRef = db.collection('users').doc(referrerUid);
  const referrerDoc = await referrerRef.get();
  if (!referrerDoc.exists) return false;

  const referrerData = referrerDoc.data()!;

  // Calculate clamped bonus for each user
  const referredTierMax = TIER_CONFIG[userData.tier || 1]?.max || 30000;
  const referrerTierMax = TIER_CONFIG[referrerData.tier || 1]?.max || 30000;

  const referredCurrentPoints = userData.points || 0;
  const referrerCurrentPoints = referrerData.points || 0;

  const referredBonus = Math.min(REFERRAL_BONUS, referredTierMax - referredCurrentPoints);
  const referrerBonus = Math.min(REFERRAL_BONUS, referrerTierMax - referrerCurrentPoints);

  await db.runTransaction(async (transaction) => {
    // Award bonus to referred user (clamped)
    if (referredBonus > 0) {
      transaction.update(userRef, {
        points: admin.firestore.FieldValue.increment(referredBonus),
        referralBonusClaimed: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const refHistoryRef = userRef.collection('pointsHistory').doc();
      transaction.set(refHistoryRef, {
        amount: referredBonus,
        type: 'referral_bonus',
        description: 'Referral bonus — welcome reward!',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      transaction.update(userRef, {
        referralBonusClaimed: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    // Award bonus to referrer (clamped)
    if (referrerBonus > 0) {
      transaction.update(referrerRef, {
        points: admin.firestore.FieldValue.increment(referrerBonus),
        validReferralCount: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const referrerHistoryRef = referrerRef.collection('pointsHistory').doc();
      transaction.set(referrerHistoryRef, {
        amount: referrerBonus,
        type: 'referral_bonus',
        description: `Referral bonus — ${userData.displayName || 'a user'} validated!`,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      transaction.update(referrerRef, {
        validReferralCount: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  });

  // Send notifications
  const notificationsRef = db.collection('users').doc(referredUid).collection('notifications');
  await notificationsRef.add({
    title: '🎉 Referral Bonus!',
    message: `You earned ${referredBonus > 0 ? referredBonus : 0} Valcoins as a referral bonus!`,
    type: 'points',
    read: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const referrerNotifRef = db.collection('users').doc(referrerUid).collection('notifications');
  await referrerNotifRef.add({
    title: '🎉 Referral Validated!',
    message: `${userData.displayName || 'A user'} you referred has been validated! You earned ${referrerBonus > 0 ? referrerBonus : 0} Valcoins.`,
    type: 'points',
    read: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return true;
}

/**
 * Clamp a user's points to their tier maximum.
 * Exported for use by other cloud functions (e.g., rewards, miniGames).
 */
export function clampPointsToTierMax(currentPoints: number, tier: number): number {
  const config = TIER_CONFIG[tier] || TIER_CONFIG[1];
  return Math.min(currentPoints, config.max);
}

export { TIER_CONFIG };
