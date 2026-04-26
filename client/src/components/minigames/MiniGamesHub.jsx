import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getMiniGameConfig, getRarityColor } from '../../services/miniGameService';
import SlotMachine from './SlotMachine';
import TreasureChest from './TreasureChest';
import DrakkarRace from './DrakkarRace';
import OdinsRiddle from './OdinsRiddle';
import YggdrasilAscender from './YggdrasilAscender';
import { useWallet } from '../../hooks/useWallet';
import { database } from '../../firebase';
import { ref, onValue, query, orderByChild, limitToLast } from 'firebase/database';
import MiniGamesChat from './MiniGamesChat';
import './MiniGamesHub.css';
import './MiniGamesChat.css';



const GAME_REGISTRY = {
  slotMachine: {
    id: 'slotMachine',
    name: "Odin's Fortune",
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 2h14" /><path d="M5 22h14" /><path d="M5 2v20" /><path d="M19 2v20" /><path d="M10 2v12" /><path d="M14 2v12" /><path d="M5 14h14" /></svg>,
    description: 'Spin the reels and match symbols to win!',
    howToPlay: 'Match 3 symbols to win! Choose your stake multiplier for bigger prizes. AURY Fever gauge fills on losses — hit the jackpot when it\'s full for bonus AURY!',
    component: SlotMachine
  },
  treasureChest: {
    id: 'treasureChest',
    name: 'Loot Box',
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 12V8H4v4" /><path d="M2 12h20" /><path d="M20 12v8H4v-8" /><line x1="12" y1="12" x2="12" y2="20" /><path d="m12 8 3-3-3-3-3 3 3 3Z" /></svg>,
    description: 'Unlock a mythic chest to reveal your prize!',
    howToPlay: 'Tap to unlock and reveal treasure inside! Rarity ranges from Common to Legendary. Higher stakes = better loot. AURY Fever gauge fills on losses!',
    component: TreasureChest
  },
  drakkarRace: {
    id: 'drakkarRace',
    name: 'Drakkar Race',
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 21h8" /><path d="M12 21V7" /><path d="M12 3c-1.5 0-3 1.5-3 4s1.5 4 3 4 3-1.5 3-4-1.5-4-3-4Z" /><path d="M21 7c0-2-2-3-2-3" /><path d="M3 7c0-2 2-3 2-3" /></svg>,
    description: 'Bet on mythical ships in a real-time global race!',
    howToPlay: 'Place bets on ships before the race starts. Winners split the total pool proportionally (parimutuel). Weather affects each ship differently!',
    component: DrakkarRace
  },
  odinsRiddle: {
    id: 'odinsRiddle',
    name: "Odin's Riddle",
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>,
    description: 'Test your knowledge of Norse lore, crypto, and Aurory!',
    howToPlay: 'Answer 5 daily riddles about Norse mythology, crypto, and Aurory. Each correct answer earns 10-50 VC. Get a perfect streak to unlock bonus rounds!',
    component: OdinsRiddle
  },
  yggdrasilAscender: {
    id: 'yggdrasilAscender',
    name: 'Yggdrasil Ascender',
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22V2" /><path d="M5 12l7-10 7 10" /><path d="M3 17l9-5 9 5" /></svg>,
    description: 'Climb the World Tree! Jump with friends in real-time.',
    howToPlay: 'Jump between platforms to climb as high as possible! Compete on the daily leaderboard. Collect runes for bonus rewards. Max 8 players per lobby.',
    component: YggdrasilAscender
  }
};

