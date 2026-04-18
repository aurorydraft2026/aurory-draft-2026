import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';

// Super Admin UID
const SUPER_ADMIN_UID = 'wgPwCyYGuYUAokSklV1LNsjCrGA3';

/**
 * Audit all active raffles for duplicate participants (Sybil detection)
 * and data inconsistencies.
 */
export const investigateRaffles = onCall(
    {
        region: 'us-central1',
        maxInstances: 5
    },
    async (request) => {
        // 1. Auth Check
        if (!request.auth) {
            throw new HttpsError('unauthenticated', 'User must be logged in.');
        }

        const callerUid = request.auth.uid;
        if (callerUid !== SUPER_ADMIN_UID) {
            throw new HttpsError('permission-denied', 'Only Super Admin can run investigations.');
        }

        try {
            const db = admin.firestore();
            const rafflesSnap = await db.collection('raffles')
                .where('status', 'in', ['active', 'entries_closed', 'spinning'])
                .get();

            const reports: any[] = [];

            for (const doc of rafflesSnap.docs) {
                const raffle = doc.data();
                const participants = raffle.participants || [];
                const participantsCount = raffle.participantsCount || 0;

                const report: any = {
                    raffleId: doc.id,
                    itemType: raffle.itemType,
                    totalParticipants: participants.length,
                    mismatchedCount: participants.length !== participantsCount,
                    duplicates: [],
                    mocks: []
                };

                const auroryIdMap = new Map<string, string[]>(); // auroryId -> [uids]

                for (const p of participants) {
                    if (p.isMock || p.uid.startsWith('mock_')) {
                        report.mocks.push(p.uid);
                    }

                    if (p.auroryPlayerId) {
                        const existing = auroryIdMap.get(p.auroryPlayerId) || [];
                        existing.push(p.uid);
                        auroryIdMap.set(p.auroryPlayerId, existing);
                    }
                }

                // Identify duplicates
                for (const [auroryId, uids] of auroryIdMap.entries()) {
                    if (uids.length > 1) {
                        report.duplicates.push({
                            auroryPlayerId: auroryId,
                            uids: uids
                        });
                    }
                }

                if (report.mismatchedCount || report.duplicates.length > 0 || report.mocks.length > 0) {
                    reports.push(report);
                }
            }

            return {
                success: true,
                timestamp: Date.now(),
                raffleReports: reports
            };

        } catch (error: any) {
            console.error('Investigation failed:', error);
            throw new HttpsError('internal', error.message || 'Unknown error during investigation.');
        }
    }
);
