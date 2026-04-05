import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';

const DRAKKAR_SHIPS = [
    { id: 'sleipnir', name: "Sleipnir Swift", color: '#fbbf24' },
    { id: 'jormungandr', name: "Jormungandr Sea-Serpent", color: '#10b981' },
    { id: 'ironclad', name: "Ironbound Hulk", color: '#94a3b8' },
    { id: 'shadow', name: "Hugin's Shadow", color: '#a855f7' },
    { id: 'prime', name: "Drakkar Prime", color: '#3b82f6' },
    { id: 'valkyrie', name: "Valkyrie Chariot", color: '#f472b6' },
    { id: 'raider', name: "Norse Raider", color: '#ef4444' }
];

const TRACK_TYPES = ['calm', 'stormy', 'foggy', 'tailwind', 'maelstrom', 'ice', 'blood'];

// Speed Efficiency Matrix (Modifier based on Weather)
const EFFICIENCY_MATRIX: any = {
  sleipnir: { calm: 1.2, stormy: 0.85, foggy: 0.95, tailwind: 1.25, maelstrom: 0.8, ice: 0.9, blood: 1.05 },
  jormungandr: { calm: 0.95, stormy: 1.3, foggy: 1.1, tailwind: 0.95, maelstrom: 1.15, ice: 1.05, blood: 1.1 },
  ironclad: { calm: 0.9, stormy: 1.1, foggy: 1.0, tailwind: 0.9, maelstrom: 1.2, ice: 1.2, blood: 1.0 },
  shadow: { calm: 1.0, stormy: 0.9, foggy: 1.35, tailwind: 1.05, maelstrom: 0.9, ice: 0.95, blood: 1.15 },
  prime: { calm: 1.1, stormy: 1.05, foggy: 1.05, tailwind: 1.15, maelstrom: 1.0, ice: 1.05, blood: 1.0 },
  valkyrie: { calm: 1.05, stormy: 0.8, foggy: 0.9, tailwind: 1.3, maelstrom: 0.95, ice: 0.85, blood: 1.25 },
  raider: { calm: 1.05, stormy: 1.1, foggy: 1.05, tailwind: 1.05, maelstrom: 0.95, ice: 1.1, blood: 0.95 }
};

const HOUSE_RAKE = 0.1; // 10%
const MIN_PAYOUT = 1.1; // Ensure 10% profit even on favorites

