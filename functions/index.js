// functions/index.js
// Firebase Cloud Functions for Asgard
// Includes proxy for Aurory API to avoid CORS issues

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const fetch = require('node-fetch');

admin.initializeApp();

const AURORY_API_BASE = 'https://aggregator-api.live.aurory.io';

// ============================================================================
// AURORY API PROXY
// ============================================================================

/**
 * Proxy for fetching player matches from Aurory API
 * Avoids CORS issues by making server-side requests
 */
exports.getAuroryPlayerMatches = functions.https.onCall(async (data, context) => {
    const { playerIdOrWallet, event, gameMode, battleCode, page } = data;

    if (!playerIdOrWallet) {
        throw new functions.https.HttpsError('invalid-argument', 'playerIdOrWallet is required');
    }

    try {
        const params = new URLSearchParams({
            player_id_or_name: playerIdOrWallet,
            game_mode: gameMode || 'pvp'
        });

        if (event) params.append('event', event);
        if (battleCode) params.append('battle_code', battleCode);
        if (page) params.append('page', page.toString());

        const url = AURORY_API_BASE + '/v1/player-matches?' + params.toString();

        console.log('Fetching Aurory API:', url);

        const response = await fetch(url, {
            headers: { 'accept': 'application/json' }
        });

        if (!response.ok) {
            if (response.status === 404) {
                return { error: 'Player not found', status: 404 };
            }
            throw new Error('Aurory API error: ' + response.status);
        }

        const result = await response.json();
        return result;

    } catch (error) {
        console.error('Aurory API proxy error:', error);
        throw new functions.https.HttpsError('internal', error.message);
    }
});

/**
 * Validate an Aurory account by fetching player data
 */
exports.validateAuroryAccount = functions.https.onCall(async (data, context) => {
    const { playerIdOrWallet } = data;

    if (!playerIdOrWallet) {
        throw new functions.https.HttpsError('invalid-argument', 'playerIdOrWallet is required');
    }

    try {
        const params = new URLSearchParams({
            player_id_or_name: playerIdOrWallet,
            event: 'PRIVATE_MATCH',
            game_mode: 'pvp'
        });

        const url = AURORY_API_BASE + '/v1/player-matches?' + params.toString();

        const response = await fetch(url, {
            headers: { 'accept': 'application/json' }
        });

        if (!response.ok) {
            if (response.status === 404) {
                return { valid: false, error: 'Player not found' };
            }
            return { valid: false, error: 'API error: ' + response.status };
        }

        const result = await response.json();

        // Safely access nested properties
        var playerId = null;
        var playerName = null;
        var totalMatches = 0;

        if (result && result.player) {
            playerId = result.player.player_id || null;
            playerName = result.player.player_name || null;
        }

        if (result && result.matches) {
            totalMatches = result.matches.total_elements || 0;
        }

        return {
            valid: true,
            playerId: playerId,
            playerName: playerName,
            totalMatches: totalMatches
        };

    } catch (error) {
        console.error('Aurory validation error:', error);
        return { valid: false, error: error.message };
    }
});

/**
 * Fetch Nefties index from Aurory API
 */
exports.getAuroryNeftiesIndex = functions.https.onCall(async (data, context) => {
    try {
        const url = AURORY_API_BASE + '/v1/nefties/index';

        const response = await fetch(url, {
            headers: { 'accept': 'application/json' }
        });

        if (!response.ok) {
            throw new Error('Aurory API error: ' + response.status);
        }

        return await response.json();

    } catch (error) {
        console.error('Aurory nefties index error:', error);
        throw new functions.https.HttpsError('internal', error.message);
    }
});

// ============================================================================
// YGGDRASIL ASCENDER
// ============================================================================

/**
 * Submit Yggdrasil Ascender run for rewards
 */
exports.submitYggdrasilRun = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be logged in.');
    }

    const { altitude, runes } = data;
    const uid = context.auth.uid;
    const today = new Date().toISOString().split('T')[0];

    // Basic validation
    if (typeof altitude !== 'number' || typeof runes !== 'number' || altitude < 0 || runes < 0) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid run data.');
    }

    const userRef = admin.firestore().collection('users').doc(uid);
    const runDocRef = userRef.collection('yggdrasil_runs').doc(today);
    const configRef = admin.firestore().collection('admin').doc('minigames');

    try {
        return await admin.firestore().runTransaction(async (transaction) => {
            const userDoc = await transaction.get(userRef);
            const runDoc = await transaction.get(runDocRef);
            const configDoc = await transaction.get(configRef);

            if (!userDoc.exists) {
                throw new functions.https.HttpsError('not-found', 'User not found.');
            }

            // Get config
            const configData = configDoc.exists ? configDoc.data().yggdrasilAscender || {} : {};
            const maxDailyRuns = configData.maxDailyRuns || 5;
            const runeMultiplier = configData.runeMultiplier || 1.0;

            // Check runs limit
            const runData = runDoc.exists ? runDoc.data() : { count: 0 };
            if (runData.count >= maxDailyRuns) {
                return { success: true, reward: 0, limitReached: true, runsCompleted: runData.count, maxRuns: maxDailyRuns };
            }

            // Calculate reward
            const rewardAmount = Math.floor(altitude / 100) * Math.max(1, Math.floor(runes * runeMultiplier));

            if (rewardAmount > 0) {
                const userData = userDoc.data();
                const currentBalance = userData.valcoins || 0;
                transaction.update(userRef, {
                    valcoins: currentBalance + rewardAmount
                });
            }

            // Update runs count
            transaction.set(runDocRef, {
                count: runData.count + 1,
                lastRunTime: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            return { 
                success: true, 
                reward: rewardAmount, 
                runsCompleted: runData.count + 1,
                maxRuns: maxDailyRuns
            };
        });
    } catch (error) {
        console.error('Transaction failed:', error);
        throw new functions.https.HttpsError('internal', error.message);
    }
});