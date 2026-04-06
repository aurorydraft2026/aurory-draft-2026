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
 * Clears the 'stats.miniGames' field for all users.
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

        console.log(`🏆 Global Mini-Game Stats Reset Triggered by ${callerUid}`);

        try {
            const db = admin.firestore();
            const usersRef = db.collection('users');
            
            // Note: For very large collections (>10k users), we might need 
            // a multi-invocation approach, but for now a loop with batches is fine.
            let snapshot = await usersRef.get();
            let totalProcessed = 0;
            let currentBatch = db.batch();
            let countInBatch = 0;

            for (const doc of snapshot.docs) {
                currentBatch.update(doc.ref, {
                    'stats.miniGames': {}
                });
                
                countInBatch++;
                totalProcessed++;

                // Commit batch every 450 docs
                if (countInBatch >= 450) {
                    await currentBatch.commit();
                    currentBatch = db.batch();
                    countInBatch = 0;
                    console.log(`Processed ${totalProcessed} users...`);
                }
            }

            // Commit final batch
            if (countInBatch > 0) {
                await currentBatch.commit();
            }

            return {
                success: true,
                count: totalProcessed,
                message: `Successfully reset mini-game stats for ${totalProcessed} users.`
            };

        } catch (error: any) {
            console.error('Reset stats failed:', error);
            throw new HttpsError('internal', error.message || 'Unknown error during stats reset.');
        }
    }
);