// Phase Durations (ms)
const DURATIONS = {
    betting: 20000,
    pause: 2000,
    race: 7000, // Slightly longer for more dramatic comebacks
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
    { cors: true, maxInstances: 20 },
    async (request) => {
        if (!request.auth) throw new HttpsError('unauthenticated', 'Login required');
        const { uid } = request.auth;
        const { shipId, amount } = request.data;

        if (!shipId || amount <= 0) throw new HttpsError('invalid-argument', 'Invalid bet');

        const db = admin.firestore();
        const userRef = db.collection('users').doc(uid);
        const stateRef = db.collection('settings').doc('mini_games').collection('drakkar_race').doc('current');

        try {
            // 1. FAST CHECK (READS OUTSIDE TRANSACTION)
            const stateSnap = await stateRef.get();
            const state = stateSnap.data();
            
            if (!state) throw new Error('Race state not found.');

            // ─── INFINITE GRACE ARCHITECTURE ───
            const now = Date.now();
            const isBetting = state.phase === 'betting';
            // Allow a 1.5s grace period during the 'pause' (preparation) phase for late network packets
            const isGracePeriod = state.phase === 'pause' && (now - state.startTime < 1500);
            
            if (!isBetting && !isGracePeriod) throw new Error('Betting is currently closed.');
            // ───────────────────────────────
            if (!state.selectedShips?.includes(shipId)) {
                throw new Error('Invalid ship for this race.');
            }

            // 2. USER-CENTRIC TRANSACTION (NO GLOBAL LOCK)
            // This allows 100 players to bet at once without colliding on the state document.
            const result = await db.runTransaction(async (transaction) => {
                // ALL READS FIRST
                const userSnap = await transaction.get(userRef);
                const betRef = stateRef.collection('bets').doc(uid);
                const betSnap = await transaction.get(betRef); // Move Read to top

                const userData = userSnap.data() || {};
                const currentPoints = userData.points || 0;

                if (currentPoints < amount) {
                    throw new Error('Insufficient Valcoins');
                }

                // ALL WRITES SECOND
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
                        playerAvatar: userData.photoURL || '',
                        raceId: state.raceId,
                        timestamp: admin.firestore.FieldValue.serverTimestamp()
                    });
                }

                return { success: true, newBalance: currentPoints - amount };
            });

            // 5. ATOMIC RTDB INCREMENT (VERY FAST FOR SPAMMING)
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
                    updates = { startTime: now };
                } else if (state.phase === 'pause') {
                    nextPhase = 'race';
                    duration = DURATIONS.race;
                    
                    // 1. CALCULATE WINNER BASED ON STRATEGIC SIMULATION
                    const ships = state.selectedShips || [];
                    const track = state.track || [];
                    
                    // Simulate each ship's final time
                    const finalTimes = ships.map((shipId: string) => {
                        let totalSpeed = 0;
                        track.forEach((weather: string) => {
                            totalSpeed += (EFFICIENCY_MATRIX[shipId]?.[weather] || 1.0);
                        });
                        // Add a small random seed to avoid ties
                        return totalSpeed + (Math.random() * 0.05);
                    });
                    
                    // Highest total speed wins
                    const winnerIdxInSelected = finalTimes.indexOf(Math.max(...finalTimes));
                    
                    updates = {
                        stateWinnerIdx: winnerIdxInSelected // Index within the 3 selected ships
                    };
                } else if (state.phase === 'race') {
                    nextPhase = 'result';
                    duration = DURATIONS.result;
                } else {
                    // Start of New Cycle: Select 3 Ships and 3 Weathers
                    nextPhase = 'betting';
                    duration = DURATIONS.betting;
                    
                    const selectedShips = [...DRAKKAR_SHIPS]
                        .sort(() => Math.random() - 0.5)
                        .slice(0, 3)
                        .map(s => s.id);
                        
                    const track = [
                        TRACK_TYPES[Math.floor(Math.random() * 7)],
                        TRACK_TYPES[Math.floor(Math.random() * 7)],
                        TRACK_TYPES[Math.floor(Math.random() * 7)]
                    ];

                    updates = {
                        raceId: (state.raceId || 0) + 1,
                        startTime: now,
                        selectedShips: selectedShips,
                        track: track,
                        stateWinnerIdx: null
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
                    // Initialize pools for the 3 selected ships only
                    const initialPools: any = {};
                    (newState.selectedShips || []).forEach((id: string) => initialPools[id] = 0);
                    await rtdb.ref('drakkar_race/pools').set(initialPools);
                    await clearBets(stateRef);
                } else if (newState.phase === 'race') {
                    // ─── FINALIZATION (POST-GRACE) ───
                    // Only finalize pools once we transition To the race phase
                    // This allows the entire 'pause' phase to act as a latent grace window
                    await finalizePools(stateRef);
                } else if (newState.phase === 'result') {
                    await processDrakkarPayouts(newState.stateWinnerIdx, newState.raceId);
                }
            }

            return { success: true, state: result.state };
        } catch (error: any) {
            console.error('Drakkar Refresh Error:', error);
            throw new HttpsError('internal', error.message);
        }
    }
);

async function finalizePools(stateRef: admin.firestore.DocumentReference) {
    const rtdb = admin.database();
    const poolsSnap = await rtdb.ref('drakkar_race/pools').get();
    const finalPools = poolsSnap.val() || {};
    
    // Save the finalized pools back to Firestore state for historical consistency
    // This happens during the 5s preparation phase
    await stateRef.update({
        finalPools,
        finalizationTime: Date.now()
    });
}

