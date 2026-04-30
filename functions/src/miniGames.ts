import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import fetch from 'node-fetch';
import { updateLeaderboardStats } from './leaderboardUtils';
import { clampPointsToTierMax } from './tierAndReferral';

// ═══════════════════════════════════════════════════════
//  DRAKKAR RACE v2 — 7 Ships, 7 Weathers, Latin Square
// ═══════════════════════════════════════════════════════

const ALL_SHIPS = [
    { id: 'sleipnir', name: "Sleipnir Swift", color: '#fbbf24' },
    { id: 'jormungandr', name: "Jörmungandr", color: '#10b981' },
    { id: 'ironbound', name: "Ironbound Hulk", color: '#e2e8f0' },
    { id: 'hugin', name: "Hugin's Shadow", color: '#a855f7' },
    { id: 'drakkar', name: "Drakkar Prime", color: '#3b82f6' },
    { id: 'freyja', name: "Freyja's Chariot", color: '#ec4899' },
    { id: 'norse', name: "Norse Raider", color: '#ef4444' }
];

const ALL_WEATHERS = [
    { id: 'calm', name: 'Calm Seas', icon: '☀️' },
    { id: 'storm', name: 'Thunderstorm', icon: '⚡' },
    { id: 'fog', name: 'Thick Fog', icon: '🌫️' },
    { id: 'kraken', name: 'Kraken Attack', icon: '🐙' },
    { id: 'gale', name: 'Northern Gale', icon: '💨' },
    { id: 'ice', name: 'Frozen Wastes', icon: '🧊' },
    { id: 'aurora', name: 'Mystic Aurora', icon: '✨' }
];

// Latin Square speed matrix (x10 integers to avoid floating point)
// Row = ship index, Column = weather index
// Values: 5=0.5x, 7=0.7x, 8=0.8x, 9=0.9x, 10=1.0x, 11=1.1x, 13=1.3x
// Each row and column contains each value exactly once
const SPEED_MATRIX: number[][] = [
    // Calm  Storm  Fog  Kraken  Gale  Ice  Aurora
    [16,  8,   9,  10, 11, 12, 14], // Sleipnir Swift
    [11, 12, 14, 16,  8,   9, 10], // Jörmungandr
    [ 9, 10, 11, 12, 14, 16,  8], // Ironbound Hulk
    [12, 14, 16,  8,  9,  10, 11], // Hugin's Shadow
    [14, 16,  8,  9, 10,  11, 12], // Drakkar Prime
    [ 8,  9, 10, 11, 12,  14, 16], // Freyja's Chariot
    [10, 11, 12, 14, 16,   8,  9], // Norse Raider
];

const BASE_SPEED = 8; // Reverted to 8 for original race duration and excitement
const ZONE_WIDTH = 18; // 90% / 5 zones = 18% each
const DEFAULT_HOUSE_CUT = 0.10; // 10% house edge
const DEFAULT_HOUSE_SEED = 1000000; // Updated to 1M as requested
const DOCK_WIDTH = 10;
const SHIP_START = 10;
const MAX_BET_PER_USER = 30000; // 10k per ship x 3 ships
const MAX_BET_PER_SHIP_PER_USER = 10000;
const MAX_SHIP_POOL = 1000000;

// Phase Durations (ms)
const DURATIONS = {
    betting: 20000,
    reveal: 4000, // 4s buffer for Master Sync and synchronization
    racing: 0, // dynamic — set to winner's finish time + buffer
    result: 3000
};

const BOT_COLORS = ['#ff4444', '#44ff44', '#4444ff', '#ffeb3b', '#9c27b0', '#ff9800', '#00bcd4'];
const BOT_INITIALS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// ═══════════════════════════════════════════════════════
//  LEADERBOARD TRACKING (RTDB)
// ═══════════════════════════════════════════════════════



// ═══════════════════════════════════════════════════════
//  RACE LOGIC
// ═══════════════════════════════════════════════════════

function shuffleArray<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/** Pick N unique random indices from 0..6 */
function pickUnique(count: number): number[] {
    const indices = [0, 1, 2, 3, 4, 5, 6];
    const shuffled = shuffleArray(indices);
    return shuffled.slice(0, count);
}

/** Pick 5 random indices from 0..6, allowing duplicates */
function pick5Weathers(): number[] {
    const indices: number[] = [];
    for (let i = 0; i < 5; i++) {
        indices.push(Math.floor(Math.random() * 7));
    }
    return indices;
}

/**
 * Compute race finish time (ms) for a ship given 5 weather zone speeds.
 * Race starts at 10% (the weather boundary) and ends at 100%
 */
function computeFinishTimeMs(shipIdx: number, weatherIndices: number[]): number {
    let totalMs = 0;

    // Weather traversal (5 zones x 18% each = 90% total distance)
    for (const wIdx of weatherIndices) {
        const speed = SPEED_MATRIX[shipIdx][wIdx];
        totalMs += (ZONE_WIDTH * 10000) / (speed * BASE_SPEED);
    }

    return totalMs;
}

/**
 * Determine race winner from 3 ships and 3 weathers.
 * Returns { winnerIdx, finishTimes } where winnerIdx is 0, 1, or 2.
 */
function determineRaceResult(shipIndices: number[], weatherIndices: number[]) {
    const finishTimes = shipIndices.map(sIdx => computeFinishTimeMs(sIdx, weatherIndices));

    // Find winner (lowest time). Tiebreaker: ship with higher speed in last zone
    let winnerIdx = 0;
    for (let i = 1; i < 3; i++) {
        if (finishTimes[i] < finishTimes[winnerIdx]) {
            winnerIdx = i;
        } else if (finishTimes[i] === finishTimes[winnerIdx]) {
            // Tiebreaker: higher speed in last weather zone
            const lastWeather = weatherIndices[2];
            const speedA = SPEED_MATRIX[shipIndices[winnerIdx]][lastWeather];
            const speedB = SPEED_MATRIX[shipIndices[i]][lastWeather];
            if (speedB > speedA) winnerIdx = i;
        }
    }

    return { winnerIdx, finishTimes };
}

/**
 * Generate a profile of randomized bot bets for a race.
 */
function generateBotProfile(ships: any[], config: any) {
    const minBots = config.minBots ?? 10;
    const maxBots = config.maxBots ?? 20;
    const minBet = config.minBotBet ?? 100;
    const maxBet = config.maxBotBet ?? 500;

    const botCount = Math.floor(Math.random() * (maxBots - minBots + 1)) + minBots;
    const botActions: any[] = [];
    const botPools: Record<string, number> = {};
    ships.forEach(s => { botPools[s.id] = 0; });

    // Balanced distribution: Assign bots to ships in a round-robin style to minimize gaps
    for (let i = 0; i < botCount; i++) {
        // Round robin + slight randomness
        const shipIdx = i % ships.length;
        const shipId = ships[shipIdx].id;
        const amount = Math.floor(Math.random() * (maxBet - minBet + 1)) + minBet;
        
        // Random cutoff between 10s and 3s before end (20s total)
        const cutoffMs = (Math.random() * (10000 - 3000) + 3000);
        const timeOffset = Math.floor(Math.random() * (20000 - cutoffMs));

        const botAction = {
            id: `bot-${i}-${Date.now()}`,
            shipId,
            amount,
            timeOffset,
            color: BOT_COLORS[Math.floor(Math.random() * BOT_COLORS.length)],
            initial: BOT_INITIALS[Math.floor(Math.random() * BOT_INITIALS.length)]
        };

        botActions.push(botAction);
        botPools[shipId] = (botPools[shipId] || 0) + amount;
    }

    // Shuffle botActions so they don't appear in round-robin order on the client
    for (let i = botActions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [botActions[i], botActions[j]] = [botActions[j], botActions[i]];
    }

    return { botActions, botPools, botCount };
}


// ═══════════════════════════════════════════════════════
//  EXISTING MINI-GAMES (Slot Machine / Treasure Chest)
// ═══════════════════════════════════════════════════════

