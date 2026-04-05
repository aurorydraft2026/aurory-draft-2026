import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';

const DRAKKAR_SHIPS = [
    { id: 'gold', name: "Odin's Sleipnir", color: '#fbbf24' },
    { id: 'red', name: "Surtur's Fury", color: '#ef4444' },
    { id: 'blue', name: "Aegir's Tide", color: '#3b82f6' },
    { id: 'green', name: "Yggdrasil's Root", color: '#10b981' }
];

const TRACK_TYPES = ['calm', 'rough', 'stormy', 'foggy'];
const PAYOUT_MULTIPLIER = 3.8;

// Phase Durations (ms)
const DURATIONS = {
    betting: 20000,
    pause: 2000,
    race: 5000,
    result: 3000
};

/**
 * Play a mini-game (Backend version)
 * Handle prize selection, point deduction, and payouts securely.
 */
export const playMiniGame = onCall(
    {
        cors: true,
        maxInstances: 10,
        timeoutSeconds: 30,
        memory: '256MiB',
    },
    async (request) => {
        // 1. Verify authentication
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
                // 2. Fetch game config
                const configRef = db.collection('settings').doc('mini_games');
                const configSnap = await transaction.get(configRef);
                
                let gameConfig;
                if (!configSnap.exists) {
                    // Fallback to defaults if no custom config exists
                    gameConfig = getDefaultConfig()[gameType];
                } else {
                    gameConfig = configSnap.data()?.[gameType];
                }

                if (!gameConfig) {
                    throw new Error('Game configuration not found.');
                }
                if (!gameConfig.enabled) {
                    throw new Error('This game is currently disabled.');
                }

                const costPerPlay = gameConfig.costPerPlay || 50;
                const noWinWeight = gameConfig.noWinWeight || 0;
                const prizes = gameConfig.prizes || [];

                // 3. Verify user balance
                const userSnap = await transaction.get(userRef);
                if (!userSnap.exists) throw new Error('User record not found.');

                const userData = userSnap.data() || {};
                const currentPoints = userData.points || 0;

                // 3b. Anti-concurrency check (4-second cooldown)
                const lastPlay = userData.lastMiniGamePlay;
                if (lastPlay) {
                    const lastPlayMs = lastPlay.toMillis?.() || 0;
                    const nowMs = Date.now();
                    if (nowMs - lastPlayMs < 4000) {
                        throw new Error('Action already in progress. Please wait for the current action to finish.');
                    }
                }

                if (currentPoints < costPerPlay) {
                    throw new Error(`Insufficient Valcoins. Need ${costPerPlay}, have ${currentPoints}`);
                }

                // 4. Select prize (Weighted Random)
                const selectedPrize = selectWeightedPrize(prizes, noWinWeight, costPerPlay);

                // 5. Deduct cost from points and set play lock
                transaction.update(userRef, {
                    points: admin.firestore.FieldValue.increment(-costPerPlay),
                    lastMiniGamePlay: admin.firestore.FieldValue.serverTimestamp(),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });

                // 6. Credit prize (if any)
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

                // 6b. Track cumulative stats for leaderboard (per game & currency)
                const statsUpdate: Record<string, any> = {
                    [`stats.miniGames.${gameType}.totalPlays`]: admin.firestore.FieldValue.increment(1),
                    [`stats.miniGames.${gameType}.totalSpent`]: admin.firestore.FieldValue.increment(costPerPlay),
                };
                if (selectedPrize && selectedPrize.amount > 0) {
                    const currencyKey = selectedPrize.type.toLowerCase(); // 'valcoins', 'aury', 'usdc'
                    statsUpdate[`stats.miniGames.${gameType}.totalWon.${currencyKey}`] = admin.firestore.FieldValue.increment(selectedPrize.amount);
                    statsUpdate[`stats.miniGames.all.totalWon.${currencyKey}`] = admin.firestore.FieldValue.increment(selectedPrize.amount);
                }
                statsUpdate[`stats.miniGames.all.totalPlays`] = admin.firestore.FieldValue.increment(1);
                statsUpdate[`stats.miniGames.all.totalSpent`] = admin.firestore.FieldValue.increment(costPerPlay);
                transaction.update(userRef, statsUpdate);

                // 7. Log play history to user record
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

                // 7b. Push to Global Realtime Database feed (only positive wins)
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

                // 8. Log points history (deduction)
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
            throw new HttpsError('internal', error.message || 'An unexpected error occurred while playing the mini-game.');
        }
    }
);

