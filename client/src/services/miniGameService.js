import { db } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
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
 * Play a mini-game (Backend-revealed)
 * 
 * Calls a Firebase Cloud Function to securely handle price/payout.
 * 
 * @param {Object} user - The authenticated user object
 * @param {string} gameType - 'slotMachine' or 'treasureChest'
 * @returns {Promise<Object>} Result with prize details
 */
export async function playMiniGame(user, gameType) {
  if (!user || !user.uid) {
    return { success: false, error: 'Please log in to play' };
  }

  try {
    const functions = getFunctions();
    const playMiniGameFn = httpsCallable(functions, 'playMiniGame');
    
    const result = await playMiniGameFn({ gameType });
    const { success, prize, cost, newBalance, error } = result.data;

    if (!success) {
      return { success: false, error: error || 'Failed to play mini-game' };
    }

    // Send notification for notable wins (rare+)
    if (prize && prize.rarity !== 'common') {
      await createNotification(user.uid, {
        title: `🎉 ${prize.rarity.toUpperCase()} WIN!`,
        message: `You won ${prize.name} from the ${gameType === 'slotMachine' ? 'Slot Machine' : 'Treasure Chest'}!`,
        type: 'mini_game'
      });
    }

    return { success: true, prize, cost, newBalance };
  } catch (error) {
    console.error('Error playing mini-game:', error);
    // Handle specific Firebase HttpsErrors
    const errorMessage = error.details?.message || error.message || 'An error occurred while playing.';
    return { success: false, error: errorMessage };
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
