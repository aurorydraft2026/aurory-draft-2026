import { db, database } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import { ref, onValue, off, query, orderByChild, limitToLast } from 'firebase/database';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { createNotification } from './notifications';

// ═══════════════════════════════════════════════════════
//  DRAKKAR RACE v2 — CONSTANTS
// ═══════════════════════════════════════════════════════

export const ALL_SHIPS = [
  { id: 'sleipnir', name: "Sleipnir Swift", color: '#fbbf24', gradient: 'linear-gradient(135deg, #fbbf24 0%, #d97706 100%)' },
  { id: 'jormungandr', name: "Jörmungandr", color: '#10b981', gradient: 'linear-gradient(135deg, #10b981 0%, #065f46 100%)' },
  { id: 'ironbound', name: "Ironbound Hulk", color: '#e2e8f0', gradient: 'linear-gradient(135deg, #e2e8f0 0%, #94a3b8 100%)' },
  { id: 'hugin', name: "Hugin's Shadow", color: '#a855f7', gradient: 'linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)' },
  { id: 'drakkar', name: "Drakkar Prime", color: '#3b82f6', gradient: 'linear-gradient(135deg, #3b82f6 0%, #1e40af 100%)' },
  { id: 'freyja', name: "Freyja's Chariot", color: '#ec4899', gradient: 'linear-gradient(135deg, #ec4899 0%, #be185d 100%)' },
  { id: 'norse', name: "Norse Raider", color: '#ef4444', gradient: 'linear-gradient(135deg, #ef4444 0%, #991b1b 100%)' }
];

export const ALL_WEATHERS = [
  { id: 'calm', name: 'Calm Seas', icon: '☀️', color: '#60a5fa' },
  { id: 'storm', name: 'Thunderstorm', icon: '⚡', color: '#fbbf24' },
  { id: 'fog', name: 'Thick Fog', icon: '🌫️', color: '#94a3b8' },
  { id: 'kraken', name: 'Kraken Attack', icon: '🐙', color: '#10b981' },
  { id: 'gale', name: 'Northern Gale', icon: '💨', color: '#60a5fa' },
  { id: 'ice', name: 'Frozen Wastes', icon: '🧊', color: '#67e8f9' },
  { id: 'aurora', name: 'Mystic Aurora', icon: '✨', color: '#c084fc' }
];

// Latin Square speed matrix (x10)
// Row = ship index (0-6), Column = weather index (0-6)
export const SPEED_MATRIX = [
  [13, 5,  7,  8,  9,  10, 11], // Sleipnir Swift
  [ 9, 10, 11, 13,  5,   7,  8], // Jörmungandr
  [ 7,  8,  9, 10, 11,  13,  5], // Ironbound Hulk
  [10, 11, 13,  5,  7,   8,  9], // Hugin's Shadow
  [11, 13,  5,  7,  8,   9, 10], // Drakkar Prime
  [ 5,  7,  8,  9, 10,  11, 13], // Freyja's Chariot
  [ 8,  9, 10, 11, 13,   5,  7], // Norse Raider
];

export const CHIP_VALUES = [1, 5, 10, 50, 100];
export const MAX_BET_PER_USER = 1000;

// Animation constants
export const BASE_SPEED = 8; // % of track per second at 1.0x
export const ZONE_WIDTH = 30; // % of track per weather zone
export const DOCK_WIDTH = 8; // % start zone
export const FINISH_WIDTH = 2; // % finish zone

export const SHIP_START = 2; // Ships park inside the dock (%)

/**
 * Compute ship position at a given elapsed time (ms)
 * Ships start inside the dock and accelerate through the dock into weather zones.
 * Returns position as % of track (0-100)
 */
export function computeShipPosition(speeds, elapsedMs) {
  let position = SHIP_START;
  let remainingMs = elapsedMs;

  // Phase 1: Traverse dock area (SHIP_START → DOCK_WIDTH) at first zone speed
  const dockDistance = DOCK_WIDTH - SHIP_START; // 6%
  const firstZoneSpeed = (speeds[0] / 10) * BASE_SPEED; // % per second
  const dockTimeMs = (dockDistance / firstZoneSpeed) * 1000;

  if (remainingMs < dockTimeMs) {
    position += (remainingMs / 1000) * firstZoneSpeed;
    return position;
  }
  position = DOCK_WIDTH;
  remainingMs -= dockTimeMs;

  // Phase 2: Traverse 3 weather zones
  for (let i = 0; i < speeds.length; i++) {
    const speed = speeds[i];
    const zoneSpeed = (speed / 10) * BASE_SPEED;
    const zoneTimeMs = (ZONE_WIDTH / zoneSpeed) * 1000;

    if (remainingMs >= zoneTimeMs) {
      position += ZONE_WIDTH;
      remainingMs -= zoneTimeMs;
    } else {
      position += (remainingMs / 1000) * zoneSpeed;
      return Math.min(position, DOCK_WIDTH + 3 * ZONE_WIDTH);
    }
  }

  // Past all zones — at finish line
  return DOCK_WIDTH + 3 * ZONE_WIDTH;
}

