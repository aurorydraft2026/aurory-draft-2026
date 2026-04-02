import { db } from '../firebase';
import {
  doc,
  collection,
  getDoc,
  serverTimestamp,
  increment,
  runTransaction
} from 'firebase/firestore';
import { createNotification } from './notifications';

/**
 * Fetch mini-game configuration from Firestore
 * @returns {Promise<Object>} The mini-game settings
 */
export async function getMiniGameConfig() {
  try {
    const configRef = doc(db, 'settings', 'mini_games');
    const configSnap = await getDoc(configRef);

    if (!configSnap.exists()) {
      // Return defaults if no config exists yet
      return getDefaultConfig();
    }

    return configSnap.data();
  } catch (error) {
    console.error('Error fetching mini-game config:', error);
    return getDefaultConfig();
  }
}

/**
 * Default configuration used when no admin config exists
 */
function getDefaultConfig() {
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

/**
 * Select a prize using weighted random selection
 * Supports "No Win" results if noWinWeight is > 0
 * @param {Array} prizes - Array of prize objects with `weight` property
 * @param {number} noWinWeight - Weight for "No Win" outcome
 * @param {number} costPerPlay - The cost to play (for guaranteed minimum fallback)
 * @returns {Object|null} The selected prize or null if a loss occurred
 */
function selectWeightedPrize(prizes, noWinWeight = 0, costPerPlay = 50) {
  if (!prizes || prizes.length === 0) {
    // If no prizes configured at ALL, fallback to a consolation
    return {
      id: 'fallback',
      name: `${Math.floor(costPerPlay / 2)} Valcoins`,
      type: 'valcoins',
      amount: Math.floor(costPerPlay / 2),
      rarity: 'common',
      icon: '🪙'
    };
  }

  const prizesWeight = prizes.reduce((sum, p) => sum + (p.weight || 1), 0);
  const totalWeight = prizesWeight + (noWinWeight || 0);
  
  let random = Math.random() * totalWeight;

  // 1. Check if we hit the "No Win" zone (House Edge)
  if (random < noWinWeight) {
    return null;
  }

  // 2. Adjust random to search prizes
  random -= noWinWeight;

  for (const prize of prizes) {
    random -= (prize.weight || 1);
    if (random <= 0) return prize;
  }

  // Fallback to last prize
  return prizes[prizes.length - 1];
}

/**
 * Play a mini-game
 * 
 * Uses a Firestore transaction to atomically:
 * 1. Verify the user has enough Valcoins
 * 2. Deduct the play cost
 * 3. Select a prize (weighted random)
 * 4. Credit the prize to the user's balance
 * 5. Log the play in history
 * 
 * @param {string} gameType - 'slotMachine' or 'treasureChest'
 * @param {Object} user - The authenticated user object
 * @returns {Promise<Object>} Result with prize details
 */
export async function playMiniGame(user, gameType) {
  if (!user || !user.uid) {
    return { success: false, error: 'Please log in to play' };
  }

  try {
    // 1. Fetch game config
    const config = await getMiniGameConfig();
    const gameConfig = config[gameType];

    if (!gameConfig) {
      return { success: false, error: 'Game not found' };
    }
    if (!gameConfig.enabled) {
      return { success: false, error: 'This game is currently disabled' };
    }

    const costPerPlay = gameConfig.costPerPlay || 50;
    const noWinWeight = gameConfig.noWinWeight || 0;
    const prizes = gameConfig.prizes || [];

    // 2. Select prize BEFORE the transaction (pure logic, no Firestore reads)
    const selectedPrize = selectWeightedPrize(prizes, noWinWeight, costPerPlay);

    // 3. Execute atomic transaction
    const userRef = doc(db, 'users', user.uid);
    const walletRef = doc(db, 'wallets', user.uid);

    const result = await runTransaction(db, async (transaction) => {
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists()) throw new Error('User not found');

      const userData = userSnap.data();
      const currentPoints = userData.points || 0;

      // Verify balance
      if (currentPoints < costPerPlay) {
        throw new Error(`Insufficient Valcoins. Need ${costPerPlay}, have ${currentPoints}`);
      }

      // Deduct cost from points
      transaction.update(userRef, {
        points: increment(-costPerPlay),
        updatedAt: serverTimestamp()
      });

      // Credit prize (if any)
      if (selectedPrize) {
        if (selectedPrize.type.toLowerCase() === 'valcoins' && selectedPrize.amount > 0) {
          // Net effect: -cost + prize
          // We already deducted cost above, now add prize
          transaction.update(userRef, {
            points: increment(selectedPrize.amount)
          });
        } else if (selectedPrize.type.toLowerCase() === 'aury' && selectedPrize.amount > 0) {
          const amountSmallest = Math.floor(selectedPrize.amount * 1e9);
          transaction.set(walletRef, {
            balance: increment(amountSmallest),
            updatedAt: serverTimestamp()
          }, { merge: true });
        } else if (selectedPrize.type.toLowerCase() === 'usdc' && selectedPrize.amount > 0) {
          const amountSmallest = Math.floor(selectedPrize.amount * 1e6);
          transaction.set(walletRef, {
            usdcBalance: increment(amountSmallest),
            updatedAt: serverTimestamp()
          }, { merge: true });
        }
      }

      // Log play history
      const historyRef = doc(collection(db, 'users', user.uid, 'miniGameHistory'));
      transaction.set(historyRef, {
        gameType,
        prizeName: selectedPrize ? selectedPrize.name : 'Better Luck Next Time',
        prizeType: selectedPrize ? selectedPrize.type : 'none',
        prizeAmount: selectedPrize ? selectedPrize.amount : 0,
        prizeRarity: selectedPrize ? selectedPrize.rarity : 'common',
        prizeIcon: selectedPrize ? selectedPrize.icon : '❌',
        cost: costPerPlay,
        timestamp: serverTimestamp()
      });

      // Log points history (deduction)
      const pointsHistoryRef = doc(collection(db, 'users', user.uid, 'pointsHistory'));
      transaction.set(pointsHistoryRef, {
        amount: -costPerPlay,
        type: 'mini_game',
        description: `Played ${gameType === 'slotMachine' ? 'Slot Machine' : 'Treasure Chest'}`,
        timestamp: serverTimestamp()
      });

      return {
        success: true,
        prize: selectedPrize,
        cost: costPerPlay,
        newBalance: currentPoints - costPerPlay + (selectedPrize && selectedPrize.type.toLowerCase() === 'valcoins' ? selectedPrize.amount : 0)
      };
    });

    // Send notification for notable wins (rare+)
    if (result.success && selectedPrize && selectedPrize.rarity !== 'common') {
      await createNotification(user.uid, {
        title: `🎉 ${selectedPrize.rarity === 'legendary' ? 'LEGENDARY' : selectedPrize.rarity === 'epic' ? 'EPIC' : 'RARE'} WIN!`,
        message: `You won ${selectedPrize.name} from the ${gameType === 'slotMachine' ? 'Slot Machine' : 'Treasure Chest'}!`,
        type: 'mini_game'
      });
    }

    return result;
  } catch (error) {
    console.error('Error playing mini-game:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get rarity color for a prize
 * @param {string} rarity - 'common', 'rare', 'epic', 'legendary'
 * @returns {string} CSS color value
 */
export function getRarityColor(rarity) {
  switch (rarity) {
    case 'legendary': return '#ff9800';
    case 'epic': return '#9c27b0';
    case 'rare': return '#2196f3';
    case 'common':
    default: return '#78909c';
  }
}

/**
 * Get rarity label for display
 * @param {string} rarity
 * @returns {string}
 */
export function getRarityLabel(rarity) {
  switch (rarity) {
    case 'legendary': return '★★★★';
    case 'epic': return '★★★';
    case 'rare': return '★★';
    case 'common':
    default: return '★';
  }
}

/**
 * Get thematic recommended icons for a rarity tier
 * @param {string} rarity 
 * @returns {Array} List of emojis
 */
export function getRecommendedIcons(rarity) {
  switch (rarity) {
    case 'legendary': return ['🔥', '🎰', '🏆', '💎', '👑', '⚡', '🤑'];
    case 'epic': return ['👑', '🌟', '⚡', '🌌', '🌠', '🚀', '🔮'];
    case 'rare': return ['💎', '🍀', '💰', '✨', '🎁', '🔑', '🕯️'];
    case 'common':
    default: return ['🍒', '🔔', '🍋', '🪙', '💰', '🍕', '🎲'];
  }
}
