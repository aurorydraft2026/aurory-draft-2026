import React, { useState, useEffect, useRef, useCallback } from 'react';
import { database, db } from '../../firebase';
import { ref, onValue, set, remove, onDisconnect, get, query, orderByChild, limitToLast } from 'firebase/database';
import { doc, getDoc, collection, query as fsQuery, orderBy, limit, getDocs } from 'firebase/firestore';
import { submitYggdrasilRun, getYggdrasilEvents, joinYggdrasilEvent, claimYggdrasilEventPrize, getUserYggData, subscribeGlobalGoal, consumeIdunAppleService } from '../../services/miniGameService';
import { resolveDisplayName } from '../../utils/userUtils';
import RuneShop from './RuneShop';
import './YggdrasilAscender.css';

// ═══ CONSTANTS ═══
const CANVAS_W = 400;
const CANVAS_H = 450;
const GRAVITY = 0.32;
const JUMP_FORCE = -10;
const BOOST_FORCE = -17;
const MOVE_SPEED = 6.5;
const PLAYER_W = 26;
const PLAYER_H = 70;
const PLAT_W = 80;
const PLAT_H = 16;
const PLAT_GAP_MIN = 100;
const PLAT_GAP_MAX = 150;
const RUNE_SIZE = 22;
const NIDHOGG_GRACE_PERIOD = 120; // 2 seconds at 60fps
const NIDHOGG_BASE_SPEED = 0.3;
const NIDHOGG_ACCEL = 0.0001; // Accelerates over time
const NIDHOGG_MAX_SPEED = 4.5; // Cap to ensure it stays beatable (Player MOVE_SPEED is 6.5)
const NIDHOGG_STALL_BOOST = 0.45; // Temporary surge if player stays low (increased since it's no longer permanent)
const RATATOSKR_W = 20;
const RATATOSKR_H = 16;
const RATATOSKR_SPEED = 2; // Slowed down so players can see and catch it

// No more static milestones, using dynamic run-end rewards instead

const RUNE_SYMBOLS = ['ᚠ', 'ᚢ', 'ᚦ', 'ᚨ', 'ᚱ', 'ᚲ', 'ᚷ', 'ᚹ', 'ᚺ', 'ᛁ', 'ᛃ', 'ᛈ', 'ᛇ', 'ᛉ', 'ᛋ', 'ᛏ', 'ᛒ', 'ᛗ', 'ᛚ', 'ᛞ'];

