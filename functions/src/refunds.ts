import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';

// Initialize admin if not already initialized (handled in index.ts usually but good practice to be safe or rely on index)
// admin.initializeApp() is called in index.ts

/**
 * Trigger: When a draft document is deleted
 * Goal: Refund the creator if it was a paid 1v1 tournament that hadn't started.
 * 
 * NOTE: Using v1 Cloud Functions (functions.firestore) to avoid Eventarc permission issues
 * that often occur with v2 functions on first deployment.
 */
export const onTournamentDeleted = functions.firestore
    .document('drafts/{draftId}')
    .onDelete(async (snap: functions.firestore.QueryDocumentSnapshot, context: functions.EventContext) => {
        const data = snap.data();
        const draftId = context.params.draftId;

        if (!data) {
            console.log('No data associated with the event');
            return;
        }

        // 1. Check if refund is applicable
        // Must be mode3 or mode4 (1v1)
        const is1v1 = data.draftType === 'mode3' || data.draftType === 'mode4';
        if (!is1v1) return;

        // Must not be friendly
        if (data.isFriendly) return;

        // Must be in 'waiting' status (hasn't started)
        // If status is 'active', 'completed', etc., we don't refund automatically on delete.
        if (data.status !== 'waiting') return;

        // 2. Prepare Refunds
        const refunds: { [uid: string]: number } = {};

        // Check entryPaid map for all payers
        if (data.entryPaid && typeof data.entryPaid === 'object') {
            for (const [uid, amount] of Object.entries(data.entryPaid)) {
                if (typeof amount === 'number' && amount > 0) {
                    refunds[uid] = amount;
                }
            }
        }

        // Fallback for creator if no refunds found yet
        if (Object.keys(refunds).length === 0) {
            const creatorId = data.createdBy;
            if (creatorId) {
                const poolAmount = data.poolAmount || 0;
                const entryFee = data.entryFee || 0;
                let fallbackAmount = 0;

                if (poolAmount > 0) {
                    fallbackAmount = (entryFee === 0) ? poolAmount : entryFee;
                }

                if (fallbackAmount > 0) {
                    refunds[creatorId] = fallbackAmount;
                }
            }
        }

        if (Object.keys(refunds).length === 0) {
            console.log(`Draft ${draftId} deleted, but no refunds applicable.`);
            return;
        }

        // 3. Process Refunds in Transaction
        const uids = Object.keys(refunds);
        console.log(`Processing refunds for deleted draft ${draftId}:`, refunds);

        try {
            await admin.firestore().runTransaction(async (transaction) => {
                for (const uid of uids) {
                    const amount = refunds[uid];
                    const walletRef = admin.firestore().collection('wallets').doc(uid);
                    const walletDoc = await transaction.get(walletRef);

                    if (!walletDoc.exists) {
                        console.warn(`Wallet for user ${uid} not found during refund. Skipping.`);
                        continue;
                    }

                    const currentBalance = walletDoc.data()?.balance || 0;

                    // Credit balance
                    transaction.update(walletRef, {
                        balance: currentBalance + amount,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    });

                    // Create transaction record
                    const txRef = admin.firestore().collection('wallets').doc(uid).collection('transactions').doc();
                    transaction.set(txRef, {
                        type: 'refund_pool',
                        amount: amount,
                        draftId: draftId,
                        draftTitle: data.title || 'Tournament Refund',
                        timestamp: admin.firestore.FieldValue.serverTimestamp(),
                        note: 'Automatic refund for deleted tournament'
                    });
                }
            });

            console.log(`Successfully processed all refunds for draft ${draftId}`);
        } catch (error) {
            console.error(`Failed to process refunds for draft ${draftId}:`, error);
        }
    });