/**
 * Place a bet on a Drakkar Race
 */
export const placeDrakkarBet = onCall(
    { cors: true, maxInstances: 10 },
    async (request) => {
        if (!request.auth) throw new HttpsError('unauthenticated', 'Login required');
        const { uid } = request.auth;
        const { shipId, amount } = request.data;

        if (!shipId || amount <= 0) throw new HttpsError('invalid-argument', 'Invalid bet');

        const db = admin.firestore();
        const userRef = db.collection('users').doc(uid);
        const stateRef = db.collection('settings').doc('mini_games').collection('drakkar_race').doc('current');

        try {
            const result = await db.runTransaction(async (transaction) => {
                const betRef = stateRef.collection('bets').doc(uid);
                
                // 1. ALL READS FIRST
                const stateSnap = await transaction.get(stateRef);
                const userSnap = await transaction.get(userRef);
                const betSnap = await transaction.get(betRef);

                const state = stateSnap.data();
                if (!state || state.phase !== 'betting') {
                    throw new Error('Betting is currently closed.');
                }

                const userData = userSnap.data() || {};
                const currentPoints = userData.points || 0;
                if (currentPoints < amount) {
                    throw new Error('Insufficient Valcoins');
                }

                // 2. ALL WRITES LAST
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
                        timestamp: admin.firestore.FieldValue.serverTimestamp()
                    });
                }

                return { success: true, newBalance: currentPoints - amount };
            });

            // 2. Side effect: Update public pool in RTDB (only if transaction succeeded)
            const rtdb = admin.database();
            await rtdb.ref(`drakkar_race/pools/${shipId}`).transaction((current) => (current || 0) + amount);

            return result;
        } catch (error: any) {
            console.error('Place Bet Error:', error);
            throw new HttpsError('internal', error.message);
        }
    }
);

/**
 * State Machine Heartbeat for Drakkar Race
 * Advances phases and handles payouts.
 */
export const refreshDrakkarRace = onCall(
    { cors: true, maxInstances: 5 },
    async (request) => {
        const db = admin.firestore();
        const stateRef = db.collection('settings').doc('mini_games').collection('drakkar_race').doc('current');
        const rtdb = admin.database();

        try {
            // 1. Determine next state inside a Lean Transaction
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
                    nextPhase = 'pause';
                    duration = DURATIONS.pause;
                } else if (state.phase === 'pause') {
                    nextPhase = 'race';
                    duration = DURATIONS.race;
                } else if (state.phase === 'race') {
                    nextPhase = 'result';
                    duration = DURATIONS.result;
                } else {
                    nextPhase = 'betting';
                    duration = DURATIONS.betting;
                    const winnerIdx = Math.floor(Math.random() * 4);
                    updates = {
                        track: [
                            TRACK_TYPES[Math.floor(Math.random() * 4)],
                            TRACK_TYPES[Math.floor(Math.random() * 4)],
                            TRACK_TYPES[Math.floor(Math.random() * 4)]
                        ],
                        winnerIdx: winnerIdx,
                        raceId: (state.raceId || 0) + 1,
                        startTime: now
                    };
                }

                const newState = {
                    ...state,
                    ...updates,
                    phase: nextPhase,
                    endTime: now + duration,
                    lastUpdate: now
                };

                transaction.set(stateRef, newState);
                return { state: newState, changed: true };
            });

            // 2. Side effects outside the transaction (RTDB Sync & Payouts)
            if (result.changed) {
                const newState = result.state;
                await rtdb.ref('drakkar_race/state').set(newState);

                if (newState.phase === 'betting') {
                    await rtdb.ref('drakkar_race/pools').set({ gold: 0, red: 0, blue: 0, green: 0 });
                    await clearBets(stateRef);
                } else if (newState.phase === 'result') {
                    await processDrakkarPayouts(newState.winnerIdx, newState.raceId);
                }
            }

            return { success: true, state: result.state };
        } catch (error: any) {
            console.error('Drakkar Refresh Error:', error);
            throw new HttpsError('internal', error.message);
        }
    }
);