// Seeded RNG
function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function getDailySeed() {
  const d = new Date();
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

// Zone colors
const ZONES = [
  { maxAlt: 1000, name: 'MIDGARD', bg1: '#0d1b0e', bg2: '#1a3a1c', color: '#22c55e', condition: 'Normal' },
  { maxAlt: 3000, name: 'CLOUDS', bg1: '#0f1729', bg2: '#1e3a5f', color: '#60a5fa', condition: 'Dense Air' },
  { maxAlt: 5000, name: 'BIFROST', bg1: '#1a0a2e', bg2: '#2d1b69', color: '#a78bfa', condition: 'Slippery' },
  { maxAlt: 7000, name: 'THUNDERSTORM', bg1: '#020617', bg2: '#0f172a', color: '#3b82f6', condition: 'Darkness' },
  { maxAlt: 9000, name: 'COSMIC_WINDS', bg1: '#1e1b4b', bg2: '#312e81', color: '#fbbf24', condition: 'Low Gravity + Wind' },
  { maxAlt: Infinity, name: 'ASGARD', bg1: '#1a0a0a', bg2: '#3d1f00', color: '#f472b6', condition: 'Fast Platforms' },
];

function getZone(alt) {
  for (const z of ZONES) if (alt < z.maxAlt) return z;
  return ZONES[ZONES.length - 1];
}

// Platform generation
// usedBands: Set of band numbers that already have items assigned (prevents duplicates across batches)
function generatePlatforms(count, startY, rng, difficulty, usedBands) {
  const platforms = [];
  let y = startY;
  for (let i = 0; i < count; i++) {
    const gap = PLAT_GAP_MIN + rng() * (PLAT_GAP_MAX - PLAT_GAP_MIN);
    y -= gap;
    const x = rng() * (CANVAS_W - PLAT_W);
    // Platform type based on difficulty (starts earlier)
    let type = 'standard';
    const currentAlt = Math.floor(-y / 4);
    const isThunderZone = currentAlt >= 5000 && currentAlt < 7000;
    const roll = rng();
    if (difficulty > 0.1 && roll < 0.1) type = 'boost'; // 10% boost
    else if (difficulty > 0.05 && roll < 0.40) type = 'moving'; // 25% moving
    else if (isThunderZone && roll < 0.85) type = 'fragile'; // 45% fragile in Thunderstorm!
    else if (difficulty > 0.08 && roll < (difficulty > 0.66 ? 0.85 : 0.60)) type = 'fragile'; // fragile

    const hasRune = rng() < 0.25;
    const runeSymbol = RUNE_SYMBOLS[Math.floor(rng() * RUNE_SYMBOLS.length)];
    const isMoving = type === 'moving' || (type === 'fragile' && difficulty > 0.5 && rng() < 0.2);
    let moveType = 'horizontal';
    if (isMoving) {
      const moveRoll = rng();
      if (moveRoll < 0.15 && difficulty > 0.3) moveType = 'vertical';
      else if (moveRoll < 0.30 && difficulty > 0.5) moveType = 'circular';
    }

    platforms.push({
      id: Math.random().toString(36).substr(2, 9),
      x, y, w: PLAT_W, h: PLAT_H, type,
      isMoving,
      moveType,
      moveDir: rng() < 0.5 ? 1 : -1,
      baseX: x, baseY: y,
      radius: 40 + rng() * 40,
      angle: rng() * Math.PI * 2,
      activated: false,
      broken: false,
      spawnTime: Date.now(),
      hasRune,
      runeSymbol,
      runeCollected: false,
      item: null,
      itemCollected: false
    });
  }

  // Separate band assignment for different items
  const assignItem = (type, freq, prefix) => {
    const bands = {};
    for (const plat of platforms) {
      const band = Math.floor(Math.floor(-plat.y / 4) / freq);
      if (!bands[band]) bands[band] = [];
      bands[band].push(plat);
    }
    for (const band of Object.keys(bands)) {
      const bandAlt = parseInt(band) * freq;
      if (bandAlt >= 15000) continue; // No more power-ups above 15k
      const key = `${prefix}_${band}`;
      if (usedBands && usedBands.has(key)) continue;
      const eligible = bands[band].filter(p => (p.type === 'standard' || p.type === 'moving') && !p.item);
      if (eligible.length > 0) {
        const shuffled = eligible.sort(() => rng() - 0.5);
        shuffled[0].item = type;
        if (usedBands) usedBands.add(key);
      }
    }
  };

  assignItem('turbo', 3000, 'T');
  assignItem('doubleJump', 2000, 'J');

  return platforms;
}

// Generate floating rune patterns (all standard gold runes)
function generateFloatingRunes(startY, endY, rng) {
  const runes = [];
  const runeCount = 3 + Math.floor(rng() * 4); // 3-6 runes per batch
  const centerX = 60 + rng() * (CANVAS_W - 120);
  const patternY = startY + rng() * (endY - startY);
  const symbol = RUNE_SYMBOLS[Math.floor(rng() * RUNE_SYMBOLS.length)];

  for (let j = 0; j < runeCount; j++) {
    runes.push({
      id: `fr_${Math.random()}_${j}`,
      x: centerX + (j - Math.floor(runeCount / 2)) * 30,
      y: patternY + (rng() - 0.5) * 40,
      symbol,
      collected: false,
      offX: 0, offY: 0
    });
  }
  return runes;
}

// Generate red runes — event-exclusive, uses Math.random() so each player sees different placements
// Spawns ~2-3 per 1000m band, scattered independently (not in patterns)
function generateRedRunes(startY, endY) {
  const runes = [];
  const bandHeight = Math.abs(endY - startY);
  // ~2-3 per 1000m band (1000m = 4000 world units)
  const count = Math.floor(Math.random() * 2) + 2; // 2-3
  const symbol = RUNE_SYMBOLS[Math.floor(Math.random() * RUNE_SYMBOLS.length)];

  for (let i = 0; i < count; i++) {
    runes.push({
      id: `rr_${Math.random()}_${i}`,
      x: 40 + Math.random() * (CANVAS_W - 80),
      y: startY + Math.random() * bandHeight,
      symbol,
      collected: false,
      isRedRune: true,
      offX: 0, offY: 0
    });
  }
  return runes;
}

const YggdrasilAscender = ({ user }) => {
  const canvasRef = useRef(null);
  const gameRef = useRef(null);
  const animRef = useRef(null);
  const assetsRef = useRef({ 
    stand: null, jump: null, turbo: null, plat1: null, plat2: null, background: null,
    magnet: null, apple: null, spirit: null, jumpIcon: null, turboIcon: null, rune: null, redRune: null, ratatoskr: null
  });
  const keysRef = useRef({});
  const touchRef = useRef({ left: false, right: false, jump: false });
  const leftBtnRef = useRef(null);
  const rightBtnRef = useRef(null);
  const jumpBtnRef = useRef(null);

  const [assetsLoaded, setAssetsLoaded] = useState(false);
  const [gameState, setGameState] = useState('start'); // start, playing, over
  const [score, setScore] = useState(0);
  const [bestScore, setBestScore] = useState(0);
  const [isNewBest, setIsNewBest] = useState(false);
  const [zoneName, setZoneName] = useState('MIDGARD');
  const [showZoneAnnouncement, setShowZoneAnnouncement] = useState(false);
  const [shopTurboCharges, setShopTurboCharges] = useState(0);
  const [freeTurboCharges, setFreeTurboCharges] = useState(0);
  const [shopJumpCharges, setShopJumpCharges] = useState(0);
  const [freeJumpCharges, setFreeJumpCharges] = useState(0);
  const zoneNameRef = useRef('MIDGARD');
  const [playerCount, setPlayerCount] = useState(1);
  const [lbMode, setLbMode] = useState('daily');
  const [lbMetric, setLbMetric] = useState('altitude'); // 'altitude' or 'runes'
  const [leaderboard, setLeaderboard] = useState([]);
  const [lbLoading, setLbLoading] = useState(false);
  const [nameCache, setNameCache] = useState({});
  const [activeEventId, setActiveEventId] = useState(null);
  const [eventLiveCounts, setEventLiveCounts] = useState({});
  const nameCacheRef = useRef({}); // Ref to avoid dependency loop in useEffect
  const ghostPlayersDataRef = useRef({}); // Avoid stale closure in requestAnimationFrame
  const ghostVisualsRef = useRef({}); // { uid: { x, y, targetX, targetY } }
  const [runesCollected, setRunesCollected] = useState(0);
  const [redRunesCollected, setRedRunesCollected] = useState(0);
  const [turboTime, setTurboTime] = useState(0);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [joystickMode, setJoystickMode] = useState(false);
  const [joystickX, setJoystickX] = useState(0);
  const [joystickY, setJoystickY] = useState(0);
  const [runStats, setRunStats] = useState(null);
  const [showRules, setShowRules] = useState(false);
  const [turboUsed, setTurboUsed] = useState(false);
  const [jumpUsed, setJumpUsed] = useState(false);
  const [yggConfig, setYggConfig] = useState({ maxDailyRuns: 5, runeMultiplier: 1.0 });
  const bestScoreRef = useRef(0);
  const [nidhoggWarning, setNidhoggWarning] = useState(false);
  const [ratatoskrNotif, setRatatoskrNotif] = useState(null);
  const [deathReason, setDeathReason] = useState(null); // 'fall' | 'nidhogg'

  // ═══ RUNE SHOP STATE ═══
  const [showShop, setShowShop] = useState(false);
  const [userUpgrades, setUserUpgrades] = useState({ magnetismLevel: 0, extraTurbo: 0, extraJump: 0, hasIdunApple: false });
  const [globalGoal, setGlobalGoal] = useState({ target: 1000000, current: 0, rewardMultiplier: 2 });
  const [appleUsedInRun, setAppleUsedInRun] = useState(false);
  const [doubleJumpDisabled, setDoubleJumpDisabled] = useState(false);
  const turboMomentumRef = useRef(false);
  const [showApplePrompt, setShowApplePrompt] = useState(false);
  const [appleTimer, setAppleTimer] = useState(10);
  const appleTimerRef = useRef(null);
  const appleDeathReasonRef = useRef(null);
  const joystickTouchIdRef = useRef(null);

  // ═══ EMOTES STATE ═══
  const [showEmoteMenu, setShowEmoteMenu] = useState(false);
  const currentEmoteRef = useRef(null);
  const [selectedEmote, setSelectedEmote] = useState(null);
  const EMOTES = ['🔥', '⚔️', '🛡️', '⚡', '🏆', '💀'];

  // Events
  const [events, setEvents] = useState([]);
  const [activeEvent, setActiveEvent] = useState(null);
  const activeEventIdRef = useRef(null);
  const [eventPrizeCaught, setEventPrizeCaught] = useState(null);
  const [eventLoading, setEventLoading] = useState(false);
  const [eventLoadingId, setEventLoadingId] = useState(null);
  const [fallenMessages, setFallenMessages] = useState([]);
  const [globalHistory, setGlobalHistory] = useState([]);
  const prevPlayersRef = useRef({});
  const containerRef = useRef(null);

  // Fetch admin config for prize calculation display
  const fetchConfig = useCallback(async () => {
    try {
      const configSnap = await getDoc(doc(db, 'settings', 'mini_games'));
      if (configSnap.exists()) {
        const data = configSnap.data()?.yggdrasilAscender || {};
        setYggConfig({
          maxDailyRuns: data.maxDailyRuns ?? 5,
          runeMultiplier: data.runeMultiplier ?? 1.0,
          shopCosts: data.shopCosts || {},
          exchangeRates: data.exchangeRates || {},
          customShopItems: data.customShopItems || [],
          ratatoskrReward: data.ratatoskrReward ?? 5,
          globalGoalTarget: data.globalGoalTarget ?? 1000000
        });
      }
    } catch (err) {
      console.warn('Failed to fetch ygg config, using defaults', err);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  // Load and process assets (remove white background)
  useEffect(() => {
    const processImage = (src) => new Promise((res, rej) => {
      const img = new Image();
      img.src = src;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return res(img);

        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        // Remove white background (chroma keying)
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2];
          // If pixel is white or very near white
          if (r > 240 && g > 240 && b > 240) {
            data[i + 3] = 0;
          }
        }
        ctx.putImageData(imageData, 0, 0);
        const newImg = new Image();
        newImg.src = canvas.toDataURL();
        newImg.onload = () => res(newImg);
      };
      img.onerror = () => rej(new Error(`Failed to load ${src}`));
    });

    Promise.all([
      processImage('/icons/minigames/yggdrasil/hero_stand.png'),
      processImage('/icons/minigames/yggdrasil/hero_jump.png'),
      processImage('/icons/minigames/yggdrasil/hero_turbo.png'),
      processImage('/icons/minigames/yggdrasil/platform_1.png'),
      processImage('/icons/minigames/yggdrasil/platform_2.png'),
      processImage('/icons/minigames/yggdrasil/background.png'),
      processImage('/icons/minigames/yggdrasil/magnet.png'),
      processImage("/icons/minigames/yggdrasil/idunn's_apple.png"),
      processImage('/icons/minigames/yggdrasil/death_spirit.png'),
      processImage('/icons/minigames/yggdrasil/double_jump.png'),
      processImage('/icons/minigames/yggdrasil/turbo.png'),
      processImage('/icons/minigames/yggdrasil/rune.png'),
      processImage('/icons/minigames/yggdrasil/red_rune.png'),
      processImage('/icons/minigames/yggdrasil/ratatoskr.png')
    ]).then(([stand, jump, turbo, plat1, plat2, background, magnet, apple, spirit, jumpIcon, turboIcon, rune, redRune, ratatoskr]) => {
      assetsRef.current = { 
        stand, jump, turbo, plat1, plat2, background,
        magnet, apple, spirit, jumpIcon, turboIcon, rune, redRune, ratatoskr
      };
      setAssetsLoaded(true);
    }).catch(err => {
      console.error('Asset processing failed:', err);
      setAssetsLoaded(true);
    });
  }, []);

  // Load best score & Detect touch
  useEffect(() => {
    const saved = localStorage.getItem('ygg_best');
    if (saved) {
      const val = parseInt(saved, 10);
      setBestScore(val);
      bestScoreRef.current = val;
    }
    setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0);
  }, []);

  // ═══ RUNE SHOP DATA & GLOBAL GOAL ═══
  const loadUserShopData = useCallback(async () => {
    if (!user?.uid) return null;
    const data = await getUserYggData(user.uid);
    setUserUpgrades(data.upgrades);
    fetchConfig(); // Also refresh global config to update shop stock counts
    return data.upgrades;
  }, [user, fetchConfig]);

  useEffect(() => {
    if (gameState === 'start') {
      loadUserShopData();
    }
  }, [gameState, loadUserShopData]);

  useEffect(() => {
    const unsub = subscribeGlobalGoal((data) => {
      setGlobalGoal(data);
    });
    return () => unsub();
  }, []);

  // Subscribe to Death Spirits
  useEffect(() => {
    const sRef = ref(database, 'yggdrasil/spirits');
    const unsub = onValue(sRef, (snapshot) => {
      const data = snapshot.val();
      if (data && gameRef.current) {
        gameRef.current.globalSpirits = data;
      } else if (gameRef.current) {
        gameRef.current.globalSpirits = {};
      }
    });
    return () => unsub();
  }, []);

  // Load events
  useEffect(() => {
    getYggdrasilEvents().then(setEvents);
  }, [gameState]);

  // Subscribe to ghost players and Global History
  useEffect(() => {
    if (!user?.uid) return;
    const playersRef = ref(database, 'yggdrasil/players');

    const addHistoryEvent = (text, type) => {
      setGlobalHistory(prev => [{
        id: Date.now() + Math.random(),
        text,
        type,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      }, ...prev].slice(0, 40));
    };

    const unsub = onValue(playersRef, snap => {
      const data = snap.val() || {};
      const prevData = prevPlayersRef.current;

      // Monitor all players
      Object.keys(data).forEach(uid => {
        const p = data[uid];
        const prevP = prevData[uid];

        if (!prevP) {
          // Join event
          const pName = p.name || 'A Warrior';
          if (p.eventId) {
            const event = events.find(e => e.id === p.eventId);
            const eventName = event ? event.name : 'an event';
            addHistoryEvent(`${pName} has joined the ${eventName} event`, 'join');
          } else {
            addHistoryEvent(`${pName} has joined the lobby`, 'join');
          }
        } else {
          // Detect event join (while already in lobby)
          if (p.eventId && p.eventId !== prevP.eventId) {
            const pName = p.name || 'A Warrior';
            const event = events.find(e => e.id === p.eventId);
            const eventName = event ? event.name : 'an event';
            addHistoryEvent(`${pName} has joined the ${eventName} event`, 'join');
          }
          // Zone change
          if (p.zoneName && p.zoneName !== prevP.zoneName) {
            addHistoryEvent(`${p.name || 'A Warrior'} has reached ${p.zoneName.replace('_', ' ')}`, 'zone');
          }
          // Milestones
          const prevAlt = prevP.maxAlt || 0;
          const currAlt = p.maxAlt || 0;
          [5000, 10000, 15000, 20000, 25000, 30000].forEach(m => {
            if (currAlt >= m && prevAlt < m) {
              addHistoryEvent(`${p.name || 'A Warrior'} has reached ${m} meters!`, 'milestone');
            }
          });
        }
      });

      // Fallen events
      Object.keys(prevData).forEach(uid => {
        if (!data[uid]) {
          const prevP = prevData[uid];
          addHistoryEvent(`${prevP.name || 'A Warrior'} has fallen at ${prevP.maxAlt || 0}m`, 'fall');

          // Local fallen overlay (only for others)
          if (uid !== user.uid) {
            const id = Date.now() + Math.random();
            setFallenMessages(prev => [...prev.slice(-2), { id, name: prevP.name || 'A Warrior' }]);
            setTimeout(() => setFallenMessages(prev => prev.filter(m => m.id !== id)), 4000);
          }
        }
      });

      prevPlayersRef.current = data;
      const { [user.uid]: _, ...others } = data;
      ghostPlayersDataRef.current = others;
      setPlayerCount(Object.keys(data).length);
    });
    return () => unsub();
  }, [user?.uid, events]);

  // Scroll to game when starting on mobile/short screens
  useEffect(() => {
    if (gameState === 'playing' && containerRef.current) {
      // Small delay to ensure layout has settled
      setTimeout(() => {
        containerRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }, [gameState]);

  // Subscribe to leaderboard
  useEffect(() => {
    setLbLoading(true);

    if (lbMetric === 'runes' || lbMetric === 'redRunes') {
      // Fetch Current Balances from Firestore
      const usersRef = collection(db, 'users');
      const scoreField = lbMetric === 'redRunes' ? 'yggRedRunes' : 'yggRunes';
      const q = fsQuery(usersRef, orderBy(scoreField, 'desc'), limit(10));
      
      getDocs(q).then(snap => {
        const arr = snap.docs.map(docSnap => {
          const data = docSnap.data();
          return {
            uid: docSnap.id,
            name: resolveDisplayName(data),
            score: data[scoreField] || 0
          };
        });
        setLeaderboard(arr);
        setLbLoading(false);
      }).catch(err => {
        console.error(`Firestore ${lbMetric} LB error:`, err);
        setLbLoading(false);
      });
      return;
    }

    const base = 'leaderboard'; // For altitude
    let path;
    const now = new Date();

    if (lbMode === 'daily') {
      path = `yggdrasil/${base}/daily/${getDailySeed()}`;
    } else if (lbMode === 'weekly') {
      // Weekly logic: Sunday to Sunday (Align with homepage)
      const sunday = new Date(now);
      sunday.setDate(now.getDate() - now.getDay());
      const weekKey = sunday.toISOString().split('T')[0];
      path = `yggdrasil/${base}/weekly/${weekKey}`;
    } else if (lbMode === 'monthly') {
      const monthId = `${now.getUTCFullYear()}_m${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
      path = `yggdrasil/${base}/monthly/${monthId}`;
    } else {
      path = `yggdrasil/${base}/alltime`;
    }

    const lbRef = query(
      ref(database, path),
      orderByChild('score'),
      limitToLast(10)
    );

    const unsub = onValue(lbRef, async snap => {
      const arr = [];
      if (snap.exists()) {
        const uids = [];
        snap.forEach(child => {
          const val = child.val();
          if (val && typeof val.score === 'number') {
            arr.push({ uid: child.key, ...val });
            uids.push(child.key);
          }
        });

        // Resolve names from Firestore for all top players
        const currentCache = nameCacheRef.current;
        const newNames = {};
        let changed = false;

        await Promise.all(uids.map(async (uid) => {
          if (uid === user?.uid) {
            const myName = resolveDisplayName(user);
            if (currentCache[uid] !== myName) {
              newNames[uid] = myName;
              changed = true;
            }
            return;
          }
          if (!currentCache[uid]) {
            try {
              const uDoc = await getDoc(doc(db, 'users', uid));
              if (uDoc.exists()) {
                const resolved = resolveDisplayName(uDoc.data());
                newNames[uid] = resolved;
                changed = true;
              }
            } catch (err) {
              console.error("Error fetching leaderboard name:", err);
            }
          }
        }));

        if (changed) {
          const updatedCache = { ...currentCache, ...newNames };
          nameCacheRef.current = updatedCache;
          setNameCache(updatedCache);
        }
      }
      setLeaderboard(arr.reverse());
      setLbLoading(false);
    }, (error) => {
      console.error("Leaderboard read error:", error);
      setLbLoading(false);
    });

    return () => unsub();
  }, [lbMode, lbMetric, user]);


  // Publish presence
  const publishPresence = useCallback((x, y, maxAlt, zoneName) => {
    if (!user?.uid) return;
    const pRef = ref(database, `yggdrasil/players/${user.uid}`);

    const presenceData = {
      x, y,
      maxAlt,
      zoneName,
      name: resolveDisplayName(user),
      color: '#' + user.uid.slice(0, 6),
      t: Date.now(),
      eventId: activeEventId
    };

    if (currentEmoteRef.current && Date.now() - currentEmoteRef.current.t < 4000) {
      presenceData.emote = currentEmoteRef.current.emote;
      presenceData.emoteTime = currentEmoteRef.current.t;
    }

    set(pRef, presenceData);
  }, [user, activeEventId]);

  // Remove presence
  const removePresence = useCallback(() => {
    if (!user?.uid) return;
    remove(ref(database, `yggdrasil/players/${user.uid}`));
  }, [user]);

  // Subscribe to all players to count live participants per event
  useEffect(() => {
    const playersRef = ref(database, 'yggdrasil/players');
    const unsub = onValue(playersRef, snap => {
      const counts = {};
      if (snap.exists()) {
        snap.forEach(child => {
          const p = child.val();
          if (p.eventId) {
            counts[p.eventId] = (counts[p.eventId] || 0) + 1;
          }
        });
      }
      setEventLiveCounts(counts);
    });
    return () => unsub();
  }, []);

  // Submit score
  const submitScore = useCallback((finalScore, finalRunes) => {
    if (!user?.uid) return;
    const name = resolveDisplayName(user);
    const now = new Date();
    
    // Seed and date keys
    const seed = gameRef.current?.seed || getDailySeed();
    const sunday = new Date(now);
    sunday.setDate(now.getDate() - now.getDay());
    const weekKey = sunday.toISOString().split('T')[0];
    const monthId = `${now.getUTCFullYear()}_m${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

    const horizons = [
      `daily/${seed}`,
      `weekly/${weekKey}`,
      `monthly/${monthId}`,
      `alltime`
    ];

    const metrics = [
      { id: 'altitude', val: finalScore, base: 'leaderboard' },
      { id: 'runes', val: finalRunes, base: 'leaderboard_runes' }
    ];

    metrics.forEach(m => {
      if (m.val <= 0) return;
      
      horizons.forEach(hPath => {
        const scoreRef = ref(database, `yggdrasil/${m.base}/${hPath}/${user.uid}`);
        get(scoreRef).then(snap => {
          if (!snap.exists() || snap.val().score < m.val) {
            set(scoreRef, {
              name,
              score: m.val,
              t: Date.now()
            });
          }
        });
      });
    });
  }, [user]);

  // Init game
  const initGame = useCallback((eventOverride = undefined, upgradesOverride = null) => {
    const upgradesToUse = upgradesOverride || userUpgrades;
    const seed = getDailySeed();
    const rng = seededRandom(seed);
    const itemBandsUsed = new Set();
    const startPlats = generatePlatforms(80, CANVAS_H - 50, rng, 0, itemBandsUsed);
    // Add ground platform (full width, invisible floor)
    startPlats.push({ x: 0, y: CANVAS_H - 15, w: CANVAS_W, h: 20, type: 'ground', broken: false, moveDir: 1 });
    startPlats.sort((a, b) => b.y - a.y);


    const eventToUse = eventOverride !== undefined ? eventOverride : activeEvent;

    gameRef.current = {
      seed,
      player: {
        x: CANVAS_W / 2 - PLAYER_W / 2,
        y: CANVAS_H - 100, // spawn above ground
        vy: 0,
        vx: 0,
        isGrounded: true,
        squash: 1, // squash/stretch factor
        scaleX: 1,
        scaleY: 1,
        facing: 1, // 1 for right, -1 for left
        turboTime: 0,
        shopTurboCharges: upgradesToUse.extraTurbo || 0,
        freeTurboCharges: 0,
        shopTurbosUsed: 0,
        shopJumpCharges: upgradesToUse.extraJump || 0,
        freeJumpCharges: 0,
        shopJumpsUsed: 0,
        usedDoubleJumpInAir: false,
        mistTimer: 120 // 2 seconds survival in Nidhogg mist
      },
      platforms: startPlats,
      camera: 0,
      targetCamera: 0, // for smoothing
      maxAlt: 0,
      rng,
      platGenY: startPlats[0].y,
      lastPublish: 0,
      difficulty: 0,
      runes: 0,
      redRunes: 0,
      isEvent: !!eventToUse,
      isEventWithRedRunes: !!(eventToUse && eventToUse.redRunesEnabled),
      lastRedRuneAlt: 0,
      redRuneRunes: [], // separate array for red runes
      magnetism: (upgradesToUse.magnetismLevel || 0) === 1 ? 100 : (upgradesToUse.magnetismLevel || 0) === 2 ? 160 : (upgradesToUse.magnetismLevel || 0) === 3 ? 240 : 0,
      particles: [],
      windParticles: [], // decorative wind streaks
      itemBandsUsed,
      milestonesHit: new Set(),
      rewards: 0,
      shake: 0, // screen shake magnitude
      lastTime: performance.now(),
      lastHUDTime: 0,
      flashAlpha: 0, // for lightning/darkness
      goldenFlashAlpha: 0, // for apple respawn
      weatherType: 'clear', // clear, thunderstorm, cosmic
      thunderState: 'none', // none, warning, flashing
      thunderTimer: 0,
      thunderCount: 0,
      lastThunderTime: 0,
      hasIdunApple: upgradesToUse.hasIdunApple,
      appleUsedInRun: false,
      lastRuneAlt: 0, // first spawn at 3000m
      // ═══ NIDHOGG'S RISING MIST ═══
      nidhogg: {
        y: CANVAS_H + 200, // starts well below screen
        speed: NIDHOGG_BASE_SPEED,
        graceTimer: NIDHOGG_GRACE_PERIOD,
        active: false,
        mistParticles: []
      },
      // ═══ RATATOSKR THE MESSENGER ═══
      ratatoskr: null, // { x, y, platformId, direction, speed, alive }
      lastRatatoskrAlt: 0, // altitude of last spawn
      ratatoskrCooldown: 3000 + Math.floor(rng() * 2000), // 3k-5k alt between spawns
      floatingRunes: [],
      stars: Array.from({ length: 40 }, () => ({
        x: rng() * CANVAS_W,
        y: rng() * CANVAS_H * 3,
        size: 1 + rng() * 1
      })),
      specialPrize: (eventToUse && (eventToUse.currentPool || 0) >= (eventToUse.targetPool || 0)) ? {
        x: CANVAS_W / 2 - 18,
        y: -eventToUse.targetAltitude * 4,
        w: 36,
        h: 36,
        collected: false,
        name: eventToUse.prizeName,
        image: null // will be loaded
      } : null
    };

    // Load special prize image if needed
    if (gameRef.current.specialPrize) {
      const prizeImg = new Image();
      prizeImg.src = eventToUse.prizeImage;
      prizeImg.onload = () => {
        if (gameRef.current?.specialPrize) {
          gameRef.current.specialPrize.image = prizeImg;
        }
      };
    }

    gameRef.current.magnetism = (upgradesToUse.magnetismLevel || 0) === 1 ? 100 : (upgradesToUse.magnetismLevel || 0) === 2 ? 160 : (upgradesToUse.magnetismLevel || 0) === 3 ? 240 : 0;
    gameRef.current.hasIdunApple = upgradesToUse.hasIdunApple;

    setRunesCollected(0);
    setRedRunesCollected(0);
    setRunStats(null);
    
    setShopTurboCharges(upgradesToUse.extraTurbo || 0);
    setFreeTurboCharges(0);
    setShopJumpCharges(upgradesToUse.extraJump || 0);
    setFreeJumpCharges(0);
    
    setAppleUsedInRun(false);
    setNidhoggWarning(false);
    setRatatoskrNotif(null);
    setDeathReason(null);
    keysRef.current = {};
    touchRef.current = { left: false, right: false, jump: false };
    setJoystickX(0);
  }, [activeEvent, userUpgrades]);

  const handleJoystickTouch = (e) => {
    if (!joystickMode) return;
    if (e.cancelable) e.preventDefault();
    
    let touch = null;
    if (e.type === 'touchstart') {
      touch = e.changedTouches[0];
      joystickTouchIdRef.current = touch.identifier;
    } else {
      // Find the touch that matches our joystick finger
      for (let i = 0; i < e.touches.length; i++) {
        if (e.touches[i].identifier === joystickTouchIdRef.current) {
          touch = e.touches[i];
          break;
        }
      }
    }
    
    if (!touch) return;

    const area = e.currentTarget.getBoundingClientRect();
    const centerX = area.left + area.width / 2;
    const centerY = area.top + area.height / 2;
    let dx = touch.clientX - centerX;
    let dy = touch.clientY - centerY;
    
    const dist = Math.sqrt(dx * dx + dy * dy);
    const maxDist = area.width / 2 - 20; 
    
    if (dist > maxDist) {
      dx *= maxDist / dist;
      dy *= maxDist / dist;
    }
    
    setJoystickX(dx);
    setJoystickY(dy);
    
    if (dx > 10) {
      touchRef.current.right = true;
      touchRef.current.left = false;
    } else if (dx < -10) {
      touchRef.current.left = true;
      touchRef.current.right = false;
    } else {
      touchRef.current.left = false;
      touchRef.current.right = false;
    }
  };

  const handleJoystickEnd = (e) => {
    if (e.cancelable) e.preventDefault();
    joystickTouchIdRef.current = null;
    setJoystickX(0);
    setJoystickY(0);
    touchRef.current.left = false;
    touchRef.current.right = false;
  };

  // Game loop
  const gameLoop = useCallback(() => {
    const g = gameRef.current;
    const canvas = canvasRef.current;
    if (!g || !canvas) return;
    const currentAssets = assetsRef.current;
    const ctx = canvas.getContext('2d');

    const p = g.player;

    const now = performance.now();
    const dt = Math.min(3, (now - g.lastTime) / 16.66); // Normalize to 60fps
    g.lastTime = now;

    // Horizontal Movement
    let targetVx = 0;
    const currentAlt = Math.floor(-p.y / 4);
    let speedMult = 1.0;

    // Clouds - slow speed (1k-3k)
    if (currentAlt >= 1000 && currentAlt < 3000) {
      speedMult = 0.65;
    }

    if (keysRef.current['ArrowLeft'] || keysRef.current['KeyA'] || touchRef.current.left) {
      targetVx = -MOVE_SPEED * speedMult;
      p.facing = -1;
    } else if (keysRef.current['ArrowRight'] || keysRef.current['KeyD'] || touchRef.current.right) {
      targetVx = MOVE_SPEED * speedMult;
      p.facing = 1;
    }

    // Default friction (snappy stop)
    let friction = 0.25;
    // Bifrost slippery physics (3k-5k) — only when grounded on a platform
    const inBifrost = currentAlt >= 3000 && currentAlt < 5000;
    if (inBifrost && p.isGrounded) {
      friction = 0.04; // Very slippery on platforms
      // Slight idle drift when standing still
      if (targetVx === 0 && Math.abs(p.vx) < 0.3) {
        p.vx += (Math.sin(now / 800) * 0.08) * dt;
      }
    }

    // Cosmic Winds - Wind effect (7k-9k)
    if (currentAlt >= 7000 && currentAlt < 9000) {
      // Windy weather: Base wind that shifts slowly + chaotic gusts
      const baseWind = Math.sin(now / 4000) * 0.14;
      const gust = Math.sin(now / 500) * 0.12 * (Math.sin(now / 1200) > 0.3 ? 1 : 0);
      p.vx += (baseWind + gust) * dt;
      friction = 0.12; // Harder to stabilize in the wind
    }

    p.vx += (targetVx - p.vx) * friction * dt;
    p.x += p.vx * dt;

    // Screen wrap
    if (p.x + PLAYER_W < 0) p.x = CANVAS_W;
    if (p.x > CANVAS_W) p.x = -PLAYER_W;

    // Manual jump logic
    const jumpPressed = keysRef.current['Space'] || keysRef.current['ArrowUp'] || touchRef.current.jump;
    const lastJumpPressed = keysRef.current['lastJump'] || false;

    if (jumpPressed) {
      if (p.isGrounded) {
        p.vy = JUMP_FORCE;
        p.isGrounded = false;
        p.usedDoubleJumpInAir = false; // reset for fresh jump
      } else if (!lastJumpPressed && (p.shopJumpCharges > 0 || p.freeJumpCharges > 0) && !p.usedDoubleJumpInAir && !turboMomentumRef.current && p.turboTime <= 0) {
        p.vy = JUMP_FORCE * 1.1; // HIGH JUMP!
        
        // Prioritize free jumps
        if (p.freeJumpCharges > 0) {
          p.freeJumpCharges--;
          setFreeJumpCharges(p.freeJumpCharges);
        } else if (p.shopJumpCharges > 0) {
          p.shopJumpCharges--;
          p.shopJumpsUsed = (p.shopJumpsUsed || 0) + 1;
          setShopJumpCharges(p.shopJumpCharges);
        }

        p.usedDoubleJumpInAir = true;
        setJumpUsed(true);
        setTimeout(() => setJumpUsed(false), 1000);
        for (let di = 0; di < 6; di++) {
          g.particles.push({
            x: p.x + PLAYER_W / 2 + (Math.random() - 0.5) * 20, y: p.y + PLAYER_H,
            vx: (Math.random() - 0.5) * 3, vy: 1 + Math.random() * 2,
            life: 15, color: '#60a5fa', size: 3
          });
        }
      }
    }
    keysRef.current['lastJump'] = jumpPressed;

    // Turbo activation (anytime)
    const turboPressed = keysRef.current['ShiftLeft'] || keysRef.current['ShiftRight'] || keysRef.current['KeyE'] || touchRef.current.turbo;
    const lastTurboPressed = keysRef.current['lastTurbo'] || false;

    if (turboPressed && !lastTurboPressed && (p.shopTurboCharges > 0 || p.freeTurboCharges > 0) && p.turboTime <= 0) {
      // Prioritize free turbos
      if (p.freeTurboCharges > 0) {
        p.freeTurboCharges--;
        setFreeTurboCharges(p.freeTurboCharges);
      } else if (p.shopTurboCharges > 0) {
        p.shopTurboCharges--;
        p.shopTurbosUsed = (p.shopTurbosUsed || 0) + 1;
        setShopTurboCharges(p.shopTurboCharges);
      }
      
      p.turboTime = 60; // 1 second
      g.shake = 10;
      turboMomentumRef.current = true;
      setTurboUsed(true);
      setTimeout(() => setTurboUsed(false), 1000);
    }
    keysRef.current['lastTurbo'] = turboPressed;

    // Physics
    let currentGravity = GRAVITY;

    if (currentAlt >= 9000) {
      g.weatherType = 'asgard';
    } else if (currentAlt >= 7000) {
      g.weatherType = 'cosmic';
      currentGravity = GRAVITY * 0.6; // Lower gravity
    } else if (currentAlt >= 5000) {
      g.weatherType = 'thunderstorm';
      // Thunderclap trigger with 4-6s cooldown (Reduced from 5-7s)
      const cooldown = 4000 + (g.rng ? g.rng() : Math.random()) * 2000;
      if (now - g.lastThunderTime > cooldown && Math.random() < 0.01 && g.thunderState === 'none') {
        g.thunderState = 'warning';
        g.thunderTimer = 0;
        g.flashAlpha = 0;
        g.shake = 15;
        g.lastThunderTime = now;
      }
    } else if (currentAlt >= 3000) {
      g.weatherType = 'bifrost';
    } else if (currentAlt >= 1000) {
      g.weatherType = 'clouds';
    } else {
      g.weatherType = 'clear'; // Midgard (0-1k)
    }

    // Thunderstorm Flickering logic
    if (g.thunderState === 'warning') {
      g.thunderTimer += dt;
      g.flashAlpha = Math.min(0.85, g.thunderTimer / 60); // Slowly get dark over 1s
      if (g.flashAlpha >= 0.85) {
        g.thunderState = 'flashing';
        g.thunderTimer = 0;
        g.thunderCount = 0;
      }
    } else if (g.thunderState === 'flashing') {
      g.thunderTimer += dt;
      // 3 rapid flashes (black to semi-transparent)
      const flashPeriod = 8;
      const isVisible = Math.floor(g.thunderTimer / flashPeriod) % 2 === 0;
      g.flashAlpha = isVisible ? 0.95 : 0.3;

      if (g.thunderTimer > flashPeriod * 6) { // 3 cycles (on/off)
        g.thunderState = 'fade';
      }
    } else if (g.thunderState === 'fade') {
      g.flashAlpha -= 0.02 * dt;
      if (g.flashAlpha <= 0) {
        g.flashAlpha = 0;
        g.thunderState = 'none';
      }
    }

    // Apple Respawn Golden Flash decrement
    if (g.goldenFlashAlpha > 0) {
      g.goldenFlashAlpha -= 0.015 * dt;
      if (g.goldenFlashAlpha < 0) g.goldenFlashAlpha = 0;
    }

    // Vertical Physics
    if (p.turboTime > 0) {
      p.vy = BOOST_FORCE * 1.5; // Sustain high speed during turbo
      p.isGrounded = false;
    } else {
      p.vy += currentGravity * dt;
    }
    p.y += p.vy * dt;
    if (p.turboTime <= 0) p.isGrounded = false;

    // Platform Collision (only when falling)
    if (p.vy >= 0) {
      for (const plat of g.platforms) {
        if (plat.broken) continue;
        if (p.y + PLAYER_H > plat.y && p.y + PLAYER_H < plat.y + plat.h + 10 &&
          p.x + PLAYER_W * 0.8 > plat.x && p.x + PLAYER_W * 0.2 < plat.x + plat.w) {

          p.y = plat.y - PLAYER_H;
          p.isGrounded = true;

          if (plat.type === 'boost') {
            p.vy = BOOST_FORCE;
            p.isGrounded = false;
            p.squash = 0.5;
            g.shake = 5;
          } else {
            p.vy = 0;
            p.isGrounded = true;
            p.usedDoubleJumpInAir = false; // Reset on landing
            p.squash = 0.9;
          }

          if (plat.type === 'fragile' && !plat.activated) {
            plat.activated = true;
            plat.activatedTime = Date.now(); // Start 2s flicker countdown
          }

          if (p.squash === 1) {
            p.squash = 0.85; // squash on landing
            // Spawn landing dust
            for (let di = 0; di < 6; di++) {
              g.particles.push({
                x: p.x + PLAYER_W / 2 + (Math.random() - 0.5) * 30,
                y: plat.y,
                vx: (Math.random() - 0.5) * 2,
                vy: -Math.random() * 1,
                life: 20,
                color: 'rgba(255, 255, 255, 0.5)',
                size: 2 + Math.random() * 2
              });
            }
          }

          if (plat.type === 'boost') {
            p.vy = BOOST_FORCE;
            p.isGrounded = false;
            g.shake = 8;
          }
          break;
        }
      }
    }

    // Item Collection
    for (const plat of g.platforms) {
      if (plat.item && !plat.itemCollected) {
        // Simple circular collision check with item (assume center of platform)
        const ix = plat.x + plat.w / 2;
        const iy = plat.y - 20;
        const dx = (p.x + PLAYER_W / 2) - ix;
        const dy = (p.y + PLAYER_H / 2) - iy;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 40) {
          const isTurbo = plat.item === 'turbo';
          const isJump = plat.item === 'doubleJump';
          const atMax = isTurbo 
            ? (p.shopTurboCharges + p.freeTurboCharges) >= 3 
            : (p.shopJumpCharges + p.freeJumpCharges) >= 5;

          if (atMax) {
            // Don't collect — item stays visible
            // Skip collection entirely
          } else {
            plat.itemCollected = true;
            if (isTurbo) {
              p.freeTurboCharges = (p.freeTurboCharges || 0) + 1;
              setFreeTurboCharges(p.freeTurboCharges);
            } else if (isJump) {
              p.freeJumpCharges = (p.freeJumpCharges || 0) + 1;
              setFreeJumpCharges(p.freeJumpCharges);
            }
            // Collect effect
            for (let i = 0; i < 10; i++) {
              g.particles.push({
                x: ix, y: iy, vx: (Math.random() - 0.5) * 5, vy: (Math.random() - 0.5) * 5,
                life: 20, color: plat.item === 'turbo' ? '#fbbf24' : '#60a5fa', size: 3
              });
            }
          }
        }
      }
    }

    // Rune collection & Magnetism
    for (const plat of g.platforms) {
      if (!plat.hasRune || plat.runeCollected || plat.broken) continue;

      // Initialize rune offsets for magnetism visual
      if (plat.runeOffX === undefined) {
        plat.runeOffX = 0;
        plat.runeOffY = 0;
      }

      let runeX = plat.x + plat.w / 2 + plat.runeOffX;
      let runeY = plat.y - 20 + plat.runeOffY;

      // Magnetism pull
      if (g.magnetism > 0) {
        const dx = (p.x + PLAYER_W / 2) - runeX;
        const dy = (p.y + PLAYER_H / 2) - runeY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < g.magnetism) {
          // Move rune toward player — stronger pull when closer
          const closeness = 1 - (dist / g.magnetism); // 0 at edge, 1 when on top
          const pullForce = (2.5 + closeness * 10.0) * dt;
          plat.runeOffX += (dx / dist) * pullForce;
          plat.runeOffY += (dy / dist) * pullForce;
          runeX = plat.x + plat.w / 2 + plat.runeOffX;
          runeY = plat.y - 20 + plat.runeOffY;

          // Magnetism Sparkles
          if (Math.random() < 0.15) {
            g.particles.push({
              x: runeX, y: runeY,
              vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2,
              life: 15, color: '#fbbf24', size: 2
            });
          }
        } else {
          // Snap back slowly if out of range
          plat.runeOffX *= 0.95;
          plat.runeOffY *= 0.95;
        }
      }

      if (
        p.x + PLAYER_W > runeX - RUNE_SIZE / 2 &&
        p.x < runeX + RUNE_SIZE / 2 &&
        p.y + PLAYER_H > runeY - RUNE_SIZE / 2 &&
        p.y < runeY + RUNE_SIZE / 2
      ) {
        plat.runeCollected = true;
        g.runes++;
        setRunesCollected(g.runes);
        // Spawn particles
        for (let pi = 0; pi < 8; pi++) {
          g.particles.push({
            x: runeX, y: runeY,
            vx: (Math.random() - 0.5) * 4,
            vy: (Math.random() - 0.5) * 4 - 2,
            life: 30,
            color: '#fbbf24',
            size: 3
          });
        }
      }

    }

    // Floating Rune collection & Magnetism
    for (const fr of g.floatingRunes) {
      if (fr.collected) continue;

      let runeX = fr.x + (fr.offX || 0);
      let runeY = fr.y + (fr.offY || 0);

      // Magnetism pull
      if (g.magnetism > 0) {
        const dx = (p.x + PLAYER_W / 2) - runeX;
        const dy = (p.y + PLAYER_H / 2) - runeY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < g.magnetism) {
          const closeness = 1 - (dist / g.magnetism);
          const pullForce = (2.5 + closeness * 10.0) * dt;
          fr.offX = (fr.offX || 0) + (dx / dist) * pullForce;
          fr.offY = (fr.offY || 0) + (dy / dist) * pullForce;
          runeX = fr.x + fr.offX;
          runeY = fr.y + fr.offY;

          // Magnetism Sparkles
          if (Math.random() < 0.15) {
            g.particles.push({
              x: runeX, y: runeY,
              vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2,
              life: 15, color: '#fbbf24', size: 2
            });
          }
        } else {
          fr.offX = (fr.offX || 0) * 0.95;
          fr.offY = (fr.offY || 0) * 0.95;
        }
      }

      if (
        p.x + PLAYER_W > runeX - RUNE_SIZE / 2 &&
        p.x < runeX + RUNE_SIZE / 2 &&
        p.y + PLAYER_H > runeY - RUNE_SIZE / 2 &&
        p.y < runeY + RUNE_SIZE / 2
      ) {
        fr.collected = true;
        g.runes += 1;
        setRunesCollected(g.runes);
        for (let pi = 0; pi < 8; pi++) {
          g.particles.push({
            x: runeX, y: runeY,
            vx: (Math.random() - 0.5) * 4,
            vy: (Math.random() - 0.5) * 4 - 2,
            life: 30, color: '#fbbf24', size: 3
          });
        }
      }
    }

    // Red Rune collection & Magnetism (event-only)
    if (g.isEventWithRedRunes) {
      for (const rr of g.redRuneRunes) {
        if (rr.collected) continue;

        let runeX = rr.x + (rr.offX || 0);
        let runeY = rr.y + (rr.offY || 0);

        // Magnetism pull (Red Runes are heavier, 70% effective magnetism)
        if (g.magnetism > 0) {
          const dx = (p.x + PLAYER_W / 2) - runeX;
          const dy = (p.y + PLAYER_H / 2) - runeY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const rrMagnetRange = g.magnetism * 0.5;
          if (dist < rrMagnetRange) {
            const closeness = 1 - (dist / rrMagnetRange);
            const pullForce = (2.5 + closeness * 10.0) * dt * 0.5;
            rr.offX = (rr.offX || 0) + (dx / dist) * pullForce;
            rr.offY = (rr.offY || 0) + (dy / dist) * pullForce;
            runeX = rr.x + rr.offX;
            runeY = rr.y + rr.offY;

            // Red magnetism sparkles
            if (Math.random() < 0.15) {
              g.particles.push({
                x: runeX, y: runeY,
                vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2,
                life: 15, color: '#ef4444', size: 2
              });
            }
          } else {
            rr.offX = (rr.offX || 0) * 0.95;
            rr.offY = (rr.offY || 0) * 0.95;
          }
        }

        if (
          p.x + PLAYER_W > runeX - RUNE_SIZE / 2 &&
          p.x < runeX + RUNE_SIZE / 2 &&
          p.y + PLAYER_H > runeY - RUNE_SIZE / 2 &&
          p.y < runeY + RUNE_SIZE / 2
        ) {
          rr.collected = true;
          g.redRunes += 1;
          setRedRunesCollected(g.redRunes);
          for (let pi = 0; pi < 10; pi++) {
            g.particles.push({
              x: runeX, y: runeY,
              vx: (Math.random() - 0.5) * 5,
              vy: (Math.random() - 0.5) * 5 - 2,
              life: 35, color: '#ef4444', size: 4
            });
          }
        }
      }
    }

    // Death Spirit collection
    if (g.globalSpirits) {
      for (const [id, s] of Object.entries(g.globalSpirits)) {
        if (s.uid === user?.uid) continue; // Can't collect own spirit

        // Magnetism for spirits (80% effective range)
        let sx = s.x + (s.offX || 0);
        let sy = s.y + (s.offY || 0);
        if (g.magnetism > 0) {
          const dx = (p.x + PLAYER_W / 2) - sx;
          const dy = (p.y + PLAYER_H / 2) - sy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < g.magnetism * 0.8) {
            const closeness = 1 - (dist / (g.magnetism * 0.8));
            const pullForce = (2.0 + closeness * 6.0) * dt;
            s.offX = (s.offX || 0) + (dx / dist) * pullForce;
            s.offY = (s.offY || 0) + (dy / dist) * pullForce;
            sx = s.x + s.offX;
            sy = s.y + s.offY;
            if (Math.random() < 0.1) {
              g.particles.push({
                x: sx, y: sy, vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2,
                life: 15, color: '#a855f7', size: 2
              });
            }
          } else {
            s.offX = (s.offX || 0) * 0.95;
            s.offY = (s.offY || 0) * 0.95;
          }
        }

        const dx = (p.x + PLAYER_W / 2) - sx;
        const dy = (p.y + PLAYER_H / 2) - sy;
        if (Math.sqrt(dx * dx + dy * dy) < 40) {
          // Collect!
          remove(ref(database, `yggdrasil/spirits/${id}`));
          const isTurbo = Math.random() > 0.5;
          let granted = false;
          if (isTurbo) {
            if ((p.shopTurboCharges + p.freeTurboCharges) < 3) {
              p.freeTurboCharges = (p.freeTurboCharges || 0) + 1;
              setFreeTurboCharges(p.freeTurboCharges);
              granted = true;
            }
          } else {
            if ((p.shopJumpCharges + p.freeJumpCharges) < 5) {
              p.freeJumpCharges = (p.freeJumpCharges || 0) + 1;
              setFreeJumpCharges(p.freeJumpCharges);
              granted = true;
            }
          }
          if (granted) {
            setRatatoskrNotif(`Spirit Blessing: +1 ${isTurbo ? 'Turbo' : 'Jump'}!`);
          } else {
            setRatatoskrNotif(`Spirit Absorbed! (${isTurbo ? 'Turbo' : 'Jump'} at MAX)`);
          }
          setTimeout(() => setRatatoskrNotif(null), 2500);
          for (let i = 0; i < 15; i++) {
            g.particles.push({
              x: s.x + (s.offX || 0), y: s.y + (s.offY || 0), vx: (Math.random() - 0.5) * 8, vy: (Math.random() - 0.5) * 8,
              life: 40, color: '#a855f7', size: 4
            });
          }
        }
      }
    }

    // Special Prize collision
    if (g.specialPrize && !g.specialPrize.collected) {
      const sp = g.specialPrize;
      
      // Magnetism for Special Prize (50% range)
      let spx = sp.x + (sp.offX || 0);
      let spy = sp.y + (sp.offY || 0);
      if (g.magnetism > 0) {
        const dx = (p.x + PLAYER_W / 2) - (spx + sp.w / 2);
        const dy = (p.y + PLAYER_H / 2) - (spy + sp.h / 2);
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < g.magnetism * 0.5) {
          const closeness = 1 - (dist / (g.magnetism * 0.5));
          const pullForce = (1.5 + closeness * 5.0) * dt;
          sp.offX = (sp.offX || 0) + (dx / dist) * pullForce;
          sp.offY = (sp.offY || 0) + (dy / dist) * pullForce;
          spx = sp.x + sp.offX;
          spy = sp.y + sp.offY;
          if (Math.random() < 0.2) {
            g.particles.push({
              x: spx + sp.w / 2, y: spy + sp.h / 2, 
              vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.5) * 3,
              life: 20, color: '#fbbf24', size: 3
            });
          }
        } else {
          sp.offX = (sp.offX || 0) * 0.95;
          sp.offY = (sp.offY || 0) * 0.95;
        }
      }

      if (
        p.x + PLAYER_W > spx &&
        p.x < spx + sp.w &&
        p.y + PLAYER_H > spy &&
        p.y < spy + sp.h
      ) {
        sp.collected = true;
        setEventPrizeCaught(sp.name);
        claimYggdrasilEventPrize(activeEventIdRef.current, Math.floor(-sp.y / 4)).then(res => {
          if (res.success) {
            console.log('Prize claimed successfully!');
          }
        });
        // Sparkle particles
        for (let i = 0; i < 20; i++) {
          g.particles.push({
            x: sp.x + sp.w / 2, y: sp.y + sp.h / 2,
            vx: (Math.random() - 0.5) * 8,
            vy: (Math.random() - 0.5) * 8,
            life: 40,
            color: '#fbbf24',
            size: 4
          });
        }
      }
    }

    // Moving & Vanishing platforms
    for (const plat of g.platforms) {
      if (plat.broken) continue;

      // Moving logic
      if (plat.isMoving) {
        let platSpeedMult = 1.0;
        // Asgard - Faster platforms every 2k meters (starts at 9k)
        if (currentAlt >= 9000) {
          const asgardProgress = Math.floor((currentAlt - 9000) / 2000);
          platSpeedMult = 1.0 + (asgardProgress * 0.15); // Reduced from 0.4
        }

        // Reduced difficulty factor from 3 to 2.5
        const rawSpeed = 1.5 * (1 + g.difficulty * 2.5) * platSpeedMult;
        // Hard cap at 6.0 to ensure platforms are catchable (Player MOVE_SPEED is 6.5)
        const speed = Math.min(6.0, rawSpeed) * dt;
        const oldX = plat.x;
        const oldY = plat.y;

        if (plat.moveType === 'vertical') {
          plat.y += plat.moveDir * speed;
          if (plat.y < plat.baseY - 60) {
            plat.y = plat.baseY - 60;
            plat.moveDir = 1;
          } else if (plat.y > plat.baseY + 60) {
            plat.y = plat.baseY + 60;
            plat.moveDir = -1;
          }
        } else if (plat.moveType === 'circular') {
          plat.angle += (speed / plat.radius) * plat.moveDir;
          plat.x = plat.baseX + Math.cos(plat.angle) * plat.radius;
          plat.y = plat.baseY + Math.sin(plat.angle) * plat.radius;
        } else {
          plat.x += plat.moveDir * speed;
          if (plat.x < 0) {
            plat.x = 0;
            plat.moveDir = 1;
          } else if (plat.x + plat.w > CANVAS_W) {
            plat.x = CANVAS_W - plat.w;
            plat.moveDir = -1;
          }
        }

        // Robust Ride-along logic: If player is grounded and on this platform, move them by the same delta
        if (p.isGrounded && p.y + PLAYER_H >= oldY - 5 && p.y + PLAYER_H <= oldY + PLAT_H + 5) {
          // Check horizontal bounds with a small buffer
          if (p.x + PLAYER_W * 0.7 > oldX && p.x + PLAYER_W * 0.3 < oldX + plat.w) {
            p.x += (plat.x - oldX);
            p.y += (plat.y - oldY);
          }
        }
      }

      // Vanishing logic (Platform 2 / Fragile) - 2s flicker then break
      if (plat.type === 'fragile') {
        if (plat.activated && plat.activatedTime) {
          const age = Date.now() - plat.activatedTime;
          if (age > 2000) {
            plat.broken = true; // Vanish after 2 seconds!
          }
        }
      }
    }

    // Camera smoothing
    const altitudeTarget = CANVAS_H * 0.4;
    if (p.y < g.targetCamera + altitudeTarget) {
      g.targetCamera = p.y - altitudeTarget;
    }
    g.camera += (g.targetCamera - g.camera) * 0.15 * dt; // smooth interpolation

    // Screen shake decay
    if (g.shake > 0) {
      g.shake *= 0.9;
    }

    // Turbo decay
    if (p.turboTime > 0) {
      p.turboTime -= 1 * dt;
      // Update React state for the turbo bar HUD (throttled)
      if (now - g.lastHUDTime > 66) {
        setTurboTime(p.turboTime);
      }
      // Spawn turbo particles (trail) - Reduced rate for performance
      if (Math.random() < 0.4) {
        g.particles.push({
          x: p.x + PLAYER_W / 2 + (Math.random() - 0.5) * 20,
          y: p.y + PLAYER_H - 10,
          vx: (Math.random() - 0.5) * 2,
          vy: 3 + Math.random() * 3,
          life: 15,
          color: Math.random() > 0.5 ? '#ef4444' : '#fbbf24',
          size: 2
        });
      }
    } else if (p.turboTime <= 0 && now - g.lastHUDTime > 66) {
      setTurboTime(0);
    }

    // Altitude
    const alt = Math.max(0, Math.floor(-g.camera / 4));
    if (alt > g.maxAlt) g.maxAlt = alt;
    g.difficulty = Math.min(1, alt / 12000); // Steeper curve: reaches max at 12k

    // Milestones removed; handled on Game Over

    // Dynamic Weather Particles
    const maxWeather = alt > 10000 ? 30 : alt > 5000 ? 25 : 15;
    if (g.windParticles.length < maxWeather) {
      let wColor = 'rgba(255,255,255,0.1)';
      let wSize = 1;
      let wSpeed = 5 + Math.random() * 5;
      let wType = 'line';

      if (alt < 1000) { // Midgard Leaves (0-1k)
        wColor = Math.random() > 0.5 ? 'rgba(34, 197, 94, 0.4)' : 'rgba(21, 128, 61, 0.4)';
        wType = 'leaf';
      } else if (alt < 3000) { // Cloud Mist (1k-3k)
        wColor = 'rgba(255, 255, 255, 0.1)';
        wType = 'mist';
        wSize = 20 + Math.random() * 40;
        wSpeed = 1 + Math.random() * 2;
      } else if (alt < 5000) { // Bifrost Sparks (3k-5k)
        wColor = `hsla(${Math.random() * 360}, 70%, 70%, 0.4)`;
        wType = 'spark';
      } else { // Thunderstorm+ Gold Dust (5k+)
        wColor = 'rgba(251, 191, 36, 0.3)';
        wType = 'dust';
      }

      g.windParticles.push({
        x: Math.random() * CANVAS_W,
        y: g.camera - 100,
        speed: wSpeed,
        len: 10 + Math.random() * 20,
        color: wColor,
        type: wType,
        size: wSize
      });
    }
    g.windParticles.forEach(w => w.y += w.speed);
    g.windParticles = g.windParticles.filter(w => w.y < g.camera + CANVAS_H + 100);

    // Update particles
    g.particles = g.particles.filter(pt => {
      pt.x += pt.vx;
      pt.y += pt.vy;
      pt.life--;
      return pt.life > 0;
    });

    // Generate more platforms
    while (g.platGenY > g.camera - 200) {
      const prevGenY = g.platGenY;
      const newPlats = generatePlatforms(20, g.platGenY, g.rng, g.difficulty, g.itemBandsUsed);
      g.platforms.push(...newPlats);
      g.platGenY = newPlats[newPlats.length - 1].y;

      // Generate floating runes based on generator altitude (genAlt) - Only during events
      const genAlt = Math.floor(-g.platGenY / 4);
      if (g.isEvent && genAlt >= 1000 && genAlt - g.lastRuneAlt >= 1000) {
        const newFloatingRunes = generateFloatingRunes(g.platGenY, prevGenY, g.rng);
        g.floatingRunes.push(...newFloatingRunes);
        g.lastRuneAlt = genAlt;
      }

      // Generate red runes (event-only, per-player random)
      if (g.isEventWithRedRunes && genAlt >= 500 && genAlt - g.lastRedRuneAlt >= 1000) {
        const newRedRunes = generateRedRunes(g.platGenY, prevGenY);
        g.redRuneRunes.push(...newRedRunes);
        g.lastRedRuneAlt = genAlt;
      }
    }

    // Cull old platforms
    g.platforms = g.platforms.filter(pl => pl.y < g.camera + CANVAS_H + 100);
    g.floatingRunes = g.floatingRunes.filter(fr => fr.y < g.camera + CANVAS_H + 1000);
    if (g.isEventWithRedRunes) {
      g.redRuneRunes = g.redRuneRunes.filter(rr => rr.y < g.camera + CANVAS_H + 1000);
    }

    // ═══ NIDHOGG'S RISING MIST ═══
    const nh = g.nidhogg;
    if (nh.graceTimer > 0) {
      nh.graceTimer -= dt;
    } else {
      nh.active = true;
      // 1. Passive Acceleration (Capped)
      if (nh.speed < NIDHOGG_MAX_SPEED) {
        nh.speed += NIDHOGG_ACCEL * dt;
      }
      
      // 2. Proximity Surge (Temporary boost, NOT permanent acceleration)
      let currentMistSpeed = nh.speed;
      const distToMist = p.y - nh.y;
      if (distToMist < 300 && distToMist > 0) {
        currentMistSpeed += NIDHOGG_STALL_BOOST * (1 - distToMist / 300);
      }
      
      nh.y -= currentMistSpeed * dt;
      const cameraBottom = g.camera + CANVAS_H;
      if (nh.y > cameraBottom + 400) {
        nh.y = cameraBottom + 400;
      }
      if (Math.random() < 0.3) {
        nh.mistParticles.push({
          x: Math.random() * CANVAS_W,
          y: nh.y + Math.random() * 40,
          vx: (Math.random() - 0.5) * 2,
          vy: -0.5 - Math.random() * 1.5,
          life: 40 + Math.random() * 30,
          size: 4 + Math.random() * 8
        });
      }
      nh.mistParticles = nh.mistParticles.filter(mp => {
        mp.x += mp.vx;
        mp.y += mp.vy;
        mp.life--;
        return mp.life > 0;
      });
    }
    const mistDist = p.y - nh.y;
    if (nh.active && mistDist < 500 && mistDist > 0) {
      if (now - g.lastHUDTime > 66) setNidhoggWarning(true);
    } else {
      if (now - g.lastHUDTime > 66) setNidhoggWarning(false);
    }

    // ═══ RATATOSKR THE MESSENGER ═══
    if (!g.ratatoskr && alt - g.lastRatatoskrAlt >= g.ratatoskrCooldown) {
      const visiblePlats = g.platforms.filter(pl =>
        !pl.broken && pl.type !== 'ground' && (pl.type === 'standard' || pl.type === 'moving') &&
        pl.y > g.camera && pl.y < g.camera + CANVAS_H - 50
      );
      if (visiblePlats.length > 0) {
        const plat = visiblePlats[Math.floor(g.rng() * visiblePlats.length)];
        const dir = g.rng() < 0.5 ? 1 : -1;
        g.ratatoskr = {
          x: dir === 1 ? plat.x - RATATOSKR_W : plat.x + plat.w,
          y: plat.y - RATATOSKR_H,
          direction: dir,
          speed: RATATOSKR_SPEED + g.rng() * 2,
          alive: true,
          animFrame: 0
        };
        g.lastRatatoskrAlt = alt;
        g.ratatoskrCooldown = 3000 + Math.floor(g.rng() * 2000);
      }
    }
    if (g.ratatoskr && g.ratatoskr.alive) {
      const rat = g.ratatoskr;
      rat.x += rat.direction * rat.speed * dt;
      rat.animFrame += dt * 0.3;
      if (rat.x > CANVAS_W + 20 || rat.x < -RATATOSKR_W - 20) {
        g.ratatoskr = null;
      } else {
        const rdx = (p.x + PLAYER_W / 2) - (rat.x + RATATOSKR_W / 2);
        const rdy = (p.y + PLAYER_H / 2) - (rat.y + RATATOSKR_H / 2);
        const rdist = Math.sqrt(rdx * rdx + rdy * rdy);
        if (rdist < 35) {
          rat.alive = false;
          const reward = yggConfig.ratatoskrReward ?? 5;
          g.runes += reward;
          setRunesCollected(g.runes);
          setRatatoskrNotif(`+${reward} Runes!`);
          setTimeout(() => setRatatoskrNotif(null), 2000);
          for (let i = 0; i < 12; i++) {
            g.particles.push({
              x: rat.x + RATATOSKR_W / 2, y: rat.y + RATATOSKR_H / 2,
              vx: (Math.random() - 0.5) * 6, vy: (Math.random() - 0.5) * 6 - 2,
              life: 25, color: '#fbbf24', size: 3
            });
          }
          g.ratatoskr = null;
        }
      }
    }

    // ═══ GAME OVER ═══
    const triggerGameOver = (reason) => {
      setScore(g.maxAlt);
      setRunesCollected(g.runes);
      setRedRunesCollected(g.redRunes || 0);
      setDeathReason(reason);
      if (alt > bestScoreRef.current) {
        setIsNewBest(true);
        setBestScore(alt);
        bestScoreRef.current = alt;
        localStorage.setItem('ygg_best', alt.toString());
      } else {
        setIsNewBest(false);
      }
      submitScore(g.maxAlt, g.runes);
      removePresence();
      setGameState('over');
      setRunStats({ loading: true });
      submitYggdrasilRun(g.maxAlt, g.runes, g.player.shopTurbosUsed || 0, g.player.shopJumpsUsed || 0, g.redRunes || 0).then(res => {
        loadUserShopData(); // Refresh balance after run
        if (res && res.success) {
          setRunStats(res);

          // Only spawn Death Spirit if it was a valid run (not limit reached)
          if (!res.limitReached && user?.uid) {
            const spiritId = `${user.uid}_${Date.now()}`;
            const spiritRef = ref(database, `yggdrasil/spirits/${spiritId}`);
            set(spiritRef, {
              x: Math.floor(p.x + PLAYER_W / 2),
              y: Math.floor(p.y + PLAYER_H / 2),
              uid: user.uid,
              name: resolveDisplayName(user),
              t: Date.now()
            });
            // Auto-cleanup after 15 mins
            setTimeout(() => remove(spiritRef), 900000);
          }
        } else {
          setRunStats({ error: res?.error || 'Failed to submit' });
        }
      });
    };

    if (p.y > g.camera + CANVAS_H + 120) {
      // Check if apple can save the player
      if (g.hasIdunApple && !g.appleUsedInRun) {
        // Prepare death states for UI display
        setScore(g.maxAlt);
        setRunesCollected(g.runes);
        setDeathReason('fall');
        if (alt > bestScoreRef.current) {
          setIsNewBest(true);
          setBestScore(alt);
          bestScoreRef.current = alt;
          localStorage.setItem('ygg_best', alt.toString());
        } else {
          setIsNewBest(false);
        }

        // Pause the game loop and show respawn prompt
        appleDeathReasonRef.current = 'fall';
        setShowApplePrompt(true);
        setAppleTimer(10);
        setGameState('apple_prompt');
        return;
      }
      triggerGameOver('fall');
      return;
    }
    if (nh.active && p.y + PLAYER_H > nh.y) {
      g.shake = 20;
      p.mistTimer -= dt;
      if (p.mistTimer <= 0) {
        if (g.hasIdunApple && !g.appleUsedInRun) {
          // Prepare death states for UI display
          setScore(g.maxAlt);
          setRunesCollected(g.runes);
          setDeathReason('nidhogg');
          if (alt > bestScoreRef.current) {
            setIsNewBest(true);
            setBestScore(alt);
            bestScoreRef.current = alt;
            localStorage.setItem('ygg_best', alt.toString());
          } else {
            setIsNewBest(false);
          }

          appleDeathReasonRef.current = 'nidhogg';
          setShowApplePrompt(true);
          setAppleTimer(10);
          setGameState('apple_prompt');
          return;
        }
        triggerGameOver('nidhogg');
        return;
      }
    } else {
      p.mistTimer = 120; // reset
    }


    // Publish presence (throttled ~10/sec)
    if (now - g.lastPublish > 100) {
      publishPresence(Math.round(p.x), Math.round(p.y), g.maxAlt, getZone(alt).name);
      g.lastPublish = now;
    }

    // ═══ RENDER ═══
    const zone = getZone(alt);
    if (zone.name !== zoneNameRef.current) {
      zoneNameRef.current = zone.name;
      setZoneName(zone.name);
      // Trigger large announcement
      setShowZoneAnnouncement(true);
      setTimeout(() => setShowZoneAnnouncement(false), 2500);
    }

    const assets = assetsRef.current;

    if (assets.background) {
      // Draw epic landscape background (Parallax)
      const bg = assets.background;
      const progress = Math.min(1, alt / 10000); // Stretch the art over 10km

      // Calculate aspect-correct view
      const canvasAspect = CANVAS_H / CANVAS_W;
      const imgAspect = bg.height / bg.width;

      let sw, sh, sx, sy;
      if (imgAspect > canvasAspect) {
        // Image is taller than canvas
        sw = bg.width;
        sh = bg.width * canvasAspect;
        sx = 0;
        sy = (bg.height - sh) * (1 - progress);
      } else {
        // Image is wider than canvas
        sh = bg.height;
        sw = bg.height / canvasAspect;
        sx = (bg.width - sw) / 2;
        sy = 0;
      }

      ctx.drawImage(bg, sx, sy, sw, sh, 0, 0, CANVAS_W, CANVAS_H);
    } else {
      // Fallback background gradient
      const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
      grad.addColorStop(0, zone.bg1);
      grad.addColorStop(1, zone.bg2);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }

    // Stars for high altitudes (Lowered to 500 for testing)
    if (alt > 500) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.6, (alt - 500) / 2000)})`;
      g.stars.forEach(s => {
        const sy = (s.y + g.camera * 0.1) % CANVAS_H;
        ctx.fillRect(s.x, sy, s.size, s.size);
      });
    }

    // Weather Particles
    g.windParticles.forEach(w => {
      ctx.fillStyle = w.color;
      ctx.strokeStyle = w.color;
      if (w.type === 'leaf') {
        ctx.fillRect(w.x, w.y - g.camera, 4, 4);
      } else if (w.type === 'mist') {
        ctx.beginPath();
        ctx.arc(w.x, w.y - g.camera, w.size, 0, Math.PI * 2);
        ctx.fill();
      } else if (w.type === 'spark' || w.type === 'line') {
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(w.x, w.y - g.camera);
        ctx.lineTo(w.x, w.y - g.camera + w.len);
        ctx.stroke();
      } else if (w.type === 'dust') {
        ctx.fillRect(w.x, w.y - g.camera, 2, 2);
      }
    });

    // Draw Death Spirits
    if (g.globalSpirits) {
      for (const s of Object.values(g.globalSpirits)) {
        if (s.y < g.camera - 50 || s.y > g.camera + CANVAS_H + 50) continue;
        const pulse = Math.sin(Date.now() / 400) * 5;
        ctx.save();
        ctx.translate(s.x + (s.offX || 0), s.y + (s.offY || 0) - g.camera);

        // Aura
        const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, 20 + pulse);
        grad.addColorStop(0, 'rgba(168, 85, 247, 0.6)');
        grad.addColorStop(1, 'rgba(168, 85, 247, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, 20 + pulse, 0, Math.PI * 2);
        ctx.fill();

        // Core
        if (currentAssets.spirit) {
          ctx.drawImage(currentAssets.spirit, -12, -12 + pulse / 2, 24, 24);
        } else {
          ctx.fillStyle = '#f3e8ff';
          ctx.font = '20px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.shadowBlur = 10;
          ctx.shadowColor = '#a855f7';
          ctx.fillText('👻', 0, pulse / 2);
        }

        // Name
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.font = '10px Rajdhani, sans-serif';
        ctx.fillText(s.name, 0, 25);

        ctx.restore();
      }
    }

    ctx.save();
    // Apply screen shake
    if (g.shake > 0) {
      ctx.translate((Math.random() - 0.5) * g.shake, (Math.random() - 0.5) * g.shake);
    }
    ctx.translate(0, -g.camera);

    // PB Marker line
    if (bestScoreRef.current > 0) {
      const pbY = -bestScoreRef.current * 4;
      // Only draw if within 2 screens of the player
      if (pbY > g.camera - CANVAS_H && pbY < g.camera + CANVAS_H * 2) {
        ctx.save();
        ctx.setLineDash([8, 4]);
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.3)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, pbY);
        ctx.lineTo(CANVAS_W, pbY);
        ctx.stroke();

        ctx.fillStyle = 'rgba(251, 191, 36, 0.6)';
        ctx.font = 'bold 12px Rajdhani, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('🏆 PERSONAL BEST', 10, pbY - 8);
        ctx.restore();
      }
    }

    // Platforms
    for (const plat of g.platforms) {
      if (plat.y < g.camera - 20 || plat.y > g.camera + CANVAS_H + 20) continue;
      if (plat.broken) continue;
      if (plat.type === 'ground') continue; // Invisible floor

      ctx.save();
      const currentAssets = assetsRef.current;
      const isFragile = plat.type === 'fragile';
      const platImg = isFragile ? currentAssets.plat2 : currentAssets.plat1;

      if (platImg) {
        // Blinking logic for vanishing platforms
        // Blinking logic for vanishing platforms - flicker over 2s
        if (isFragile && plat.activated && plat.activatedTime) {
          const age = Date.now() - plat.activatedTime;
          if (age > 1500) {
            // Fast flicker last 0.5s
            if (Math.floor(Date.now() / 80) % 2 === 0) ctx.globalAlpha = 0.2;
          } else if (age > 800) {
            // Medium flicker
            if (Math.floor(Date.now() / 150) % 2 === 0) ctx.globalAlpha = 0.4;
          } else {
            // Slow flicker first 0.8s
            if (Math.floor(Date.now() / 300) % 2 === 0) ctx.globalAlpha = 0.6;
          }
        }

        // Scale platform visual to match collision width
        const rw = plat.w;
        const rh = rw * (platImg.height / platImg.width);
        ctx.drawImage(platImg, plat.x, plat.y + (plat.h - rh) / 2, rw, rh);

        // Boost platform tint & glow
        if (plat.type === 'boost') {
          ctx.save();
          ctx.globalCompositeOperation = 'source-atop';
          ctx.fillStyle = 'rgba(251, 191, 36, 0.4)'; // Gold tint
          ctx.fillRect(plat.x, plat.y, plat.w, plat.h);
          ctx.restore();

          ctx.save();
          ctx.shadowBlur = 15;
          ctx.shadowColor = '#fbbf24';
          ctx.strokeStyle = 'rgba(251, 191, 36, 0.8)';
          ctx.lineWidth = 2;
          roundRect(ctx, plat.x, plat.y, plat.w, plat.h, 4);
          ctx.stroke();
          ctx.restore();
        }

        ctx.globalAlpha = 1; // Reset alpha
      } else {
        // Fallback vector drawing
        if (plat.type === 'standard') {
          ctx.fillStyle = '#8B5A2B';
          roundRect(ctx, plat.x, plat.y, plat.w, plat.h, 4);
          ctx.fill();
        } else if (plat.type === 'fragile') {
          ctx.fillStyle = '#7dd3fc';
          ctx.globalAlpha = 0.7;
          roundRect(ctx, plat.x, plat.y, plat.w, plat.h, 4);
          ctx.fill();
          ctx.globalAlpha = 1;
        } else if (plat.type === 'moving') {
          ctx.fillStyle = '#22c55e';
          roundRect(ctx, plat.x, plat.y, plat.w, plat.h, 4);
          ctx.fill();
        } else if (plat.type === 'boost' || plat.type === 'turbo') {
          ctx.fillStyle = plat.type === 'turbo' ? '#ef4444' : '#fbbf24';
          roundRect(ctx, plat.x, plat.y, plat.w, plat.h, 4);
          ctx.fill();
        }
      }

      // Draw Power-up Items (Large, glowing, impossible to miss)
      if (plat.item && !plat.itemCollected) {
        ctx.save();
        const bounce = Math.sin(Date.now() / 200) * 10;
        const glowPulse = 0.5 + Math.sin(Date.now() / 250) * 0.5;
        const cx = plat.x + plat.w / 2;
        const cy = plat.y - 30 + bounce;

        // Glowing background circle
        const grad = ctx.createRadialGradient(cx, cy, 5, cx, cy, 28);
        if (plat.item === 'turbo') {
          grad.addColorStop(0, 'rgba(251, 191, 36, 0.9)');
          grad.addColorStop(0.5, 'rgba(251, 191, 36, 0.4)');
          grad.addColorStop(1, 'rgba(251, 191, 36, 0)');
        } else {
          grad.addColorStop(0, 'rgba(96, 165, 250, 0.9)');
          grad.addColorStop(0.5, 'rgba(96, 165, 250, 0.4)');
          grad.addColorStop(1, 'rgba(96, 165, 250, 0)');
        }
        ctx.globalAlpha = 1.0;
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, 28 + glowPulse * 8, 0, Math.PI * 2);
        ctx.fill();

        // Icon
        if (plat.item === 'turbo' && currentAssets.turboIcon) {
          ctx.drawImage(currentAssets.turboIcon, cx - 18, cy - 18, 36, 36);
        } else if (plat.item === 'doubleJump' && currentAssets.jumpIcon) {
          ctx.drawImage(currentAssets.jumpIcon, cx - 18, cy - 18, 36, 36);
        } else {
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = '32px sans-serif';
          ctx.shadowBlur = 20;
          ctx.shadowColor = plat.item === 'turbo' ? '#fbbf24' : '#60a5fa';
          ctx.fillText(plat.item === 'turbo' ? '\uD83D\uDE80' : '\uD83D\uDC5F', cx, cy);
        }
        ctx.restore();
      }

      // Icons on platforms removed for boost types as per request (using platform tint instead)

      ctx.restore();

      // Draw rune floating above platform
      if (plat.hasRune && !plat.runeCollected) {
        const runeX = plat.x + plat.w / 2 + (plat.runeOffX || 0);
        const runeY = plat.y - 20 + Math.sin(Date.now() / 300 + plat.x) * 3 + (plat.runeOffY || 0);
        ctx.save();
        if (currentAssets.rune) {
          const spinScale = Math.cos(Date.now() / 500);
          ctx.translate(runeX, runeY);
          ctx.scale(spinScale, 1);
          ctx.drawImage(currentAssets.rune, -12, -12, 24, 24);
        } else {
          ctx.fillStyle = '#fbbf24';
          ctx.font = `bold ${RUNE_SIZE}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.strokeStyle = 'rgba(0,0,0,0.8)';
          ctx.lineWidth = 3;
          ctx.strokeText(plat.runeSymbol, runeX, runeY);
          ctx.fillText(plat.runeSymbol, runeX, runeY);
        }
        ctx.restore();
      }
    }

    // Draw floating runes (all gold)
    for (const fr of g.floatingRunes) {
      if (fr.collected) continue;
      const rx = fr.x + (fr.offX || 0);
      const ry = fr.y + Math.sin(Date.now() / 300 + fr.x) * 5 + (fr.offY || 0);
      const screenRy = ry - g.camera;

      // Only draw if on screen
      if (screenRy > -50 && screenRy < CANVAS_H + 50) {
        ctx.save();
        if (currentAssets.rune) {
          const spinScale = Math.cos(Date.now() / 600 + rx); 
          ctx.translate(rx, ry);
          ctx.scale(spinScale, 1);
          ctx.drawImage(currentAssets.rune, -14, -14, 28, 28);
        } else {
          ctx.fillStyle = '#fbbf24';
          const displaySize = RUNE_SIZE * 1.2;
          ctx.font = `bold ${displaySize}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.shadowBlur = 15;
          ctx.shadowColor = '#fbbf24';
          ctx.strokeStyle = 'rgba(0,0,0,0.8)';
          ctx.lineWidth = 3;
          ctx.strokeText(fr.symbol, rx, ry);
          ctx.fillText(fr.symbol, rx, ry);
        }
        ctx.restore();
      }
    }

    // Draw red runes (event-only, separate array)
    if (g.isEventWithRedRunes) {
      for (const rr of g.redRuneRunes) {
        if (rr.collected) continue;
        const rx = rr.x + (rr.offX || 0);
        const ry = rr.y + Math.sin(Date.now() / 250 + rr.x) * 6 + (rr.offY || 0);
        const screenRy = ry - g.camera;

        if (screenRy > -50 && screenRy < CANVAS_H + 50) {
          ctx.save();
          if (currentAssets.redRune) {
            const spinScale = Math.cos(Date.now() / 500 + rx);
            ctx.translate(rx, ry);
            ctx.scale(spinScale, 1);
            // Red glow aura
            ctx.shadowBlur = 18;
            ctx.shadowColor = '#ef4444';
            ctx.drawImage(currentAssets.redRune, -18, -18, 36, 36);
          } else {
            ctx.fillStyle = '#ef4444';
            const displaySize = RUNE_SIZE * 1.5;
            ctx.font = `bold ${displaySize}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowBlur = 20;
            ctx.shadowColor = '#ef4444';
            ctx.strokeStyle = 'rgba(0,0,0,0.8)';
            ctx.lineWidth = 3;
            const rrSymbol = 'ᚱ';
            ctx.strokeText(rrSymbol, rx, ry);
            ctx.fillText(rrSymbol, rx, ry);
            // Pulse glow
            const pulse = Math.sin(Date.now() / 200) * 0.5 + 0.5;
            ctx.globalAlpha = 0.3 * pulse;
            ctx.font = `bold ${displaySize + 10}px sans-serif`;
            ctx.fillText(rrSymbol, rx, ry);
          }
          ctx.restore();
        }
      }
    }

    // Render particles
    for (const pt of g.particles) {
      ctx.globalAlpha = pt.life / 30;
      ctx.fillStyle = pt.color;
      const s = pt.size || 4;
      ctx.fillRect(pt.x - s / 2, pt.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;

    // Draw Ratatoskr
    if (g.ratatoskr && g.ratatoskr.alive) {
      const rat = g.ratatoskr;
      ctx.save();
      const bounce = Math.sin(rat.animFrame * 8) * 2;
      const rx = rat.x;
      const ry = rat.y + bounce;

      if (currentAssets.ratatoskr) {
        ctx.save();
        if (rat.direction === -1) {
          ctx.scale(-1, 1);
          ctx.drawImage(currentAssets.ratatoskr, -rx - RATATOSKR_W, ry, RATATOSKR_W, RATATOSKR_H);
        } else {
          ctx.drawImage(currentAssets.ratatoskr, rx, ry, RATATOSKR_W, RATATOSKR_H);
        }
        ctx.restore();
      } else {
        // Body
        ctx.fillStyle = '#c2410c'; // Orange-brown
        ctx.beginPath();
        ctx.ellipse(rx + RATATOSKR_W / 2, ry + RATATOSKR_H / 2, RATATOSKR_W / 2, RATATOSKR_H / 2.5, 0, 0, Math.PI * 2);
        ctx.fill();
        // Tail (fluffy arc)
        ctx.strokeStyle = '#c2410c';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        const tailDir = rat.direction;
        ctx.moveTo(rx + (tailDir === 1 ? 0 : RATATOSKR_W), ry + 4);
        ctx.quadraticCurveTo(
          rx + (tailDir === 1 ? -12 : RATATOSKR_W + 12), ry - 8,
          rx + (tailDir === 1 ? -4 : RATATOSKR_W + 4), ry - 14
        );
        ctx.stroke();
        // Ears
        ctx.fillStyle = '#ea580c';
        ctx.beginPath();
        ctx.arc(rx + (tailDir === 1 ? RATATOSKR_W - 2 : 2), ry + 2, 3, 0, Math.PI * 2);
        ctx.fill();
        // Eye
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.arc(rx + (tailDir === 1 ? RATATOSKR_W - 4 : 4), ry + RATATOSKR_H / 2 - 2, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Glow aura
      ctx.globalAlpha = 0.3 + Math.sin(Date.now() / 200) * 0.15;
      const ratGlow = ctx.createRadialGradient(rx + RATATOSKR_W / 2, ry + RATATOSKR_H / 2, 2, rx + RATATOSKR_W / 2, ry + RATATOSKR_H / 2, 25);
      ratGlow.addColorStop(0, 'rgba(251, 191, 36, 0.6)');
      ratGlow.addColorStop(1, 'rgba(251, 191, 36, 0)');
      ctx.fillStyle = ratGlow;
      ctx.beginPath();
      ctx.arc(rx + RATATOSKR_W / 2, ry + RATATOSKR_H / 2, 25, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      // Label
      ctx.font = 'bold 9px Rajdhani, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fbbf24';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.strokeText('Ratatoskr', rx + RATATOSKR_W / 2, ry - 8);
      ctx.fillText('Ratatoskr', rx + RATATOSKR_W / 2, ry - 8);
      ctx.restore();
    }

    // Draw Special Prize
    if (g.specialPrize && !g.specialPrize.collected) {
      const sp = g.specialPrize;
      const spx = sp.x + (sp.offX || 0);
      const spy = sp.y + (sp.offY || 0);
      // Only draw if on screen
      if (spy > g.camera - 100 && spy < g.camera + CANVAS_H + 100) {
        const floatY = Math.sin(Date.now() / 400) * 10;

        ctx.save();
        // Pulsing glow
        ctx.shadowBlur = 15 + Math.sin(Date.now() / 200) * 8;
        ctx.shadowColor = '#fbbf24';

        if (sp.image) {
          ctx.drawImage(sp.image, spx, spy + floatY, sp.w, sp.h);
        } else {
          // Glow effect if image not loaded yet
          ctx.fillStyle = '#fbbf24';
          ctx.beginPath();
          ctx.arc(spx + sp.w / 2, spy + sp.h / 2 + floatY, sp.w / 2, 0, Math.PI * 2);
          ctx.fill();
        }

        // Draw label
        ctx.shadowBlur = 4; // Smaller glow for text
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px Rajdhani';
        ctx.textAlign = 'center';
        ctx.fillText(sp.name.toUpperCase(), sp.x + sp.w / 2, sp.y + floatY - 12);
        ctx.restore();
      }
    }

    // Ghost players
    Object.entries(ghostPlayersDataRef.current).forEach(([uid, gp]) => {
      if (gp.x === undefined || gp.y === undefined) return;

      // Initialize visual pos if new
      if (!ghostVisualsRef.current[uid]) {
        ghostVisualsRef.current[uid] = { x: gp.x, y: gp.y };
      }

      // Lerp visual pos toward target
      const vis = ghostVisualsRef.current[uid];
      vis.x += (gp.x - vis.x) * 0.1;
      vis.y += (gp.y - vis.y) * 0.1;

      const gpCanvasY = vis.y;
      if (gpCanvasY < g.camera - 100 || gpCanvasY > g.camera + CANVAS_H + 100) return;

      ctx.save();
      ctx.globalAlpha = 0.6; // increased opacity as requested
      if (assets.stand) {
        const standImg = assets.stand;
        const renderW = PLAYER_H * (standImg.width / standImg.height);
        ctx.drawImage(standImg, vis.x + (PLAYER_W - renderW) / 2, gpCanvasY, renderW, PLAYER_H);
      } else {
        ctx.fillStyle = gp.color || '#64748b';
        roundRect(ctx, vis.x, gpCanvasY, PLAYER_W, PLAYER_H, 6);
        ctx.fill();
      }

      // Name tag
      const nameStr = gp.name?.slice(0, 10) || '?';
      ctx.font = 'bold 12px Rajdhani, sans-serif';
      ctx.textAlign = 'center';

      // Black outline for high visibility
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#000';
      ctx.strokeText(nameStr, vis.x + PLAYER_W / 2, gpCanvasY - 6);

      // White text
      ctx.fillStyle = '#fff';
      ctx.fillText(nameStr, vis.x + PLAYER_W / 2, gpCanvasY - 6);

      // Emote
      if (gp.emote && gp.emoteTime && Date.now() - gp.emoteTime < 4000) {
        const age = Date.now() - gp.emoteTime;
        const bounce = Math.sin(age / 200) * 5;
        const opacity = age > 3500 ? (4000 - age) / 500 : 1;
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.font = '24px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(gp.emote, vis.x + PLAYER_W / 2, gpCanvasY - 25 + bounce);
        ctx.restore();
      }
      ctx.restore();
    });

    // Player
    const isJumping = !p.isGrounded;
    const isTurbo = p.turboTime > 0;

    ctx.save();
    ctx.translate(p.x + PLAYER_W / 2, p.y + PLAYER_H);

    let finalScaleX = p.scaleX;
    let finalScaleY = p.scaleY;

    if (isTurbo) {
      finalScaleX *= 0.7;
      finalScaleY *= 1.1;
    } else if (isJumping) {
      finalScaleX *= 1.2;
      finalScaleY *= 1.0;
    }

    ctx.scale(finalScaleX, finalScaleY);
    ctx.translate(-PLAYER_W / 2, -PLAYER_H);

    if (assets.stand && assets.jump) {
      let heroImg = isJumping ? assets.jump : assets.stand;
      if (p.turboTime > 0 && assets.turbo) {
        heroImg = assets.turbo;
      }

      // Flip logic
      ctx.save();
      if (p.facing === -1) {
        ctx.scale(-1, 1);
        ctx.translate(-PLAYER_W, 0);
      }

      // Calculate size to maintain aspect ratio
      const sizeMult = isJumping ? 1.1 : 1.0; // Slightly boost jumping sprite size
      const renderH = PLAYER_H * sizeMult;
      const renderW = renderH * (heroImg.width / heroImg.height);

      // Shift drawing down to plant feet on the platform floor
      ctx.drawImage(heroImg, (PLAYER_W - renderW) / 2, PLAYER_H - renderH, renderW, renderH);

      ctx.restore(); // Restore flip scale

      // Draw current emote for local player (outside flip logic)
      if (currentEmoteRef.current && Date.now() - currentEmoteRef.current.t < 4000) {
        const age = Date.now() - currentEmoteRef.current.t;
        const bounce = Math.sin(age / 200) * 5;
        const opacity = age > 3500 ? (4000 - age) / 500 : 1;
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.font = '24px sans-serif';
        ctx.textAlign = 'center';
        // Draw relative to player center
        ctx.fillText(currentEmoteRef.current.emote, PLAYER_W / 2, -25 + bounce);
        ctx.restore();
      }
    } else {
      // Fallback vector character
      // Body
      ctx.fillStyle = '#e2e8f0';
      roundRect(ctx, 4, 10, PLAYER_W - 8, PLAYER_H - 14, 4);
      ctx.fill();
      // Head
      ctx.fillStyle = '#fcd34d';
      ctx.beginPath();
      ctx.arc(PLAYER_W / 2, 8, 9, 0, Math.PI * 2);
      ctx.fill();
      // Helmet horns
      ctx.strokeStyle = '#b8860b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(5, 4);
      ctx.lineTo(1, -4);
      ctx.moveTo(PLAYER_W - 5, 4);
      ctx.lineTo(PLAYER_W - 1, -4);
      ctx.stroke();
      // Eyes
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(11, 6, 2, 2);
      ctx.fillRect(17, 6, 2, 2);
      // Cape
      ctx.fillStyle = '#dc2626';
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.moveTo(8, 14);
      ctx.lineTo(PLAYER_W - 8, 14);
      ctx.lineTo(PLAYER_W - 4, PLAYER_H + (isJumping ? 6 : 2));
      ctx.lineTo(4, PLAYER_H + (isJumping ? 6 : 2));
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    ctx.restore();

    if (p.vy >= 0 || p.isGrounded) {
      turboMomentumRef.current = false;
    }

    const isJumpDisabled = !p.isGrounded && (p.turboTime > 0 || turboMomentumRef.current);

    // Update React state for HUD (Throttled to 15fps for maximum performance)
    if (now - g.lastHUDTime > 66) {
      setScore(alt);
      setTurboTime(Math.max(0, p.turboTime));
      setDoubleJumpDisabled(isJumpDisabled);
      g.lastHUDTime = now;
    }

    // Mist at the bottom
    const mistGrad = ctx.createLinearGradient(0, CANVAS_H - 120, 0, CANVAS_H);
    mistGrad.addColorStop(0, 'transparent');
    mistGrad.addColorStop(1, zone.bg2);
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = mistGrad;
    ctx.fillRect(0, CANVAS_H - 120, CANVAS_W, 120);
    ctx.globalAlpha = 1;

    // Vignette
    const vignette = ctx.createRadialGradient(CANVAS_W / 2, CANVAS_H / 2, CANVAS_W * 0.3, CANVAS_W / 2, CANVAS_H / 2, CANVAS_W);
    vignette.addColorStop(0, 'transparent');
    vignette.addColorStop(1, 'rgba(0,0,0,0.4)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Weather Visuals with smoothed transitions
    const getZoneAlpha = (alt, start, end, fade = 500) => {
      if (alt < start - fade || alt > end + fade) return 0;
      if (alt >= start && alt <= end) return 1;
      if (alt < start) return Math.max(0, (alt - (start - fade)) / fade);
      return Math.max(0, ((end + fade) - alt) / fade);
    };

    const cosmicAlpha = getZoneAlpha(currentAlt, 7000, 9000);
    if (cosmicAlpha > 0) {
      // Shifting Aurora curtains
      ctx.save();
      ctx.globalAlpha = 0.2 * cosmicAlpha;
      const hue = (now / 50) % 360;
      const aurGrad = ctx.createLinearGradient(0, 0, CANVAS_W, 0);
      aurGrad.addColorStop(0, `hsla(${hue}, 70%, 50%, 0)`);
      aurGrad.addColorStop(0.5, `hsla(${(hue + 60) % 360}, 70%, 50%, 0.8)`);
      aurGrad.addColorStop(1, `hsla(${(hue + 120) % 360}, 70%, 50%, 0)`);
      ctx.fillStyle = aurGrad;
      for (let i = 0; i < 2; i++) {
        const offset = Math.sin(now / 1000 + i) * 50;
        ctx.fillRect(offset, 0, CANVAS_W, CANVAS_H);
      }
      ctx.restore();
    }

    // Nidhogg Mist Survival Countdown
    if (p.mistTimer < 120 && p.mistTimer > 0 && gameState === 'playing') {
      const seconds = Math.ceil(p.mistTimer / 60);
      const bx = p.x + PLAYER_W / 2;
      const by = p.y - 45 - g.camera;

      // Draw bubble
      ctx.save();
      ctx.fillStyle = 'rgba(239, 68, 68, 0.8)'; // Reddish for danger
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(bx, by, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Draw text
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 20px Rajdhani';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(seconds, bx, by);
      ctx.restore();
    }

    const bifrostAlpha = getZoneAlpha(currentAlt, 3000, 5000);
    if (bifrostAlpha > 0) {
      // Shifting Rainbow Bridge overlay
      ctx.save();
      ctx.globalAlpha = 0.08 * bifrostAlpha;
      const rainbowGrad = ctx.createLinearGradient(0, 0, CANVAS_W, 0);
      for (let i = 0; i <= 6; i++) {
        const hue = (i * 60 + now / 10) % 360;
        rainbowGrad.addColorStop(i / 6, `hsla(${hue}, 80%, 50%, 1)`);
      }
      ctx.fillStyle = rainbowGrad;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.restore();
    }

    if (g.flashAlpha > 0) {
      // Thunderclap Darkness flickering
      ctx.fillStyle = `rgba(0, 0, 0, ${g.flashAlpha})`;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }

    if (g.goldenFlashAlpha > 0) {
      // Iðunn's Apple Golden Flash
      ctx.fillStyle = `rgba(251, 191, 36, ${g.goldenFlashAlpha})`;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }

    // ═══ NIDHOGG'S MIST RENDER ═══
    if (g.nidhogg.active) {
      const nhRender = g.nidhogg;
      const mistScreenY = nhRender.y - g.camera;
      if (mistScreenY < CANVAS_H + 100) {
        ctx.save();
        // Main mist gradient (dark purple fog rising from below)
        const mistGradNh = ctx.createLinearGradient(0, mistScreenY - 60, 0, CANVAS_H + 50);
        mistGradNh.addColorStop(0, 'rgba(75, 0, 130, 0)');
        mistGradNh.addColorStop(0.15, 'rgba(75, 0, 130, 0.3)');
        mistGradNh.addColorStop(0.4, 'rgba(40, 0, 60, 0.7)');
        mistGradNh.addColorStop(1, 'rgba(10, 0, 15, 0.95)');
        ctx.fillStyle = mistGradNh;
        ctx.fillRect(0, Math.max(0, mistScreenY - 60), CANVAS_W, CANVAS_H - Math.max(0, mistScreenY - 60) + 50);
        // Tendril particles
        nhRender.mistParticles.forEach(mp => {
          const mpScreenY = mp.y - g.camera;
          if (mpScreenY > -20 && mpScreenY < CANVAS_H + 20) {
            ctx.globalAlpha = (mp.life / 70) * 0.4;
            ctx.fillStyle = 'rgba(148, 0, 211, 0.5)';
            ctx.beginPath();
            ctx.arc(mp.x, mpScreenY, mp.size, 0, Math.PI * 2);
            ctx.fill();
          }
        });
        ctx.globalAlpha = 1;
        // Pulsing edge glow
        const edgeGlow = ctx.createLinearGradient(0, mistScreenY - 30, 0, mistScreenY + 10);
        edgeGlow.addColorStop(0, 'rgba(148, 0, 211, 0)');
        edgeGlow.addColorStop(0.5, `rgba(148, 0, 211, ${0.2 + Math.sin(Date.now() / 300) * 0.1})`);
        edgeGlow.addColorStop(1, 'rgba(148, 0, 211, 0)');
        ctx.fillStyle = edgeGlow;
        ctx.fillRect(0, Math.max(0, mistScreenY - 30), CANVAS_W, 40);
        ctx.restore();
      }
    }

    animRef.current = requestAnimationFrame(gameLoop);
  }, [publishPresence, removePresence, submitScore, user, gameState, yggConfig, loadUserShopData]);

  // Use Idun's Apple — respawn the player to the highest platform
  const handleAppleDecision = useCallback((accepted) => {
    // Clear the timer
    if (appleTimerRef.current) {
      clearInterval(appleTimerRef.current);
      appleTimerRef.current = null;
    }
    setShowApplePrompt(false);

    const g = gameRef.current;
    if (!g) return;

    if (!accepted) {
      // Player declined or timer ran out — trigger real game over
      const reason = appleDeathReasonRef.current || 'fall';
      setScore(g.maxAlt);
      setRunesCollected(g.runes);
      setDeathReason(reason);
      const alt = g.maxAlt;
      if (alt > bestScoreRef.current) {
        setIsNewBest(true);
        setBestScore(alt);
        bestScoreRef.current = alt;
        localStorage.setItem('ygg_best', alt.toString());
      } else {
        setIsNewBest(false);
      }
      submitScore(g.maxAlt);
      removePresence();
      setGameState('over');
      setRunStats({ loading: true });
      submitYggdrasilRun(g.maxAlt, g.runes, g.player.shopTurbosUsed || 0, g.player.shopJumpsUsed || 0).then(res => {
        loadUserShopData(); // Refresh balance after run
        if (res && res.success) {
          setRunStats(res);

          // Only spawn Death Spirit if it was a valid run (not limit reached)
          if (!res.limitReached && user?.uid) {
            const spiritId = `${user.uid}_${Date.now()}`;
            const spiritRef = ref(database, `yggdrasil/spirits/${spiritId}`);
            set(spiritRef, {
              x: Math.floor(p.x + PLAYER_W / 2),
              y: Math.floor(p.y + PLAYER_H / 2),
              uid: user.uid,
              name: resolveDisplayName(user),
              t: Date.now()
            });
            // Auto-cleanup after 15 mins
            setTimeout(() => remove(spiritRef), 900000);
          }
        } else {
          setRunStats({ error: res?.error || 'Failed to submit' });
        }
      });
      return;
    }

    // Player accepted — respawn on the highest platform currently on screen
    const p = g.player;

    // Find non-broken platforms within the current camera view
    const visiblePlats = g.platforms.filter(pl =>
      !pl.broken &&
      pl.type !== 'ground' &&
      pl.y >= g.camera &&
      pl.y <= g.camera + CANVAS_H
    );

    // Sort by altitude (lowest y is highest)
    visiblePlats.sort((a, b) => a.y - b.y);
    let targetPlat = visiblePlats[0];

    // Fallback: If no platform is on screen, find the closest one above or at the camera
    if (!targetPlat) {
      const fallbackPlats = g.platforms.filter(pl => !pl.broken && pl.type !== 'ground' && pl.y <= g.camera + CANVAS_H);
      fallbackPlats.sort((a, b) => b.y - a.y); // Closest from above
      targetPlat = fallbackPlats[0];
    }

    if (targetPlat) {
      p.x = targetPlat.x + targetPlat.w / 2 - PLAYER_W / 2;
      p.y = targetPlat.y - PLAYER_H - 10;
    } else {
      // Absolute fallback
      p.y = g.camera + 100;
      p.x = CANVAS_W / 2 - PLAYER_W / 2;
    }

    // Push Nidhogg down and reset timers to prevent immediate re-death
    if (g.nidhogg.active) {
      g.nidhogg.y = p.y + 600; // Push mist 600px below player
      g.nidhogg.graceTimer = 60; // 1 second grace period
    }
    p.mistTimer = 120; // Reset survival window

    p.vy = -7; // Gentle upward boost
    p.vx = 0;
    g.shake = 15;
    g.goldenFlashAlpha = 0.8; // Trigger golden flash
    g.flashAlpha = 0; // Clear any thunderstorm darkness

    // Spawn golden revival particles
    for (let i = 0; i < 40; i++) {
      g.particles.push({
        x: p.x + PLAYER_W / 2, y: p.y + PLAYER_H / 2,
        vx: (Math.random() - 0.5) * 10, vy: (Math.random() - 0.5) * 10,
        life: 50, color: '#fbbf24', size: 4
      });
    }

    g.appleUsedInRun = true;
    g.hasIdunApple = false;
    setAppleUsedInRun(true);
    setUserUpgrades(prev => ({ ...prev, hasIdunApple: false }));
    setGameState('playing');

    // Consume the apple in Firestore so it's one-time use per purchase
    consumeIdunAppleService();

    // Resume game loop
    if (animRef.current) cancelAnimationFrame(animRef.current);
    animRef.current = requestAnimationFrame(gameLoop);
  }, [gameLoop, submitScore, removePresence, loadUserShopData, user]);

  const handleEmoteSelect = useCallback((emote) => {
    setSelectedEmote(emote);
    currentEmoteRef.current = { emote, t: Date.now() };
    
    // Immediate broadcast
    const g = gameRef.current;
    if (g) {
      const alt = Math.max(0, Math.floor(-g.camera / 4));
      publishPresence(Math.round(g.player.x), Math.round(g.player.y), g.maxAlt, getZone(alt).name);
    }

    // Delay closing for visual feedback
    setTimeout(() => {
      setShowEmoteMenu(false);
      setSelectedEmote(null);
    }, 200);
  }, [publishPresence]);



  const startGame = useCallback(async (eventId = null) => {
    if (eventId) {
      const ev = events.find(e => e.id === eventId);
      if (!ev) return;

      const confirmJoin = window.confirm(`Join "${ev.name}" for ${ev.entryFee} ${ev.currency}?`);
      if (!confirmJoin) return;

      setEventLoading(true);
      setEventLoadingId(eventId);
      const res = await joinYggdrasilEvent(eventId);
      setEventLoading(false);
      setEventLoadingId(null);

      if (!res.success) {
        alert(res.error || 'Failed to join event');
        return;
      }
      const updatedEv = { ...ev, currentPool: (ev.currentPool || 0) + 1 };
      setActiveEvent(updatedEv);
      setActiveEventId(eventId);
      activeEventIdRef.current = eventId;
      
      const freshUpgrades = await loadUserShopData();
      initGame(updatedEv, freshUpgrades);
    } else {
      setActiveEvent(null);
      setActiveEventId(null);
      activeEventIdRef.current = null;
      
      const freshUpgrades = await loadUserShopData();
      initGame(null, freshUpgrades);
    }

    keysRef.current = {};
    touchRef.current = { left: false, right: false, jump: false, turbo: false };
    setGameState('playing');
    setIsNewBest(false);
    setScore(0);
    setRunesCollected(0);
    setDeathReason(null);
    setAppleUsedInRun(false);
    setRunStats(null);

    // Announce initial zone (Midgard)
    zoneNameRef.current = 'MIDGARD';
    setZoneName('MIDGARD');
    setShowZoneAnnouncement(true);
    setTimeout(() => setShowZoneAnnouncement(false), 2500);

    // Set up disconnect cleanup
    if (user?.uid) {
      const pRef = ref(database, `yggdrasil/players/${user.uid}`);
      onDisconnect(pRef).remove();
    }
    if (animRef.current) cancelAnimationFrame(animRef.current);
    animRef.current = requestAnimationFrame(gameLoop);
  }, [initGame, gameLoop, user, events, loadUserShopData]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      removePresence();
    };
  }, [removePresence]);

  // Apple respawn timer countdown
  useEffect(() => {
    if (!showApplePrompt) return;

    setAppleTimer(10);
    const interval = setInterval(() => {
      setAppleTimer(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [showApplePrompt]);

  // Handle timer expiration as a side effect to avoid updating parent during render
  useEffect(() => {
    if (showApplePrompt && appleTimer === 0) {
      handleAppleDecision(false);
    }
  }, [appleTimer, showApplePrompt, handleAppleDecision]);

  // Keyboard
  useEffect(() => {
    const down = (e) => {
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'ArrowDown') e.preventDefault();
      keysRef.current[e.code] = true;
    };
    const up = (e) => {
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'ArrowDown') e.preventDefault();
      keysRef.current[e.code] = false;
    };
    const blur = () => {
      keysRef.current = {};
      touchRef.current = { left: false, right: false, jump: false };
    };
    window.addEventListener('keydown', down, { passive: false });
    window.addEventListener('keyup', up, { passive: false });
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // Handle Mobile Touch Events (Passive: False)
  const handleLeftStart = (e) => {
    if (e.cancelable) e.preventDefault();
    touchRef.current.left = true;
    e.currentTarget.classList.add('is-pressed');
  };
  const handleLeftEnd = (e) => {
    if (e.cancelable) e.preventDefault();
    touchRef.current.left = false;
    e.currentTarget.classList.remove('is-pressed');
  };
  const handleRightStart = (e) => {
    if (e.cancelable) e.preventDefault();
    touchRef.current.right = true;
    e.currentTarget.classList.add('is-pressed');
  };
  const handleRightEnd = (e) => {
    if (e.cancelable) e.preventDefault();
    touchRef.current.right = false;
    e.currentTarget.classList.remove('is-pressed');
  };
  const handleJumpStart = (e) => {
    if (e.cancelable) e.preventDefault();
    touchRef.current.jump = true;
    e.currentTarget.classList.add('is-pressed');
  };
  const handleJumpEnd = (e) => {
    if (e.cancelable) e.preventDefault();
    touchRef.current.jump = false;
    e.currentTarget.classList.remove('is-pressed');
  };

  useEffect(() => {
    const l = leftBtnRef.current;
    const r = rightBtnRef.current;
    const j = jumpBtnRef.current;

    if (l) {
      l.addEventListener('touchstart', handleLeftStart, { passive: false });
      l.addEventListener('touchend', handleLeftEnd, { passive: false });
      l.addEventListener('touchcancel', handleLeftEnd, { passive: false });
    }
    if (r) {
      r.addEventListener('touchstart', handleRightStart, { passive: false });
      r.addEventListener('touchend', handleRightEnd, { passive: false });
      r.addEventListener('touchcancel', handleRightEnd, { passive: false });
    }
    if (j) {
      j.addEventListener('touchstart', handleJumpStart, { passive: false });
      j.addEventListener('touchend', handleJumpEnd, { passive: false });
      j.addEventListener('touchcancel', handleJumpEnd, { passive: false });
    }

    return () => {
      if (l) {
        l.removeEventListener('touchstart', handleLeftStart);
        l.removeEventListener('touchend', handleLeftEnd);
        l.removeEventListener('touchcancel', handleLeftEnd);
      }
      if (r) {
        r.removeEventListener('touchstart', handleRightStart);
        r.removeEventListener('touchend', handleRightEnd);
        r.removeEventListener('touchcancel', handleRightEnd);
      }
      if (j) {
        j.removeEventListener('touchstart', handleJumpStart);
        j.removeEventListener('touchend', handleJumpEnd);
        j.removeEventListener('touchcancel', handleJumpEnd);
      }
    };
  }, [gameState]); // Re-attach when game state changes (buttons mount/unmount)

  // Canvas sizing
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = CANVAS_W;
      canvas.height = CANVAS_H;
    }
  }, []);

  return (
    <div className="ygg-container" ref={containerRef}>
      <div
        className="ygg-canvas-wrapper"
      >
        <canvas
          ref={canvasRef}
        />

        {/* Mobile Controls Overlay */}
        {gameState === 'playing' && isTouchDevice && (
          <div className="ygg-mobile-controls" style={{
            position: 'absolute', bottom: '15px', left: 0, right: 0,
            display: 'flex', justifyContent: 'center', padding: '0 12px', pointerEvents: 'none'
          }}>
            <div className="ygg-mobile-controls-row">
              {joystickMode ? (
                <div 
                  className="ygg-joystick-area"
                  onTouchStart={handleJoystickTouch}
                  onTouchMove={handleJoystickTouch}
                  onTouchEnd={handleJoystickEnd}
                >
                  <div 
                    className="ygg-joystick-knob" 
                    style={{ transform: `translate(${joystickX}px, ${joystickY}px)` }}
                  />
                </div>
              ) : (
                <div className="ygg-dpad-group">
                  <button
                    ref={leftBtnRef}
                    className="ygg-btn-dir"
                    onTouchStart={handleLeftStart}
                    onTouchEnd={handleLeftEnd}
                  >◀</button>
                  <button
                    ref={rightBtnRef}
                    className="ygg-btn-dir"
                    onTouchStart={handleRightStart}
                    onTouchEnd={handleRightEnd}
                  >▶</button>
                </div>
              )}

              <div className="ygg-joystick-mode-toggle">
                <input 
                  type="checkbox" 
                  id="joystick-mode" 
                  className="ygg-joystick-checkbox"
                  checked={joystickMode}
                  onChange={(e) => setJoystickMode(e.target.checked)}
                  onClick={(e) => e.stopPropagation()}
                />
                <label htmlFor="joystick-mode" className="ygg-joystick-label">Joystick Mode</label>
              </div>

              <div className="ygg-mobile-actions">
                <button
                  className="ygg-ctrl-btn turbo-btn"
                  onTouchStart={(e) => { e.preventDefault(); touchRef.current.turbo = true; }}
                  onTouchEnd={(e) => { e.preventDefault(); touchRef.current.turbo = false; }}
                >
                  <img src="/icons/minigames/yggdrasil/turbo.png" alt="turbo" className="ygg-btn-icon-img" />
                </button>
                <button
                  ref={jumpBtnRef}
                  className="ygg-ctrl-btn jump"
                  onTouchStart={handleJumpStart}
                  onTouchEnd={handleJumpEnd}
                >JUMP</button>
              </div>
            </div>
          </div>
        )}


        {/* HUD */}
        {gameState === 'playing' && (
          <>
            <div className="ygg-hud">
              <div className="ygg-hud-left">
                <div className="ygg-altitude">
                  {score}m<span> ALTITUDE</span>
                </div>
                {bestScore > 0 && <div className="ygg-best">Best: {bestScore}m</div>}
                
                {/* Zone condition badge with color */}
                {(() => {
                  const z = getZone(score);
                  return (
                    <div className="ygg-condition-badge" style={{ background: z.color, borderColor: z.color, color: '#fff' }}>
                      {z.condition}
                    </div>
                  );
                })()}

                {runesCollected > 0 && (
                  <div className="ygg-runes-hud">
                    <img src="/icons/minigames/yggdrasil/rune.png" alt="rune" className="ygg-hud-icon-img" />
                    {runesCollected}
                  </div>
                )}

                {redRunesCollected > 0 && (
                  <div className="ygg-runes-hud" style={{ background: 'rgba(239, 68, 68, 0.15)', borderColor: 'rgba(239, 68, 68, 0.4)' }}>
                    <img src="/icons/minigames/yggdrasil/red_rune.png" alt="red rune" className="ygg-hud-icon-img" />
                    <span style={{ color: '#ef4444' }}>{redRunesCollected}</span>
                  </div>
                )}

                {/* Power-ups HUD (inline, below runes) */}
                <div className="ygg-powerups-hud-inline">
                  {userUpgrades.magnetismLevel > 0 && (
                    <div className="ygg-pu-mini-sm ygg-magnet-badge" title={`Magnetism Level ${userUpgrades.magnetismLevel}`}>
                      <img src="/icons/minigames/yggdrasil/magnet.png" alt="magnet" className="ygg-pu-icon-img" />
                      <span>Lv.{userUpgrades.magnetismLevel}</span>
                    </div>
                  )}
                  <div className={`ygg-pu-mini-sm ${turboUsed ? 'pu-used' : ''} ${(shopTurboCharges + freeTurboCharges) >= 3 ? 'pu-max' : ''}`}>
                    <img src="/icons/minigames/yggdrasil/turbo.png" alt="turbo" className="ygg-pu-icon-img" />
                    <span>
                      {(shopTurboCharges + freeTurboCharges) >= 3 
                        ? 'MAX' 
                        : `x${shopTurboCharges}${freeTurboCharges > 0 ? ` + ${freeTurboCharges}` : ''}`}
                    </span>
                    {turboUsed && <span className="ygg-pu-float">-1</span>}
                  </div>
                  <div className={`ygg-pu-mini-sm ${jumpUsed ? 'pu-used' : ''} ${(shopJumpCharges + freeJumpCharges) >= 5 ? 'pu-max' : ''} ${doubleJumpDisabled ? 'pu-disabled' : ''}`}>
                    <img src="/icons/minigames/yggdrasil/double_jump.png" alt="jump" className="ygg-pu-icon-img" />
                    <span>
                      {(shopJumpCharges + freeJumpCharges) >= 5 
                        ? 'MAX' 
                        : `x${shopJumpCharges}${freeJumpCharges > 0 ? ` + ${freeJumpCharges}` : ''}`}
                    </span>
                    {jumpUsed && <span className="ygg-pu-float">-1</span>}
                  </div>
                  {userUpgrades.hasIdunApple && !appleUsedInRun && (
                    <div className="ygg-pu-mini-sm ygg-apple-badge" title="Iðunn's Apple — auto-activates on death">
                      <img src="/icons/minigames/yggdrasil/idunn's_apple.png" alt="apple" className="ygg-pu-icon-img" />
                      <span>REVIVE</span>
                    </div>
                  )}
                </div>


                {/* Turbo Active Bar */}
                {turboTime > 0 && (
                  <div className="ygg-turbo-active">
                    <div className="ygg-turbo-bar-inner" style={{ width: `${(turboTime / 60) * 100}%` }} />
                  </div>
                )}

                {/* Event Prize Chasing HUD */}
                {activeEvent && (
                  <div className="ygg-chasing">
                    <div style={{ position: 'relative' }}>
                      <img
                        src={activeEvent.prizeImage}
                        alt={activeEvent.prizeName}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: '11px', fontWeight: 'bold' }}>{activeEvent.prizeName}</span>
                    </div>
                  </div>
                )}
              </div>
              <div className="ygg-hud-right">
                <div className="ygg-players-pill">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                  {playerCount}
                </div>
              </div>
              {/* Height Bar */}
              <div className="ygg-height-bar">
                <div
                  className="ygg-height-fill"
                  style={{ height: `${Math.min(100, (score / 15000) * 100)}%` }}
                />
                <div className="ygg-height-marker" style={{ bottom: '6.6%' }}>1k</div>
                <div className="ygg-height-marker" style={{ bottom: '20%' }}>3k</div>
                <div className="ygg-height-marker" style={{ bottom: '33.3%' }}>5k</div>
                <div className="ygg-height-marker" style={{ bottom: '66.6%' }}>10k</div>
              </div>
            </div>
            
            {/* Emote Sidebar (Center-Right) */}
            {gameState === 'playing' && (
              <div className="ygg-emote-sidebar">
                <button
                  className={`ygg-hud-emote-btn-icon ${showEmoteMenu ? 'active' : ''}`}
                  onClick={() => setShowEmoteMenu(prev => !prev)}
                  title="Emotes"
                >
                  💬
                </button>

                {/* Emote Dropdown Menu (Side-positioned) */}
                {showEmoteMenu && (
                  <div className="ygg-emote-dropdown-side">
                    {EMOTES.map((e) => (
                      <button
                        key={e}
                        className={`ygg-emote-option-sm ${selectedEmote === e ? 'selected' : ''}`}
                        onClick={() => handleEmoteSelect(e)}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Zone Announcement Overlay */}
            {showZoneAnnouncement && (() => {
              const z = getZone(score);
              return (
                <div className="ygg-zone-announcement">
                  <div className="ygg-zone-banner" style={{
                    background: `linear-gradient(90deg, transparent, ${z.color}cc, transparent)`,
                    textShadow: `0 1px 8px ${z.color}88, 0 1px 4px rgba(0,0,0,0.5)`
                  }}>
                    {zoneName}
                  </div>
                </div>
              );
            })()}

            {/* Fallen Messages */}
            <div className="ygg-fallen-messages">
              {fallenMessages.map(m => (
                <div key={m.id} className="ygg-fallen-msg">
                  <img src="/icons/minigames/yggdrasil/death_spirit.png" alt="spirit" className="ygg-fallen-icon-img" />
                  <b>{m.name}</b> has fallen!
                </div>
              ))}
            </div>

            {/* Nidhogg Warning */}
            {nidhoggWarning && (
              <div className="ygg-nidhogg-warning">
                <span className="ygg-nidhogg-icon">🐉</span>
                <span>Níðhöggr rises!</span>
              </div>
            )}

            {/* Ratatoskr Notification */}
            {ratatoskrNotif && (
              <div className="ygg-ratatoskr-notif">
                <img src="/icons/minigames/yggdrasil/ratatoskr.png" alt="ratatoskr" className="ygg-notif-icon-img" />
                {ratatoskrNotif}
              </div>
            )}
          </>
        )}



        {/* Start Screen */}
        {gameState === 'start' && (
          <div className="ygg-start-overlay">
            <div className="ygg-start-title">Yggdrasil Ascender</div>
            <div className="ygg-start-subtitle">
              Climb the World Tree! Other players appear as ghosts alongside you.
            </div>

            {events.length > 0 && (
              <>
                <div className="ygg-events-container">
                  <div className="ygg-events-header">🏆 Special Events</div>
                  <div className="ygg-events-list-scroll custom-scrollbar">
                    <div className="ygg-events-grid">
                      {events.map(ev => (
                        <button
                          key={ev.id}
                          className={`ygg-event-btn ${ev.status} ${eventLoadingId === ev.id ? 'loading' : ''}`}
                          disabled={ev.status === 'closed' || eventLoading}
                          onClick={() => startGame(ev.id)}
                        >
                          <div className="ygg-event-info">
                            <div className="ygg-event-name">
                              {ev.name}
                              {ev.redRunesEnabled && (
                                <span className="ygg-event-red-rune-indicator" title="Red Runes available in this event!">
                                  <img src="/icons/minigames/yggdrasil/red_rune.png" alt="red rune" />
                                </span>
                              )}
                            </div>
                            <div className="ygg-event-prize">Prize: {ev.prizeName}</div>
                            {ev.status === 'open' && (
                              <>
                                {/* Runs counter removed per request */}
                                <div className="ygg-event-live">
                                  Running now: <b>{eventLiveCounts[ev.id] || 0}</b>
                                </div>
                              </>
                            )}
                          </div>

                          {ev.prizeImage && (
                            <div className="ygg-event-prize-thumb">
                              <img src={ev.prizeImage} alt="prize" />
                            </div>
                          )}

                          <div className="ygg-event-action">
                            {eventLoadingId === ev.id ? (
                              <div className="ygg-event-joining">Joining...</div>
                            ) : ev.status === 'closed' ? (
                              <div className="ygg-event-ended">
                                Ended<br />
                                <span className="ygg-winner-name">{ev.winnerName || 'Winner'} got it!</span>
                              </div>
                            ) : (
                              <div className="ygg-event-cost">
                                {ev.entryFee} {ev.currency === 'AURY' ? 'AURY' : 'VC'}
                              </div>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="ygg-lobby-divider" />
              </>
            )}

            <div className="ygg-rules-box" style={{ background: 'rgba(0,0,0,0.5)', padding: '10px 15px', borderRadius: '8px', marginBottom: '15px', border: '1px solid rgba(184,134,11,0.5)', fontSize: '13px', textAlign: 'left' }}>
              <div style={{ color: '#fbbf24', fontWeight: 'bold', marginBottom: '4px' }}>📜 Prize Calculation:</div>
              <ul style={{ margin: 0, paddingLeft: '16px', lineHeight: '1.4' }}>
                <li>First <b>{yggConfig.maxDailyRuns} runs per day</b> earn Valcoins!</li>
                <li>Base Reward: <b>1 VC per 100m</b> climbed.</li>
                <li><b>Runes</b> multiply your reward! (Rune multiplier: <b>{yggConfig.runeMultiplier}x</b>)</li>
              </ul>
            </div>

            <button className="ygg-rules-btn" onClick={() => setShowRules(true)}>📜 RULES &amp; POWER-UPS</button>

            {!assetsLoaded ? (
              <div className="ygg-loading">Loading Assets...</div>
            ) : (
              <>
                <button className="ygg-start-btn" onClick={() => startGame()}>Start Free Run</button>
                <button className="ygg-shop-trigger-btn" onClick={() => setShowShop(true)}>
                  <img src="/icons/minigames/yggdrasil/rune.png" alt="rune" className="ygg-btn-icon-img-inline" />
                  RUNE SHOP
                </button>
              </>
            )}
            <div className="ygg-controls-hint">
              <span><span className="ygg-key">←</span><span className="ygg-key">→</span> or <span className="ygg-key">A</span><span className="ygg-key">D</span></span>
              <span>📱 Tap left/right</span>
            </div>
          </div>
        )}

        {/* Game Over */}
        {(gameState === 'over' || gameState === 'apple_prompt') && (
          <div className="ygg-gameover-overlay">
            <div className="ygg-gameover-title" style={deathReason === 'nidhogg' ? { color: '#a855f7' } : {}}>
              {deathReason === 'nidhogg' ? 'Consumed by Níðhöggr!' : 'Fallen!'}
            </div>
            <div className="ygg-gameover-score">
              {score}<span>METERS</span>
            </div>
            <div className={`ygg-gameover-best ${isNewBest ? 'ygg-new-best' : ''}`}>
              {isNewBest ? '🎉 New Personal Best!' : `Best: ${bestScore}m`}
            </div>

            <div className="ygg-gameover-stats" style={{ display: 'flex', flexDirection: 'column', gap: '8px', margin: '15px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}>
                <span style={{ background: 'rgba(0,0,0,0.5)', padding: '4px 10px', borderRadius: '4px' }}>⬆️ Base: {Math.floor(score / 100)}</span>
                <span style={{ color: '#fbbf24' }}>✖️</span>
                <span style={{ background: 'rgba(0,0,0,0.5)', padding: '4px 10px', borderRadius: '4px' }}>
                  <img src="/icons/minigames/yggdrasil/rune.png" alt="rune" className="ygg-stats-icon-img" />
                  {runesCollected} Runes
                </span>
              </div>
              {redRunesCollected > 0 && (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}>
                  <span style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', padding: '4px 12px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <img src="/icons/minigames/yggdrasil/red_rune.png" alt="red rune" className="ygg-stats-icon-img" />
                    <span style={{ color: '#ef4444', fontWeight: 'bold' }}>{redRunesCollected} Red Runes</span>
                  </span>
                </div>
              )}

              {runStats?.loading && <div style={{ color: '#94a3b8', fontSize: '14px' }}>Calculating rewards...</div>}
              {runStats?.error && <div style={{ color: '#ef4444', fontSize: '14px' }}>{runStats.error}</div>}
              {runStats?.limitReached && <div style={{ color: '#ef4444', fontSize: '14px', fontWeight: 'bold' }}>Daily limit reached (No Valcoins or Banked Runes)</div>}

              {runStats?.success && !runStats?.limitReached && (
                <div style={{ background: 'rgba(184, 134, 11, 0.2)', border: '1px solid #b8860b', padding: '8px', borderRadius: '8px' }}>
                  <div style={{ color: '#fbbf24', fontWeight: 'bold', fontSize: '18px' }}>+{runStats.reward} Valcoins!</div>
                  {runStats.runesEarned > 0 && (
                    <div style={{ color: '#fbbf24', fontSize: '14px', fontWeight: 'bold', marginTop: '2px' }}>ᚠ {runStats.runesEarned} Runes Banked!</div>
                  )}
                  {runStats.redRunesEarned > 0 && (
                    <div style={{ color: '#ef4444', fontSize: '14px', fontWeight: 'bold', marginTop: '2px' }}>🔴 {runStats.redRunesEarned} Red Runes Banked!</div>
                  )}
                  <div style={{ color: '#cbd5e1', fontSize: '12px', marginTop: '4px' }}>Runs today: {runStats.runsCompleted}/{runStats.maxRuns}</div>
                </div>
              )}
            </div>

            <div className="ygg-gameover-btns">
              {gameState === 'apple_prompt' ? (
                <div className="ygg-apple-respawn-box">
                  <div className="ygg-apple-icon">
                    <img src="/icons/minigames/yggdrasil/idunn's_apple.png" alt="apple" className="ygg-apple-prompt-img" />
                  </div>
                  <div className="ygg-apple-timer" style={{
                    color: appleTimer <= 3 ? '#ef4444' : '#fbbf24',
                    textShadow: appleTimer <= 3 ? '0 0 10px rgba(239, 68, 68, 0.5)' : '0 0 10px rgba(251, 191, 36, 0.5)'
                  }}>
                    {appleTimer}s
                  </div>
                  <div className="ygg-apple-text">Use Iðunn's Apple to respawn?</div>
                  <div className="ygg-apple-actions">
                    <button className="ygg-apple-btn-respawn" onClick={() => handleAppleDecision(true)}>
                      🍎 RESPAWN
                    </button>
                    <button className="ygg-apple-btn-restart" onClick={() => {
                      handleAppleDecision(false);
                      setTimeout(() => startGame(activeEvent?.id), 100);
                    }}>
                      RESTART
                    </button>
                    <button className="ygg-apple-btn-decline" onClick={() => handleAppleDecision(false)}>
                      BACK TO MENU
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button className="ygg-retry-btn" onClick={() => startGame(activeEvent?.id)}>Play Again</button>

                  <button className="ygg-back-btn" onClick={() => setGameState('start')}>
                    Back to Menu
                  </button>

                  {activeEvent && (
                    <button className="ygg-free-btn" onClick={() => startGame()}>
                      Return to Free Play
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* Caught Prize Notification */}
        {eventPrizeCaught && (
          <div className="ygg-prize-caught-overlay" style={{
            position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.8)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            zIndex: 100, textAlign: 'center', animation: 'fadeIn 0.5s ease-out'
          }}>
            <div style={{ fontSize: '40px', marginBottom: '20px' }}>🎁</div>
            <div style={{ color: '#fbbf24', fontSize: '24px', fontWeight: 'bold', marginBottom: '10px' }}>TREASURE FOUND!</div>
            <div style={{ fontSize: '18px', color: '#fff', marginBottom: '30px' }}>You caught the {eventPrizeCaught}!</div>
            <button
              className="ygg-start-btn"
              onClick={() => {
                setEventPrizeCaught(null);
                setGameState('over');
              }}
            >
              CLAIM REWARD
            </button>
          </div>
        )}

        {/* Apple Respawn Prompt - Now integrated into Game Over screen */}
      </div>

      {/* Side Panel: Leaderboard & History */}
      <div className="ygg-side-panel">
        {/* Global Ascension Goal */}
        <div className="ygg-global-goal">
          <div className="ygg-goal-header">
            <span className="ygg-goal-title">Global Ascension</span>
            <span className="ygg-goal-count">
              {(globalGoal?.current || 0).toLocaleString()} / {(globalGoal?.target || 1000000).toLocaleString()}
            </span>
          </div>
          <div className="ygg-goal-bar">
            <div
              className="ygg-goal-fill"
              style={{ width: `${Math.min(100, (globalGoal.current / globalGoal.target) * 100)}%` }}
            >
              <div className="ygg-goal-shine"></div>
            </div>
          </div>
          {globalGoal.current >= globalGoal.target && (
            <div className="ygg-goal-reward">
              🎉 Goal Met! <b>{globalGoal.rewardMultiplier}x</b> Rewards Active!
            </div>
          )}
        </div>

        {/* Leaderboard */}
        <div className="ygg-leaderboard">
          <div className="ygg-lb-header">
            <span className="ygg-lb-title">Leaderboard</span>
            <div className="ygg-lb-controls">
              <select className="ygg-lb-dropdown" value={lbMetric} onChange={e => setLbMetric(e.target.value)}>
                <option value="altitude">Altitude</option>
                <option value="runes">Rune Balances</option>
                <option value="redRunes">Red Rune Balances</option>
              </select>
              {lbMetric === 'altitude' ? (
                <select className="ygg-lb-dropdown" value={lbMode} onChange={e => setLbMode(e.target.value)}>
                  <option value="daily">Today</option>
                  <option value="weekly">This Week</option>
                  <option value="monthly">This Month</option>
                  <option value="alltime">All Time</option>
                </select>
              ) : (
                <span className="ygg-lb-global-label">Global Top</span>
              )}
            </div>
          </div>
          <div className="ygg-lb-list">
            {lbLoading ? (
              <div className="ygg-lb-loading">
                <div className="viking-spinner"></div>
                <span>Fetching Ranks...</span>
              </div>
            ) : leaderboard.length === 0 ? (
              <div className="ygg-lb-empty">No scores yet. Be the first!</div>
            ) : leaderboard.map((entry, i) => (
              <div key={entry.uid} className={`ygg-lb-row ${entry.uid === user?.uid ? 'is-me' : ''}`}>
                <span className="ygg-lb-rank">#{i + 1}</span>
                <span className="ygg-lb-name">{nameCache[entry.uid] || entry.name}</span>
                <span className="ygg-lb-score">
                  {entry.score.toLocaleString()}
                  {lbMetric === 'altitude' ? 'm' : lbMetric === 'redRunes' ? ' 🔴' : ' ᚠ'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Global History Feed */}
        <div className="ygg-history">
          <div className="ygg-history-header">
            <span className="ygg-history-title">Global Activity</span>
          </div>
          <div className="ygg-history-list custom-scrollbar">
            {globalHistory.length === 0 ? (
              <div className="ygg-history-empty">Waiting for activity...</div>
            ) : (
              globalHistory.map(event => (
                <div key={event.id} className={`ygg-history-item ${event.type}`}>
                  <span className="ygg-history-time">{event.time}</span>
                  <span className="ygg-history-text">{event.text}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      {/* Rules Modal */}
      {showRules && (
        <div className="ygg-tutorial-overlay">
          <div className="ygg-tutorial-modal ygg-rules-modal">
            <h2 className="ygg-tutorial-title">RULES &amp; POWER-UPS</h2>

            <div className="ygg-rules-scroll custom-scrollbar">
              <div className="ygg-rules-section">
                <div className="ygg-rules-heading">💰 Rewards</div>
                <table className="ygg-rules-table">
                  <thead>
                    <tr><th>Condition</th><th>Bonus</th></tr>
                  </thead>
                  <tbody>
                    <tr><td>Daily Limit</td><td><b>{yggConfig.maxDailyRuns}</b> Runs/day</td></tr>
                    <tr><td>Altitude</td><td><b>1 VC</b> / 100m</td></tr>
                    <tr><td>Rune Multiplier</td><td><b>{yggConfig.runeMultiplier}x</b> total</td></tr>
                  </tbody>
                </table>
                <div className="ygg-formula-box">
                  <code>floor(alt/100) × max(1, floor(runes × {yggConfig.runeMultiplier}))</code>
                </div>
              </div>

              <div className="ygg-rules-section">
                <div className="ygg-rules-heading">⚡ Power-ups <span className="ygg-max-note">(Turbo: Max 3 | High Jump: Max 5)</span></div>
                <table className="ygg-rules-table">
                  <thead>
                    <tr><th>Item</th><th>Effect</th><th>Activate</th></tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>
                        <img src="/icons/minigames/yggdrasil/turbo.png" alt="turbo" className="ygg-rules-icon-img" />
                        Turbo
                      </td>
                      <td>Massive speed boost (2s)</td>
                      <td style={{ color: '#fbbf24' }}>
                        [SHIFT]/[E] / <img src="/icons/minigames/yggdrasil/turbo.png" alt="turbo" className="ygg-rules-icon-img-sm" />
                      </td>
                    </tr>
                    <tr>
                      <td>
                        <img src="/icons/minigames/yggdrasil/double_jump.png" alt="jump" className="ygg-rules-icon-img" />
                        High Jump
                      </td>
                      <td>Double jump mid-air</td>
                      <td style={{ color: '#fbbf24' }}>[SPACE] / JUMP</td>
                    </tr>
                  </tbody>
                </table>
                <div style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.4)', marginTop: '4px' }}>
                  Turbo spawns every 3000m. High Jump spawns every 2000m. Items won't be collected when at max.
                </div>
              </div>

              <div className="ygg-rules-section">
                <div className="ygg-rules-heading">🌍 Weather Zones</div>
                <table className="ygg-rules-table ygg-zones-table">
                  <thead>
                    <tr><th>Zone</th><th>Altitude</th><th>Condition</th></tr>
                  </thead>
                  <tbody>
                    {ZONES.map((z, i) => {
                      const prev = i > 0 ? ZONES[i - 1].maxAlt / 1000 : 0;
                      const altText = z.maxAlt === Infinity ? `${prev}km+` : `${prev}–${z.maxAlt / 1000}km`;
                      return (
                        <tr key={z.name}>
                          <td><span className="ygg-zone-dot" style={{ background: z.color }} />{z.name.replace('_', ' ')}</td>
                          <td>{altText}</td>
                          <td style={{ color: z.color, fontWeight: 700 }}>{z.condition}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="ygg-rules-section">
                <div className="ygg-rules-heading">🎮 Controls</div>
                <table className="ygg-rules-table">
                  <thead>
                    <tr><th>Action</th><th>PC</th><th>Mobile</th></tr>
                  </thead>
                  <tbody>
                    <tr><td>Move</td><td>← → / A D</td><td>D-pad</td></tr>
                    <tr><td>Jump</td><td>Space / ↑</td><td>JUMP btn</td></tr>
                    <tr><td>Turbo</td><td>Shift / E</td><td>
                      <img src="/icons/minigames/yggdrasil/turbo.png" alt="turbo" className="ygg-rules-icon-img-sm" />
                    </td></tr>
                  </tbody>
                </table>
              </div>
            </div>

            <button className="ygg-tut-close" onClick={() => setShowRules(false)}>GOT IT</button>
          </div>
        </div>
      )}

      {/* Rune Shop Modal */}
      {showShop && (
        <RuneShop
          user={user}
          config={yggConfig}
          onClose={() => setShowShop(false)}
          onUpdate={loadUserShopData}
        />
      )}

    </div>
  );
};

// Helper: rounded rectangle
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export default YggdrasilAscender;
