import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';

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
const DEFAULT_HOUSE_SEED = 500; // Phantom seed injected into every ship's pool
const DOCK_WIDTH = 10;
const SHIP_START = 10;
const MAX_BET_PER_USER = 10000;

// Phase Durations (ms)
const DURATIONS = {
    betting: 20000,
    reveal: 10000, // 10s buffer for Master Sync and synchronization
    racing: 0, // dynamic — set to winner's finish time + buffer
    result: 3000
};


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
        const { gameType } = request.data;

        if (!gameType || !['slotMachine', 'treasureChest'].includes(gameType)) {
            throw new HttpsError('invalid-argument', 'Invalid game type requested.');
        }

        const db = admin.firestore();
        const userRef = db.collection('users').doc(uid);
        const walletRef = db.collection('wallets').doc(uid);

        try {
            return await db.runTransaction(async (transaction) => {
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

                const costPerPlay = gameConfig.costPerPlay || 50;
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

                const selectedPrize = selectWeightedPrize(prizes, noWinWeight, costPerPlay);

                transaction.update(userRef, {
                    points: admin.firestore.FieldValue.increment(-costPerPlay),
                    lastMiniGamePlay: admin.firestore.FieldValue.serverTimestamp(),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });

                if (selectedPrize) {
                    if (selectedPrize.type.toLowerCase() === 'valcoins' && selectedPrize.amount > 0) {
                        transaction.update(userRef, {
                            points: admin.firestore.FieldValue.increment(selectedPrize.amount)
                        });
                    } else if (selectedPrize.type.toLowerCase() === 'aury' && selectedPrize.amount > 0) {
                        const amountSmallest = Math.floor(selectedPrize.amount * 1e9);
                        transaction.set(walletRef, {
                            balance: admin.firestore.FieldValue.increment(amountSmallest),
                            updatedAt: admin.firestore.FieldValue.serverTimestamp()
                        }, { merge: true });
                    } else if (selectedPrize.type.toLowerCase() === 'usdc' && selectedPrize.amount > 0) {
                        const amountSmallest = Math.floor(selectedPrize.amount * 1e6);
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
                if (selectedPrize && selectedPrize.amount > 0) {
                    const currencyKey = selectedPrize.type.toLowerCase();
                    statsUpdate[`stats.miniGames.${gameType}.totalWon.${currencyKey}`] = admin.firestore.FieldValue.increment(selectedPrize.amount);
                    statsUpdate[`stats.miniGames.all.totalWon.${currencyKey}`] = admin.firestore.FieldValue.increment(selectedPrize.amount);
                }
                statsUpdate[`stats.miniGames.all.totalPlays`] = admin.firestore.FieldValue.increment(1);
                statsUpdate[`stats.miniGames.all.totalSpent`] = admin.firestore.FieldValue.increment(costPerPlay);
                transaction.update(userRef, statsUpdate);

                const historyRef = userRef.collection('miniGameHistory').doc();
                transaction.set(historyRef, {
                    gameType,
                    prizeName: selectedPrize ? selectedPrize.name : 'Better Luck Next Time',
                    prizeType: selectedPrize ? selectedPrize.type : 'none',
                    prizeAmount: selectedPrize ? selectedPrize.amount : 0,
                    prizeRarity: selectedPrize ? selectedPrize.rarity : 'common',
                    prizeIcon: selectedPrize ? selectedPrize.icon : '❌',
                    cost: costPerPlay,
                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                });

                if (selectedPrize && selectedPrize.amount > 0) {
                    try {
                        const rtdb = admin.database();
                        const feedRef = rtdb.ref('recentMiniGameWinners');
                        feedRef.push({
                            playerName: userData.auroryPlayerName || userData.displayName || 'Guest',
                            playerAvatar: userData.auroryProfilePicture || userData.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png',
                            prizeName: selectedPrize.name,
                            rarity: selectedPrize.rarity,
                            icon: selectedPrize.icon || '🎁',
                            gameType,
                            timestamp: admin.database.ServerValue.TIMESTAMP
                        });
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
                    prize: selectedPrize,
                    cost: costPerPlay,
                    newBalance: currentPoints - costPerPlay + (selectedPrize && selectedPrize.type.toLowerCase() === 'valcoins' ? selectedPrize.amount : 0)
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
            const result = await db.runTransaction(async (transaction) => {
                const betRef = stateRef.collection('bets').doc(uid);

                // ALL READS FIRST
                const stateSnap = await transaction.get(stateRef);
                const userSnap = await transaction.get(userRef);
                const betSnap = await transaction.get(betRef);

                const state = stateSnap.data();
                if (!state || state.phase !== 'betting') {
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

                // Check max bet per user (1000 total across all ships)
                const existingBet = betSnap.exists ? betSnap.data() || {} : {};
                const currentTotal = existingBet.total || 0;
                if (currentTotal + amount > MAX_BET_PER_USER) {
                    throw new Error(`Max bet is ${MAX_BET_PER_USER} Valcoins per race. You have ${currentTotal} already placed.`);
                }

                // ALL WRITES LAST
                transaction.update(userRef, {
                    points: admin.firestore.FieldValue.increment(-amount),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
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

            // Side effect: Update public pool in RTDB
            const rtdb = admin.database();
            await rtdb.ref(`drakkar_race/pools/${shipId}`).transaction((current) => (current || 0) + amount);

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
            const result = await db.runTransaction(async (transaction) => {
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
                    const weatherIndices = pick5Weathers();
                    const revealedIndex = Math.floor(Math.random() * 5); // Pick one of 5 to reveal

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
                        raceStartTime: null
                    };
                }

                // Fetch dynamic configuration
                const configRef = db.collection('settings').doc('mini_games');
                const configSnap = await transaction.get(configRef);
                const config = configSnap.exists ? configSnap.data()?.drakkarRace || {} : {};
                
                const houseSeed = config.houseSeed ?? DEFAULT_HOUSE_SEED;
                const multiplierFactor = config.multiplierFactor ?? (1 - DEFAULT_HOUSE_CUT);

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
                    shipIds.forEach((id: string) => { poolReset[id] = 0; });
                    await rtdb.ref('drakkar_race/pools').set(poolReset);
                    await rtdb.ref('drakkar_race/bettors').remove(); // Clear social bubbles for new race
                    await clearBets(db.collection('settings').doc('mini_games').collection('drakkar_race').doc('current'));
                } else if (newState.phase === 'reveal') {
                    // MASTER SYNC: Consolidated/flushed bets from Firestore ground truth to RTDB
                    try {
                        const statePath = db.collection('settings').doc('mini_games').collection('drakkar_race').doc('current');
                        const betsSnap = await statePath.collection('bets').get();
                        const shipIds = (newState.ships || []).map((s: any) => s.id);
                        const flushedPools: Record<string, number> = {};
                        shipIds.forEach((id: string) => { flushedPools[id] = 0; });

                        if (!betsSnap.empty) {
                            betsSnap.docs.forEach((doc) => {
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
    bets.docs.forEach(doc => batch.delete(doc.ref));
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
                await db.runTransaction(async (t) => {
                    const userRef = db.collection('users').doc(bet.uid);
                    t.update(userRef, {
                        points: admin.firestore.FieldValue.increment(winAmount)
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
            prizes: [
                { id: 'sm1', name: '25 Valcoins', type: 'valcoins', amount: 25, weight: 35, rarity: 'common', icon: 'common_horn.png' },
                { id: 'sm2', name: '50 Valcoins', type: 'valcoins', amount: 50, weight: 25, rarity: 'common', icon: 'common_shield.png' },
                { id: 'sm3', name: '100 Valcoins', type: 'valcoins', amount: 100, weight: 15, rarity: 'rare', icon: 'rare_axe.png' },
                { id: 'sm4', name: '250 Valcoins', type: 'valcoins', amount: 250, weight: 10, rarity: 'epic', icon: 'epic_amber.png' },
                { id: 'sm5', name: '500 Valcoins', type: 'valcoins', amount: 500, weight: 5, rarity: 'legendary', icon: 'legendary_hammer.png' },
                { id: 'sm6', name: '0.5 AURY', type: 'aury', amount: 0.5, weight: 5, rarity: 'epic', icon: 'epic_helmet.png' },
                { id: 'sm7', name: '1 AURY', type: 'aury', amount: 1, weight: 3, rarity: 'legendary', icon: 'legendary_hammer.png' },
                { id: 'sm8', name: '1 USDC', type: 'usdc', amount: 1, weight: 2, rarity: 'legendary', icon: 'legendary_ship.png' },
            ]
        },
        treasureChest: {
            enabled: true,
            costPerPlay: 30,
            noWinWeight: 20,
            prizes: [
                { id: 'tc1', name: '15 Valcoins', type: 'valcoins', amount: 15, weight: 35, rarity: 'common', icon: 'common_horn.png' },
                { id: 'tc2', name: '30 Valcoins', type: 'valcoins', amount: 30, weight: 25, rarity: 'common', icon: 'common_shield.png' },
                { id: 'tc3', name: '75 Valcoins', type: 'valcoins', amount: 75, weight: 15, rarity: 'rare', icon: 'rare_axe.png' },
                { id: 'tc4', name: '150 Valcoins', type: 'valcoins', amount: 150, weight: 10, rarity: 'epic', icon: 'epic_helmet.png' },
                { id: 'tc5', name: '300 Valcoins', type: 'valcoins', amount: 300, weight: 5, rarity: 'legendary', icon: 'legendary_ship.png' },
                { id: 'tc6', name: '0.25 AURY', type: 'aury', amount: 0.25, weight: 5, rarity: 'epic', icon: 'epic_amber.png' },
                { id: 'tc7', name: '0.5 AURY', type: 'aury', amount: 0.5, weight: 3, rarity: 'legendary', icon: 'legendary_hammer.png' },
                { id: 'tc8', name: '0.5 USDC', type: 'usdc', amount: 0.5, weight: 2, rarity: 'legendary', icon: 'legendary_ship.png' },
            ]
        },
        drakkarRace: {
            enabled: true,
            minBet: 1,
            maxBetPerUser: 1000,
            description: 'Bet on legendary ships in a real-time parimutuel race!',
            multiplier: 'parimutuel'
        }
    };
}
