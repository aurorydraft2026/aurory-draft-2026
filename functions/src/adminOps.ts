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
        timeoutSeconds: 540, // 9 minutes max for large user bases
        memory: '512MiB'
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
            const usersRef = db.collection('users');
            
            let snapshot = await usersRef.get();
            let totalUsersProcessed = 0;
            let totalHistoryDeleted = 0;
            let currentBatch = db.batch();
            let countInBatch = 0;

            for (const userDoc of snapshot.docs) {
                // Reset overall stats
                currentBatch.update(userDoc.ref, {
                    'stats.miniGames': {}
                });
                
                countInBatch++;
                totalUsersProcessed++;

                // Optional: Wipe individual game logs
                if (wipeHistory) {
                    const historySnapshot = await userDoc.ref.collection('miniGameHistory').get();
                    for (const histDoc of historySnapshot.docs) {
                        currentBatch.delete(histDoc.ref);
                        countInBatch++;
                        totalHistoryDeleted++;

                        // Commit batch if it hits the limit (Firestore limit is 500)
                        if (countInBatch >= 450) {
                            await currentBatch.commit();
                            currentBatch = db.batch();
                            countInBatch = 0;
                            console.log(`Processed ${totalUsersProcessed} users, deleted ${totalHistoryDeleted} logs...`);
                        }
                    }
                }

                // Periodic commit even without history
                if (countInBatch >= 450) {
                    await currentBatch.commit();
                    currentBatch = db.batch();
                    countInBatch = 0;
                    console.log(`Processed ${totalUsersProcessed} users...`);
                }
            }

            // Commit final batch
            if (countInBatch > 0) {
                await currentBatch.commit();
            }

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
