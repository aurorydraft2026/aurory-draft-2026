import { db, database, functions } from '../firebase';
import { doc, getDoc, setDoc, serverTimestamp, collection, getDocs, query as fsQuery, where, orderBy, limit } from 'firebase/firestore';
import { ref, onValue, off, query, orderByChild, limitToLast, set, onDisconnect, runTransaction } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';
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
  [16, 8, 9, 10, 11, 12, 14], // Sleipnir Swift
  [11, 12, 14, 16, 8, 9, 10], // Jörmungandr
  [9, 10, 11, 12, 14, 16, 8], // Ironbound Hulk
  [12, 14, 16, 8, 9, 10, 11], // Hugin's Shadow
  [14, 16, 8, 9, 10, 11, 12], // Drakkar Prime
  [8, 9, 10, 11, 12, 14, 16], // Freyja's Chariot
  [10, 11, 12, 14, 16, 8, 9], // Norse Raider
];

export const CHIP_VALUES = [10, 100, 500, 1000, 2500, 5000];
export const MAX_BET_PER_USER = 30000;
export const MAX_BET_PER_SHIP_PER_USER = 10000;
export const MAX_SHIP_POOL = 1000000;

// Animation constants
export const BASE_SPEED = 8; // Reverted to 8 for original race duration and excitement
export const ZONE_WIDTH = 18; // 90% / 5 zones = 18% each
export const DOCK_WIDTH = 10; // % start zone (increased from 8)
export const FINISH_WIDTH = 0; // Final edge is 100%

export const SHIP_START = 10; // Ships start at 10% (the weather boundary)

/**
 * Compute ship position at a given elapsed time (ms)
 * Progresses from SHIP_START (10) to 100%
 */
export function computeShipPosition(speeds, elapsedMs) {
  let position = SHIP_START;
  let remainingMs = elapsedMs;

  // Traverse 5 weather zones
  for (let i = 0; i < speeds.length; i++) {
    const speed = speeds[i];
    const zoneSpeed = (speed / 10) * BASE_SPEED;
    const zoneTimeMs = (ZONE_WIDTH / zoneSpeed) * 1000;

    if (remainingMs >= zoneTimeMs) {
      position += ZONE_WIDTH;
      remainingMs -= zoneTimeMs;
    } else {
      position += (remainingMs / 1000) * zoneSpeed;
      return Math.min(position, 100);
    }
  }

  // Past all zones — at finish line
  return 100;
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
    const defaultConfig = getDefaultConfig();
    
    if (!configSnap.exists()) return defaultConfig;
    
    const remoteData = configSnap.data();
    const mergedConfig = {};
    
    // Merge default config with remote config so new games show up
    const allKeys = new Set([...Object.keys(defaultConfig), ...Object.keys(remoteData)]);
    for (const key of allKeys) {
      mergedConfig[key] = { ...(defaultConfig[key] || {}), ...(remoteData[key] || {}) };
    }
    
    return mergedConfig;
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
    },
    yggdrasilAscender: {
      enabled: true,
      description: 'Climb the World Tree with friends!',
      costPerPlay: 0,
    },
  };
}

// ═══════════════════════════════════════════════════════
//  YGGDRASIL ASCENDER — REWARDS
// ═══════════════════════════════════════════════════════

/**
 * Submit Yggdrasil Ascender run for altitude/rune rewards.
 * @param {number} altitude - The max altitude reached.
 * @param {number} runes - The number of runes collected.
 */
