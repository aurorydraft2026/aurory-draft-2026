import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';

// Initialize admin if not already initialized (handled in index.ts usually but good practice to be safe or rely on index)
// admin.initializeApp() is called in index.ts

/**
 * Trigger: When a draft document is deleted
 * Goal: Refund ALL players who paid entry fees if the tournament hadn't fully started.
 * 
 * Covers: waiting, coinFlip (confirmation phase), and assignment (roulette) statuses.
 * Does NOT refund if status is 'active' or 'completed' (match already in progress/done).
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

        // Refund for any pre-active status (waiting, coinFlip, assignment/roulette)
        // Do NOT refund if match is active or completed — those have separate prize logic
        const refundableStatuses = ['waiting', 'coinFlip', 'assignment'];
        if (!refundableStatuses.includes(data.status)) {
            console.log(`Draft ${draftId} deleted with status '${data.status}' — not auto-refunding.`);
            return;
        }

        // 2. Prepare Refunds from entryPaid map (source of truth for who actually paid)
        const refunds: { [uid: string]: number } = {};

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
                        note: 'Automatic refund — tournament deleted before starting'
                    });
                }
            });

            console.log(`Successfully processed all refunds for deleted draft ${draftId}`);
        } catch (error) {
            console.error(`Failed to process refunds for draft ${draftId}:`, error);
        }
    });

/**
 * Trigger: When a draft document is updated
 * Goal: Refund players who were removed from their slot (self-removal OR admin kick)
 *       but had already paid an entry fee.
 * 
 * Detection: Compare before/after preAssignedTeams — if a player's UID was in a slot
 *            before but not after, and entryPaid[uid] > 0, they get refunded.
 *            After refunding, entryPaid[uid] is set to 0 to prevent double-refunds.
 * 
 * Covers:
 *   - Player clicks "Leave Match" (self-removal clears their slot)
 *   - Admin removes player via Edit Draft Settings (saves new preAssignedTeams)
 */
export const onTournamentUpdated = functions.firestore
    .document('drafts/{draftId}')
    .onUpdate(async (change, context) => {
        const before = change.before.data();
        const after = change.after.data();
        const draftId = context.params.draftId;

        if (!before || !after) return;

        // Only handle 1v1 paid matches
        const is1v1 = after.draftType === 'mode3' || after.draftType === 'mode4';
        if (!is1v1 || after.isFriendly) return;

        // Only process during pre-active statuses
        // Check BEFORE status too, since self-removal changes status from coinFlip → waiting
        const refundableStatuses = ['waiting', 'coinFlip', 'assignment'];
        if (!refundableStatuses.includes(before.status) && !refundableStatuses.includes(after.status)) return;

        // Collect all UIDs that were in slots BEFORE but are NOT in slots AFTER
        const beforeSlots = getSlotUids(before.preAssignedTeams);
        const afterSlots = getSlotUids(after.preAssignedTeams);
        const removedUids = beforeSlots.filter(uid => !afterSlots.includes(uid));

        if (removedUids.length === 0) return;

        // Check which removed players actually paid (entryPaid > 0)
        // Use AFTER document since that's the current state
        const entryPaid = after.entryPaid || {};
        const refunds: { [uid: string]: number } = {};

        for (const uid of removedUids) {
            const amount = entryPaid[uid];
            if (typeof amount === 'number' && amount > 0) {
                refunds[uid] = amount;
            }
        }

        if (Object.keys(refunds).length === 0) {
            console.log(`Draft ${draftId}: Players removed but none had outstanding entry fees.`);
            return;
        }

        console.log(`Draft ${draftId}: Processing removal refunds:`, refunds);

        try {
            const draftRef = admin.firestore().collection('drafts').doc(draftId);

            await admin.firestore().runTransaction(async (transaction) => {
                // Re-read draft inside transaction to get latest entryPaid (prevent race conditions)
                const draftSnap = await transaction.get(draftRef);
                if (!draftSnap.exists) return;
                const currentData = draftSnap.data();
                const currentEntryPaid = currentData?.entryPaid || {};

                const entryPaidUpdates: { [key: string]: number } = {};

                for (const uid of Object.keys(refunds)) {
                    // Double-check: still has positive entryPaid (hasn't been refunded by another trigger)
                    const amount = currentEntryPaid[uid];
                    if (typeof amount !== 'number' || amount <= 0) {
                        console.log(`Draft ${draftId}: Skipping refund for ${uid} — already processed or zero.`);
                        continue;
                    }

                    const walletRef = admin.firestore().collection('wallets').doc(uid);
                    const walletDoc = await transaction.get(walletRef);

                    if (!walletDoc.exists) {
                        console.warn(`Wallet for user ${uid} not found. Skipping refund.`);
                        continue;
                    }

                    const currentBalance = walletDoc.data()?.balance || 0;

                    // Credit balance back to wallet
                    transaction.update(walletRef, {
                        balance: currentBalance + amount,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    });

                    // Create audit trail transaction record
                    const txRef = admin.firestore().collection('wallets').doc(uid).collection('transactions').doc();
                    transaction.set(txRef, {
                        type: 'refund_removal',
                        amount: amount,
                        draftId: draftId,
                        draftTitle: currentData?.title || 'Match Refund',
                        timestamp: admin.firestore.FieldValue.serverTimestamp(),
                        note: 'Automatic refund — removed from match before start'
                    });

                    // Mark as refunded (set to 0) to prevent double-refund on re-trigger
                    entryPaidUpdates[`entryPaid.${uid}`] = 0;
                }

                // Zero out refunded entryPaid entries on the draft document
                if (Object.keys(entryPaidUpdates).length > 0) {
                    transaction.update(draftRef, entryPaidUpdates);
                }
            });

            console.log(`Successfully processed removal refunds for draft ${draftId}`);
        } catch (error) {
            console.error(`Failed to process removal refunds for draft ${draftId}:`, error);
        }
    });

/**
 * Helper: Extract all player UIDs from preAssignedTeams slots
 */
function getSlotUids(preAssignedTeams: any): string[] {
    if (!preAssignedTeams) return [];
    const uids: string[] = [];

    for (const teamKey of ['team1', 'team2']) {
        const team = preAssignedTeams[teamKey];
        if (!team) continue;
        for (const role of ['leader', 'member1', 'member2']) {
            if (team[role] && typeof team[role] === 'string') {
                uids.push(team[role]);
            }
        }
    }

    return uids;
}