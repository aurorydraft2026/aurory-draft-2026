import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { processPayouts } from './verifyMatches';

// Super Admin UID (hardcoded for now, same as in verifyMatches.ts)
const SUPER_ADMIN_UID = 'wgPwCyYGuYUAokSklV1LNsjCrGA3';

/**
 * Manually trigger payout for a draft.
 * Can only be called by Super Admin.
 */
export const manualPayout = onCall(
    {
        region: 'us-central1',
        maxInstances: 10
    },
    async (request) => {
        const db = admin.firestore();
        // 1. Auth Check
        if (!request.auth) {
            throw new HttpsError('unauthenticated', 'User must be logged in.');
        }

        const callerUid = request.auth.uid;

        // Strictly check if caller is the Super Admin
        // In a real app, you might check custom claims or an admin array
        if (callerUid !== SUPER_ADMIN_UID) {
            throw new HttpsError('permission-denied', 'Only Super Admin can trigger manual payouts.');
        }

        const { draftId } = request.data;
        if (!draftId) {
            throw new HttpsError('invalid-argument', 'draftId is required.');
        }

        console.log(`🔧 Manual Payout Triggered by ${callerUid} for draft ${draftId}`);

        try {
            // 2. Fetch Draft
            const draftDoc = await admin.firestore().doc(`drafts/${draftId}`).get();
            if (!draftDoc.exists) {
                throw new HttpsError('not-found', `Draft ${draftId} not found.`);
            }

            const draftData = draftDoc.data();
            if (!draftData) {
                throw new HttpsError('internal', 'Draft data is empty.');
            }

            // 3. Validate Payout Conditions
            if (draftData.verificationStatus !== 'complete') {
                // Should we allow forcing it? Maybe, but let's warn. 
                // For now, let's require at least overallWinner to be present
            }

            if (!draftData.overallWinner) {
                throw new HttpsError('failed-precondition', 'Draft has no overallWinner. Cannot pay out.');
            }

            // 4. Execute Payout
            const result = await processPayouts(draftId, draftData, draftData.overallWinner);

            return { success: true, message: result };

        } catch (error: any) {
            console.error(`Manual payout failed for ${draftId}:`, error);
            throw new HttpsError('internal', error.message || 'Unknown error during payout.');
        }
    }
);

/**
 * Cleanup inactive anonymous guest accounts.
 * Deletes users who are anonymous and haven't been seen in over 24 hours.
 */
export const cleanupInactiveGuests = onCall(
    {
        region: 'us-central1',
        timeoutSeconds: 540, // 9 minutes max
        memory: '512MiB'
    },
    async (request) => {
        // 1. Auth Check
        if (!request.auth) {
            throw new HttpsError('unauthenticated', 'User must be logged in.');
        }

        const callerUid = request.auth.uid;
        if (callerUid !== SUPER_ADMIN_UID) {
            throw new HttpsError('permission-denied', 'Only Super Admin can trigger cleanup.');
        }

        console.log(`🧹 Manual Cleanup Triggered by ${callerUid}`);

        try {
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

            // 2. Query Firestore for inactive anonymous users
            const usersRef = admin.firestore().collection('users');
            const q = usersRef
                .where('isAnonymous', '==', true)
                .where('lastSeen', '<', admin.firestore.Timestamp.fromDate(oneDayAgo))
                .limit(500); // Process in batches to avoid timeout

            const snapshot = await q.get();
            const uidsToDelete = snapshot.docs.map(doc => doc.id);

            if (uidsToDelete.length === 0) {
                return { success: true, count: 0, message: 'No inactive guests found.' };
            }

            console.log(`🗑️ Deleting ${uidsToDelete.length} inactive guests...`);

            // 3. Delete from Firebase Auth
            // Note: deleteUsers is limited to 1000 at a time
            await admin.auth().deleteUsers(uidsToDelete);

            // 4. Delete from Firestore
            const batch = admin.firestore().batch();
            snapshot.docs.forEach(doc => {
                batch.delete(doc.ref);
            });
            await batch.commit();

            return {
                success: true,
                count: uidsToDelete.length,
                message: `Successfully deleted ${uidsToDelete.length} inactive guests.`
            };

        } catch (error: any) {
            console.error('Cleanup failed:', error);
            throw new HttpsError('internal', error.message || 'Unknown error during cleanup.');
        }
    }
);