export const playMiniGame = onCall(
    {
        cors: true,
        maxInstances: 10,
        timeoutSeconds: 30,
        memory: '256MiB',
    },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError('unauthenticated', 'You must be logged in to play mini-games.');
        }

        const { uid } = request.auth;
        const { gameType, multiplier = 1 } = request.data;
        const allowedMultipliers = [1, 2, 5, 10, 50, 100];

        if (!gameType || !['slotMachine', 'treasureChest'].includes(gameType)) {
            throw new HttpsError('invalid-argument', 'Invalid game type requested.');
        }

        if (!allowedMultipliers.includes(multiplier)) {
            throw new HttpsError('invalid-argument', 'Invalid bet multiplier requested.');
        }

        const db = admin.firestore();
        const userRef = db.collection('users').doc(uid);
        const walletRef = db.collection('wallets').doc(uid);

        try {
            return await db.runTransaction(async (transaction: any) => {
                const configRef = db.collection('settings').doc('mini_games');
                const configSnap = await transaction.get(configRef);

                let gameConfig;
                if (!configSnap.exists) {
                    gameConfig = getDefaultConfig()[gameType];
                } else {
                    gameConfig = configSnap.data()?.[gameType];
                }

                if (!gameConfig) throw new Error('Game configuration not found.');
                if (!gameConfig.enabled) throw new Error('This game is currently disabled.');

                const baseCost = gameConfig.costPerPlay || 50;
                const costPerPlay = baseCost * multiplier;
                const noWinWeight = gameConfig.noWinWeight || 0;
                const prizes = gameConfig.prizes || [];

                const userSnap = await transaction.get(userRef);
                if (!userSnap.exists) throw new Error('User record not found.');

                const userData = userSnap.data() || {};
                const currentPoints = userData.points || 0;

                const lastPlay = userData.lastMiniGamePlay;
                if (lastPlay) {
                    const lastPlayMs = lastPlay.toMillis?.() || 0;
                    if (Date.now() - lastPlayMs < 4000) {
                        throw new Error('Action already in progress. Please wait.');
                    }
                }

                if (currentPoints < costPerPlay) {
                    throw new Error(`Insufficient Valcoins. Need ${costPerPlay}, have ${currentPoints}`);
                }

                // --- DIVINE FORESIGHT CONSUMPTION ---
                let selectedPrize = null;
                const pendingOutcomes = userData.pendingMiniGameOutcomes || {};
                const predictedPrize = pendingOutcomes[gameType];

                if (predictedPrize) {
                    // Use the predicted prize (ensure it's not a dummy 'none' object)
                    selectedPrize = predictedPrize.id === 'none' ? null : predictedPrize;
                    
                    // Clear the prophecy so it's only used once
                    transaction.update(userRef, {
                        [`pendingMiniGameOutcomes.${gameType}`]: admin.firestore.FieldValue.delete()
                    });
                } else {
                    // Standard RNG
                    selectedPrize = selectWeightedPrize(prizes, noWinWeight, baseCost);
                }

                let finalPrize = selectedPrize ? { ...selectedPrize } : null;

                if (finalPrize) {
                    finalPrize.amount = finalPrize.amount * multiplier;
                    // Try to update name if it specifies amount
                    if (finalPrize.name.toLowerCase().includes('valcoins') || 
                        finalPrize.name.toLowerCase().includes('aury') || 
                        finalPrize.name.toLowerCase().includes('usdc')) {
                        finalPrize.name = `${finalPrize.amount.toLocaleString()} ${finalPrize.type}`;
                    }
                } else {
                    // --- AURY FEVER INCREMENT ---
                    // Every "Better Luck Next Time" (loss) increments the global jackpot gauge
                    try {
                        const rtdb = admin.database();
                        const jackpotRef = rtdb.ref(`mini_games/jackpots/${gameType}/count`);
                        const maxCount = gameConfig.jackpotMaxCount || 500;
                        await jackpotRef.transaction((current) => {
                            const newCount = (current || 0) + multiplier; // Scale by multiplier
                            return newCount > maxCount ? maxCount : newCount; // Cap at maxCount
                        });
                    } catch (e) {
                        console.error('Failed to increment AURY Fever counter', e);
                    }
                }

                transaction.update(userRef, {
                    points: admin.firestore.FieldValue.increment(-costPerPlay),
                    lastMiniGamePlay: admin.firestore.FieldValue.serverTimestamp(),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });

                if (finalPrize) {
                    // --- AURY FEVER JACKPOT CHECK ---
                    if (finalPrize.isJackpot || finalPrize.id === 'jackpot') {
                        try {
                            const rtdb = admin.database();
                            const jackpotCountRef = rtdb.ref(`mini_games/jackpots/${gameType}/count`);
                            const jackpotSnap = await jackpotCountRef.get();
                            const currentCount = jackpotSnap.val() || 0;
                            
                            const minAury = gameConfig.jackpotMinAury || 0;
                            const maxAury = gameConfig.jackpotMaxAury || (gameType === 'slotMachine' ? 10 : 5);
                            const maxCount = gameConfig.jackpotMaxCount || 500;
                            
                            // Proportional reward: min + (count / max) * (max - min)
                            const auryReward = minAury + (currentCount / maxCount) * (maxAury - minAury);
                            finalPrize.amount = auryReward;
                            finalPrize.name = `${auryReward.toFixed(2)} AURY JACKPOT!`;
                            
                            // Reset the counter for this game type
                            await jackpotCountRef.set(0);
                            await rtdb.ref(`mini_games/jackpots/${gameType}/lastWinner`).set({
                                uid,
                                name: userData.auroryPlayerName || userData.displayName || 'Guest',
                                amount: auryReward,
                                timestamp: admin.database.ServerValue.TIMESTAMP
                            });
                        } catch (e) {
                            console.error('Failed to process AURY Fever Jackpot payout', e);
                            // Fallback to a small amount if RTDB fails
                            finalPrize.amount = 0.1;
                        }
                    }

                    if (finalPrize.type.toLowerCase() === 'valcoins' && finalPrize.amount > 0) {
                        // FIX: Account for the costPerPlay that was deducted prior to the win!
                        const postCostPoints = (userData.points || 0) - costPerPlay;
                        const rawNewPoints = postCostPoints + finalPrize.amount;
                        const userTier = userData.tier || 1;
                        const clampedPoints = clampPointsToTierMax(rawNewPoints, userTier, postCostPoints);
                        
                        transaction.update(userRef, {
                            points: clampedPoints,
                            exp: admin.firestore.FieldValue.increment(finalPrize.amount)
                        });
                    } else if (finalPrize.type.toLowerCase() === 'aury' && finalPrize.amount > 0) {
                        const amountSmallest = Math.floor(finalPrize.amount * 1e9);
                        transaction.set(walletRef, {
                            balance: admin.firestore.FieldValue.increment(amountSmallest),
                            updatedAt: admin.firestore.FieldValue.serverTimestamp()
                        }, { merge: true });
                    } else if (finalPrize.type.toLowerCase() === 'usdc' && finalPrize.amount > 0) {
                        const amountSmallest = Math.floor(finalPrize.amount * 1e6);
                        transaction.set(walletRef, {
                            usdcBalance: admin.firestore.FieldValue.increment(amountSmallest),
                            updatedAt: admin.firestore.FieldValue.serverTimestamp()
                        }, { merge: true });
                    }
                }

                const statsUpdate: Record<string, any> = {
                    [`stats.miniGames.${gameType}.totalPlays`]: admin.firestore.FieldValue.increment(1),
                    [`stats.miniGames.${gameType}.totalSpent`]: admin.firestore.FieldValue.increment(costPerPlay),
                };
                if (finalPrize && finalPrize.amount > 0) {
                    const currencyKey = finalPrize.type.toLowerCase();
                    statsUpdate[`stats.miniGames.${gameType}.totalWon.${currencyKey}`] = admin.firestore.FieldValue.increment(finalPrize.amount);
                    statsUpdate[`stats.miniGames.all.totalWon.${currencyKey}`] = admin.firestore.FieldValue.increment(finalPrize.amount);
                }
                statsUpdate[`stats.miniGames.all.totalPlays`] = admin.firestore.FieldValue.increment(1);
                statsUpdate[`stats.miniGames.all.totalSpent`] = admin.firestore.FieldValue.increment(costPerPlay);
                transaction.update(userRef, statsUpdate);

                const historyRef = userRef.collection('miniGameHistory').doc();
                transaction.set(historyRef, {
                    gameType,
                    prizeName: finalPrize ? finalPrize.name : 'Better Luck Next Time',
                    prizeType: finalPrize ? finalPrize.type : 'none',
                    prizeAmount: finalPrize ? finalPrize.amount : 0,
                    prizeRarity: finalPrize ? finalPrize.rarity : 'common',
                    prizeIcon: finalPrize ? finalPrize.icon : '❌',
                    cost: costPerPlay,
                    multiplier,
                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                });

                if (finalPrize && finalPrize.amount > 0) {
                    try {
                        const rtdb = admin.database();
                        const feedRef = rtdb.ref('recentMiniGameWinners');
                        feedRef.push({
                            playerName: userData.auroryPlayerName || userData.displayName || 'Guest',
                            playerAvatar: userData.auroryProfilePicture || userData.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png',
                            prizeName: finalPrize.name,
                            rarity: finalPrize.rarity,
                            icon: finalPrize.icon || '🎁',
                            gameType,
                            multiplier,
                            timestamp: admin.database.ServerValue.TIMESTAMP
                        });

                        // ─── NEW: UPDATE RTDB LEADERBOARDS ───
                        await updateLeaderboardStats(
                            uid,
                            userData.auroryPlayerName || userData.displayName || 'Guest',
                            userData.auroryProfilePicture || userData.photoURL || '',
                            finalPrize.amount,
                            finalPrize.type.toLowerCase(),
                            gameType
                        );
                    } catch (e) {
                        console.error('Failed to log win to RTDB', e);
                    }
                }

                const pointsHistoryRef = userRef.collection('pointsHistory').doc();
                transaction.set(pointsHistoryRef, {
                    amount: -costPerPlay,
                    type: 'mini_game',
                    description: `Played ${gameType === 'slotMachine' ? 'Slot Machine' : 'Treasure Chest'}`,
                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                });

                return {
                    success: true,
                    prize: finalPrize,
                    cost: costPerPlay,
                    newBalance: currentPoints - costPerPlay + (finalPrize && finalPrize.type.toLowerCase() === 'valcoins' ? finalPrize.amount : 0)
                };
            });
        } catch (error: any) {
            console.error('PlayMiniGame Error:', error);
            throw new HttpsError('internal', error.message || 'An unexpected error occurred.');
        }
    }
);


// ═══════════════════════════════════════════════════════
//  DRAKKAR RACE v2 — PLACE BET
// ═══════════════════════════════════════════════════════

