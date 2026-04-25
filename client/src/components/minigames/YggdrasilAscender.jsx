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
const PLAYER_W = 55;
const PLAYER_H = 80;
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
  { maxAlt: 2000, name: 'MIDGARD', bg1: '#0d1b0e', bg2: '#1a3a1c' },
  { maxAlt: 5000, name: 'CLOUDS', bg1: '#0f1729', bg2: '#1e3a5f' },
  { maxAlt: 10000, name: 'BIFROST', bg1: '#1a0a2e', bg2: '#2d1b69' },
  { maxAlt: Infinity, name: 'ASGARD', bg1: '#1a0a0a', bg2: '#3d1f00' },
];

function getZone(alt) {
  for (const z of ZONES) if (alt < z.maxAlt) return z;
  return ZONES[ZONES.length - 1];
}

// Platform generation
function generatePlatforms(count, startY, rng, difficulty) {
  const platforms = [];
  let y = startY;
  for (let i = 0; i < count; i++) {
    const gap = PLAT_GAP_MIN + rng() * (PLAT_GAP_MAX - PLAT_GAP_MIN);
    y -= gap;
    const x = rng() * (CANVAS_W - PLAT_W);
    // Platform type based on difficulty (starts earlier)
    let type = 'standard';
    const roll = rng();
    if (difficulty > 0.1 && roll < 0.08) type = 'boost'; // 8%
    else if (difficulty > 0.15 && roll < 0.15) type = 'turbo'; // 7%
    else if (difficulty > 0.05 && roll < 0.40) type = 'moving'; // 25%
    else if (difficulty > 0.08 && roll < (difficulty > 0.66 ? 0.85 : 0.60)) type = 'fragile'; // much more common at 10k

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
      runeCollected: false
    });
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
  const [playerCount, setPlayerCount] = useState(1);
  const [lbMode, setLbMode] = useState('daily');
  const [leaderboard, setLeaderboard] = useState([]);
  const [lbLoading, setLbLoading] = useState(false);
  const [nameCache, setNameCache] = useState({});
  const nameCacheRef = useRef({}); // Ref to avoid dependency loop in useEffect
  const ghostPlayersDataRef = useRef({}); // Avoid stale closure in requestAnimationFrame
  const ghostVisualsRef = useRef({}); // { uid: { x, y, targetX, targetY } }
  const [runesCollected, setRunesCollected] = useState(0);
  const [turboTime, setTurboTime] = useState(0);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [runStats, setRunStats] = useState(null);
  const zoneNameRef = useRef('MIDGARD');
  const bestScoreRef = useRef(0);
  
  // Events
  const [events, setEvents] = useState([]);
  const [activeEvent, setActiveEvent] = useState(null);
  const activeEventIdRef = useRef(null);
  const [eventPrizeCaught, setEventPrizeCaught] = useState(null);
  const [eventLoading, setEventLoading] = useState(false);
  const [eventLoadingId, setEventLoadingId] = useState(null);

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
      if (snap.exists()) {
        const data = snap.val();
        const { [user.uid]: _, ...others } = data;
        ghostPlayersDataRef.current = others;
        setPlayerCount(Object.keys(others).length + 1);
      } else {
        ghostPlayersDataRef.current = {};
        setPlayerCount(1);
      }
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

  // One-time migration: Populate monthly leaderboard from all-time scores if they are from this month
  useEffect(() => {
    if (!user?.uid) return;
    const now = new Date();
    const monthId = `${now.getFullYear()}_m${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthlyPath = `yggdrasil/leaderboard/monthly/${monthId}`;
    
    // Check if monthly exists
    get(ref(database, monthlyPath)).then(snap => {
      if (!snap.exists()) {
        console.log("Monthly leaderboard empty, migrating from All-time...");
        get(ref(database, 'yggdrasil/leaderboard/alltime')).then(atSnap => {
          if (atSnap.exists()) {
            atSnap.forEach(child => {
              const data = child.val();
              const scoreDate = new Date(data.t || 0);
              // If the score was made in the current month/year
              if (scoreDate.getFullYear() === now.getFullYear() && scoreDate.getMonth() === now.getMonth()) {
                set(ref(database, `${monthlyPath}/${child.key}`), data);
              }
            });
          }
        });
      }
    });
  }, [user?.uid]);

  // Publish presence
  const publishPresence = useCallback((x, y) => {
    if (!user?.uid) return;
    const pRef = ref(database, `yggdrasil/players/${user.uid}`);
    set(pRef, {
      x, y,
      name: resolveDisplayName(user),
      color: '#' + user.uid.slice(0, 6),
      t: Date.now()
    });
  }, [user]);

  // Remove presence
  const removePresence = useCallback(() => {
    if (!user?.uid) return;
    remove(ref(database, `yggdrasil/players/${user.uid}`));
  }, [user]);

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
  const initGame = useCallback(() => {
    const seed = getDailySeed();
    const rng = seededRandom(seed);
    const startPlats = generatePlatforms(80, CANVAS_H - 50, rng, 0);
    // Add ground platform (full width, invisible floor)
    startPlats.push({ x: 0, y: CANVAS_H - 15, w: CANVAS_W, h: 20, type: 'ground', broken: false, moveDir: 1 });
    startPlats.sort((a, b) => b.y - a.y);

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
        turboTime: 0
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
      milestonesHit: new Set(),
      rewards: 0,
      shake: 0, // screen shake magnitude
      lastTime: performance.now(),
      lastHUDTime: 0,
      specialPrize: (activeEvent && activeEvent.currentPool >= activeEvent.targetPool) ? {
        x: CANVAS_W / 2 - 25,
        y: -activeEvent.targetAltitude * 4,
        w: 50,
        h: 50,
        collected: false,
        name: activeEvent.prizeName,
        image: null // will be loaded
      } : null
    };

    // Load special prize image if needed
    if (gameRef.current.specialPrize) {
      const prizeImg = new Image();
      prizeImg.src = activeEvent.prizeImage;
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

    // Input
    let moveX = 0;
    if (keysRef.current['ArrowLeft'] || keysRef.current['KeyA'] || touchRef.current.left) {
      moveX = -MOVE_SPEED * dt;
      p.facing = -1;
    }
    if (keysRef.current['ArrowRight'] || keysRef.current['KeyD'] || touchRef.current.right) {
      moveX = MOVE_SPEED * dt;
      p.facing = 1;
    }
    p.x += moveX;

    // Screen wrap
    if (p.x + PLAYER_W < 0) p.x = CANVAS_W;
    if (p.x > CANVAS_W) p.x = -PLAYER_W;

    // Manual jump logic
    if ((keysRef.current['Space'] || keysRef.current['ArrowUp'] || touchRef.current.jump) && p.isGrounded) {
      p.vy = JUMP_FORCE;
      p.isGrounded = false;
    }

    // Physics
    if (p.turboTime > 0) {
      p.vy = BOOST_FORCE * 1.5; // Sustain high speed during turbo
      p.isGrounded = false;
    } else {
      p.vy += GRAVITY * dt;
    }
    p.y += p.vy * dt;
    if (p.turboTime <= 0) p.isGrounded = false; // Only assume falling if not in turbo

    // Collision (only when falling)
    if (p.vy >= 0) {
      for (const plat of g.platforms) {
        if (plat.broken) continue;
        const inset = plat.type === 'ground' ? 0 : 20;
        if (
          p.x + PLAYER_W > plat.x + inset &&
          p.x < plat.x + plat.w - inset &&
          p.y + PLAYER_H >= plat.y + 4 &&
          p.y + PLAYER_H <= plat.y + plat.h + p.vy * dt + 2
        ) {
          p.y = plat.y + 4 - PLAYER_H;
          p.vy = 0;
          p.isGrounded = true;

          if (p.squash === 1) {
            p.squash = 0.6; // squash on landing
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
            p.vy = BOOST_FORCE; // auto boost is fun
            p.isGrounded = false;
            g.shake = 8; // big shake
          } else if (plat.type === 'turbo') {
            p.vy = BOOST_FORCE * 1.5; // HUGE TURBO BOOST
            p.isGrounded = false;
            p.turboTime = 120; // Show turbo sprite for 2 seconds
          } else if (plat.type === 'fragile') {
            if (!plat.activated) {
              plat.activated = true;
              plat.spawnTime = Date.now();
            }
          }
          break;
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
        const speed = 1.5 * (1 + g.difficulty * 3) * dt;
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

      // Vanishing logic (Platform 2 / Fragile)
      if (plat.type === 'fragile') {
        if (plat.activated) {
          const age = Date.now() - plat.spawnTime;
          const fragileTime = g.difficulty > 0.66 ? 1500 : 2000;
          if (age > fragileTime) {
            plat.broken = true; // Vanish!
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
    p.squash += (1 - p.squash) * 0.2;
    p.scaleX = 1 + (1 - p.squash);
    p.scaleY = p.squash;
    // apply stretch based on velocity
    if (p.turboTime > 0) {
      // Stabilize scale during turbo to prevent pulsing
      p.scaleY = 1.35;
      p.scaleX = 0.75;
    } else if (Math.abs(p.vy) > 2) {
      p.scaleY = Math.min(1.35, 1 + Math.abs(p.vy) * 0.015);
      p.scaleX = Math.max(0.75, 1 - Math.abs(p.vy) * 0.015);
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

      if (alt < 2000) { // Midgard Leaves
        wColor = Math.random() > 0.5 ? 'rgba(34, 197, 94, 0.4)' : 'rgba(21, 128, 61, 0.4)';
        wType = 'leaf';
      } else if (alt < 5000) { // Cloud Mist
        wColor = 'rgba(255, 255, 255, 0.1)';
        wType = 'mist';
        wSize = 20 + Math.random() * 40;
        wSpeed = 1 + Math.random() * 2;
      } else if (alt < 10000) { // Bifrost Sparks
        wColor = `hsla(${Math.random() * 360}, 70%, 70%, 0.4)`;
        wType = 'spark';
      } else { // Asgard Gold Dust
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
      const newPlats = generatePlatforms(20, g.platGenY, g.rng, g.difficulty);
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

    // Stars for high altitudes
    if (alt > 4000) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.6, (alt - 4000) / 10000)})`;
      const starRng = seededRandom(42);
      for (let i = 0; i < 40; i++) {
        const sx = starRng() * CANVAS_W;
        const sy = (starRng() * CANVAS_H * 3 + g.camera * 0.1) % CANVAS_H;
        ctx.fillRect(sx, sy, 1.5, 1.5);
      }
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
        if (isFragile && plat.activated) {
          const age = Date.now() - plat.spawnTime;
          const fragileTime = g.difficulty > 0.66 ? 1500 : 2000;
          if (age > fragileTime * 0.75) {
            if (Math.floor(Date.now() / 100) % 2 === 0) ctx.globalAlpha = 0.3;
          } else if (age > fragileTime * 0.5) {
            if (Math.floor(Date.now() / 200) % 2 === 0) ctx.globalAlpha = 0.5;
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

      // Draw icons on top of platforms if they are special types
      if (plat.type === 'boost' || plat.type === 'turbo') {
        ctx.save();
        ctx.fillStyle = plat.type === 'turbo' ? '#fff' : '#92400e';
        ctx.font = 'bold 24px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(plat.type === 'turbo' ? '🔥' : '⚡', plat.x + plat.w / 2, plat.y - 20);
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
        if (sp.image) {
          ctx.drawImage(sp.image, sp.x, sp.y, sp.w, sp.h);
        } else {
          // Glow effect if image not loaded yet
          ctx.shadowBlur = 15;
          ctx.shadowColor = '#fbbf24';
          ctx.fillStyle = '#fbbf24';
          ctx.beginPath();
          ctx.arc(sp.x + sp.w / 2, sp.y + sp.h / 2, sp.w / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }

        // Draw label
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px Rajdhani';
        ctx.textAlign = 'center';
        ctx.fillText(sp.name.toUpperCase(), sp.x + sp.w / 2, sp.y - 10);
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
    ctx.save();
    ctx.translate(p.x + PLAYER_W / 2, p.y + PLAYER_H); // Translate to bottom-center for squash/stretch
    ctx.scale(p.scaleX, p.scaleY);
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
      const renderW = PLAYER_H * (heroImg.width / heroImg.height);
      // Shift drawing down to plant feet on the platform floor (3D depth)
      ctx.drawImage(heroImg, (PLAYER_W - renderW) / 2, 0, renderW, PLAYER_H);

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
      activeEventIdRef.current = eventId;
    } else {
      setActiveEvent(null);
      activeEventIdRef.current = null;
    }

    keysRef.current = {};
    touchRef.current = { left: false, right: false, jump: false };
    setGameState('playing');
    setIsNewBest(false);
    initGame();
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
  useEffect(() => {
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
            display: 'flex', justifyContent: 'space-between', padding: '0 20px', pointerEvents: 'none'
          }}>
            <div style={{ display: 'flex', gap: '10px', pointerEvents: 'auto' }}>
              <button
                ref={leftBtnRef}
                className="ygg-btn-dir"
                style={{ width: '60px', height: '60px', borderRadius: '50%', background: 'rgba(255,255,255,0.2)', border: '2px solid rgba(255,255,255,0.4)', color: 'white', fontSize: '24px' }}>◀</button>
              <button
                ref={rightBtnRef}
                className="ygg-btn-dir"
                style={{ width: '60px', height: '60px', borderRadius: '50%', background: 'rgba(255,255,255,0.2)', border: '2px solid rgba(255,255,255,0.4)', color: 'white', fontSize: '24px' }}>▶</button>
            </div>
            <div style={{ pointerEvents: 'auto' }}>
              <button
                ref={jumpBtnRef}
                style={{ width: '80px', height: '60px', borderRadius: '30px', background: 'rgba(251, 191, 36, 0.4)', border: '2px solid rgba(251, 191, 36, 0.8)', color: 'white', fontSize: '18px', fontWeight: 'bold' }}>JUMP</button>
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
                <div className="ygg-zone-label">{zoneName}</div>
                {runesCollected > 0 && <div className="ygg-runes-hud">ᚠ {runesCollected}</div>}

                {/* Turbo Indicator */}
                {turboTime > 0 && (
                  <div className="ygg-turbo-hud">
                    <span className="ygg-turbo-icon">🔥</span>
                    <div className="ygg-turbo-bar">
                      <div
                        className="ygg-turbo-progress"
                        style={{ width: `${(turboTime / 120) * 100}%` }}
                      />
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
              <div style={{ color: '#fbbf24', fontWeight: 'bold', marginBottom: '4px' }}>📜 Rules of the Climb:</div>
              <ul style={{ margin: 0, paddingLeft: '16px', lineHeight: '1.4' }}>
                <li>Your first <b>5 runs per day</b> earn Valcoins!</li>
                <li>Base Reward: <b>1 VC per 100m</b> climbed.</li>
                <li><b>Runes act as a Multiplier!</b> (Collect 5 runes = 5x total Valcoins).</li>
              </ul>
            </div>

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
                                <div className="ygg-event-pool">
                                  Pool: <span className={ev.currentPool >= ev.targetPool ? 'full' : ''}>{ev.currentPool || 0}/{ev.targetPool}</span>
                                </div>
                              )}
                            </div>
                            
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
              {activeEvent && (
                <button className="ygg-free-btn" onClick={() => startGame()} style={{ marginTop: '8px', background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: 'white', width: '100%', padding: '10px', borderRadius: '8px' }}>Return to Free Play</button>
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
