/**
 * Asgard Duels - Cloud Functions
 *
 * 1. checkTimers      — Runs every 5s, handles timer expiry + auto-pick + phase advance
 * 2. auroryProxy      — HTTP proxy to Aurory API (no CORS issues)
 * 3. verifyMatches    — Runs every 2min, verifies completed drafts against in-game results
 */

import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onRequest } from 'firebase-functions/v2/https';

// Initialize Firebase Admin with explicit regional database URL
admin.initializeApp({
  databaseURL: "https://asgard-duels-default-rtdb.asia-southeast1.firebasedatabase.app"
});

// ─── 1. TIMER CHECK (every 5 seconds) ───
// Scans all active drafts, auto-picks when timer expires, advances phases
import { processActiveTimers } from './checkTimers';

export const checkTimers = onSchedule(
    {
        schedule: 'every 1 minutes', // Cloud Scheduler minimum is 1 minute
        timeoutSeconds: 60,
        memory: '256MiB',
        region: 'us-central1'
    },
    async () => {
        // Run up to 12 checks within the 1-minute window (every ~5s)
        // If no active drafts are found on the first check, exit early to save compute costs
        for (let i = 0; i < 12; i++) {
            try {
                const processed = await processActiveTimers();
                if (processed > 0) {
                    console.log(`Timer check ${i + 1}/12: processed ${processed} draft(s)`);
                } else if (i === 0) {
                    // No active drafts found on first check — exit early
                    // (saves ~55s of idle sleep per invocation)
                    return;
                }
            } catch (err) {
                console.error(`Timer check ${i + 1}/12 error:`, err);
            }

            // Wait 5 seconds before next check (except on last iteration)
            if (i < 11) {
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }
);

// ─── 2. AURORY API PROXY ───
// HTTP function that proxies requests to the Aurory Aggregator API
// Client calls: GET /auroryProxy?endpoint=/v1/matches&params=battle_code=12345
import { handleAuroryProxy } from './auroryProxy';

export const auroryProxy = onRequest(
    {
        cors: true,
        maxInstances: 10,
        timeoutSeconds: 30,
        memory: '256MiB',
        region: 'us-central1'
    },
    handleAuroryProxy
);

// ─── 3. MATCH VERIFICATION (every 2 minutes) ───
// Scans completed drafts and verifies in-game battles via Aurory API
import { scanAndVerifyDrafts } from './verifyMatches';

export const verifyMatches = onSchedule(
    {
        schedule: 'every 2 minutes',
        timeoutSeconds: 120,
        memory: '512MiB',
        region: 'us-central1'
    },
    async () => {
        try {
            const count = await scanAndVerifyDrafts();
            if (count > 0) {
                console.log(`Match verification: ${count} draft(s) newly verified`);
            }
        } catch (err) {
            console.error('Match verification error:', err);
        }
    }
);
// ─── 4. ADMIN OPERATIONS ───
// Manual triggers for admins (e.g. payout retry)
import { manualPayout, cleanupInactiveGuests, resetMiniGameStats, clearAllGlobalNotifications, resetGlobalWallets } from './adminOps';
export { manualPayout, cleanupInactiveGuests, resetMiniGameStats, clearAllGlobalNotifications, resetGlobalWallets };

// ─── 5. REFUNDS ───
// Refund creator when a paid 1v1 tournament is deleted or updated
import { onTournamentDeleted, onTournamentUpdated } from './refunds';
export const tournamentRefund = onTournamentDeleted;
export const tournamentUpdateRefund = onTournamentUpdated;

// ─── 6. TOURNAMENTS ───
// Automatic reward distribution
import { onMatchupCompleted } from './tournaments';
export const tournamentRewards = onMatchupCompleted;

// ─── 7. DISCORD ANNOUNCEMENTS ───
// Automatic notifications to Discord webhooks
import { onRaffleCreated, onRaffleWinnerSet, onMatchupCreated, onMatchupWinner, onDraftCreated } from './discord';
export const onRaffleCreatedAnnouncement = onRaffleCreated;
export const onRaffleWinnerAnnouncement = onRaffleWinnerSet;
export const onMatchupCreatedAnnouncement = onMatchupCreated;
export const onMatchupWinnerAnnouncement = onMatchupWinner;
export const onDraftCreatedAnnouncement = onDraftCreated;
// ─── 8. MINI-GAMES ───
// Secure prize selection and payouts
import { playMiniGame, refreshDrakkarRace, placeDrakkarBet } from './miniGames';
export { playMiniGame, refreshDrakkarRace, placeDrakkarBet };
