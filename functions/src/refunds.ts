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

        // Check entryPaid map for all payers — this is the source of truth
        // Only users who actually paid (recorded in entryPaid) should be refunded
        if (data.entryPaid && typeof data.entryPaid === 'object') {
            for (const [uid, amount] of Object.entries(data.entryPaid)) {
                if (typeof amount === 'number' && amount > 0) {
                    refunds[uid] = amount;
                }
            }
        }

        if (Object.keys(refunds).length === 0) {
            console.log(`Draft ${draftId} deleted, but no refunds applicable (no entryPaid records).`);
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

/**
 * Trigger: When a draft document is updated
 * Goal: Refund players who were removed from slots but had already paid.
 */
export const onTournamentUpdated = functions.firestore
    .document('drafts/{draftId}')
    .onUpdate(async (change, context) => {
        const before = change.before.data();
        const after = change.after.data();
        const draftId = context.params.draftId;

        if (!before || !after) return;

        // Only process refunds in 'waiting' status
        if (after.status !== 'waiting') return;

        // 1. Identify assigned players in the BEFORE snapshot
        const beforeAssigned = new Set<string>();
        if (before.preAssignedTeams) {
            ['team1', 'team2'].forEach(teamKey => {
                const team = before.preAssignedTeams[teamKey];
                if (team) {
                    ['leader', 'member1', 'member2'].forEach(role => {
                        if (team[role]) beforeAssigned.add(team[role]);
                    });
                }
            });
        }

        // 2. Identify assigned players in the AFTER snapshot
        const afterAssigned = new Set<string>();
        if (after.preAssignedTeams) {
            ['team1', 'team2'].forEach(teamKey => {
                const team = after.preAssignedTeams[teamKey];
                if (team) {
                    ['leader', 'member1', 'member2'].forEach(role => {
                        if (team[role]) afterAssigned.add(team[role]);
                    });
                }
            });
        }

        // 3. Check for players in entryPaid who were REMOVED from slots
        const refundsToProcess: { [uid: string]: number } = {};
        if (after.entryPaid && typeof after.entryPaid === 'object') {
            for (const [uid, amount] of Object.entries(after.entryPaid)) {
                // ONLY refund if they were assigned before AND are NOT assigned now
                // This prevents sponsored creators (who paid but are not in slots) from getting incidental refunds on edit.
                if (typeof amount === 'number' && amount > 0 && beforeAssigned.has(uid) && !afterAssigned.has(uid)) {
                    refundsToProcess[uid] = amount;
                }
            }
        }

        if (Object.keys(refundsToProcess).length === 0) return;

        console.log(`Processing removal refunds for draft ${draftId}:`, refundsToProcess);

        try {
            await admin.firestore().runTransaction(async (transaction) => {
                // Re-read draft to ensure we have latest entryPaid status
                const draftRef = admin.firestore().collection('drafts').doc(draftId);
                const draftDoc = await transaction.get(draftRef);
                if (!draftDoc.exists) return;

                const currentData = draftDoc.data() || {};
                const currentPaid = currentData.entryPaid || {};
                const updateData: any = {};

                for (const [uid, amount] of Object.entries(refundsToProcess)) {
                    // Double check in transaction
                    if (currentPaid[uid] !== amount) continue;

                    const walletRef = admin.firestore().collection('wallets').doc(uid);
                    const walletDoc = await transaction.get(walletRef);

                    if (!walletDoc.exists) {
                        console.warn(`Wallet for user ${uid} not found. Skipping.`);
                        continue;
                    }

                    const currentBalance = walletDoc.data()?.balance || 0;

                    // Credit balance
                    transaction.update(walletRef, {
                        balance: currentBalance + amount,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    });

                    // Create transaction record
                    const txRef = walletRef.collection('transactions').doc();
                    transaction.set(txRef, {
                        type: 'entry_fee_refund',
                        amount: amount,
                        draftId: draftId,
                        draftTitle: currentData.title || 'Tournament Refund',
                        timestamp: admin.firestore.FieldValue.serverTimestamp(),
                        note: 'Refunded for removal from tournament'
                    });

                    // Clear entryPaid for this user
                    updateData[`entryPaid.${uid}`] = 0;
                }

                if (Object.keys(updateData).length > 0) {
                    transaction.update(draftRef, updateData);
                }
            });
            console.log(`Successfully processed removal refunds for draft ${draftId}`);
        } catch (error) {
            console.error(`Failed to process removal refunds for draft ${draftId}:`, error);
        }
    });
