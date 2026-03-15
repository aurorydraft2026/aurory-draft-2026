import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';

/**
 * Trigger: When a matchup document is updated
 * Goal: Automatically distribute 1st, 2nd, and 3rd place prizes when a tournament is completed.
 */
export const onMatchupCompleted = functions.firestore
    .document('matchups/{matchupId}')
    .onUpdate(async (change, context) => {
        const before = change.before.data();
        const after = change.after.data();
        const matchupId = context.params.matchupId;

        if (!before || !after) return;

        // 1. Only trigger when phase changes to 'completed'
        if (after.phase !== 'completed' || before.phase === 'completed') {
            return;
        }

        // 2. Safety check: prevent double distribution
        if (after.rewardsDistributed) {
            console.log(`Tournament ${matchupId} rewards already distributed. Skipping.`);
            return;
        }

        console.log(`🏆 Tournament ${matchupId} completed! Processing reward distribution...`);

        // 3. Collect prizes and winners
        const prizes: { [rank: number]: number } = {
            1: after.prize1 || 0,
            2: after.prize2 || 0,
            3: after.prize3 || 0
        };

        const finalStandings = after.finalStandings || [];
        if (finalStandings.length === 0) {
            console.warn(`Tournament ${matchupId} completed but no finalStandings found.`);
            return;
        }

        // we'll store distribution details here for the matchup doc
        const distributionRecords: any[] = [];

        try {
            await admin.firestore().runTransaction(async (transaction) => {
                // Read matchup again inside transaction to be absolutely sure
                const matchupRef = admin.firestore().collection('matchups').doc(matchupId);
                const matchupSnap = await transaction.get(matchupRef);
                const currentData = matchupSnap.data();

                if (currentData?.rewardsDistributed) return;

                for (const standing of finalStandings) {
                    const rank = standing.rank;
                    const prizeAury = prizes[rank] || 0;
                    
                    if (prizeAury <= 0) continue;

                    // standing.teamId is the winner's UID (leader UID if it's a team)
                    const winnerUid = standing.teamId;
                    if (!winnerUid) {
                        console.warn(`No winner UID found for rank ${rank} in tournament ${matchupId}`);
                        continue;
                    }

                    // Convert AURY (float) to nanoAURY (integer) for wallet balance
                    const prizeNano = Math.floor(prizeAury * 1e9);

                    const walletRef = admin.firestore().collection('wallets').doc(winnerUid);
                    const walletDoc = await transaction.get(walletRef);
                    
                    const currentBalance = walletDoc.exists ? (walletDoc.data()?.balance || 0) : 0;

                    // Update wallet balance
                    transaction.set(walletRef, {
                        balance: currentBalance + prizeNano,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });

                    // Create transaction record
                    const txRef = admin.firestore().collection('wallets').doc(winnerUid).collection('transactions').doc();
                    transaction.set(txRef, {
                        type: 'tournament_prize',
                        amount: prizeNano,
                        matchupId: matchupId,
                        tournamentTitle: after.title || 'Tournament Prize',
                        rank: rank,
                        timestamp: admin.firestore.FieldValue.serverTimestamp(),
                        note: `Combined prize for ${rank === 1 ? '1st' : rank === 2 ? '2nd' : '3rd'} place`
                    });

                    distributionRecords.push({
                        rank,
                        winnerUid,
                        prizeAury,
                        prizeNano
                    });
                }

                // Mark as distributed
                transaction.update(matchupRef, {
                    rewardsDistributed: true,
                    rewardsDistributedAt: admin.firestore.FieldValue.serverTimestamp(),
                    distributionRecords: distributionRecords
                });
            });

            console.log(`Successfully distributed rewards for tournament ${matchupId}.`, distributionRecords);
        } catch (error) {
            console.error(`Failed to distribute rewards for tournament ${matchupId}:`, error);
        }
    });
