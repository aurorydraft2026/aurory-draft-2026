import React, { useState, useEffect, useRef, useCallback } from 'react';
import { database, db } from '../../firebase';
import { ref, onValue, set, remove, onDisconnect, get, query, orderByChild, limitToLast } from 'firebase/database';
import { doc, getDoc } from 'firebase/firestore';
import { submitYggdrasilRun, getYggdrasilEvents, joinYggdrasilEvent, claimYggdrasilEventPrize } from '../../services/miniGameService';
import { resolveDisplayName } from '../../utils/userUtils';
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
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
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
    const roll = rng();
    if (difficulty > 0.1 && roll < 0.1) type = 'boost'; // 10% boost
    else if (difficulty > 0.05 && roll < 0.40) type = 'moving'; // 25% moving
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

  // Assign 1 turbo + 1 doubleJump per 2000m altitude band
  // Skip bands that already have items from previous generatePlatforms calls
  const bands = {};
  for (const plat of platforms) {
    const alt = Math.floor(-plat.y / 4);
    const band = Math.floor(alt / 2000);
    if (!bands[band]) bands[band] = [];
    bands[band].push(plat);
  }
  for (const band of Object.keys(bands)) {
    const bandNum = parseInt(band);
    if (usedBands && usedBands.has(bandNum)) continue; // Already assigned in a previous batch
    const eligible = bands[band].filter(p => p.type === 'standard' || p.type === 'moving');
    if (eligible.length > 0) {
      const shuffled = eligible.sort(() => rng() - 0.5);
      shuffled[0].item = 'turbo';
      if (shuffled.length > 1) {
        shuffled[1].item = 'doubleJump';
      }
      if (usedBands) usedBands.add(bandNum); // Mark band as used
    }
  }

  return platforms;
}