/**
 * Reset all mini-game leaderboard statistics.
 * Optionally wipes all play history logs (miniGameHistory subcollection).
 */
export const resetMiniGameStats = onCall(
    {
        region: 'us-central1',
        timeoutSeconds: 540,
        memory: '1GiB',
        maxInstances: 10,
        cors: true
    },
    async (request) => {
        // 1. Auth Check
        if (!request.auth) {
            throw new HttpsError('unauthenticated', 'User must be logged in.');
        }

        const callerUid = request.auth.uid;
        if (callerUid !== SUPER_ADMIN_UID) {
            throw new HttpsError('permission-denied', 'Only Super Admin can reset stats.');
        }

        const wipeHistory = request.data?.wipeHistory === true;
        console.log(`🏆 Global Mini-Game Stats Reset Triggered by ${callerUid} (Wipe History: ${wipeHistory})`);

        try {
            const db = admin.firestore();
            let totalHistoryDeleted = 0;
            let currentBatch = db.batch();
            let countInBatch = 0;

            const commitBatch = async () => {
                if (countInBatch > 0) {
                    await currentBatch.commit();
                    currentBatch = db.batch();
                    countInBatch = 0;
                }
            };

            // 1. OPTIONAL: Wipe individual game logs using COLLECTION GROUP (Fast!)
            if (wipeHistory) {
                // Clear Firestore subcollections
                const historySnapshot = await db.collectionGroup('miniGameHistory').get();
                for (const histDoc of historySnapshot.docs) {
                    currentBatch.delete(histDoc.ref);
                    countInBatch++;
                    totalHistoryDeleted++;

                    if (countInBatch >= 450) await commitBatch();
                }
                await commitBatch();

                // Clear Realtime Database 'Recent Action' feed
                try {
                    await admin.database().ref('recentMiniGameWinners').remove();
                    await admin.database().ref('drakkar_race/history').remove();
                    console.log('Successfully cleared Realtime Database recent winners and Drakkar history.');
                } catch (rtdbErr) {
                    console.error('Error clearing RTDB winners:', rtdbErr);
                }

                console.log(`Deleted ${totalHistoryDeleted} mini-game logs.`);
            }

            // 2. Reset overall stats for every user
            const usersRef = db.collection('users');
            const usersSnapshot = await usersRef.get();
            let totalUsersProcessed = 0;

            for (const userDoc of usersSnapshot.docs) {
                currentBatch.update(userDoc.ref, {
                    'stats.miniGames': {},
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });

                countInBatch++;
                totalUsersProcessed++;

                if (countInBatch >= 450) await commitBatch();
            }
            await commitBatch();

            return {
                success: true,
                count: totalUsersProcessed,
                historyDeleted: totalHistoryDeleted,
                message: `Successfully reset mini-game stats for ${totalUsersProcessed} users.${wipeHistory ? ` Deleted ${totalHistoryDeleted} history records.` : ''}`
            };

        } catch (error: any) {
            console.error('Reset stats failed:', error);
            throw new HttpsError('internal', error.message || 'Unknown error during stats reset.');
        }
    }
);

/**
 * Permanently delete ALL notifications for ALL users across the platform.
 * HIGH RISK: Clears the 'notifications' subcollection for every user record.
 */
export const clearAllGlobalNotifications = onCall(
    {
        region: 'us-central1',
        timeoutSeconds: 540, // 9 minutes
        memory: '512MiB',
        maxInstances: 10
    },
    async (request) => {
        // 1. Auth Check
        if (!request.auth) {
            throw new HttpsError('unauthenticated', 'User must be logged in.');
        }

        const callerUid = request.auth.uid;
        if (callerUid !== SUPER_ADMIN_UID) {
            throw new HttpsError('permission-denied', 'Only Super Admin can clear all notifications.');
        }

        console.log(`🚨 Global Notification Wipe Triggered by ${callerUid}`);

        try {
            const db = admin.firestore();

            // USE COLLECTION GROUP: Hits all 'notifications' subcollections across all users efficiently
            const notificationsRef = db.collectionGroup('notifications');
            const snapshot = await notificationsRef.get();

            if (snapshot.empty) {
                return {
                    success: true,
                    notificationsDeleted: 0,
                    message: "No notifications found to clear."
                };
            }

            let totalNotificationsDeleted = 0;
            let currentBatch = db.batch();
            let countInBatch = 0;

            for (const notifDoc of snapshot.docs) {
                currentBatch.delete(notifDoc.ref);
                countInBatch++;
                totalNotificationsDeleted++;

                // Commit batch at 450 items (Firestore limit is 500)
                if (countInBatch >= 450) {
                    await currentBatch.commit();
                    currentBatch = db.batch();
                    countInBatch = 0;
                    console.log(`Deleted ${totalNotificationsDeleted} notifications...`);
                }
            }

            // Final commit for leftover items
            if (countInBatch > 0) {
                await currentBatch.commit();
            }

            return {
                success: true,
                notificationsDeleted: totalNotificationsDeleted,
                message: `Successfully cleared ${totalNotificationsDeleted} notifications across all users.`
            };

        } catch (error: any) {
            console.error('Global notification wipe failed:', error);
            throw new HttpsError('internal', error.message || 'Unknown error during notification wipe.');
        }
    }
);