export async function submitYggdrasilRun(altitude, runes, turbosUsed = 0, doubleJumpsUsed = 0, redRunes = 0) {
  try {
    const claimFn = httpsCallable(functions, 'submitYggdrasilRun');
    const result = await claimFn({ altitude, runes, turbosUsed, doubleJumpsUsed, redRunes });
    return result.data;
  } catch (error) {
    console.error('Error submitting Yggdrasil run:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Fetch all active Yggdrasil Events.
 */
export async function getYggdrasilEvents() {
  try {
    const eventsRef = collection(db, 'yggdrasil_events');
    const q = fsQuery(eventsRef, where('status', '==', 'open'));
    const snap = await getDocs(q);
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error('Error fetching Yggdrasil events:', error);
    return [];
  }
}

/**
 * Join an event run.
 * @param {string} eventId - The ID of the event to join.
 */
export async function joinYggdrasilEvent(eventId) {
  try {
    const joinFn = httpsCallable(functions, 'joinYggdrasilEvent');
    const result = await joinFn({ eventId });
    return result.data;
  } catch (error) {
    console.error('Error joining Yggdrasil event:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Claim an event prize.
 * @param {string} eventId - The ID of the event.
 * @param {number} altitude - Current altitude to verify.
 */
export async function claimYggdrasilEventPrize(eventId, altitude) {
  try {
    const claimFn = httpsCallable(functions, 'claimYggdrasilEventPrize');
    const result = await claimFn({ eventId, altitude });
    return result.data;
  } catch (error) {
    console.error('Error claiming Yggdrasil prize:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Purchase a Rune Shop item.
 * @param {string} itemId - 'magnetism', 'extraTurbo', 'extraJump', 'idunApple'
 */
export async function purchaseRuneShopItem(itemId) {
  try {
    const purchaseFn = httpsCallable(functions, 'purchaseRuneShopItem');
    const result = await purchaseFn({ itemId });
    return result.data;
  } catch (error) {
    console.error('Error purchasing shop item:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Consume Iðunn's Apple (mark as used in Firestore).
 */
export async function consumeIdunAppleService() {
  try {
    const consumeFn = httpsCallable(functions, 'consumeIdunApple');
    const result = await consumeFn();
    return result.data;
  } catch (error) {
    console.error('Error consuming apple:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Exchange Runes for another currency.
 * @param {string} targetCurrency - 'Valcoins', 'AURY', 'Amiko', etc.
 * @param {number} runeAmount - Number of runes to exchange
 */
export async function exchangeRunesService(targetCurrency, runeAmount) {
  try {
    const exchangeFn = httpsCallable(functions, 'exchangeRunes');
    const result = await exchangeFn({ targetCurrency, runeAmount });
    return result.data;
  } catch (error) {
    console.error('Error exchanging runes:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get user's Yggdrasil data (rune balance + upgrades).
 * @param {string} uid - User ID
 */
export async function getUserYggData(uid) {
  if (!uid) return { runeBalance: 0, upgrades: {} };
  try {
    const userSnap = await getDoc(doc(db, 'users', uid));
    const userData = userSnap.exists() ? userSnap.data() : {};
    
    const upgradesSnap = await getDoc(doc(db, 'users', uid, 'yggdrasil_data', 'upgrades'));
    const upgrades = upgradesSnap.exists() ? upgradesSnap.data() : {};

    return {
      runeBalance: userData.yggRunes || 0,
      redRuneBalance: userData.yggRedRunes || 0,
      upgrades
    };
  } catch (error) {
    console.error('Error fetching Ygg data:', error);
    return { runeBalance: 0, upgrades: {} };
  }
}

/**
 * Fetch purchase history from Rune Shop.
 * @param {string} uid - User ID
 */
export async function getRuneShopHistory(uid) {
  if (!uid) return [];
  try {
    const historyRef = collection(db, 'users', uid, 'rune_history');
    const q = fsQuery(historyRef, orderBy('timestamp', 'desc'), limit(20));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  } catch (error) {
    console.error('Error fetching rune shop history:', error);
    return [];
  }
}

/**
 * Subscribe to the Global Ascension Goal in RTDB.
 * @param {Function} callback - Called with { target, current, rewardMultiplier }
 * @returns {() => void} unsubscribe function
 */
export function subscribeGlobalGoal(callback) {
  const goalRef = ref(database, 'yggdrasil/global_goal');
  onValue(goalRef, (snapshot) => {
    if (snapshot.exists()) {
      callback(snapshot.val());
    } else {
      callback({ target: 1000000, current: 0, rewardMultiplier: 2 });
    }
  });
  return () => off(goalRef);
}


// ═══════════════════════════════════════════════════════
//  PLAY MINI GAME (Slot Machine / Treasure Chest)
// ═══════════════════════════════════════════════════════

export async function playMiniGame(user, gameType, multiplier = 1) {
  if (!user || !user.uid) {
    return { success: false, error: 'Please log in to play' };
  }

  try {
    const playMiniGameFn = httpsCallable(functions, 'playMiniGame');
    const result = await playMiniGameFn({ gameType, multiplier });
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

export function subscribeDrakkarBettors(callback) {
  const bettorsRef = ref(database, 'drakkar_race/bettors');
  onValue(bettorsRef, (snapshot) => {
    callback(snapshot.exists() ? snapshot.val() : {});
  });
  return () => off(bettorsRef);
}

export function subscribeDrakkarPresence(callback) {
  const presenceRef = ref(database, 'drakkar_race/presence');
  onValue(presenceRef, (snapshot) => {
    callback(snapshot.exists() ? snapshot.val() : {});
  });
  return () => off(presenceRef);
}

export function updateDrakkarPresence(uid) {
  if (!uid) return;
  const pRef = ref(database, `drakkar_race/presence/${uid}`);
  set(pRef, Date.now());
  onDisconnect(pRef).remove();
}

export async function refreshDrakkarRace() {
  try {
    const refreshFn = httpsCallable(functions, 'refreshDrakkarRace');
    await refreshFn();
  } catch (err) {
    console.error('Error refreshing Drakkar Race:', err);
  }
}

export async function placeDrakkarBet(shipId, amount) {
  try {
    const betFn = httpsCallable(functions, 'placeDrakkarBet');
    const result = await betFn({ shipId, amount });
    return result.data;
  } catch (err) {
    console.error('Error placing Drakkar bet:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Perform a raw client-side increment to the RTDB pool for instant visual feedback. 
 * Note: This is a "display-only" increment; the server validates the true balance.
 */
export async function incrementDrakkarPool(shipId, amount) {
  try {
    const poolRef = ref(database, `drakkar_race/pools/${shipId}`);
    await runTransaction(poolRef, (current) => {
      return (current || 0) + amount;
    });
  } catch (err) {
    console.error('Error incrementing pool locally:', err);
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

export function getRecommendedIcons(rarity, isJackpot = false) {
  if (isJackpot) {
    return ['jackpot_pouch_2.png', 'jackpot_pouch.png', 'legendary_hammer.png', 'legendary_ship.png', '💰', '👑'];
  }
  switch (rarity) {
    case 'legendary': return ['legendary_ship.png', 'legendary_hammer.png', '🟡', '✨'];
    case 'epic': return ['epic_helmet.png', 'epic_amber.png', '🟣', '🔥'];
    case 'rare': return ['rare_axe.png', '🔵', '💎'];
    case 'common':
    default: return ['common_horn.png', 'common_shield.png', '⚪', '🪙'];
  }
}


// ═══════════════════════════════════════════════════════
//  ODIN'S RIDDLE — SERVICE FUNCTIONS
// ═══════════════════════════════════════════════════════

/**
 * Fetch a random enabled riddle from Firestore, filtered by required difficulty.
 * Uses session persistence to prevent refresh exploits.
 */
export async function fetchRandomRiddle(uid, requiredDifficulty = null) {
  try {
    let askedRiddleIds = [];
    
    if (!uid) {
      console.warn("fetchRandomRiddle: No UID provided.");
    } else {
      // 1. Check for active session to prevent refresh/farming exploit
      const sessionRef = doc(db, 'users', uid, 'activeSessions', 'odinsRiddle');
      const sessionSnap = await getDoc(sessionRef);
      
      const userRef = doc(db, 'users', uid);
      const userSnap = await getDoc(userRef);
      const userData = userSnap.data() || {};
      const daily = userData.dailyRiddle || {};
      
      // Get today's date string
      const now = new Date();
      const today = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
      
      if (daily.date === today) {
        askedRiddleIds = daily.askedRiddleIds || [];
      }

      if (sessionSnap.exists()) {
        const session = sessionSnap.data();
        const startTime = session.startTime?.toMillis?.() || session.startTime || Date.now();
        const elapsed = (Date.now() - startTime) / 1000;
        
        // If session started less than 20 seconds ago (15s limit + buffer), resume it
        if (elapsed < 20 && session.status === 'active') {
          const riddleDoc = await getDoc(doc(db, 'riddles', session.riddleId));
          if (riddleDoc.exists()) {
            const selected = riddleDoc.data();
            console.log("Resuming active riddle session:", session.riddleId);
            
            // Map options to include original indices and scramble
            const optionsWithIdx = selected.options.map((opt, i) => ({ text: opt, originalIndex: i }));
            const scrambledOptions = [...optionsWithIdx].sort(() => Math.random() - 0.5);

            return {
              id: riddleDoc.id,
              question: selected.question,
              options: scrambledOptions, // Scrambled for UI
              category: selected.category || 'norse',
              difficulty: selected.difficulty || 'easy',
              imageUrl: selected.imageUrl || '',
              initialTimeLeft: Math.max(0, 15 - Math.floor(elapsed))
            };
          }
        }
      }
    }

    // 2. Fetch riddles filtered by difficulty (if specified) and enabled status
    const riddlesRef = collection(db, 'riddles');
    let q;
    if (requiredDifficulty) {
      q = fsQuery(riddlesRef, where('enabled', '==', true), where('difficulty', '==', requiredDifficulty));
    } else {
      q = fsQuery(riddlesRef, where('enabled', '==', true));
    }
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      // Fallback: try without difficulty filter
      if (requiredDifficulty) {
        const fallbackQ = fsQuery(riddlesRef, where('enabled', '==', true));
        const fallbackSnap = await getDocs(fallbackQ);
        if (fallbackSnap.empty) return null;
        
        let riddles = fallbackSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        // Filter out already asked riddles in memory
        const freshRiddles = riddles.filter(r => !askedRiddleIds.includes(r.id));
        const candidateRiddles = freshRiddles.length > 0 ? freshRiddles : riddles; // Reuse pool if all exhausted
        
        const selected = candidateRiddles[Math.floor(Math.random() * candidateRiddles.length)];
        
        if (uid) {
          // Track that we asked this riddle
          const userRef = doc(db, 'users', uid);
          const newAskedIds = Array.from(new Set([...askedRiddleIds, selected.id]));
          await setDoc(userRef, { "dailyRiddle.askedRiddleIds": newAskedIds }, { merge: true });
          
          await setDoc(doc(db, 'users', uid, 'activeSessions', 'odinsRiddle'), {
            riddleId: selected.id, startTime: serverTimestamp(), status: 'active'
          });
        }

        const optionsWithIdx = selected.options.map((opt, i) => ({ text: opt, originalIndex: i }));
        const scrambledOptions = [...optionsWithIdx].sort(() => Math.random() - 0.5);

        return { 
          id: selected.id, 
          question: selected.question, 
          options: scrambledOptions, 
          category: selected.category || 'norse', 
          difficulty: selected.difficulty || 'easy', 
          imageUrl: selected.imageUrl || '', 
          initialTimeLeft: 15 
        };
      }
      return null;
    }

    let riddles = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    // Filter out already asked riddles in memory
    const freshRiddles = riddles.filter(r => !askedRiddleIds.includes(r.id));
    const candidateRiddles = freshRiddles.length > 0 ? freshRiddles : riddles;

    const selected = candidateRiddles[Math.floor(Math.random() * candidateRiddles.length)];

    // 3. Save new session and track asked ID
    if (uid) {
      const userRef = doc(db, 'users', uid);
      const newAskedIds = Array.from(new Set([...askedRiddleIds, selected.id]));
      await setDoc(userRef, { "dailyRiddle.askedRiddleIds": newAskedIds }, { merge: true });

      const sessionRef = doc(db, 'users', uid, 'activeSessions', 'odinsRiddle');
      await setDoc(sessionRef, {
        riddleId: selected.id,
        startTime: serverTimestamp(),
        status: 'active'
      });
    }

    const optionsWithIdx = selected.options.map((opt, i) => ({ text: opt, originalIndex: i }));
    const scrambledOptions = [...optionsWithIdx].sort(() => Math.random() - 0.5);

    return {
      id: selected.id,
      question: selected.question,
      options: scrambledOptions,
      category: selected.category || 'norse',
      difficulty: selected.difficulty || 'easy',
      imageUrl: selected.imageUrl || '',
      initialTimeLeft: 15
    };
  } catch (error) {
    console.error('Error fetching riddle:', error);
    return null;
  }
}

/**
 * Fetch the player's daily riddle progress from Firestore.
 * Returns the dailyRiddle object or a fresh default if none/expired.
 */
export async function fetchDailyRiddleProgress(uid) {
  if (!uid) return null;
  try {
    const userRef = doc(db, 'users', uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) return null;

    const userData = userSnap.data();
    const daily = userData.dailyRiddle || {};
    const now = new Date();
    const today = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;

    if (daily.date === today) {
      return daily;
    }

    // Not today — return a fresh state
    return {
      date: today,
      totalAnswered: 0,
      totalCorrect: 0,
      wrongAnswers: 0,
      streakUnlocked: false,
      phase: 'base'
    };
  } catch (error) {
    console.error('Error fetching daily riddle progress:', error);
    return null;
  }
}

/**
 * Submit an answer to the answerRiddle Cloud Function
 */
export async function submitRiddleAnswer(riddleId, answerIndex) {
  try {
    const answerFn = httpsCallable(functions, 'answerRiddle');
    const result = await answerFn({ riddleId, answerIndex });
    return result.data;
  } catch (error) {
    console.error('Error submitting riddle answer:', error);
    throw error;
  }
}


/**
 * Subscribe to the global AURY Fever jackpot gauge for a given game type.
 * @param {'slotMachine' | 'treasureChest'} gameType
 * @param {(data: { count: number, lastWinner: object|null }) => void} callback
 * @returns {() => void} unsubscribe function
 */
export function subscribeJackpot(gameType, callback) {
  const jackpotRef = ref(database, `mini_games/jackpots/${gameType}`);
  onValue(jackpotRef, (snapshot) => {
    if (snapshot.exists()) {
      callback(snapshot.val());
    } else {
      callback({ count: 0, lastWinner: null });
    }
  });
  return () => off(jackpotRef);
}

// ═══════════════════════════════════════════════════════
//  MINIGAMES CHAT
// ═══════════════════════════════════════════════════════

/**
 * Subscribe to a specific chat channel in RTDB.
 * @param {string} channelId - 'hub', 'drakkar', etc.
 * @param {Function} callback - Called with an array of messages.
 * @returns {() => void} unsubscribe function
 */
export function subscribeMiniGameChat(channelId, callback) {
  const chatRef = query(
    ref(database, `minigame_chats/${channelId}`),
    limitToLast(50)
  );

  onValue(chatRef, (snapshot) => {
    if (snapshot.exists()) {
      const msgs = [];
      snapshot.forEach(child => {
        msgs.push({ id: child.key, ...child.val() });
      });
      callback(msgs);
    } else {
      callback([]);
    }
  });

  return () => off(chatRef);
}

/**
 * Send a message to a chat channel.
 */
export async function sendMiniGameChatMessage(channelId, user, text) {
  if (!user || !text.trim()) return;

  const messageData = {
    uid: user.uid,
    name: user.auroryPlayerName || user.username || user.displayName || 'Warrior',
    avatar: user.auroryProfilePicture || user.photoURL || null,
    text: text.trim().substring(0, 500),
    timestamp: Date.now()
  };

  try {
    const specificMsgRef = ref(database, `minigame_chats/${channelId}/${Date.now()}_${user.uid.substring(0, 5)}`);
    await set(specificMsgRef, messageData);
    return { success: true };
  } catch (err) {
    console.error('Chat error:', err);
    return { success: false, error: err.message };
  }
}