export const placeDrakkarBet = onCall(
    { cors: true, maxInstances: 10 },
    async (request) => {
        if (!request.auth) throw new HttpsError('unauthenticated', 'Login required');
        const { uid } = request.auth;
        const { shipId, amount } = request.data;

        if (!shipId || !amount || amount <= 0) throw new HttpsError('invalid-argument', 'Invalid bet');
        if (!Number.isInteger(amount)) throw new HttpsError('invalid-argument', 'Bet must be a whole number');

        const db = admin.firestore();
        const userRef = db.collection('users').doc(uid);
        const stateRef = db.collection('settings').doc('mini_games').collection('drakkar_race').doc('current');

        try {
            const result = await db.runTransaction(async (transaction: any) => {
                const betRef = stateRef.collection('bets').doc(uid);

                // ALL READS FIRST
                const stateSnap = await transaction.get(stateRef);
                const userSnap = await transaction.get(userRef);
                const betSnap = await transaction.get(betRef);

                const state = stateSnap.data();
                if (!state) throw new Error('State not found');
                
                const now = Date.now();
                const phaseDuration = now - (state.lastUpdate || 0);
                
                const isBetting = state.phase === 'betting';
                const isGracePeriod = state.phase === 'reveal' && phaseDuration < 2000; // 2s grace window

                if (!isBetting && !isGracePeriod) {
                    throw new Error('Betting is currently closed.');
                }

                // Validate ship is in the current race
                const raceShipIds: string[] = (state.ships || []).map((s: any) => s.id);
                if (!raceShipIds.includes(shipId)) {
                    throw new Error('This ship is not in the current race.');
                }

                const userData = userSnap.data() || {};
                const currentPoints = userData.points || 0;
                if (currentPoints < amount) {
                    throw new Error('Insufficient Valcoins');
                }

                // Check max bet per user (30000 total across all ships)
                const existingBet = betSnap.exists ? betSnap.data() || {} : {};
                const currentTotal = existingBet.total || 0;
                if (currentTotal + amount > MAX_BET_PER_USER) {
                    throw new Error(`Max bet is ${MAX_BET_PER_USER} Valcoins per race. You have ${currentTotal} already placed.`);
                }

                // New: Check max bet per player per ship (10000)
                const currentShipBet = existingBet[shipId] || 0;
                if (currentShipBet + amount > MAX_BET_PER_SHIP_PER_USER) {
                    throw new Error(`Max bet per ship is ${MAX_BET_PER_SHIP_PER_USER} Valcoins. You have ${currentShipBet} on this ship.`);
                }

                // New: Check max pool per ship (1M total pool)
                const currentPools = state.pools || {};
                const currentShipPool = currentPools[shipId] || state.houseSeed || 0;
                if (currentShipPool + amount > MAX_SHIP_POOL) {
                    throw new Error('This ship is full! Total pool limit reached.');
                }

                // ALL WRITES LAST
                transaction.update(userRef, {
                    points: admin.firestore.FieldValue.increment(-amount),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });

                // Update state pools
                transaction.update(stateRef, {
                    [`pools.${shipId}`]: admin.firestore.FieldValue.increment(amount)
                });

                if (betSnap.exists) {
                    transaction.update(betRef, {
                        [shipId]: admin.firestore.FieldValue.increment(amount),
                        total: admin.firestore.FieldValue.increment(amount)
                    });
                } else {
                    transaction.set(betRef, {
                        uid,
                        [shipId]: amount,
                        total: amount,
                        playerName: userData.auroryPlayerName || userData.displayName || 'Guest',
                        playerAvatar: userData.auroryProfilePicture || userData.photoURL || '',
                        timestamp: admin.firestore.FieldValue.serverTimestamp()
                    });
                }

                return { 
                    success: true, 
                    newBalance: currentPoints - amount,
                    playerName: userData.auroryPlayerName || userData.displayName || 'Guest',
                    playerAvatar: userData.auroryProfilePicture || userData.photoURL || ''
                };
            });

            const rtdb = admin.database();
            
            // Real-time bettors for social proof (Avatar Bubbles)
            const resultData = result as any;
            await rtdb.ref(`drakkar_race/bettors/${shipId}/${uid}`).set({
                name: resultData.playerName,
                avatar: resultData.playerAvatar
            });

            return result;
        } catch (error: any) {
            console.error('Place Bet Error:', error);
            throw new HttpsError('internal', error.message);
        }
    }
);


// ═══════════════════════════════════════════════════════
//  DRAKKAR RACE v2 — STATE MACHINE HEARTBEAT
// ═══════════════════════════════════════════════════════

export const refreshDrakkarRace = onCall(
    { cors: true, maxInstances: 5 },
    async (request) => {
        const db = admin.firestore();
        const stateRef = db.collection('settings').doc('mini_games').collection('drakkar_race').doc('current');
        const rtdb = admin.database();

        try {
            const result = await db.runTransaction(async (transaction: any) => {
                const stateSnap = await transaction.get(stateRef);
                let state = stateSnap.data();
                const now = Date.now();

                if (!state) {
                    state = { phase: 'result', endTime: now - 1, raceId: 0 };
                }

                if (now < state.endTime) return { state, changed: false };

                let nextPhase: string;
                let duration: number;
                let updates: any = {};

                if (state.phase === 'betting') {
                    // Betting → Reveal (show hidden weathers)
                    nextPhase = 'reveal';
                    duration = DURATIONS.reveal;

                } else if (state.phase === 'reveal') {
                    // Reveal → Racing (compute winner, start animation)
                    nextPhase = 'racing';
                    const shipIndices: number[] = state.shipIndices || [0, 1, 2];
                    const weatherIndices: number[] = state.weatherIndices || [0, 1, 2];
                    const { winnerIdx, finishTimes } = determineRaceResult(shipIndices, weatherIndices);

                    // Race duration = slowest ship time + 500ms buffer
                    const maxTime = Math.max(...finishTimes);
                    duration = Math.ceil(maxTime) + 500;


                    updates = {
                        winnerIdx,
                        finishTimes,
                        raceDuration: duration,
                        raceStartTime: now
                    };

                } else if (state.phase === 'racing') {
                    // Racing → Result (payouts)
                    nextPhase = 'result';
                    duration = DURATIONS.result;

                } else {
                    // Result/Init → New Betting Phase
                    nextPhase = 'betting';
                    duration = DURATIONS.betting;

                    const shipIndices = pickUnique(3);
                    
                    // --- THE TABLE FLIP ALGORITHM ---
                    // 1. Pick a "bait" weather
                    const baitWeather = Math.floor(Math.random() * 7);

                    // 2. Rank the 3 ships in this bait weather
                    const shipRankings = shipIndices.map(sIdx => ({
                        idx: sIdx,
                        speed: SPEED_MATRIX[sIdx][baitWeather]
                    }));
                    shipRankings.sort((a, b) => b.speed - a.speed); // [0]=Favorite, [1]=Medium, [2]=Underdog
                    
                    // 3. Determine which ship gets the boost based on requested odds
                    const roll = Math.random();
                    let chosenShipIdx: number;
                    if (roll < 0.34) {
                        chosenShipIdx = shipRankings[2].idx; // 34% Underdog
                    } else if (roll < 0.67) {
                        chosenShipIdx = shipRankings[1].idx; // 33% Medium
                    } else {
                        chosenShipIdx = shipRankings[0].idx; // 33% Favorite
                    }

                    // 4. Find the chosen ship's absolute best weathers
                    const allWeathers = [0, 1, 2, 3, 4, 5, 6];
                    allWeathers.sort((a, b) => SPEED_MATRIX[chosenShipIdx][b] - SPEED_MATRIX[chosenShipIdx][a]);

                    // 5. Build the final 5 weathers, ensuring chosen ship guarantees a win
                    let weatherIndices: number[] = [];
                    let revealedIndex: number = 0;
                    let safetyCounter = 0;
                    const numTopWeathers = Math.random() < 0.5 ? 1 : 2;

                    while (safetyCounter < 50) {
                        safetyCounter++;
                        const unshuffled = [baitWeather, ...allWeathers.slice(0, numTopWeathers)];
                        while (unshuffled.length < 5) {
                            unshuffled.push(Math.floor(Math.random() * 7));
                        }
                        
                        weatherIndices = shuffleArray(unshuffled);
                        revealedIndex = weatherIndices.indexOf(baitWeather);
                        
                        const result = determineRaceResult(shipIndices, weatherIndices);
                        if (shipIndices[result.winnerIdx] === chosenShipIdx) {
                            break; // Winning combination found!
                        }
                    }
                    // ---------------------------------

                    const ships = shipIndices.map((i: number) => ALL_SHIPS[i]);
                    const weathers = weatherIndices.map((i: number) => ALL_WEATHERS[i]);

                    updates = {
                        raceId: (state.raceId || 0) + 1,
                        ships,
                        weathers,
                        shipIndices,
                        weatherIndices,
                        revealedIndex,
                        winnerIdx: null,
                        finishTimes: null,
                        raceDuration: null,
                        raceStartTime: null,
                        pools: {} // Will be populated with houseSeed below
                    };
                }

                // Fetch dynamic configuration
                const configRef = db.collection('settings').doc('mini_games');
                const configSnap = await transaction.get(configRef);
                const config = configSnap.exists ? configSnap.data()?.drakkarRace || {} : {};
                
                const houseSeed = config.houseSeed ?? DEFAULT_HOUSE_SEED;
                const multiplierFactor = config.multiplierFactor ?? (1 - DEFAULT_HOUSE_CUT);

                // If we just initialized a new betting phase, populate pools with houseSeed
                if (nextPhase === 'betting' && updates.pools) {
                    updates.ships.forEach((ship: any) => {
                        updates.pools[ship.id] = houseSeed;
                    });

                    // ─── GHOST BOTS GENERATION ───
                    if (config.botsEnabled !== false) {
                        // Persist or refresh base bot count every 20 races
                        let botBaseCount = state.botBaseCount || 15;
                        if (state.raceId % 20 === 0) {
                            const minB = config.minBots ?? 10;
                            const maxB = config.maxBots ?? 20;
                            botBaseCount = Math.floor(Math.random() * (maxB - minB + 1)) + minB;
                        }

                        // Fluctuat slightly (+/- 2) each race within overall range
                        const flex = Math.floor(Math.random() * 5) - 2;
                        const targetBots = Math.max(config.minBots ?? 10, Math.min(config.maxBots ?? 20, botBaseCount + flex));
                        
                        const botProfile = generateBotProfile(updates.ships, { 
                            ...config, 
                            minBots: targetBots, 
                            maxBots: targetBots 
                        });

                        updates.botActions = botProfile.botActions;
                        updates.botPools = botProfile.botPools;
                        updates.botCount = botProfile.botCount;
                        updates.botBaseCount = botBaseCount;
                    } else {
                        updates.botActions = [];
                        updates.botPools = {};
                        updates.botCount = 0;
                    }
                }

                const newState = {
                    ...state,
                    ...updates,
                    phase: nextPhase,
                    endTime: now + duration,
                    lastUpdate: now,
                    // Persist config for the duration of this race
                    houseSeed,
                    multiplierFactor
                };

                transaction.set(stateRef, newState);
                return { state: newState, changed: true };
            });

            // Side effects outside transaction
            if (result.changed) {
                const newState = result.state;
                await rtdb.ref('drakkar_race/state').set(newState);

                if (newState.phase === 'betting') {
                    // Reset pools for new race
                    const shipIds = (newState.ships || []).map((s: any) => s.id);
                    const poolReset: Record<string, number> = {};
                    shipIds.forEach((id: string) => { poolReset[id] = newState.houseSeed || 0; });
                    await rtdb.ref('drakkar_race/pools').set(poolReset);
                    await rtdb.ref('drakkar_race/bettors').remove(); // Clear social bubbles for new race
                    await clearBets(db.collection('settings').doc('mini_games').collection('drakkar_race').doc('current'));
                } else if (newState.phase === 'reveal') {
                    // MASTER SYNC: Consolidated/flushed bets from Firestore ground truth to RTDB
                    try {
                        const statePath = db.collection('settings').doc('mini_games').collection('drakkar_race').doc('current');
                        
                        // ── SAFETY DELAY ──
                        // Wait for any concurrent Firestore transactions from late-betting clients to fully replicate.
                        await new Promise(resolve => setTimeout(resolve, 5000));

                        const betsSnap = await statePath.collection('bets').get();
                        const shipIds = (newState.ships || []).map((s: any) => s.id);
                        const flushedPools: Record<string, number> = {};
                        
                        // FIX: Initialize with houseSeed, not 0
                        shipIds.forEach((id: string) => { 
                            flushedPools[id] = newState.houseSeed || 0; 
                        });

                        if (!betsSnap.empty) {
                            betsSnap.docs.forEach((doc: any) => {
                                const betData = doc.data();
                                shipIds.forEach((id: string) => {
                                    if (betData[id]) flushedPools[id] += betData[id];
                                });
                            });
                        }
                        // Update RTDB with the Source of Truth
                        await rtdb.ref('drakkar_race/pools').set(flushedPools);
                    } catch (e) {
                        console.error('Master Sync failed during Reveal phase', e);
                    }
                } else if (newState.phase === 'result') {
                    await processDrakkarPayouts(newState);
                }
            }

            return { success: true, state: result.state };
        } catch (error: any) {
            console.error('Drakkar Refresh Error:', error);
            throw new HttpsError('internal', error.message);
        }
    }
);