async function clearBets(stateRef: admin.firestore.DocumentReference) {
    const bets = await stateRef.collection('bets').get();
    const batch = admin.firestore().batch();
    bets.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
}

async function processDrakkarPayouts(winnerIdxInSelected: number, raceId: number) {
    const db = admin.firestore();
    const stateRef = db.collection('settings').doc('mini_games').collection('drakkar_race').doc('current');
    
    // 1. Fetch current pools from RTDB to calculate total
    const rtdb = admin.database();
    const poolsSnap = await rtdb.ref('drakkar_race/pools').get();
    const pools = poolsSnap.val() || {};
    
    const stateSnap = await stateRef.get();
    const state = stateSnap.data();
    if (!state || !state.selectedShips) return;
    
    const winningShipId = state.selectedShips[winnerIdxInSelected];
    const totalPool = Object.values(pools).reduce((a: any, b: any) => a + b, 0) as number;
    const winningPool = pools[winningShipId] || 0;
    
    if (totalPool === 0 || winningPool === 0) return;

    // Calculate Dynamic Multiplier with House Rake
    let multiplier = (totalPool * (1 - HOUSE_RAKE)) / winningPool;
    if (multiplier < MIN_PAYOUT) multiplier = MIN_PAYOUT;

    // Push to History (RTDB - keep last 20)
    const historyRef = rtdb.ref('drakkar_race/history').push();
    await historyRef.set({
        raceId,
        winnerId: winningShipId,
        totalPool,
        multiplier: parseFloat(multiplier.toFixed(2)),
        timestamp: admin.database.ServerValue.TIMESTAMP
    });

    // Cleanup history > 20
    const historySnap = await rtdb.ref('drakkar_race/history').orderByChild('timestamp').limitToLast(21).get();
    if (historySnap.numChildren() > 20) {
        const firstKey = Object.keys(historySnap.val())[0];
        await rtdb.ref(`drakkar_race/history/${firstKey}`).remove();
    }

    const bets = await stateRef.collection('bets').get();
    if (bets.empty) return;

    for (const betDoc of bets.docs) {
        const bet = betDoc.data();
        const personalWinningBet = bet[winningShipId] || 0;
        const winAmount = Math.floor(personalWinningBet * multiplier);
        
        if (winAmount > 0) {
            try {
                // Use a separate transaction for each user
                await db.runTransaction(async (t) => {
                    const userRef = db.collection('users').doc(bet.uid);
                    t.update(userRef, {
                        points: admin.firestore.FieldValue.increment(winAmount)
                    });

                    // Log history
                    const historyRef = userRef.collection('miniGameHistory').doc();
                    t.set(historyRef, {
                        gameType: 'drakkarRace',
                        prizeName: `${winAmount} Valcoins`,
                        prizeType: 'valcoins',
                        prizeAmount: winAmount,
                        prizeRarity: winAmount > 100 ? 'epic' : 'rare',
                        prizeIcon: 'legendary_hammer.png',
                        cost: bet.total,
                        timestamp: admin.firestore.FieldValue.serverTimestamp()
                    });

                    // Site Notification
                    const notificationRef = userRef.collection('notifications').doc();
                    t.set(notificationRef, {
                        title: 'Drakkar Race Win!',
                        message: `Congratulations! You won ${winAmount} Valcoins in the Drakkar Race.`,
                        type: 'win',
                        read: false,
                        createdAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                });

                // Post to Global Feed
                if (winAmount >= 50) {
                    await rtdb.ref('recentMiniGameWinners').push({
                        playerName: bet.playerName,
                        playerAvatar: bet.playerAvatar || '',
                        prizeName: `${winAmount} Valcoins`,
                        rarity: winAmount > 200 ? 'legendary' : 'epic',
                        icon: 'legendary_hammer.png',
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
