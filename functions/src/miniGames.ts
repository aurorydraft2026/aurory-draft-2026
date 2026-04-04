import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';

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
                { id: 'sm1', name: '25 Valcoins', type: 'valcoins', amount: 25, weight: 35, rarity: 'common', icon: '🍒' },
                { id: 'sm2', name: '50 Valcoins', type: 'valcoins', amount: 50, weight: 25, rarity: 'common', icon: '🔔' },
                { id: 'sm3', name: '100 Valcoins', type: 'valcoins', amount: 100, weight: 15, rarity: 'rare', icon: '💎' },
                { id: 'sm4', name: '250 Valcoins', type: 'valcoins', amount: 250, weight: 10, rarity: 'epic', icon: '👑' },
                { id: 'sm5', name: '500 Valcoins', type: 'valcoins', amount: 500, weight: 5, rarity: 'legendary', icon: '🎰' },
                { id: 'sm6', name: '0.5 AURY', type: 'aury', amount: 0.5, weight: 5, rarity: 'epic', icon: '🌟' },
                { id: 'sm7', name: '1 AURY', type: 'aury', amount: 1, weight: 3, rarity: 'legendary', icon: '🔥' },
                { id: 'sm8', name: '1 USDC', type: 'usdc', amount: 1, weight: 2, rarity: 'legendary', icon: '🏆' },
            ]
        },
        treasureChest: {
            enabled: true,
            costPerPlay: 30,
            noWinWeight: 20,
            prizes: [
                { id: 'tc1', name: '15 Valcoins', type: 'valcoins', amount: 15, weight: 35, rarity: 'common', icon: '🪙' },
                { id: 'tc2', name: '30 Valcoins', type: 'valcoins', amount: 30, weight: 25, rarity: 'common', icon: '💰' },
                { id: 'tc3', name: '75 Valcoins', type: 'valcoins', amount: 75, weight: 15, rarity: 'rare', icon: '💎' },
                { id: 'tc4', name: '150 Valcoins', type: 'valcoins', amount: 150, weight: 10, rarity: 'epic', icon: '👑' },
                { id: 'tc5', name: '300 Valcoins', type: 'valcoins', amount: 300, weight: 5, rarity: 'legendary', icon: '🏆' },
                { id: 'tc6', name: '0.25 AURY', type: 'aury', amount: 0.25, weight: 5, rarity: 'epic', icon: '🌟' },
                { id: 'tc7', name: '0.5 AURY', type: 'aury', amount: 0.5, weight: 3, rarity: 'legendary', icon: '🔥' },
                { id: 'tc8', name: '0.5 USDC', type: 'usdc', amount: 0.5, weight: 2, rarity: 'legendary', icon: '⚡' },
            ]
        }
    };
}