// ═══════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════

async function clearBets(stateRef: admin.firestore.DocumentReference) {
    const bets = await stateRef.collection('bets').get();
    if (bets.empty) return;
    const batch = admin.firestore().batch();
    bets.docs.forEach((doc: any) => batch.delete(doc.ref));
    await batch.commit();
}

async function processDrakkarPayouts(raceState: any) {
    const db = admin.firestore();
    const rtdb = admin.database();
    const stateRef = db.collection('settings').doc('mini_games').collection('drakkar_race').doc('current');

    const winnerIdx = raceState.winnerIdx;
    if (winnerIdx === null || winnerIdx === undefined) return;

    const winnerShip = raceState.ships[winnerIdx];
    const winnerId = winnerShip.id;

    const houseSeed = raceState.houseSeed ?? DEFAULT_HOUSE_SEED;
    const multiplierFactor = raceState.multiplierFactor ?? (1 - DEFAULT_HOUSE_CUT);

    const bets = await stateRef.collection('bets').get();
    let totalPool = houseSeed * 3;
    let winnerPool = houseSeed;

    // Add Bot Bets to Total Pool
    if (raceState.botPools) {
        Object.keys(raceState.botPools).forEach(shipId => {
            const amount = raceState.botPools[shipId] || 0;
            totalPool += amount;
            // NEW: Bot bets on the winner now count towards the divisor (diluting payout)
            if (shipId === winnerId) winnerPool += amount;
        });
    }

    if (!bets.empty) {
        const betDocs: any[] = [];
        for (const betDoc of bets.docs) {
            const bet = betDoc.data();
            betDocs.push(bet);
            totalPool += bet.total || 0;
            winnerPool += bet[winnerId] || 0;
        }

        const payoutMultiplier = (totalPool / winnerPool) * multiplierFactor;

        for (const bet of betDocs) {
            const betOnWinner = bet[winnerId] || 0;
            if (betOnWinner <= 0) continue;

            const winAmount = Math.floor(betOnWinner * payoutMultiplier);
            if (winAmount <= 0) continue;

            try {
                await db.runTransaction(async (t: any) => {
                    const userRef = db.collection('users').doc(bet.uid);
                    const userSnap = await t.get(userRef);
                    if (!userSnap.exists) return;
                    
                    const userData = userSnap.data();
                    const currentPoints = userData.points || 0;
                    const userTier = userData.tier || 1;
                    
                    const rawNewPoints = currentPoints + winAmount;
                    const clampedPoints = clampPointsToTierMax(rawNewPoints, userTier, currentPoints);

                    t.update(userRef, {
                        points: clampedPoints,
                        exp: admin.firestore.FieldValue.increment(winAmount),
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    });

                    const historyRef = userRef.collection('miniGameHistory').doc();
                    t.set(historyRef, {
                        gameType: 'drakkarRace',
                        prizeName: `${winAmount} Valcoins`,
                        prizeType: 'valcoins',
                        prizeAmount: winAmount,
                        prizeRarity: winAmount >= (bet.total * 5) ? 'legendary' : winAmount >= (bet.total * 2) ? 'epic' : 'rare',
                        prizeIcon: 'legendary_ship.png',
                        cost: bet.total,
                        timestamp: admin.firestore.FieldValue.serverTimestamp()
                    });
                });

                if (winAmount >= (bet.total * 2)) {
                    try {
                        await rtdb.ref('recentMiniGameWinners').push({
                            playerName: bet.playerName || 'Guest',
                            playerAvatar: bet.playerAvatar || 'https://cdn.discordapp.com/embed/avatars/0.png',
                            prizeName: `${winAmount} Valcoins (${payoutMultiplier.toFixed(1)}x)`,
                            rarity: payoutMultiplier >= 5 ? 'legendary' : 'epic',
                            icon: 'legendary_ship.png',
                            gameType: 'drakkarRace',
                            timestamp: admin.database.ServerValue.TIMESTAMP
                        });
                    } catch (e) {
                        console.error('Failed to push to GlobalWinNotifier', e);
                    }
                }

                // ─── NEW: UPDATE RTDB LEADERBOARDS ───
                await updateLeaderboardStats(
                    bet.uid,
                    bet.playerName || 'Guest',
                    bet.playerAvatar || '',
                    winAmount,
                    'valcoins',
                    'drakkarRace'
                );
            } catch (err) {
                console.error(`Failed to pay out user ${bet.uid}`, err);
            }
        }
    }

    const finalMultiplier = (totalPool / winnerPool) * multiplierFactor;

    // Save race history to RTDB (last 10 races)
    try {
        const historyEntry = {
            raceId: raceState.raceId,
            winner: winnerShip,
            totalPool,
            payoutMultiplier: Math.round(finalMultiplier * 100) / 100,
            ships: raceState.ships,
            weathers: raceState.weathers,
            timestamp: admin.database.ServerValue.TIMESTAMP
        };
        const historyRef = rtdb.ref('drakkar_race/history').push();
        await historyRef.set(historyEntry);

        // Trim to last 10
        const allHistory = await rtdb.ref('drakkar_race/history').orderByChild('timestamp').get();
        if (allHistory.exists()) {
            const allKeys = Object.keys(allHistory.val());
            if (allKeys.length > 10) {
                const toDelete = allKeys.slice(0, allKeys.length - 10);
                const updates: Record<string, null> = {};
                toDelete.forEach(k => { updates[k] = null; });
                await rtdb.ref('drakkar_race/history').update(updates);
            }
        }
    } catch (e) {
        console.error('Failed to save race history', e);
    }
}


// ═══════════════════════════════════════════════════════
//  WEIGHTED RANDOM (for Slot Machine / Treasure Chest)
// ═══════════════════════════════════════════════════════