/**
 * Get the speed multiplier display value (e.g., 13 → "1.3x")
 */
export function formatSpeed(rawSpeed) {
  return (rawSpeed / 10).toFixed(1) + 'x';
}

/**
 * Get global ship index from ship id
 */
export function getShipGlobalIndex(shipId) {
  return ALL_SHIPS.findIndex(s => s.id === shipId);
}

/**
 * Get weather global index from weather id
 */
export function getWeatherGlobalIndex(weatherId) {
  return ALL_WEATHERS.findIndex(w => w.id === weatherId);
}


// ═══════════════════════════════════════════════════════
//  EXISTING MINI-GAME FUNCTIONS
// ═══════════════════════════════════════════════════════

export async function getMiniGameConfig() {
  try {
    const configRef = doc(db, 'settings', 'mini_games');
    const configSnap = await getDoc(configRef);
    if (!configSnap.exists()) return getDefaultConfig();
    return configSnap.data();
  } catch (error) {
    console.error('Error fetching mini-game config:', error);
    return getDefaultConfig();
  }
}

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
      minBet: 1,
      maxBetPerUser: 1000,
      description: 'Bet on legendary ships in a real-time parimutuel race!',
      multiplier: 'parimutuel'
    }
  };
}


// ═══════════════════════════════════════════════════════
//  PLAY MINI GAME (Slot Machine / Treasure Chest)
// ═══════════════════════════════════════════════════════

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
    const errorMessage = error.details?.message || error.message || 'An error occurred.';
    return { success: false, error: errorMessage };
  }
}


// ═══════════════════════════════════════════════════════
//  DRAKKAR RACE v2 — REALTIME SUBSCRIPTIONS
// ═══════════════════════════════════════════════════════

export function subscribeDrakkarRaceState(callback) {
  const stateRef = ref(database, 'drakkar_race/state');
  onValue(stateRef, (snapshot) => {
    callback(snapshot.exists() ? snapshot.val() : null);
  });
  return () => off(stateRef);
}

export function subscribeDrakkarPools(callback) {
  const poolsRef = ref(database, 'drakkar_race/pools');
  onValue(poolsRef, (snapshot) => {
    callback(snapshot.exists() ? snapshot.val() : {});
  });
  return () => off(poolsRef);
}

export function subscribeDrakkarHistory(callback) {
  const historyRef = query(
    ref(database, 'drakkar_race/history'),
    orderByChild('timestamp'),
    limitToLast(10)
  );
  onValue(historyRef, (snapshot) => {
    if (snapshot.exists()) {
      const data = snapshot.val();
      const entries = Object.values(data).sort((a, b) => b.timestamp - a.timestamp);
      callback(entries);
    } else {
      callback([]);
    }
  });
  return () => off(historyRef);
}

export async function refreshDrakkarRace() {
  try {
    const functions = getFunctions();
    const refreshFn = httpsCallable(functions, 'refreshDrakkarRace');
    await refreshFn();
  } catch (err) {
    console.error('Error refreshing Drakkar Race:', err);
  }
}

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


// ═══════════════════════════════════════════════════════
//  UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════

export function getRarityColor(rarity) {
  switch (rarity) {
    case 'legendary': return '#ff9800';
    case 'epic': return '#9c27b0';
    case 'rare': return '#2196f3';
    case 'common':
    default: return '#78909c';
  }
}

export function getRarityLabel(rarity) {
  switch (rarity) {
    case 'legendary': return '★★★★';
    case 'epic': return '★★★';
    case 'rare': return '★★';
    case 'common':
    default: return '★';
  }
}

export function getRecommendedIcons(rarity) {
  switch (rarity) {
    case 'legendary': return ['legendary_ship.png', 'legendary_hammer.png'];
    case 'epic': return ['epic_helmet.png', 'epic_amber.png'];
    case 'rare': return ['rare_axe.png'];
    case 'common':
    default: return ['common_horn.png', 'common_shield.png'];
  }
}
