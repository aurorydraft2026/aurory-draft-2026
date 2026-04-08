import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { updateLeaderboardStats } from './leaderboardUtils';

/**
 * Claim the daily check-in reward.
 * Ported from client-side logic to ensure security and real-time leaderboard updates.
 */
export const collectDailyReward = onCall(
    {
        region: 'us-central1',
        maxInstances: 10
    },
    async (request) => {
        // 1. Auth Check
        if (!request.auth) throw new HttpsError('unauthenticated', 'Login required');
        const uid = request.auth.uid;
        const db = admin.firestore();

        try {
            const userRef = db.collection('users').doc(uid);
            const historyRef = userRef.collection('pointsHistory');
            
            const now = new Date();
            const todayStr = now.toISOString().split('T')[0];
            const yesterday = new Date(now);
            yesterday.setUTCDate(now.getUTCDate() - 1);
            const yesterdayStr = yesterday.toISOString().split('T')[0];

            const result = await db.runTransaction(async (transaction) => {
                const userDoc = await transaction.get(userRef);
                if (!userDoc.exists) throw new HttpsError('not-found', 'User not found');

                const userData = userDoc.data()!;
                
                // Rate limiting: Already checked in today?
                if (userData.lastDailyCheckIn === todayStr) {
                    throw new HttpsError('already-exists', 'Already checked in today!');
                }

                // Streak Logic
                let currentStreak = userData.checkInStreak || 0;
                let newStreak = 1;

                if (userData.lastDailyCheckIn === yesterdayStr) {
                    newStreak = currentStreak + 1;
                }

                // Award points (Dynamic from Settings)
                let baseAmount = 10;
                const configRef = db.collection('settings').doc('valcoin_rewards');
                const configSnap = await transaction.get(configRef);
                if (configSnap.exists) {
                    baseAmount = configSnap.data()?.dailyCheckIn ?? 10;
                }

                // Bonus Logic: Random bonus if streak >= 7
                let bonusAmount = 0;
                if (newStreak >= 7) {
                    bonusAmount = Math.floor(Math.random() * 5) + 1;
                }

                const totalAmount = baseAmount + bonusAmount;

                // Update User
                transaction.update(userRef, {
                    points: admin.firestore.FieldValue.increment(totalAmount),
                    lastDailyCheckIn: todayStr,
                    checkInStreak: newStreak,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });

                // Record History
                const newHistoryRef = historyRef.doc();
                transaction.set(newHistoryRef, {
                    amount: totalAmount,
                    baseAmount,
                    bonusAmount,
                    streak: newStreak,
                    type: 'daily_checkin',
                    description: bonusAmount > 0 
                        ? `Daily check-in reward (Streak: ${newStreak} days, +${bonusAmount} bonus)` 
                        : `Daily check-in reward (Streak: ${newStreak} days)`,
                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                });

                return { 
                    totalAmount,
                    baseAmount,
                    bonusAmount,
                    newStreak,
                    displayName: userData.auroryPlayerName || userData.displayName || 'Guest',
                    photoURL: userData.auroryProfilePicture || userData.photoURL || ''
                };
            });

            // ─── UPDATE LEADERBOARD ───
            await updateLeaderboardStats(
                uid,
                result.displayName,
                result.photoURL,
                result.totalAmount,
                'valcoins', // Currently Valcoins only
                'check-in'
            );

            return {
                success: true,
                message: result.bonusAmount > 0 
                    ? `Check-in successful! +${result.baseAmount} Valcoins and +${result.bonusAmount} bonus!`
                    : `Check-in successful! +${result.baseAmount} Valcoins`,
                points: result.totalAmount,
                streak: result.newStreak
            };

        } catch (error: any) {
            console.error('Daily check-in error:', error);
            if (error instanceof HttpsError) throw error;
            throw new HttpsError('internal', error.message || 'Check-in failed');
        }
    }
);