function selectWeightedPrize(prizes: any[], noWinWeight = 0, costPerPlay = 50) {
    if (!prizes || prizes.length === 0) {
        return {
            id: 'fallback',
            name: `${Math.floor(costPerPlay / 2)} Valcoins`,
            type: 'valcoins',
            amount: Math.floor(costPerPlay / 2),
            rarity: 'common',
            icon: '🪙'
        };
    }

    const prizesWeight = prizes.reduce((sum, p) => sum + (p.weight ?? 1), 0);
    const totalWeight = prizesWeight + (noWinWeight || 0);
    if (totalWeight <= 0) return null;

    let random = Math.random() * totalWeight;
    if (random < noWinWeight) return null;
    random -= noWinWeight;

    for (const prize of prizes) {
        const weight = prize.weight ?? 1;
        if (weight <= 0) continue;
        random -= weight;
        if (random <= 0) return prize;
    }

    const activePrizes = prizes.filter(p => (p.weight ?? 1) > 0);
    return activePrizes.length > 0 ? activePrizes[activePrizes.length - 1] : null;
}

function getDefaultConfig(): any {
    return {
        slotMachine: {
            enabled: true,
            costPerPlay: 50,
            noWinWeight: 30,
            jackpotMaxAury: 10,
            prizes: [
                { id: 'sm1', name: '25 Valcoins', type: 'valcoins', amount: 25, weight: 35, rarity: 'common', icon: 'common_horn.png' },
                { id: 'sm2', name: '50 Valcoins', type: 'valcoins', amount: 50, weight: 25, rarity: 'common', icon: 'common_shield.png' },
                { id: 'sm3', name: '100 Valcoins', type: 'valcoins', amount: 100, weight: 15, rarity: 'rare', icon: 'rare_axe.png' },
                { id: 'sm4', name: '250 Valcoins', type: 'valcoins', amount: 250, weight: 10, rarity: 'epic', icon: 'epic_amber.png' },
                { id: 'sm5', name: '500 Valcoins', type: 'valcoins', amount: 500, weight: 5, rarity: 'legendary', icon: 'legendary_hammer.png' },
                { id: 'sm6', name: '0.5 AURY', type: 'aury', amount: 0.5, weight: 5, rarity: 'epic', icon: 'epic_helmet.png' },
                { id: 'sm7', name: '1 AURY', type: 'aury', amount: 1, weight: 3, rarity: 'legendary', icon: 'legendary_hammer.png' },
                { id: 'sm8', name: '1 USDC', type: 'usdc', amount: 1, weight: 2, rarity: 'legendary', icon: 'legendary_ship.png' },
                { id: 'jackpot', name: 'AURY FEVER JACKPOT', type: 'aury', amount: 0, weight: 1, rarity: 'legendary', icon: 'legendary_hammer.png', isJackpot: true },
            ]
        },
        treasureChest: {
            enabled: true,
            costPerPlay: 30,
            noWinWeight: 20,
            jackpotMaxAury: 5,
            prizes: [
                { id: 'tc1', name: '15 Valcoins', type: 'valcoins', amount: 15, weight: 35, rarity: 'common', icon: 'common_horn.png' },
                { id: 'tc2', name: '30 Valcoins', type: 'valcoins', amount: 30, weight: 25, rarity: 'common', icon: 'common_shield.png' },
                { id: 'tc3', name: '75 Valcoins', type: 'valcoins', amount: 75, weight: 15, rarity: 'rare', icon: 'rare_axe.png' },
                { id: 'tc4', name: '150 Valcoins', type: 'valcoins', amount: 150, weight: 10, rarity: 'epic', icon: 'epic_helmet.png' },
                { id: 'tc5', name: '300 Valcoins', type: 'valcoins', amount: 300, weight: 5, rarity: 'legendary', icon: 'legendary_ship.png' },
                { id: 'tc6', name: '0.25 AURY', type: 'aury', amount: 0.25, weight: 5, rarity: 'epic', icon: 'epic_amber.png' },
                { id: 'tc7', name: '0.5 AURY', type: 'aury', amount: 0.5, weight: 3, rarity: 'legendary', icon: 'legendary_hammer.png' },
                { id: 'tc8', name: '0.5 USDC', type: 'usdc', amount: 0.5, weight: 2, rarity: 'legendary', icon: 'legendary_ship.png' },
                { id: 'jackpot', name: 'AURY FEVER JACKPOT', type: 'aury', amount: 0, weight: 1, rarity: 'legendary', icon: 'legendary_ship.png', isJackpot: true },
            ]
        },
        drakkarRace: {
            enabled: true,
            minBet: 1,
            maxBetPerUser: 10000,
            maxBetPerRace: 1000000,
            description: 'Bet on legendary ships in a real-time parimutuel race!',
            multiplier: 'parimutuel'
        },
        odinsRiddle: {
            enabled: true,
            timerLimit: 15,
            maxWrongPerDay: 3,
            baseRiddles: [
                { difficulty: 'easy', reward: 20 },
                { difficulty: 'easy', reward: 20 },
                { difficulty: 'medium', reward: 30 },
                { difficulty: 'medium', reward: 30 },
                { difficulty: 'hard', reward: 50 },
            ],
            streakRiddles: [
                { difficulty: 'easy', reward: 50 },
                { difficulty: 'easy', reward: 50 },
                { difficulty: 'easy', reward: 50 },
                { difficulty: 'medium', reward: 50 },
                { difficulty: 'hard', reward: 50 },
            ]
        }
    };
}
// ═══════════════════════════════════════════════════════
//  ODIN'S RIDDLE — DAILY PROGRESSION SYSTEM
// ═══════════════════════════════════════════════════════