/**
 * Global Wallet Reset (Beta-to-Launch Cleanup)
 * 1. Resets points (users) to 0.
 * 2. Resets balance and usdcBalance (wallets) to 0.
 * 3. Wipes ALL transactions, pointsHistory, withdrawals, and depositNotifications.
 */
export const resetGlobalWallets = onCall(
    {
        region: 'us-central1',
        timeoutSeconds: 540,
        memory: '1GiB',
        maxInstances: 10,
        cors: true
    },
    async (request) => {
        // 1. Auth Check
        if (!request.auth) {
            throw new HttpsError('unauthenticated', 'User must be logged in.');
        }

        const callerUid = request.auth.uid;
        if (callerUid !== SUPER_ADMIN_UID) {
            throw new HttpsError('permission-denied', 'Only Super Admin can reset global wallets.');
        }

        console.log(`🚨 GLOBAL WALLET RESET TRIGGERED BY ${callerUid}`);

        try {
            const db = admin.firestore();
            let totalRecordsDeleted = 0;
            let currentBatch = db.batch();
            let countInBatch = 0;

            const commitBatch = async () => {
                if (countInBatch > 0) {
                    await currentBatch.commit();
                    currentBatch = db.batch();
                    countInBatch = 0;
                }
            };

            // A. WIPE HISTORY (Recursive/CollectionGroup Deletions)
            // 1. Transactions (wallets subcollection)
            const transactionsSnap = await db.collectionGroup('transactions').get();
            for (const doc of transactionsSnap.docs) {
                currentBatch.delete(doc.ref);
                countInBatch++;
                totalRecordsDeleted++;
                if (countInBatch >= 450) await commitBatch();
            }
            await commitBatch();

            // 2. PointsHistory (users subcollection)
            const pointsSnap = await db.collectionGroup('pointsHistory').get();
            for (const doc of pointsSnap.docs) {
                currentBatch.delete(doc.ref);
                countInBatch++;
                totalRecordsDeleted++;
                if (countInBatch >= 450) await commitBatch();
            }
            await commitBatch();

            // 3. Withdrawals (top-level collection)
            const withdrawalsSnap = await db.collection('withdrawals').get();
            for (const doc of withdrawalsSnap.docs) {
                currentBatch.delete(doc.ref);
                countInBatch++;
                totalRecordsDeleted++;
                if (countInBatch >= 450) await commitBatch();
            }
            await commitBatch();

            // 4. DepositNotifications (top-level collection)
            const depositsSnap = await db.collection('depositNotifications').get();
            for (const doc of depositsSnap.docs) {
                currentBatch.delete(doc.ref);
                countInBatch++;
                totalRecordsDeleted++;
                if (countInBatch >= 450) await commitBatch();
            }
            await commitBatch();

            // B. RESET BALANCES
            // 1. Reset points in users collection
            const usersSnap = await db.collection('users').get();
            for (const doc of usersSnap.docs) {
                currentBatch.update(doc.ref, { points: 0, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
                countInBatch++;
                if (countInBatch >= 450) await commitBatch();
            }
            await commitBatch();

            // 2. Reset balance and usdcBalance in wallets collection
            const walletsSnap = await db.collection('wallets').get();
            for (const doc of walletsSnap.docs) {
                currentBatch.update(doc.ref, {
                    balance: 0,
                    usdcBalance: 0,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
                countInBatch++;
                if (countInBatch >= 450) await commitBatch();
            }
            await commitBatch();

            return {
                success: true,
                message: `SUCCESS: Reset all balances to 0 and cleared ${totalRecordsDeleted} history records.`
            };

        } catch (error: any) {
            console.error('Global Reset Failed:', error);
            throw new HttpsError('internal', error.message || 'Unknown error during global reset.');
        }
    }
);

/**
 * Migration Script: Populate RTDB Minigame Leaderboards (All-Time) from Firestore stats.
 */
export const migrateMinigameLeaderboards = onCall(
    {
        region: 'us-central1',
        timeoutSeconds: 540,
        memory: '1GiB',
        maxInstances: 5
    },
    async (request) => {
        if (!request.auth) throw new HttpsError('unauthenticated', 'Login required');

        const db = admin.firestore();
        const rtdb = admin.database();

        try {
            // AUTHORIZATION: Check if user is Super Admin OR has 'admin' role
            if (request.auth.uid !== SUPER_ADMIN_UID) {
                const userDoc = await db.collection('users').doc(request.auth.uid).get();
                if (userDoc.data()?.role !== 'admin') {
                    throw new HttpsError('permission-denied', 'Admin access required');
                }
            }
            const usersSnap = await db.collection('users').get();
            let migratedCount = 0;

            for (const userDoc of usersSnap.docs) {
                const userData = userDoc.data();
                const stats = userData.stats?.miniGames;
                if (!stats) continue;

                const uid = userDoc.id;
                const userRef = db.collection('users').doc(uid);
                const name = userData.auroryPlayerName || userData.displayName || 'Guest';
                const avatar = userData.auroryProfilePicture || userData.photoURL || '';

                // 1. Migrate each individual game type
                for (const gameId of ['slotMachine', 'treasureChest', 'drakkarRace']) {
                    const gameStats = stats[gameId];
                    if (!gameStats || !gameStats.totalWon) continue;

                    for (const currency of ['valcoins', 'aury', 'usdc']) {
                        const amount = gameStats.totalWon[currency] || 0;
                        if (amount > 0) {
                            await rtdb.ref(`leaderboards/earnings/${currency}/${gameId}/all_time/${uid}`).set({
                                score: amount,
                                displayName: name,
                                photoURL: avatar
                            });
                        }
                    }
                }

                // 2. Aggregate 'all' earnings if explicit 'all' key is missing or low
                // Including: Minigames + Daily Check-ins
                const explicitAll = stats.all?.totalWon || {};
                
                // Fetch daily check-in totals from history
                const checkInSnap = await userRef.collection('pointsHistory')
                    .where('type', '==', 'daily_checkin')
                    .get();
                let historicalCheckInTotal = 0;
                checkInSnap.forEach((doc: any) => {
                    historicalCheckInTotal += doc.data().amount || 0;
                });

                for (const currency of ['valcoins', 'aury', 'usdc']) {
                    let totalVal = explicitAll[currency] || 0;
                    
                    // If 'all' is missing or 0, sum up from other games
                    if (totalVal <= 0) {
                        for (const gId of ['slotMachine', 'treasureChest', 'drakkarRace']) {
                            totalVal += stats[gId]?.totalWon?.[currency] || 0;
                        }
                    }

                    // Add Check-in data to Valcoins aggregate
                    if (currency === 'valcoins') {
                        totalVal += historicalCheckInTotal;
                        
                        // Also create a specific 'check-in' leaderboard entry for All-Time
                        if (historicalCheckInTotal > 0) {
                            await rtdb.ref(`leaderboards/earnings/${currency}/check-in/all_time/${uid}`).set({
                                score: historicalCheckInTotal,
                                displayName: name,
                                photoURL: avatar
                            });
                        }
                    }

                    if (totalVal > 0) {
                        await rtdb.ref(`leaderboards/earnings/${currency}/all/all_time/${uid}`).set({
                            score: totalVal,
                            displayName: name,
                            photoURL: avatar
                        });
                    }
                }

                migratedCount++;
            }

            return { success: true, count: migratedCount, message: `Successfully migrated ${migratedCount} users to RTDB leaderboards.` };
        } catch (error: any) {
            console.error('Migration failed:', error);
            throw new HttpsError('internal', error.message);
        }
    }
);
