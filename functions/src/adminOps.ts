import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { processPayouts } from './verifyMatches';

const db = admin.firestore();

// Super Admin UID (hardcoded for now, same as in verifyMatches.ts)
const SUPER_ADMIN_UID = 'fWp7xeLNvuTD9axrPtJpp4afC1g2';

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
            const draftDoc = await db.doc(`drafts/${draftId}`).get();
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