/** Get today's date as a string (UTC) for daily reset tracking */
function getTodayDateString(): string {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

/** Look up the difficulty and reward for a given riddle position */
function getRiddleSlot(riddleIndex: number, config: any): { difficulty: string; reward: number; phase: string } | null {
    const baseRiddles = (config.baseRiddles && config.baseRiddles.length > 0) ? config.baseRiddles : [
        { difficulty: 'easy', reward: 20 },
        { difficulty: 'easy', reward: 20 },
        { difficulty: 'medium', reward: 30 },
        { difficulty: 'medium', reward: 30 },
        { difficulty: 'hard', reward: 50 },
    ];
    const streakRiddles = (config.streakRiddles && config.streakRiddles.length > 0) ? config.streakRiddles : [
        { difficulty: 'easy', reward: 50 },
        { difficulty: 'easy', reward: 50 },
        { difficulty: 'easy', reward: 50 },
        { difficulty: 'medium', reward: 50 },
        { difficulty: 'hard', reward: 50 },
    ];

    if (riddleIndex < baseRiddles.length) {
        return { ...baseRiddles[riddleIndex], phase: 'base' };
    }

    const streakIdx = riddleIndex - baseRiddles.length;
    if (streakIdx < streakRiddles.length) {
        return { ...streakRiddles[streakIdx], phase: 'streak' };
    }

    return null; // All riddles completed
}

export const answerRiddle = onCall(
    {
        cors: true,
        maxInstances: 10,
        timeoutSeconds: 15,
        memory: '256MiB',
    },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError('unauthenticated', 'You must be logged in to play.');
        }

        const { uid } = request.auth;
        const { riddleId, answerIndex } = request.data;

        if (!riddleId || typeof riddleId !== 'string') {
            throw new HttpsError('invalid-argument', 'Riddle ID is required.');
        }
        if (typeof answerIndex !== 'number' || answerIndex < -1 || answerIndex > 3) {
            throw new HttpsError('invalid-argument', 'Answer index must be -1 (timeout) or 0-3.');
        }

        const isTimeout = answerIndex === -1;
        const db = admin.firestore();

        try {
            // 1. Fetch riddle and config
            const riddleRef = db.collection('riddles').doc(riddleId);
            const configRef = db.collection('settings').doc('mini_games');
            const [riddleSnap, configSnap] = await Promise.all([
                riddleRef.get(),
                configRef.get()
            ]);

            if (!riddleSnap.exists) {
                throw new HttpsError('not-found', 'Riddle not found.');
            }

            const riddle = riddleSnap.data()!;
            const isCorrect = isTimeout ? false : answerIndex === riddle.correctIndex;

            // Get config (admin-editable)
            let riddleConfig: any;
            if (configSnap.exists) {
                riddleConfig = configSnap.data()?.odinsRiddle || getDefaultConfig().odinsRiddle;
            } else {
                riddleConfig = getDefaultConfig().odinsRiddle;
            }

            const maxWrong = riddleConfig.maxWrongPerDay || 3;
            const today = getTodayDateString();

            // 2. Run transaction for daily progress + reward
            const userRef = db.collection('users').doc(uid);
            const result = await db.runTransaction(async (transaction: any) => {
                const userSnap = await transaction.get(userRef);
                if (!userSnap.exists) throw new Error('User not found.');
                const userData = userSnap.data() || {};

                // Get or reset daily progress
                let daily = userData.dailyRiddle || {};
                if (daily.date !== today) {
                    // New day — reset everything
                    daily = {
                        date: today,
                        totalAnswered: 0,
                        totalCorrect: 0,
                        wrongAnswers: 0,
                        streakUnlocked: false,
                        phase: 'base'
                    };
                }

                // Check if already locked out or completed
                if (daily.phase === 'locked' || daily.phase === 'completed') {
                    return {
                        success: false,
                        message: daily.phase === 'locked' ? 'Locked' : 'Completed',
                        dailyProgress: daily,
                        stats: userData.stats?.riddles || {}
                    };
                }

                // Determine current riddle slot
                const currentSlot = getRiddleSlot(daily.totalAnswered, riddleConfig);
                if (!currentSlot) {
                    daily.phase = 'completed';
                    transaction.update(userRef, { dailyRiddle: daily });
                    return {
                        success: false,
                        message: 'Completed',
                        dailyProgress: daily,
                        stats: userData.stats?.riddles || {}
                    };
                }

                // Check if streak is required but not unlocked
                if (currentSlot.phase === 'streak' && !daily.streakUnlocked) {
                    daily.phase = 'completed';
                    transaction.update(userRef, { dailyRiddle: daily });
                    return {
                        success: false,
                        message: 'Completed (Streak Locked)',
                        dailyProgress: daily,
                        stats: userData.stats?.riddles || {}
                    };
                }

                const reward = isCorrect ? currentSlot.reward : 0;

                // Update daily progress
                daily.totalAnswered += 1;
                if (isCorrect) {
                    daily.totalCorrect += 1;
                } else {
                    daily.wrongAnswers += 1;
                }

                // Check if base round is complete → allow streak if lives left
                const baseCount = (riddleConfig.baseRiddles && riddleConfig.baseRiddles.length > 0) ? riddleConfig.baseRiddles.length : 5;
                if (daily.totalAnswered === baseCount) {
                    if (daily.wrongAnswers < maxWrong) {
                        daily.streakUnlocked = true;
                        daily.phase = 'streak';
                    } else {
                        daily.phase = 'locked';
                    }
                }

                // Check wrong answer limit
                if (daily.wrongAnswers >= maxWrong) {
                    daily.phase = 'locked';
                }

                // Check if all riddles are done
                const streakCount = (riddleConfig.streakRiddles && riddleConfig.streakRiddles.length > 0) ? riddleConfig.streakRiddles.length : 5;
                const totalRiddles = baseCount + streakCount;
                if (daily.totalAnswered >= totalRiddles) {
                    daily.phase = 'completed';
                }

                // Build user updates
                const updates: any = {
                    dailyRiddle: daily,
                    [`stats.riddles.totalPlayed`]: admin.firestore.FieldValue.increment(1),
                };

                if (isCorrect) {
                    updates[`stats.riddles.totalCorrect`] = admin.firestore.FieldValue.increment(1);
                    updates[`stats.riddles.totalEarned`] = admin.firestore.FieldValue.increment(reward);
                    updates[`stats.riddles.streak`] = (userData.stats?.riddles?.streak || 0) + 1;

                    // Award Valcoins (clamped to tier max)
                    const currentPoints = userData.points || 0;
                    const userTier = userData.tier || 1;
                    const rawNew = currentPoints + reward;
                    const clamped = clampPointsToTierMax(rawNew, userTier, currentPoints);
                    updates.points = clamped;
                } else {
                    updates[`stats.riddles.streak`] = 0;
                }

                transaction.update(userRef, updates);

                return {
                    success: true,
                    correct: isCorrect,
                    correctIndex: riddle.correctIndex,
                    reward,
                    streak: isCorrect ? (userData.stats?.riddles?.streak || 0) + 1 : 0,
                    totalCorrect: (userData.stats?.riddles?.totalCorrect || 0) + (isCorrect ? 1 : 0),
                    totalPlayed: (userData.stats?.riddles?.totalPlayed || 0) + 1,
                    dailyProgress: daily,
                };
            });

            // 3. Graceful handle for rejection early exit
            if (result.success === false) {
                return {
                    success: false,
                    correct: false,
                    message: result.message,
                    dailyProgress: result.dailyProgress,
                    streak: result.stats.streak || 0,
                    totalCorrect: result.stats.totalCorrect || 0,
                    totalPlayed: result.stats.totalPlayed || 0
                };
            }

            // 3. Update riddle stats (outside transaction)
            const riddleUpdate: any = {
                timesAsked: admin.firestore.FieldValue.increment(1),
            };
            if (isCorrect) {
                riddleUpdate.timesCorrect = admin.firestore.FieldValue.increment(1);
            }
            await riddleRef.update(riddleUpdate);

            // 4. Leaderboard update for correct answers
            const finalReward = result.reward || 0;
            if (isCorrect && finalReward > 0) {
                try {
                    const userSnap = await userRef.get();
                    const userData = userSnap.data() || {};
                    await updateLeaderboardStats(
                        uid,
                        userData.auroryPlayerName || userData.displayName || 'Guest',
                        userData.auroryProfilePicture || userData.photoURL || '',
                        finalReward,
                        'valcoins',
                        'odinsRiddle'
                    );
                } catch (e) {
                    console.error('Riddle leaderboard update failed', e);
                }
            }

            return {
                success: true,
                correct: result.correct,
                correctIndex: result.correctIndex,
                reward: result.reward,
                streak: result.streak,
                totalCorrect: result.totalCorrect,
                totalPlayed: result.totalPlayed,
                dailyProgress: result.dailyProgress,
            };
        } catch (error: any) {
            console.error('AnswerRiddle Error:', error);
            throw new HttpsError('internal', error.message || 'An error occurred.');
        }
    }
);

// ═══════════════════════════════════════════════════════
//  YGGDRASIL ASCENDER
// ═══════════════════════════════════════════════════════

/**
 * Submit Yggdrasil Ascender run for rewards
 */
export const submitYggdrasilRun = onCall(
    { cors: true, maxInstances: 10 },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError('unauthenticated', 'User must be logged in.');
        }

        const { altitude, runes } = request.data;
        const { uid } = request.auth;
        const today = new Date().toISOString().split('T')[0];

        if (typeof altitude !== 'number' || typeof runes !== 'number' || altitude < 0 || runes < 0) {
            throw new HttpsError('invalid-argument', 'Invalid run data.');
        }

        const db = admin.firestore();
        const rtdb = admin.database();
        const userRef = db.collection('users').doc(uid);
        const runDocRef = userRef.collection('yggdrasil_runs').doc(today);
        const configRef = db.collection('settings').doc('mini_games');
        const upgradesRef = userRef.collection('yggdrasil_data').doc('upgrades');

        try {
            // Always increment global ascension goal (even past daily limit)
            try {
                await rtdb.ref('yggdrasil/global_goal/current').transaction((current: number | null) => {
                    return (current || 0) + Math.floor(altitude);
                });
            } catch (e) {
                console.error('Global ascension increment failed:', e);
            }

            return await db.runTransaction(async (transaction: any) => {
                const [userDoc, runDoc, configDoc, upgradesDoc] = await Promise.all([
                    transaction.get(userRef),
                    transaction.get(runDocRef),
                    transaction.get(configRef),
                    transaction.get(upgradesRef)
                ]);

                if (!userDoc.exists) {
                    throw new HttpsError('not-found', 'User not found.');
                }

                const configData = configDoc.exists ? configDoc.data().yggdrasilAscender || {} : {};
                const maxDailyRuns = configData.maxDailyRuns ?? 5;
                const runeMultiplier = configData.runeMultiplier ?? 1.0;
                const globalGoalTarget = configData.globalGoalTarget ?? 1000000;

                // Sync target to RTDB so it matches Admin Panel
                await rtdb.ref('yggdrasil/global_goal/target').set(globalGoalTarget);

                const runData = runDoc.exists ? runDoc.data() : { count: 0 };
                const rewardAmount = Math.floor(altitude / 100) * Math.max(1, Math.floor(runes * runeMultiplier));
                const runesEarned = Math.floor(runes);

                const { turbosUsed = 0, doubleJumpsUsed = 0 } = request.data;
                const updateData: any = {};

                // Deduct consumed power-ups from the correct subcollection (Always happens if used)
                if (turbosUsed > 0 || doubleJumpsUsed > 0) {
                    const upgrades = upgradesDoc.exists ? upgradesDoc.data() : {};
                    
                    const newExtraTurbo = Math.max(0, (upgrades.extraTurbo || 0) - turbosUsed);
                    const newExtraJump = Math.max(0, (upgrades.extraJump || 0) - doubleJumpsUsed);
                    
                    transaction.set(upgradesRef, {
                        extraTurbo: newExtraTurbo,
                        extraJump: newExtraJump
                    }, { merge: true });
                }

                if (runData.count >= maxDailyRuns) {
                    if (Object.keys(updateData).length > 0) {
                        transaction.update(userRef, updateData);
                    }
                    return { success: true, reward: 0, limitReached: true, runesEarned: 0, runsCompleted: runData.count, maxRuns: maxDailyRuns };
                }
                if (rewardAmount > 0) {
                    updateData.points = admin.firestore.FieldValue.increment(rewardAmount);
                    updateData.exp = admin.firestore.FieldValue.increment(rewardAmount);
                }
                if (runesEarned > 0) {
                    updateData.yggRunes = admin.firestore.FieldValue.increment(runesEarned);
                }


                if (Object.keys(updateData).length > 0) {
                    transaction.update(userRef, updateData);
                }

                transaction.set(runDocRef, {
                    count: runData.count + 1,
                    lastRunTime: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });

                return { 
                    success: true, 
                    reward: rewardAmount,
                    runesEarned,
                    runsCompleted: runData.count + 1,
                    maxRuns: maxDailyRuns
                };
            });
        } catch (error: any) {
            console.error('SubmitYggdrasilRun Error:', error);
            throw new HttpsError('internal', error.message || 'Failed to submit run.');
        }
    }
);

// ═══════════════════════════════════════════════════════
//  YGGDRASIL — RUNE SHOP
// ═══════════════════════════════════════════════════════

