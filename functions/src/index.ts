/**
 * Aurory Draft - Cloud Functions
 *
 * 1. checkTimers      — Runs every 15s, handles timer expiry + auto-pick + phase advance
 * 2. auroryProxy      — HTTP proxy to Aurory API (no CORS issues)
 * 3. verifyMatches    — Runs every 2min, verifies completed drafts against in-game results
 */

import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onRequest } from 'firebase-functions/v2/https';

// Initialize Firebase Admin
admin.initializeApp();

// ─── 1. TIMER CHECK (every 15 seconds) ───
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
        // Run 4 checks within the 1-minute window (every ~15s)
        for (let i = 0; i < 4; i++) {
            try {
                const processed = await processActiveTimers();
                if (processed > 0) {
                    console.log(`Timer check ${i + 1}/4: processed ${processed} draft(s)`);
                }
            } catch (err) {
                console.error(`Timer check ${i + 1}/4 error:`, err);
            }

            // Wait 15 seconds before next check (except on last iteration)
            if (i < 3) {
                await new Promise(resolve => setTimeout(resolve, 15000));
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
import { manualPayout, cleanupInactiveGuests } from './adminOps';
exports.manualPayout = manualPayout;
exports.cleanupInactiveGuests = cleanupInactiveGuests;

// ─── 5. REFUNDS ───
// Refund creator when a paid 1v1 tournament is deleted
import { onTournamentDeleted } from './refunds';
export const tournamentRefund = onTournamentDeleted;
