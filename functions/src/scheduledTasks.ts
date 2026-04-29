import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';

/**
 * Weekly Reset for Yggdrasil Global Ascension.
 * Resets the current progression to 0 every Monday at 00:00 UTC.
 */
export const resetGlobalAscension = onSchedule(
    {
        schedule: '0 0 * * 1', // Every Monday at 00:00 UTC
        region: 'us-central1',
        timeoutSeconds: 60,
        memory: '256MiB'
    },
    async (event) => {
        console.log('🌳 Triggering Weekly Global Ascension Reset...');
        const rtdb = admin.database();
        try {
            await rtdb.ref('yggdrasil/global_goal/current').set(0);
            console.log('✅ Global Ascension reset to 0.');
        } catch (error) {
            console.error('❌ Failed to reset Global Ascension:', error);
        }
    }
);