// Default shop configuration
const DEFAULT_SHOP_CONFIG = {
    magnetismCosts: [50, 150, 400], // Level 1, 2, 3
    extraPocketsCosts: { turbo: 20, doubleJump: 15 },
    idunAppleCost: 80,
    exchangeRates: [
        { currency: 'Valcoins', rate: 500, enabled: true },
        { currency: 'AURY', rate: 500, enabled: false },
        { currency: 'Amiko', rate: 500, enabled: false }
    ]
};

/**
 * Purchase a Rune Shop item.
 * Items: magnetism (upgrade), extraTurbo (consumable), extraJump (consumable), idunApple (max 1)
 */
export const purchaseRuneShopItem = onCall(
    { cors: true, maxInstances: 10 },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError('unauthenticated', 'User must be logged in.');
        }

        const { itemId } = request.data;
        const { uid } = request.auth;

        if (!itemId || typeof itemId !== 'string') {
            throw new HttpsError('invalid-argument', 'Item ID is required.');
        }

        const db = admin.firestore();
        const userRef = db.collection('users').doc(uid);
        const upgradesRef = userRef.collection('yggdrasil_data').doc('upgrades');
        const configRef = db.collection('settings').doc('mini_games');

        try {
            return await db.runTransaction(async (transaction: any) => {
                const [userDoc, upgradesDoc, configDoc] = await Promise.all([
                    transaction.get(userRef),
                    transaction.get(upgradesRef),
                    transaction.get(configRef)
                ]);

                if (!userDoc.exists) {
                    throw new HttpsError('not-found', 'User not found.');
                }

                const userData = userDoc.data();
                const runeBalance = userData.yggRunes || 0;
                const upgrades = upgradesDoc.exists ? upgradesDoc.data() : {};
                const configData = configDoc.exists ? configDoc.data() : {};
                const yggConfig = configData.miniGamesConfig?.yggdrasilAscender || configData.yggdrasilAscender || {};
                const shopCosts = yggConfig.shopCosts || {};

                let cost = 0;
                const updateUser: any = {};
                const updateUpgrades: any = {};

                switch (itemId) {
                    case 'magnetism': {
                        const currentLevel = upgrades.magnetismLevel || 0;
                        if (currentLevel >= 3) {
                            return { success: false, error: 'Rune Magnetism is already at max level.' };
                        }
                        const costKey = `magnetismLv${currentLevel + 1}`;
                        cost = shopCosts[costKey] ?? DEFAULT_SHOP_CONFIG.magnetismCosts[currentLevel];
                        updateUpgrades.magnetismLevel = currentLevel + 1;
                        break;
                    }
                    case 'extraTurbo': {
                        if ((upgrades.extraTurbo || 0) >= 3) {
                            return { success: false, error: 'You have reached the maximum number of Turbo charges.' };
                        }
                        cost = shopCosts.extraTurbo ?? DEFAULT_SHOP_CONFIG.extraPocketsCosts.turbo;
                        updateUpgrades.extraTurbo = (upgrades.extraTurbo || 0) + 1;
                        break;
                    }
                    case 'extraJump': {
                        if ((upgrades.extraJump || 0) >= 5) {
                            return { success: false, error: 'You have reached the maximum number of Double Jump charges.' };
                        }
                        cost = shopCosts.extraJump ?? DEFAULT_SHOP_CONFIG.extraPocketsCosts.doubleJump;
                        updateUpgrades.extraJump = (upgrades.extraJump || 0) + 1;
                        break;
                    }
                    case 'idunApple': {
                        if (upgrades.hasIdunApple) {
                            return { success: false, error: 'You already have an Idun\'s Apple. Use it before buying another.' };
                        }
                        cost = shopCosts.idunApple ?? DEFAULT_SHOP_CONFIG.idunAppleCost;
                        updateUpgrades.hasIdunApple = true;
                        break;
                    }
                    default: {
                        if (itemId.startsWith('custom_')) {
                            const customItems = yggConfig.customShopItems || [];
                            const customItem = customItems.find((i: any) => i.id === itemId);
                            
                            if (!customItem) {
                                return { success: false, error: 'Custom item not found in shop configuration.' };
                            }
                            
                            if (customItem.stock <= 0) {
                                return { success: false, error: 'This item is currently out of stock.' };
                            }
                            
                            cost = customItem.price || 0;
                            
                            // 1. Create prize record in user's armory
                            const prizeRef = userRef.collection('prizes').doc();
                            transaction.set(prizeRef, {
                                name: customItem.name,
                                description: customItem.description || '',
                                icon: customItem.icon || '🎁',
                                pngUrl: customItem.image || '', // Using pngUrl to match ArmoryModal's image display
                                rarity: customItem.rarity || 'common',
                                status: 'unclaimed',
                                type: 'prize',
                                source: 'Rune Shop',
                                createdAt: admin.firestore.FieldValue.serverTimestamp()
                            });
                            
                            // 2. Decrement stock in the config
                            const updatedItems = customItems.map((i: any) => {
                                if (i.id === itemId) return { ...i, stock: Math.max(0, i.stock - 1) };
                                return i;
                            });

                            const configPath = configData.miniGamesConfig 
                                ? 'miniGamesConfig.yggdrasilAscender.customShopItems' 
                                : 'yggdrasilAscender.customShopItems';
                                
                            transaction.update(configRef, { [configPath]: updatedItems });
                            break;
                        }
                        return { success: false, error: 'Unknown item.' };
                    }
                }

                if (runeBalance < cost) {
                    return { success: false, error: `Not enough Runes. Need ${cost}, have ${runeBalance}.` };
                }

                // Deduct runes
                updateUser.yggRunes = admin.firestore.FieldValue.increment(-cost);
                transaction.update(userRef, updateUser);

                // Update upgrades
                transaction.set(upgradesRef, updateUpgrades, { merge: true });

                return { 
                    success: true, 
                    cost,
                    newRuneBalance: runeBalance - cost,
                    item: itemId
                };
            });
        } catch (error: any) {
            console.error('PurchaseRuneShopItem Error:', error);
            throw new HttpsError('internal', error.message || 'Failed to purchase item.');
        }
    }
);

/**
 * Consume Iðunn's Apple (mark as used).
 */
export const consumeIdunApple = onCall(
    { cors: true, maxInstances: 10 },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError('unauthenticated', 'User must be logged in.');
        }

        const { uid } = request.auth;
        const db = admin.firestore();
        const upgradesRef = db.collection('users').doc(uid).collection('yggdrasil_data').doc('upgrades');

        try {
            await upgradesRef.set({ hasIdunApple: false }, { merge: true });
            return { success: true };
        } catch (error: any) {
            console.error('ConsumeIdunApple Error:', error);
            throw new HttpsError('internal', error.message || 'Failed to consume apple.');
        }
    }
);

/**
 * Exchange Runes for another currency (Valcoins, AURY, Amiko, etc.)
 */
export const exchangeRunes = onCall(
    { cors: true, maxInstances: 10 },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError('unauthenticated', 'User must be logged in.');
        }

        const { targetCurrency, runeAmount } = request.data;
        const { uid } = request.auth;

        if (!targetCurrency || typeof targetCurrency !== 'string') {
            throw new HttpsError('invalid-argument', 'Target currency is required.');
        }
        if (typeof runeAmount !== 'number' || runeAmount <= 0 || !Number.isInteger(runeAmount)) {
            throw new HttpsError('invalid-argument', 'Rune amount must be a positive integer.');
        }

        const db = admin.firestore();
        const userRef = db.collection('users').doc(uid);
        const configRef = db.collection('settings').doc('mini_games');

        try {
            return await db.runTransaction(async (transaction: any) => {
                const [userDoc, configDoc] = await Promise.all([
                    transaction.get(userRef),
                    transaction.get(configRef)
                ]);

                if (!userDoc.exists) {
                    throw new HttpsError('not-found', 'User not found.');
                }

                const userData = userDoc.data();
                const runeBalance = userData.yggRunes || 0;

                if (runeBalance < runeAmount) {
                    return { success: false, error: `Not enough Runes. Have ${runeBalance}, need ${runeAmount}.` };
                }

                // Get exchange rates from config (1 Rune = X units)
                const configData = configDoc.exists ? configDoc.data() : {};
                const yggConfig = configData.miniGamesConfig?.yggdrasilAscender || configData.yggdrasilAscender || {};
                const exchangeRatesConfig = yggConfig.exchangeRates || DEFAULT_SHOP_CONFIG.exchangeRates;
                
                let rate = 0;
                if (Array.isArray(exchangeRatesConfig)) {
                    const found = exchangeRatesConfig.find((r: any) => r.currency === targetCurrency);
                    rate = found ? found.rate : (targetCurrency === 'Valcoins' ? 100 : 0.01);
                } else {
                    // Object format: { valcoins: 100, aury: 0.01 }
                    const key = targetCurrency.toLowerCase();
                    rate = exchangeRatesConfig[key] ?? (targetCurrency === 'Valcoins' ? 100 : 0.01);
                }

                const outputAmount = runeAmount * rate;
                if (outputAmount <= 0) {
                    return { success: false, error: 'Amount too small for exchange.' };
                }

                const updateData: any = {
                    yggRunes: admin.firestore.FieldValue.increment(-runeAmount)
                };

                // Credit target currency
                if (targetCurrency === 'Valcoins') {
                    updateData.points = admin.firestore.FieldValue.increment(Math.floor(outputAmount));
                } else if (targetCurrency === 'AURY') {
                    updateData.auryBalance = admin.firestore.FieldValue.increment(outputAmount);
                } else {
                    // Generic currency field
                    updateData[`currencies.${targetCurrency}`] = admin.firestore.FieldValue.increment(outputAmount);
                }

                transaction.update(userRef, updateData);

                return {
                    success: true,
                    runesSpent: runeAmount,
                    received: targetCurrency === 'Valcoins' ? Math.floor(outputAmount) : outputAmount,
                    currency: targetCurrency,
                    newRuneBalance: runeBalance - runeAmount
                };
            });
        } catch (error: any) {
            console.error('ExchangeRunes Error:', error);
            throw new HttpsError('internal', error.message || 'Failed to exchange runes.');
        }
    }
);