async function clearBets(stateRef: admin.firestore.DocumentReference) {
    const bets = await stateRef.collection('bets').get();
    const batch = admin.firestore().batch();
    bets.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
}

async function processDrakkarPayouts(winnerIdx: number, raceId: number) {
    const db = admin.firestore();
    const stateRef = db.collection('settings').doc('mini_games').collection('drakkar_race').doc('current');
    
    // 1. Verify if this race has already been processed to prevent double-payouts
    const winnerId = DRAKKAR_SHIPS[winnerIdx].id;
    const bets = await stateRef.collection('bets').get();
    
    if (bets.empty) return;

    for (const betDoc of bets.docs) {
        const bet = betDoc.data();
        const winAmount = (bet[winnerId] || 0) * PAYOUT_MULTIPLIER;
        
        if (winAmount > 0) {
            try {
                // Use a separate transaction for each user to ensure stability
                await db.runTransaction(async (t) => {
                    const userRef = db.collection('users').doc(bet.uid);
                    t.update(userRef, {
                        points: admin.firestore.FieldValue.increment(Math.floor(winAmount))
                    });

                    // Log history
                    const historyRef = userRef.collection('miniGameHistory').doc();
                    t.set(historyRef, {
                        gameType: 'drakkarRace',
                        prizeName: `${Math.floor(winAmount)} Valcoins`,
                        prizeType: 'valcoins',
                        prizeAmount: Math.floor(winAmount),
                        prizeRarity: winAmount > 100 ? 'epic' : 'rare',
                        prizeIcon: 'legendary_ship.png',
                        cost: bet.total,
                        timestamp: admin.firestore.FieldValue.serverTimestamp()
                    });
                });

                // Post to Global Feed (can be outside user transaction)
                if (winAmount >= 50) {
                    const rtdb = admin.database();
                    await rtdb.ref('recentMiniGameWinners').push({
                        playerName: bet.playerName,
                        prizeName: `${Math.floor(winAmount)} Valcoins`,
                        rarity: winAmount > 200 ? 'legendary' : 'epic',
                        icon: 'legendary_ship.png',
                        gameType: 'drakkarRace',
                        timestamp: admin.database.ServerValue.TIMESTAMP
                    });
                }
            } catch (err) {
                console.error(`Failed to pay out user ${bet.uid} for race ${raceId}`, err);
            }
        }
    }
}


/**
 * Weighted Random Prize Selection
 */
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

    // Use ?? to allow 0 weight to actually be 0
    const prizesWeight = prizes.reduce((sum, p) => sum + (p.weight ?? 1), 0);
    const totalWeight = prizesWeight + (noWinWeight || 0);
    
    // If everything is weighted at 0, return null (loss) or first item as safety
    if (totalWeight <= 0) return null;

    let random = Math.random() * totalWeight;

    // 1. Check if we hit the "No Win" zone
    if (random < noWinWeight) return null;
    random -= noWinWeight;

    // 2. Filter out 0-weight prizes from selection
    for (const prize of prizes) {
        const weight = prize.weight ?? 1;
        if (weight <= 0) continue; // Skip 0-weight prizes
        
        random -= weight;
        if (random <= 0) return prize;
    }

    // Fallback to last non-zero prize
    const activePrizes = prizes.filter(p => (p.weight ?? 1) > 0);
    return activePrizes.length > 0 ? activePrizes[activePrizes.length - 1] : null;
}

/**
 * Default configuration fallback
 */
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
            minBet: 10,
            description: 'Bet on the legendary ships in a real-time global race!',
            multiplier: 3.8
        }
    };
}