const MiniGamesHub = ({ user, userPoints, onClose }) => {
  const [config, setConfig] = useState(null);
  const [selectedGame, setSelectedGame] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTooltip, setActiveTooltip] = useState(null);
  const [isChatOpen, setIsChatOpen] = useState(false);

  // Real Firestore balances from wallet hook
  const { walletBalance, usdcBalance, formatAuryAmount, formatUsdcAmount } = useWallet(user);

  // UI "Suspense" balances
  const [displayedPoints, setDisplayedPoints] = useState(userPoints);
  const [displayedAury, setDisplayedAury] = useState(walletBalance);
  const [displayedUsdc, setDisplayedUsdc] = useState(usdcBalance);
  const [isFrozen, setIsFrozen] = useState(false);
  const [totalOnlineCount, setTotalOnlineCount] = useState(0);
  const [yggPlayersCount, setYggPlayersCount] = useState(0);

  // Balance delta animator
  const [balanceDeltas, setBalanceDeltas] = useState([]);
  const prevPointsRef = useRef(null);
  const prevAuryRef = useRef(null);
  const prevUsdcRef = useRef(null);
  const deltaReadyRef = useRef(false);

  // Live winner ticker
  const [hubWinners, setHubWinners] = useState([]);

  // Recent games from localStorage
  const [recentGames, setRecentGames] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('asgard_recent_games') || '[]');
    } catch { return []; }
  });

  // Sync all displayed balances with real Firestore balances when NOT in a game
  useEffect(() => {
    if (!isFrozen) {
      setDisplayedPoints(userPoints);
      setDisplayedAury(walletBalance);
      setDisplayedUsdc(usdcBalance);
    }
  }, [userPoints, walletBalance, usdcBalance, isFrozen]);

  // ── Balance Delta Tracker ──
  const addBalanceDelta = useCallback((type, amount) => {
    const id = `${Date.now()}-${Math.random()}`;
    setBalanceDeltas(prev => [...prev, { id, type, amount }]);
    setTimeout(() => {
      setBalanceDeltas(prev => prev.filter(d => d.id !== id));
    }, 1100);
  }, []);

  // Warm-up: skip balance noise during initial Firestore sync (first 1.5s)
  useEffect(() => {
    const timer = setTimeout(() => { deltaReadyRef.current = true; }, 1500);
    return () => clearTimeout(timer);
  }, []);

  // Detect balance changes and emit floating deltas
  useEffect(() => {
    if (!deltaReadyRef.current) {
      prevPointsRef.current = displayedPoints;
      prevAuryRef.current = displayedAury;
      prevUsdcRef.current = displayedUsdc;
      return;
    }

    if (prevPointsRef.current !== null) {
      const delta = (displayedPoints ?? 0) - (prevPointsRef.current ?? 0);
      if (delta !== 0) addBalanceDelta('vc', delta);
    }
    prevPointsRef.current = displayedPoints;

    if (prevAuryRef.current !== null) {
      const delta = (displayedAury ?? 0) - (prevAuryRef.current ?? 0);
      if (delta !== 0 && Math.abs(delta) > 1000) addBalanceDelta('aury', delta);
    }
    prevAuryRef.current = displayedAury;

    if (prevUsdcRef.current !== null) {
      const delta = (displayedUsdc ?? 0) - (prevUsdcRef.current ?? 0);
      if (delta !== 0 && Math.abs(delta) > 1000) addBalanceDelta('usdc', delta);
    }
    prevUsdcRef.current = displayedUsdc;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayedPoints, displayedAury, displayedUsdc, addBalanceDelta]);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setLoading(true);
    const cfg = await getMiniGameConfig();
    setConfig(cfg);
    setLoading(false);
  };

  // Prevent background scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    document.body.classList.add('minigame-open');
    return () => { 
      document.body.style.overflow = '';
      document.body.classList.remove('minigame-open');
    };
  }, []);

  const handleBackToHub = () => {
    setSelectedGame(null);
  };

  // Listen to GLOBAL Minigame Presence Count
  useEffect(() => {
    const presenceRef = ref(database, 'mini_games/presence');
    const unsub = onValue(presenceRef, snap => {
      if (snap.exists()) {
        const data = snap.val();
        const now = Date.now();
        const activeCount = Object.values(data).filter(lastActive => (now - lastActive) < 120000).length;
        setTotalOnlineCount(activeCount);
      } else {
        setTotalOnlineCount(0);
      }
    });
    return () => unsub();
  }, []);

  // Listen to live player count for Yggdrasil Ascender
  useEffect(() => {
    const playersRef = ref(database, 'yggdrasil/players');
    const unsub = onValue(playersRef, snap => {
      if (snap.exists()) {
        setYggPlayersCount(Object.keys(snap.val()).length);
      } else {
        setYggPlayersCount(0);
      }
    });
    return () => unsub();
  }, []);

  // ── Live Winner Ticker — subscribe to ALL recent winners ──
  useEffect(() => {
    const recentRef = query(
      ref(database, 'recentMiniGameWinners'),
      orderByChild('timestamp'),
      limitToLast(15)
    );
    const unsub = onValue(recentRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        const winnersArray = Object.keys(data).map(key => ({
          id: key,
          ...data[key]
        })).sort((a, b) => b.timestamp - a.timestamp).slice(0, 10);
        setHubWinners(winnersArray);
      } else {
        setHubWinners([]);
      }
    });
    return () => unsub();
  }, []);

  const availableGames = config
    ? Object.keys(GAME_REGISTRY).filter(key => config[key]?.enabled)
    : [];

  // ── Card mouse tracking for hover glow (DOM-direct, zero re-renders) ──
  const handleCardMouseMove = useCallback((e) => {
    const card = e.currentTarget;
    const rect = card.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    card.style.setProperty('--mouse-x', `${x}%`);
    card.style.setProperty('--mouse-y', `${y}%`);
  }, []);

  const handleCardMouseLeave = useCallback((e) => {
    const card = e.currentTarget;
    card.style.removeProperty('--mouse-x');
    card.style.removeProperty('--mouse-y');
  }, []);

  // ── Select game + track recent ──
  const handleSelectGame = useCallback((gameKey) => {
    if (gameKey === 'yggdrasilAscender' && yggPlayersCount >= 8) {
      alert('Lobby is full! Max 8 players allowed. Please try again later.');
      return;
    }
    const updated = [gameKey, ...recentGames.filter(k => k !== gameKey)].slice(0, 5);
    setRecentGames(updated);
    try { localStorage.setItem('asgard_recent_games', JSON.stringify(updated)); } catch {}
    setSelectedGame(gameKey);
    setActiveTooltip(null);
  }, [recentGames, yggPlayersCount]);

  // ── Format balance delta for display ──
  const formatDelta = useCallback((type, amount) => {
    if (type === 'vc') return amount > 0 ? `+${amount}` : `${amount}`;
    if (type === 'aury') {
      const v = amount / 1e9;
      return v > 0 ? `+${v.toFixed(2)}` : `${v.toFixed(2)}`;
    }
    if (type === 'usdc') {
      const v = amount / 1e6;
      return v > 0 ? `+${v.toFixed(2)}` : `${v.toFixed(2)}`;
    }
    return '';
  }, []);

  // ── Render balance pills with delta animations ──
  const renderBalancePills = () => (
    <div className="minigames-balances-group">
      <div className="minigames-balance" title="Valcoins">
        {balanceDeltas.filter(d => d.type === 'vc').map(d => (
          <span key={d.id} className={`balance-delta ${d.amount > 0 ? 'positive' : 'negative'}`}>
            {formatDelta('vc', d.amount)}
          </span>
        ))}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M8 12h8" /><path d="M12 8v8" /></svg>
        <span>{displayedPoints ?? 0}</span>
      </div>
      <div className="minigames-balance aury-pill" title="AURY Balance">
        {balanceDeltas.filter(d => d.type === 'aury').map(d => (
          <span key={d.id} className={`balance-delta ${d.amount > 0 ? 'positive' : 'negative'}`}>
            {formatDelta('aury', d.amount)}
          </span>
        ))}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 6a6 6 0 0 1 0 12" /><path d="M12 6v12" /><path d="M12 9h4" /><path d="M12 15h4" /></svg>
        <span>{formatAuryAmount ? formatAuryAmount(displayedAury) : (displayedAury / 1e9).toFixed(2)}</span>
      </div>
      <div className="minigames-balance usdc-pill" title="USDC Balance">
        {balanceDeltas.filter(d => d.type === 'usdc').map(d => (
          <span key={d.id} className={`balance-delta ${d.amount > 0 ? 'positive' : 'negative'}`}>
            {formatDelta('usdc', d.amount)}
          </span>
        ))}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><path d="M16 8h-1.5c-1.38 0-2.5 1.12-2.5 2.5s1.12 2.5 2.5 2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5H12" /></svg>
        <span>{formatUsdcAmount ? formatUsdcAmount(displayedUsdc) : (displayedUsdc / 1e6).toFixed(2)}</span>
      </div>
    </div>
  );

  // ── GAME VIEW ──
  if (selectedGame) {
    const gameInfo = GAME_REGISTRY[selectedGame];
    const GameComponent = gameInfo.component;
    const gameConfig = config[selectedGame];

    return (
      <>
        <div className="minigames-backdrop" onClick={onClose} />
        <div className="minigames-overlay">
          <div className="minigames-modal minigames-game-view" onClick={e => e.stopPropagation()}>
            <div className="minigames-modal-header">
              <button className="minigames-back-btn" onClick={handleBackToHub}>
                ← <span className="back-btn-text">Games</span>
              </button>
              <h2>{gameInfo.icon} {gameInfo.name}</h2>
              {renderBalancePills()}
              <button className="minigames-close-btn" onClick={onClose}>✕</button>
            </div>

            <div className="minigames-game-content">
              <GameComponent
                user={user}
                userPoints={displayedPoints}
                gameConfig={gameConfig}
                onConfigReload={loadConfig}
                setFrozen={setIsFrozen}
                setDisplayedPoints={setDisplayedPoints}
                onClose={onClose}
                onBack={handleBackToHub}
              />
            </div>
          </div>
        </div>
      </>
    );
  }

  // Recently played games (only show enabled ones)
  const recentAvailable = recentGames.filter(k => availableGames.includes(k));

  const renderGameCard = (gameKey) => {
    const game = GAME_REGISTRY[gameKey];
    const gameCfg = config[gameKey];
    const isTooltipActive = activeTooltip === gameKey;

    return (
      <div
        key={gameKey}
        className="minigame-card"
        onMouseMove={handleCardMouseMove}
        onMouseLeave={handleCardMouseLeave}
        onClick={() => !isTooltipActive && handleSelectGame(gameKey)}
      >
        {/* Info tooltip button */}
        <button
          className="minigame-card-info-btn"
          onClick={(e) => {
            e.stopPropagation();
            setActiveTooltip(isTooltipActive ? null : gameKey);
          }}
          title="How to play"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
        </button>

        {/* Info tooltip overlay */}
        {isTooltipActive && (
          <div className="minigame-card-tooltip" onClick={(e) => e.stopPropagation()}>
            <h4>{game.name}</h4>
            <p>{game.howToPlay}</p>
            <div className="tooltip-cost">
              {gameKey === 'drakkarRace' ? 'Bet to play' :
               (gameKey === 'odinsRiddle' || gameKey === 'yggdrasilAscender') ? 'Free to play' :
               `${gameCfg?.costPerPlay || 0} VC per play`}
            </div>
            <button className="tooltip-play-btn" onClick={() => handleSelectGame(gameKey)}>
              Play Now →
            </button>
          </div>
        )}

        <div className="minigame-card-icon">{game.icon}</div>
        <h3>{game.name}</h3>
        <p>{game.description}</p>
        <div className="minigame-card-cost">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M8 12h8" /><path d="M12 8v8" /></svg>
          <span>{gameKey === 'drakkarRace' ? 'Bet to play' : (gameKey === 'odinsRiddle' || gameKey === 'yggdrasilAscender') ? 'Free to play' : `${gameCfg?.costPerPlay || 0} per play`}</span>
        </div>
        <div className="minigame-card-prizes">
          {gameKey === 'drakkarRace' ? 'Parimutuel payouts' : gameKey === 'odinsRiddle' ? 'Earn 10-50 VC per riddle' : gameKey === 'yggdrasilAscender' ? `Daily leaderboard • ${yggPlayersCount}/8 Players Live` : `${gameCfg?.prizes?.length || 0} prizes available`}
        </div>
      </div>
    );
  };

  // ── HUB VIEW ──
  return (
    <>
      <div className="minigames-backdrop" onClick={onClose} />
      <div className="minigames-overlay">
        <div className="minigames-modal" onClick={e => e.stopPropagation()}>
          <div className="minigames-modal-header">
            <h2 className="minigames-hub-title">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px' }}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M12 22V12" /><path d="M12 12l8-4" /><path d="M12 12L4 8" /></svg> 
              Asgard Trials
              {totalOnlineCount >= 0 && <span className="hub-online-count">{totalOnlineCount} Online</span>}
            </h2>
            {renderBalancePills()}
            <button 
              className={`minigames-chat-toggle ${isChatOpen ? 'active' : ''}`} 
              onClick={() => setIsChatOpen(!isChatOpen)}
              title="Global Chat"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </button>
            <button className="minigames-close-btn" onClick={onClose}>✕</button>
          </div>

          <div className={`minigames-hub-body ${isChatOpen ? 'chat-open' : ''}`}>
            <div className="minigames-hub-scroll-area">

            {loading ? (
              <div className="minigames-loading">
                <div className="compass-spinner">
                  <svg viewBox="0 0 100 100" width="64" height="64">
                    <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(212,175,55,0.15)" strokeWidth="1.5" />
                    <circle cx="50" cy="50" r="32" fill="none" stroke="rgba(212,175,55,0.08)" strokeWidth="1" strokeDasharray="4 4" />
                    {/* Tick marks */}
                    {[0, 90, 180, 270].map(angle => (
                      <line
                        key={angle}
                        x1="50" y1="8" x2="50" y2="14"
                        stroke="rgba(212,175,55,0.4)"
                        strokeWidth="1.5"
                        transform={`rotate(${angle} 50 50)`}
                      />
                    ))}
                    {/* Cardinal labels */}
                    <text x="50" y="22" textAnchor="middle" fill="rgba(212,175,55,0.5)" fontSize="7" fontFamily="Rajdhani, sans-serif" fontWeight="700">N</text>
                    <text x="50" y="93" textAnchor="middle" fill="rgba(212,175,55,0.3)" fontSize="7" fontFamily="Rajdhani, sans-serif" fontWeight="700">S</text>
                    <text x="9" y="53" textAnchor="middle" fill="rgba(212,175,55,0.3)" fontSize="7" fontFamily="Rajdhani, sans-serif" fontWeight="700">W</text>
                    <text x="91" y="53" textAnchor="middle" fill="rgba(212,175,55,0.3)" fontSize="7" fontFamily="Rajdhani, sans-serif" fontWeight="700">E</text>
                    {/* Needle */}
                    <g className="compass-needle">
                      <polygon points="50,16 47,50 53,50" fill="rgba(212,175,55,0.85)" />
                      <polygon points="50,84 47,50 53,50" fill="rgba(212,175,55,0.25)" />
                    </g>
                    <circle cx="50" cy="50" r="3.5" fill="var(--accent-gold)" />
                  </svg>
                </div>
                <p>Charting the sacred trials...</p>
              </div>
            ) : availableGames.length === 0 ? (
              <div className="minigames-empty">
                <span className="empty-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M12 22V12" /><path d="M12 12l8-4" /><path d="M12 12L4 8" /></svg></span>
                <p>The Sacred Trials are closed. Check back later!</p>
              </div>
            ) : (
              <>
                {/* ── Live Winner Ticker ── */}
                {hubWinners.length > 0 && (
                  <div className="hub-winner-ticker">
                    <div className="hub-ticker-label">
                      <span className="hub-ticker-dot" />
                      LIVE
                    </div>
                    <div className="hub-ticker-track">
                      {[...hubWinners, ...hubWinners].map((winner, idx) => (
                        <div key={`${winner.id}-${idx}`} className={`hub-ticker-item ${winner.rarity}`}>
                          <img src={winner.playerAvatar} alt="" className="hub-ticker-avatar" />
                          <span className="hub-ticker-name">{winner.playerName}</span>
                          <span className="hub-ticker-text">won</span>
                          <span className="hub-ticker-prize" style={{ color: getRarityColor(winner.rarity) }}>
                            {winner.icon && winner.icon.endsWith('.png') ? (
                              <img src={`${process.env.PUBLIC_URL}/icons/minigames/${winner.icon}`} alt="" className="hub-ticker-prize-icon" />
                            ) : null}
                            {winner.prizeName}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="minigames-hub-sections">
                  {/* ── RECENTLY PLAYED (compact pills) ── */}
                  {recentAvailable.length > 0 && (
                    <div className="recent-played-row">
                      <span className="recent-played-label">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                        Recent
                      </span>
                      {recentAvailable.map(gameKey => {
                        const game = GAME_REGISTRY[gameKey];
                        return (
                          <button
                            key={gameKey}
                            className="recent-pill"
                            onClick={() => handleSelectGame(gameKey)}
                            title={game.name}
                          >
                            <span className="recent-pill-icon">{game.icon}</span>
                            <span className="recent-pill-name">{game.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* ── SOLO PLAY ── */}
                  {availableGames.filter(k => k === 'slotMachine' || k === 'treasureChest' || k === 'odinsRiddle').length > 0 && (
                    <div className="minigames-section">
                      <h3 className="minigames-section-title">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px' }}><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                        Solo Play
                      </h3>
                      <div className="minigames-grid">
                        {availableGames
                          .filter(k => k === 'slotMachine' || k === 'treasureChest' || k === 'odinsRiddle')
                          .map(gameKey => renderGameCard(gameKey))}
                      </div>
                    </div>
                  )}

                  {/* ── SOCIAL PLAY ── */}
                  {availableGames.filter(k => k === 'drakkarRace' || k === 'yggdrasilAscender').length > 0 && (
                    <div className="minigames-section">
                      <h3 className="minigames-section-title">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px' }}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                        Social Play
                      </h3>
                      <div className="minigames-grid">
                        {availableGames
                          .filter(k => k === 'drakkarRace' || k === 'yggdrasilAscender')
                          .map(gameKey => renderGameCard(gameKey))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
            </div> {/* End of minigames-hub-scroll-area */}

            {isChatOpen && <MiniGamesChat user={user} channelId="hub" />}
          </div>
        </div>
      </div>
    </>
  );
};

export default MiniGamesHub;