// ═══════════════════════════════════════════════════════
//  YGGDRASIL EVENTS — JOIN & CLAIM
// ═══════════════════════════════════════════════════════

/**
 * Join a Yggdrasil event run. Deducts entry fee and increments the pool.
 */
export const joinYggdrasilEvent = onCall(
    { cors: true, maxInstances: 10, timeoutSeconds: 15, memory: '256MiB' },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError('unauthenticated', 'You must be logged in.');
        }

        const { eventId } = request.data;
        if (!eventId || typeof eventId !== 'string') {
            throw new HttpsError('invalid-argument', 'Event ID is required.');
        }

        const { uid } = request.auth;
        const db = admin.firestore();

        try {
            const eventRef = db.collection('yggdrasil_events').doc(eventId);

            return await db.runTransaction(async (transaction: any) => {
                const eventSnap = await transaction.get(eventRef);
                if (!eventSnap.exists) {
                    throw new HttpsError('not-found', 'Event not found.');
                }

                const eventData = eventSnap.data();
                if (eventData.status !== 'open') {
                    return { success: false, error: 'This event is no longer open.' };
                }

                // Get user data to deduct fee
                const userRef = db.collection('users').doc(uid);
                const userSnap = await transaction.get(userRef);
                if (!userSnap.exists) {
                    throw new HttpsError('not-found', 'User not found.');
                }
                const userData = userSnap.data();

                const entryFee = eventData.entryFee || 0;
                const currency = eventData.currency || 'AURY';

                // Deduct entry fee
                if (entryFee > 0) {
                    if (currency === 'Valcoins') {
                        const currentPoints = userData.points || 0;
                        if (currentPoints < entryFee) {
                            return { success: false, error: `Insufficient Valcoins. Need ${entryFee}, have ${currentPoints}.` };
                        }
                        transaction.update(userRef, {
                            points: admin.firestore.FieldValue.increment(-entryFee)
                        });
                    } else {
                        // AURY — deduct from wallet
                        const walletRef = db.collection('wallets').doc(uid);
                        const walletSnap = await transaction.get(walletRef);
                        if (!walletSnap.exists) {
                            return { success: false, error: 'Wallet not found. Please deposit AURY first.' };
                        }
                        const walletData = walletSnap.data();
                        const auryMultiplier = 1000000000; // lamports
                        const feeInLamports = Math.round(entryFee * auryMultiplier);
                        const currentBalance = walletData.balance || 0;

                        if (currentBalance < feeInLamports) {
                            return { success: false, error: `Insufficient AURY. Need ${entryFee}, have ${(currentBalance / auryMultiplier).toFixed(2)}.` };
                        }
                        transaction.update(walletRef, {
                            balance: admin.firestore.FieldValue.increment(-feeInLamports)
                        });

                        // Log the transaction
                        const txRef = walletRef.collection('transactions').doc();
                        transaction.set(txRef, {
                            type: 'ygg_event_entry',
                            amount: -feeInLamports,
                            currency: 'AURY',
                            description: `Yggdrasil Event Entry: ${eventData.name}`,
                            eventId: eventId,
                            timestamp: admin.firestore.FieldValue.serverTimestamp()
                        });
                    }
                }

                // Increment pool
                transaction.update(eventRef, {
                    currentPool: admin.firestore.FieldValue.increment(1)
                });

                return { success: true };
            });
        } catch (error: any) {
            console.error('JoinYggdrasilEvent Error:', error);
            throw new HttpsError('internal', error.message || 'Failed to join event.');
        }
    }
);

/**
 * Claim a Yggdrasil event prize. First player to reach the target altitude wins.
 */
export const claimYggdrasilEventPrize = onCall(
    { cors: true, maxInstances: 10, timeoutSeconds: 15, memory: '256MiB' },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError('unauthenticated', 'You must be logged in.');
        }

        const { eventId, altitude } = request.data;
        if (!eventId || typeof eventId !== 'string') {
            throw new HttpsError('invalid-argument', 'Event ID is required.');
        }
        if (typeof altitude !== 'number' || altitude < 0) {
            throw new HttpsError('invalid-argument', 'Valid altitude is required.');
        }

        const { uid } = request.auth;
        const db = admin.firestore();

        try {
            const eventRef = db.collection('yggdrasil_events').doc(eventId);

            const result = await db.runTransaction(async (transaction: any) => {
                const eventSnap = await transaction.get(eventRef);
                if (!eventSnap.exists) {
                    throw new HttpsError('not-found', 'Event not found.');
                }

                const eventData = eventSnap.data();

                // Check if event is still open
                if (eventData.status !== 'open') {
                    return { 
                        success: false, 
                        error: 'Event already claimed.',
                        winner: eventData.winnerName || 'Unknown'
                    };
                }

                // Check if pool target is met (prize is only available when pool is full)
                const currentPool = eventData.currentPool || 0;
                const targetPool = eventData.targetPool || 0;
                
                if (currentPool < targetPool) {
                    return { success: false, error: 'Prize not yet available.' };
                }

                // Check if player reached the target altitude
                if (altitude < (eventData.targetAltitude || 0)) {
                    return { success: false, error: 'You have not reached the required altitude.' };
                }

                // Get user info for the winner record
                const userRef = db.collection('users').doc(uid);
                const userSnap = await transaction.get(userRef);
                const userData = userSnap.exists ? userSnap.data() : {};
                const winnerName = userData.auroryPlayerName || userData.displayName || 'Unknown Player';

                // Close the event and record the winner
                transaction.update(eventRef, {
                    status: 'closed',
                    winnerId: uid,
                    winnerName: winnerName,
                    claimTimestamp: admin.firestore.FieldValue.serverTimestamp()
                });

                // Add prize to the user's armory (Prizes tab)
                const prizeRef = userRef.collection('prizes').doc();
                transaction.set(prizeRef, {
                    name: eventData.prizeName,
                    image: eventData.prizeImage,
                    rarity: eventData.prizeRarity || 'epic',
                    source: 'yggdrasil_event',
                    eventId: eventId,
                    eventName: eventData.name,
                    status: 'available',
                    claimedAt: admin.firestore.FieldValue.serverTimestamp()
                });

                // --- NEW: NOTIFY PLAYER ---
                const notificationRef = userRef.collection('notifications').doc();
                transaction.set(notificationRef, {
                    title: '🎁 Yggdrasil Event Won!',
                    message: `Congratulations! You reached the altitude and won the ${eventData.prizeName}. Go to your Armory to claim it!`,
                    type: 'gift',
                    icon: '🏆',
                    link: '/armory',
                    read: false,
                    createdAt: admin.firestore.FieldValue.serverTimestamp()
                });

                return { 
                    success: true, 
                    prizeName: eventData.prizeName,
                    prizeImage: eventData.prizeImage,
                    prizeRarity: eventData.prizeRarity
                };
            });

            // --- NEW: NOTIFY ADMIN ON DISCORD (OUTSIDE TRANSACTION) ---
            const GENERAL_WEBHOOK_URL = 'https://discord.com/api/webhooks/1492129011391008908/yiO-SAMvjoJXFync1kQoYnwFutN8-3Ig8srB4Ei0FFTPBAxX7WgvVMheObUg6Jaj8kWt';
            try {
                const userSnap = await db.collection('users').doc(uid).get();
                const userData = userSnap.data() || {};
                const winnerName = userData.auroryPlayerName || userData.displayName || 'Unknown Player';
                const eventSnap = await db.collection('yggdrasil_events').doc(eventId).get();
                const eventData = eventSnap.data() || {};

                const embed = {
                    title: `🏆 YGGDRASIL EVENT WON!`,
                    description: `**${winnerName}** has reached the target altitude and won the event!`,
                    color: 0xF1C40F, // Gold
                    fields: [
                        { name: 'Event', value: eventData.name || 'Unknown Event', inline: true },
                        { name: 'Prize', value: eventData.prizeName || 'Unknown Prize', inline: true },
                        { name: 'Rarity', value: eventData.prizeRarity || 'epic', inline: true },
                        { name: 'User ID', value: uid, inline: false }
                    ],
                    footer: { 
                        text: 'Asgard • Event Completion',
                        icon_url: 'https://asgard-duels.web.app/runie-avatar.png'
                    },
                    timestamp: new Date().toISOString()
                };

                await fetch(GENERAL_WEBHOOK_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username: 'Runie',
                        avatar_url: 'https://asgard-duels.web.app/runie-avatar.png',
                        content: `🎊 **A new warrior has conquered the Yggdrasil Event!** 🎊`,
                        embeds: [embed]
                    })
                });
            } catch (e) {
                console.error('Discord notify failed on win', e);
            }

            return result;
        } catch (error: any) {
            console.error('ClaimYggdrasilEventPrize Error:', error);
            throw new HttpsError('internal', error.message || 'Failed to claim prize.');
        }
    }
);

// ─── TRIGGER: NOTIFY ADMIN ON NEW PRIZE CLAIM ───
// REMOVED: Moved to claimYggdrasilEventPrize on win instead