const YggdrasilAscender = ({ user }) => {
  const canvasRef = useRef(null);
  const gameRef = useRef(null);
  const animRef = useRef(null);
  const assetsRef = useRef({ stand: null, jump: null, turbo: null, plat1: null, plat2: null, background: null });
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
  const [turboCharges, setTurboCharges] = useState(1);
  const [doubleJumpCharges, setDoubleJumpCharges] = useState(1);
  const zoneNameRef = useRef('MIDGARD');
  const [playerCount, setPlayerCount] = useState(1);
  const [lbMode, setLbMode] = useState('daily');
  const [leaderboard, setLeaderboard] = useState([]);
  const [lbLoading, setLbLoading] = useState(false);
  const [nameCache, setNameCache] = useState({});
  const [activeEventId, setActiveEventId] = useState(null);
  const [eventLiveCounts, setEventLiveCounts] = useState({});
  const nameCacheRef = useRef({}); // Ref to avoid dependency loop in useEffect
  const ghostPlayersDataRef = useRef({}); // Avoid stale closure in requestAnimationFrame
  const ghostVisualsRef = useRef({}); // { uid: { x, y, targetX, targetY } }
  const [runesCollected, setRunesCollected] = useState(0);
  const [turboTime, setTurboTime] = useState(0);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [runStats, setRunStats] = useState(null);
  const [showRules, setShowRules] = useState(false);
  const [turboUsed, setTurboUsed] = useState(false);
  const [jumpUsed, setJumpUsed] = useState(false);
  const [yggConfig, setYggConfig] = useState({ maxDailyRuns: 5, runeMultiplier: 1.0 });
  const bestScoreRef = useRef(0);
  
  // Events
  const [events, setEvents] = useState([]);
  const [activeEvent, setActiveEvent] = useState(null);
  const activeEventIdRef = useRef(null);
  const [eventPrizeCaught, setEventPrizeCaught] = useState(null);
  const [eventLoading, setEventLoading] = useState(false);
  const [eventLoadingId, setEventLoadingId] = useState(null);
  const [fallenMessages, setFallenMessages] = useState([]);
  const prevPlayersRef = useRef({});

  // Fetch admin config for prize calculation display
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const configSnap = await getDoc(doc(db, 'settings', 'mini_games'));
        if (configSnap.exists()) {
          const data = configSnap.data()?.yggdrasilAscender || {};
          setYggConfig({
            maxDailyRuns: data.maxDailyRuns ?? 5,
            runeMultiplier: data.runeMultiplier ?? 1.0
          });
        }
      } catch (err) {
        console.warn('Failed to fetch ygg config, using defaults', err);
      }
    };
    fetchConfig();
  }, []);

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
      processImage('/icons/minigames/yggdrasil/background.png')
    ]).then(([stand, jump, turbo, plat1, plat2, background]) => {
      assetsRef.current = { stand, jump, turbo, plat1, plat2, background };
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

  // Load events
  useEffect(() => {
    getYggdrasilEvents().then(setEvents);
  }, [gameState]);

  // Subscribe to ghost players
  useEffect(() => {
    if (!user?.uid) return;
    const playersRef = ref(database, 'yggdrasil/players');
    const unsub = onValue(playersRef, snap => {
      const data = snap.val() || {};
      const { [user.uid]: _, ...others } = data;
      
      // Detect falls (players who were in prev but not in current)
      const prevOthers = prevPlayersRef.current;
      Object.keys(prevOthers).forEach(uid => {
        if (!others[uid]) {
          const pName = prevOthers[uid].name || 'A Warrior';
          const id = Date.now() + Math.random();
          setFallenMessages(prev => [...prev.slice(-2), { id, name: pName }]);
          setTimeout(() => {
            setFallenMessages(prev => prev.filter(m => m.id !== id));
          }, 4000);
        }
      });

      prevPlayersRef.current = others;
      ghostPlayersDataRef.current = others;
      setPlayerCount(Object.keys(others).length + 1);
    });
    return () => unsub();
  }, [user?.uid]);

  // Subscribe to leaderboard
  useEffect(() => {
    setLbLoading(true);
    let path;
    const now = new Date();
    
    if (lbMode === 'daily') {
      path = `yggdrasil/leaderboard/daily/${getDailySeed()}`;
    } else if (lbMode === 'weekly') {
      const weekNum = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / 604800000);
      path = `yggdrasil/leaderboard/weekly/${now.getFullYear()}_w${weekNum}`;
    } else if (lbMode === 'monthly') {
      const monthId = `${now.getFullYear()}_m${String(now.getMonth() + 1).padStart(2, '0')}`;
      path = `yggdrasil/leaderboard/monthly/${monthId}`;
    } else {
      path = 'yggdrasil/leaderboard/alltime';
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
  }, [lbMode, user]);


  // Publish presence
  const publishPresence = useCallback((x, y) => {
    if (!user?.uid) return;
    const pRef = ref(database, `yggdrasil/players/${user.uid}`);
    set(pRef, {
      x, y,
      name: resolveDisplayName(user),
      color: '#' + user.uid.slice(0, 6),
      t: Date.now(),
      eventId: activeEventId
    });
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
  const submitScore = useCallback((finalScore) => {
    if (!user?.uid || finalScore <= 0) return;
    const name = resolveDisplayName(user);
    const seed = gameRef.current?.seed || getDailySeed();
    const scoreData = { name, score: finalScore, t: Date.now() };

    // 1. Daily
    const dailyRef = ref(database, `yggdrasil/leaderboard/daily/${seed}/${user.uid}`);
    get(dailyRef).then(snap => {
      if (!snap.exists() || snap.val().score < finalScore) set(dailyRef, scoreData);
    });

    // 2. Weekly
    const now = new Date();
    const weekNum = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / 604800000);
    const weeklyRef = ref(database, `yggdrasil/leaderboard/weekly/${now.getFullYear()}_w${weekNum}/${user.uid}`);
    get(weeklyRef).then(snap => {
      if (!snap.exists() || snap.val().score < finalScore) set(weeklyRef, scoreData);
    });

    // 3. Monthly
    const monthId = `${now.getFullYear()}_m${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthlyRef = ref(database, `yggdrasil/leaderboard/monthly/${monthId}/${user.uid}`);
    get(monthlyRef).then(snap => {
      if (!snap.exists() || snap.val().score < finalScore) set(monthlyRef, scoreData);
    });

    // 4. All-time
    const atRef = ref(database, `yggdrasil/leaderboard/alltime/${user.uid}`);
    get(atRef).then(snap => {
      if (!snap.exists() || snap.val().score < finalScore) set(atRef, scoreData);
    });
  }, [user]);

  // Init game
  const initGame = useCallback((eventOverride = null) => {
    const seed = getDailySeed();
    const rng = seededRandom(seed);
    const itemBandsUsed = new Set();
    const startPlats = generatePlatforms(80, CANVAS_H - 50, rng, 0, itemBandsUsed);
    // Add ground platform (full width, invisible floor)
    startPlats.push({ x: 0, y: CANVAS_H - 15, w: CANVAS_W, h: 20, type: 'ground', broken: false, moveDir: 1 });
    startPlats.sort((a, b) => b.y - a.y);

    const eventToUse = eventOverride || activeEvent;

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
        turboCharges: 1,
        doubleJumpCharges: 1,
        usedDoubleJumpInAir: false
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
      particles: [],
      windParticles: [], // decorative wind streaks
      itemBandsUsed,
      milestonesHit: new Set(),
      rewards: 0,
      shake: 0, // screen shake magnitude
      lastTime: performance.now(),
      lastHUDTime: 0,
      flashAlpha: 0, // for lightning
      weatherType: 'clear', // clear, thunderstorm, cosmic
      thunderState: 'none', // none, warning, flashing
      thunderTimer: 0,
      thunderCount: 0,
      lastThunderTime: 0,
      stars: Array.from({ length: 40 }, () => ({
        x: rng() * CANVAS_W,
        y: rng() * CANVAS_H * 3,
        size: 1 + rng() * 1
      })),
      specialPrize: eventToUse ? {
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

    setRunesCollected(0);
    setRunStats(null);
    keysRef.current = {};
    touchRef.current = { left: false, right: false, jump: false };
  }, [activeEvent]);

  // Game loop
  const gameLoop = useCallback(() => {
    const g = gameRef.current;
    const canvas = canvasRef.current;
    if (!g || !canvas) return;
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
      } else if (!lastJumpPressed && p.doubleJumpCharges > 0 && !p.usedDoubleJumpInAir && p.turboTime <= 0) {
        p.vy = JUMP_FORCE * 1.1; // HIGH JUMP!
        p.doubleJumpCharges--;
        p.usedDoubleJumpInAir = true;
        setDoubleJumpCharges(p.doubleJumpCharges);
        setJumpUsed(true);
        setTimeout(() => setJumpUsed(false), 1000);
        for (let di = 0; di < 6; di++) {
          g.particles.push({
            x: p.x + PLAYER_W/2 + (Math.random()-0.5)*20, y: p.y + PLAYER_H,
            vx: (Math.random()-0.5)*3, vy: 1 + Math.random()*2,
            life: 15, color: '#60a5fa', size: 3
          });
        }
      }
    }
    keysRef.current['lastJump'] = jumpPressed;

    // Turbo activation (anytime)
    const turboPressed = keysRef.current['ShiftLeft'] || keysRef.current['ShiftRight'] || keysRef.current['KeyE'] || touchRef.current.turbo;
    const lastTurboPressed = keysRef.current['lastTurbo'] || false;

    if (turboPressed && !lastTurboPressed && p.turboCharges > 0 && p.turboTime <= 0) {
      p.turboCharges--;
      setTurboCharges(p.turboCharges);
      p.turboTime = 120; // 2 seconds
      g.shake = 10;
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
      // Thunderclap trigger with 5-7s cooldown
      const cooldown = 5000 + (g.rng ? g.rng() : Math.random()) * 2000;
      if (now - g.lastThunderTime > cooldown && Math.random() < 0.005 && g.thunderState === 'none') {
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
          const atMax = isTurbo ? (p.turboCharges || 0) >= 3 : (p.doubleJumpCharges || 0) >= 3;
          
          if (atMax) {
            // Don't collect — item stays visible
            // Skip collection entirely
          } else {
            plat.itemCollected = true;
            if (isTurbo) {
              p.turboCharges = (p.turboCharges || 0) + 1;
              setTurboCharges(p.turboCharges);
            } else if (isJump) {
              p.doubleJumpCharges = (p.doubleJumpCharges || 0) + 1;
              setDoubleJumpCharges(p.doubleJumpCharges);
            }
            // Collect effect
            for(let i=0; i<10; i++) {
              g.particles.push({
                x: ix, y: iy, vx: (Math.random()-0.5)*5, vy: (Math.random()-0.5)*5, 
                life: 20, color: plat.item === 'turbo' ? '#fbbf24' : '#60a5fa', size: 3
              });
            }
          }
        }
      }
    }

    // Rune collection
    for (const plat of g.platforms) {
      if (!plat.hasRune || plat.runeCollected || plat.broken) continue;
      const runeX = plat.x + plat.w / 2;
      const runeY = plat.y - 20;
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

    // Special Prize collision
    if (g.specialPrize && !g.specialPrize.collected) {
      const sp = g.specialPrize;
      if (
        p.x + PLAYER_W > sp.x &&
        p.x < sp.x + sp.w &&
        p.y + PLAYER_H > sp.y &&
        p.y < sp.y + sp.h
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
          platSpeedMult = 1.0 + (asgardProgress * 0.4); // 40% faster every 2k
        }

        const speed = 1.5 * (1 + g.difficulty * 3) * platSpeedMult * dt;
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
    }

    // Player squash/stretch lerp
    p.squash += (1 - p.squash) * 0.3;
    p.scaleX = 1 + (1 - p.squash);
    p.scaleY = p.squash;
    // apply stretch based on velocity
    if (p.turboTime > 0) {
      // Stabilize scale during turbo to prevent pulsing
      p.scaleY = 1.0;
      p.scaleX = 1.0;
    } else {
      p.scaleY = 1.0;
      p.scaleX = 1.0;
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
      const newPlats = generatePlatforms(20, g.platGenY, g.rng, g.difficulty, g.itemBandsUsed);
      g.platforms.push(...newPlats);
      g.platGenY = newPlats[newPlats.length - 1].y;
    }

    // Cull old platforms
    g.platforms = g.platforms.filter(pl => pl.y < g.camera + CANVAS_H + 100);

    // Game over
    if (p.y > g.camera + CANVAS_H + 120) {
      setScore(g.maxAlt);
      setRunesCollected(g.runes);
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

      // Request run rewards
      setRunStats({ loading: true });
      submitYggdrasilRun(g.maxAlt, g.runes).then(res => {
        if (res && res.success) {
          setRunStats(res);
        } else {
          setRunStats({ error: res?.error || 'Failed to submit' });
        }
      });
      return;
    }

    // Publish presence (throttled ~10/sec)
    if (now - g.lastPublish > 100) {
      publishPresence(Math.round(p.x), Math.round(p.y));
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
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '32px sans-serif';
        ctx.shadowBlur = 20;
        ctx.shadowColor = plat.item === 'turbo' ? '#fbbf24' : '#60a5fa';
        ctx.fillText(plat.item === 'turbo' ? '\uD83D\uDE80' : '\uD83D\uDC5F', cx, cy);
        ctx.restore();
      }

      // Draw icons on top of platforms if they are special types
      if (plat.type === 'boost') {
        ctx.save();
        ctx.fillStyle = '#92400e';
        ctx.font = 'bold 24px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('⚡', plat.x + plat.w / 2, plat.y - 20);
        ctx.restore();
      }

      ctx.restore();

      // Draw rune floating above platform
      if (plat.hasRune && !plat.runeCollected) {
        const runeX = plat.x + plat.w / 2;
        const runeY = plat.y - 20 + Math.sin(Date.now() / 300 + plat.x) * 3;
        ctx.save();
        ctx.fillStyle = '#fbbf24';
        ctx.font = `bold ${RUNE_SIZE}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.lineWidth = 3;
        ctx.strokeText(plat.runeSymbol, runeX, runeY);
        ctx.fillText(plat.runeSymbol, runeX, runeY);
        ctx.restore();
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

    // Draw Special Prize
    if (g.specialPrize && !g.specialPrize.collected) {
      const sp = g.specialPrize;
      // Only draw if on screen
      if (sp.y > g.camera - 100 && sp.y < g.camera + CANVAS_H + 100) {
        const floatY = Math.sin(Date.now() / 400) * 10;
        
        ctx.save();
        // Pulsing glow
        ctx.shadowBlur = 15 + Math.sin(Date.now() / 200) * 8;
        ctx.shadowColor = '#fbbf24';

        if (sp.image) {
          ctx.drawImage(sp.image, sp.x, sp.y + floatY, sp.w, sp.h);
        } else {
          // Glow effect if image not loaded yet
          ctx.fillStyle = '#fbbf24';
          ctx.beginPath();
          ctx.arc(sp.x + sp.w / 2, sp.y + sp.h / 2 + floatY, sp.w / 2, 0, Math.PI * 2);
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

    // Update React state for HUD (Throttled to 15fps for maximum performance)
    if (now - g.lastHUDTime > 66) {
      setScore(alt);
      setTurboTime(Math.max(0, p.turboTime));
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

    // Weather Visuals
    if (g.weatherType === 'cosmic') {
      // Shifting Aurora curtains
      ctx.save();
      ctx.globalAlpha = 0.2;
      const hue = (now / 50) % 360;
      const aurGrad = ctx.createLinearGradient(0, 0, CANVAS_W, 0);
      aurGrad.addColorStop(0, `hsla(${hue}, 70%, 50%, 0)`);
      aurGrad.addColorStop(0.5, `hsla(${(hue + 60) % 360}, 70%, 50%, 0.8)`);
      aurGrad.addColorStop(1, `hsla(${(hue + 120) % 360}, 70%, 50%, 0)`);
      ctx.fillStyle = aurGrad;
      for(let i=0; i<2; i++) {
        const offset = Math.sin(now / 1000 + i) * 50;
        ctx.fillRect(offset, 0, CANVAS_W, CANVAS_H);
      }
      ctx.restore();
    } else if (g.weatherType === 'bifrost') {
      // Shifting Rainbow Bridge overlay
      ctx.save();
      ctx.globalAlpha = 0.08; // Lowered from 0.15
      const rainbowGrad = ctx.createLinearGradient(0, 0, CANVAS_W, 0);
      for(let i=0; i<=6; i++) {
        const hue = (i * 60 + now / 10) % 360;
        rainbowGrad.addColorStop(i/6, `hsla(${hue}, 80%, 50%, 1)`);
      }
      ctx.fillStyle = rainbowGrad;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.restore();
    }

    if (g.flashAlpha > 0) {
      // Thunderclap Darkness flickering
      const opacity = g.flashAlpha > 0.5 ? g.flashAlpha : g.flashAlpha;
      ctx.fillStyle = `rgba(0, 0, 0, ${opacity})`;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }

    animRef.current = requestAnimationFrame(gameLoop);
  }, [publishPresence, removePresence, submitScore]);

  // Start/restart game
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
      setActiveEvent(ev);
      setActiveEventId(eventId);
      activeEventIdRef.current = eventId;
      initGame(ev);
    } else {
      setActiveEvent(null);
      setActiveEventId(null);
      activeEventIdRef.current = null;
      initGame(null);
    }

    keysRef.current = {};
    touchRef.current = { left: false, right: false, jump: false, turbo: false };
    setGameState('playing');
    setIsNewBest(false);
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
  }, [initGame, gameLoop, user, events]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      removePresence();
    };
  }, [removePresence]);

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
    <div className="ygg-container">
      <div className="ygg-canvas-wrapper">
        <canvas
          ref={canvasRef}
        />

        {/* Mobile Controls Overlay */}
        {gameState === 'playing' && isTouchDevice && (
          <div className="ygg-mobile-controls" style={{
            position: 'absolute', bottom: '30px', left: 0, right: 0,
            display: 'flex', justifyContent: 'space-between', padding: '0 12px', pointerEvents: 'none'
          }}>
            <div className="ygg-mobile-controls-row">
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
              
              <div className="ygg-mobile-actions">
                <button 
                  className="ygg-ctrl-btn turbo-btn"
                  onTouchStart={(e) => { e.preventDefault(); touchRef.current.turbo = true; }}
                  onTouchEnd={(e) => { e.preventDefault(); touchRef.current.turbo = false; }}
                >🚀</button>
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
                {runesCollected > 0 && <div className="ygg-runes-hud">ᚠ {runesCollected}</div>}

                {/* Power-ups HUD (inline, below runes) */}
                <div className="ygg-powerups-hud-inline">
                  <div className={`ygg-pu-mini-sm ${turboUsed ? 'pu-used' : ''} ${turboCharges >= 3 ? 'pu-max' : ''}`}>
                    <span role="img" aria-label="rocket">&#x1F680;</span>
                    <span>{turboCharges >= 3 ? 'MAX' : `x${turboCharges}`}</span>
                    {turboUsed && <span className="ygg-pu-float">-1</span>}
                  </div>
                  <div className={`ygg-pu-mini-sm ${jumpUsed ? 'pu-used' : ''} ${doubleJumpCharges >= 3 ? 'pu-max' : ''}`}>
                    <span role="img" aria-label="shoes">&#x1F45F;</span>
                    <span>{doubleJumpCharges >= 3 ? 'MAX' : `x${doubleJumpCharges}`}</span>
                    {jumpUsed && <span className="ygg-pu-float">-1</span>}
                  </div>
                </div>

                {/* Turbo Active Bar */}
                {turboTime > 0 && (
                  <div className="ygg-turbo-active">
                    <div className="ygg-turbo-bar-inner" style={{ width: `${(turboTime / 120) * 100}%` }} />
                  </div>
                )}

                {/* Event Prize Chasing HUD */}
                {activeEvent && (
                  <div className="ygg-chasing">
                    <img src={activeEvent.prizeImage} alt={activeEvent.prizeName} />
                    <span>{activeEvent.prizeName}</span>
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
                  💀 <b>{m.name}</b> has fallen!
                </div>
              ))}
            </div>
          </>
        )}



        {/* Start Screen */}
        {gameState === 'start' && (
          <div className="ygg-start-overlay">
            <div className="ygg-start-title">Yggdrasil Ascender</div>
            <div className="ygg-start-subtitle">
              Climb the World Tree! Other players appear as ghosts alongside you.
            </div>

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
                
                {events.length > 0 && (
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
                              <div className="ygg-event-name">{ev.name}</div>
                              <div className="ygg-event-prize">Prize: {ev.prizeName}</div>
                              {ev.status === 'open' && (
                                <>
                                  <div className="ygg-event-pool">
                                    Runs: <span>{ev.currentPool || 0}</span>
                                  </div>
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
                                  Ended<br/>
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
                )}
              </>
            )}
            <div className="ygg-controls-hint">
              <span><span className="ygg-key">←</span><span className="ygg-key">→</span> or <span className="ygg-key">A</span><span className="ygg-key">D</span></span>
              <span>📱 Tap left/right</span>
            </div>
          </div>
        )}

        {/* Game Over */}
        {gameState === 'over' && (
          <div className="ygg-gameover-overlay">
            <div className="ygg-gameover-title">Fallen!</div>
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
                <span style={{ background: 'rgba(0,0,0,0.5)', padding: '4px 10px', borderRadius: '4px' }}>ᚠ {runesCollected} Runes</span>
              </div>

              {runStats?.loading && <div style={{ color: '#94a3b8', fontSize: '14px' }}>Calculating rewards...</div>}
              {runStats?.error && <div style={{ color: '#ef4444', fontSize: '14px' }}>{runStats.error}</div>}
              {runStats?.limitReached && <div style={{ color: '#ef4444', fontSize: '14px', fontWeight: 'bold' }}>Daily limit reached (No Valcoins)</div>}

              {runStats?.success && !runStats?.limitReached && (
                <div style={{ background: 'rgba(184, 134, 11, 0.2)', border: '1px solid #b8860b', padding: '8px', borderRadius: '8px' }}>
                  <div style={{ color: '#fbbf24', fontWeight: 'bold', fontSize: '18px' }}>+{runStats.reward} Valcoins!</div>
                  <div style={{ color: '#cbd5e1', fontSize: '12px', marginTop: '4px' }}>Runs today: {runStats.runsCompleted}/{runStats.maxRuns}</div>
                </div>
              )}
            </div>

            <div className="ygg-gameover-btns">
              <button className="ygg-retry-btn" onClick={() => startGame(activeEvent?.id)}>Play Again</button>
              
              <button className="ygg-back-btn" onClick={() => setGameState('start')}>
                Back to Menu
              </button>

              {activeEvent && (
                <button className="ygg-free-btn" onClick={() => startGame()}>
                  Return to Free Play
                </button>
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
      </div>

      {/* Leaderboard */}
      <div className="ygg-leaderboard">
        <div className="ygg-lb-header">
          <span className="ygg-lb-title">Leaderboard</span>
          <select className="ygg-lb-dropdown" value={lbMode} onChange={e => setLbMode(e.target.value)}>
            <option value="daily">Today</option>
            <option value="weekly">This Week</option>
            <option value="monthly">This Month</option>
            <option value="alltime">All Time</option>
          </select>
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
              <span className="ygg-lb-score">{entry.score}m</span>
            </div>
          ))}
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
                <div className="ygg-rules-heading">⚡ Power-ups <span className="ygg-max-note">(Max 3 Charges each)</span></div>
                <table className="ygg-rules-table">
                  <thead>
                    <tr><th>Item</th><th>Effect</th><th>Activate</th></tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><span style={{ fontSize: '1.2rem' }}>&#x1F680;</span> Turbo</td>
                      <td>Massive speed boost (2s)</td>
                      <td style={{ color: '#fbbf24' }}>[SHIFT]/[E] / 🚀</td>
                    </tr>
                    <tr>
                      <td><span style={{ fontSize: '1.2rem' }}>&#x1F45F;</span> High Jump</td>
                      <td>Double jump mid-air</td>
                      <td style={{ color: '#fbbf24' }}>[SPACE] / JUMP</td>
                    </tr>
                  </tbody>
                </table>
                <div style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.4)', marginTop: '4px' }}>
                  Spawns every 2000m. Items won't be collected when at max.
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
                    <tr><td>Turbo</td><td>Shift / E</td><td>🚀 btn</td></tr>
                  </tbody>
                </table>
              </div>
            </div>

            <button className="ygg-tut-close" onClick={() => setShowRules(false)}>GOT IT</button>
          </div>
        </div>
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
