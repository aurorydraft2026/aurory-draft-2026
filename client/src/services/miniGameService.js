import { db, database } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import { ref, onValue, off } from 'firebase/database';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { createNotification } from './notifications';

export const DRAKKAR_SHIPS = [
  { id: 'sleipnir', name: "Sleipnir Swift", color: '#fbbf24', gradient: 'linear-gradient(135deg, #fbbf24 0%, #d97706 100%)' },
  { id: 'jormungandr', name: "Jormungandr Sea-Serpent", color: '#10b981', gradient: 'linear-gradient(135deg, #10b981 0%, #065f46 100%)' },
  { id: 'ironclad', name: "Ironbound Hulk", color: '#94a3b8', gradient: 'linear-gradient(135deg, #94a3b8 0%, #475569 100%)' },
  { id: 'shadow', name: "Hugin's Shadow", color: '#a855f7', gradient: 'linear-gradient(135deg, #a855f7 0%, #6b21a8 100%)' },
  { id: 'prime', name: "Drakkar Prime", color: '#3b82f6', gradient: 'linear-gradient(135deg, #3b82f6 0%, #1e40af 100%)' },
  { id: 'valkyrie', name: "Valkyrie Chariot", color: '#f472b6', gradient: 'linear-gradient(135deg, #f472b6 0%, #be185d 100%)' },
  { id: 'raider', name: "Norse Raider", color: '#ef4444', gradient: 'linear-gradient(135deg, #ef4444 0%, #991b1b 100%)' }
];

export const TRACK_ENVIRONMENTS = {
  calm: { name: 'Calm Waters', icon: '🌊', color: '#60a5fa' },
  stormy: { name: 'Stormy Sea', icon: '⚡', color: '#1e40af' },
  foggy: { name: 'Ethereal Fog', icon: '🌫️', color: '#94a3b8' },
  tailwind: { name: 'Strong Tailwind', icon: '💨', color: '#34d399' },
  maelstrom: { name: 'The Maelstrom', icon: '🌀', color: '#4c1d95' },
  ice: { name: 'Ice Floes', icon: '❄️', color: '#bae6fd' },
  blood: { name: 'Blood Red Tide', icon: '🩸', color: '#991b1b' }
};

export const EFFICIENCY_MATRIX = {
  sleipnir: { calm: 1.2, stormy: 0.85, foggy: 0.95, tailwind: 1.25, maelstrom: 0.8, ice: 0.9, blood: 1.05 },
  jormungandr: { calm: 0.95, stormy: 1.3, foggy: 1.1, tailwind: 0.95, maelstrom: 1.15, ice: 1.05, blood: 1.1 },
  ironclad: { calm: 0.9, stormy: 1.1, foggy: 1.0, tailwind: 0.9, maelstrom: 1.2, ice: 1.2, blood: 1.0 },
  shadow: { calm: 1.0, stormy: 0.9, foggy: 1.35, tailwind: 1.05, maelstrom: 0.9, ice: 0.95, blood: 1.15 },
  prime: { calm: 1.1, stormy: 1.05, foggy: 1.05, tailwind: 1.15, maelstrom: 1.0, ice: 1.05, blood: 1.0 },
  valkyrie: { calm: 1.05, stormy: 0.8, foggy: 0.9, tailwind: 1.3, maelstrom: 0.95, ice: 0.85, blood: 1.25 },
  raider: { calm: 1.05, stormy: 1.1, foggy: 1.05, tailwind: 1.05, maelstrom: 0.95, ice: 1.1, blood: 0.95 }
};

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
      description: 'Bet on mythical ships in a real-time global race!',
      multiplier: 3.8
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
 * Get the current state of the Drakkar Race from RTDB
 * @param {Function} callback - Callback for state updates
 * @returns {Function} Unsubscribe function
 */
export function subscribeDrakkarRaceState(callback) {
  const stateRef = ref(database, 'drakkar_race/state');
  onValue(stateRef, (snapshot) => {
    callback(snapshot.exists() ? snapshot.val() : null);
  });

  return () => off(stateRef);
}

/**
 * Subscribe to the live betting pools for the current race
 * @param {Function} callback 
 */
export function subscribeDrakkarPools(callback) {
  const poolsRef = ref(database, 'drakkar_race/pools');
  onValue(poolsRef, (snapshot) => {
    if (snapshot.exists()) {
      callback(snapshot.val());
    }
  });

  return () => off(poolsRef);
}

/**
 * Subscribe to the last 20 race results
 * @param {Function} callback 
 */
export function subscribeDrakkarHistory(callback) {
  const historyRef = ref(database, 'drakkar_race/history');
  onValue(historyRef, (snapshot) => {
    if (snapshot.exists()) {
      const data = snapshot.val();
      // Sort by timestamp descending
      const list = Object.values(data).sort((a, b) => b.timestamp - a.timestamp);
      callback(list);
    } else {
      callback([]);
    }
  });

  return () => off(historyRef);
}

/**
 * Pulse the server to advance the race phase if needed
 */
export async function refreshDrakkarRace() {
  try {
    const functions = getFunctions();
    const refreshFn = httpsCallable(functions, 'refreshDrakkarRace');
    await refreshFn();
  } catch (err) {
    console.error('Error refreshing Drakkar Race:', err);
  }
}

/**
 * Place a bet on a ship
 */
export async function placeDrakkarBet(shipId, amount) {
  try {
    const functions = getFunctions();
    const betFn = httpsCallable(functions, 'placeDrakkarBet');
    const result = await betFn({ shipId, amount });
    return result.data;
  } catch (err) {
    console.error('Error placing Drakkar bet:', err);
    return { success: false, error: err.message };
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
    case 'legendary': return ['legendary_ship.png', 'legendary_hammer.png'];
    case 'epic': return ['epic_helmet.png', 'epic_amber.png'];
    case 'rare': return ['rare_axe.png'];
    case 'common':
    default: return ['common_horn.png', 'common_shield.png'];
  }
}
