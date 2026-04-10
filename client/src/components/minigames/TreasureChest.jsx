import React, { useState, useEffect } from 'react';
import { database } from '../../firebase';
import { ref, query, orderByChild, limitToLast, onValue } from 'firebase/database';
import { playMiniGame, getRarityColor } from '../../services/miniGameService';
import confetti from 'canvas-confetti';
import './TreasureChest.css';

const TreasureChest = ({ 
  user, 
  userPoints, 
  gameConfig, 
  onConfigReload,
  setFrozen,
  setDisplayedPoints 
}) => {
  const [isOpening, setIsOpening] = useState(false);
  const [result, setResult] = useState(null);
  const [phase, setPhase] = useState('idle'); // idle, shaking, opening, reveal
  const [error, setError] = useState('');
  const [multiplier, setMultiplier] = useState(1);
  const [showPrizesModal, setShowPrizesModal] = useState(false);
  const [showRulesModal, setShowRulesModal] = useState(false);
  
  const MULTIPLIERS = [1, 2, 5, 10, 50, 100];
  
  const [recentWinners, setRecentWinners] = useState([]);
  const [displayedWinners, setDisplayedWinners] = useState([]);

  // Sync displayed winners from real-time data ONLY when not currently opening
  useEffect(() => {
    if (!isOpening) {
      setDisplayedWinners(recentWinners);
    }
  }, [recentWinners, isOpening]);

  // Fetch live winners
  useEffect(() => {
    const recentRef = query(
      ref(database, 'recentMiniGameWinners'),
      orderByChild('timestamp'),
      limitToLast(50)
    );

    const unsubscribe = onValue(recentRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        const winnersArray = Object.keys(data).map(key => ({
          id: key,
          ...data[key]
        })).sort((a, b) => b.timestamp - a.timestamp);
        
        // Filter out non-treasure chest ones, then truncate to 20
        const chestWinners = winnersArray.filter(w => w.gameType === 'treasureChest').slice(0, 20);
        setRecentWinners(chestWinners);
      } else {
        setRecentWinners([]);
      }
    });

    return () => unsubscribe();
  }, []);

  const prizes = gameConfig?.prizes || [];
  const costPerPlay = gameConfig?.costPerPlay || 30;

  const handleOpen = async () => {
    if (isOpening) return;
    const totalCost = costPerPlay * multiplier;
    if ((userPoints ?? 0) < totalCost) {
      setError(`Not enough Valcoins! Need ${totalCost}`);
      setTimeout(() => setError(''), 3000);
      return;
    }

    setError('');
    setResult(null);
    setIsOpening(true);

    // 1. Optimistic deduction in UI and Freeze sync
    setFrozen(true);
    setDisplayedPoints(prev => (prev ?? 0) - (costPerPlay * multiplier));

    // Phase 1: Shaking animation
    setPhase('shaking');

    // Call service while animation plays (fixed parameter order)
    const playResult = await playMiniGame(user, 'treasureChest', multiplier);

    if (!playResult.success) {
      setError(playResult.error);
      setIsOpening(false);
      setPhase('idle');
      setFrozen(false);
      return;
    }

    // Phase 2: Chest opens after shake
    setTimeout(() => {
      setPhase('opening');
    }, 1500);

    // Phase 3: Reveal prize
    setTimeout(() => {
      setResult(playResult);
      setPhase('reveal');
      setIsOpening(false);

      // Trigger High-Energy Celebration for Legendary Win
      if (playResult.prize?.rarity === 'legendary') {
        const duration = 3 * 1000;
        const animationEnd = Date.now() + duration;
        const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 2000 };

        const randomInRange = (min, max) => Math.random() * (max - min) + min;

        const interval = setInterval(function() {
          const timeLeft = animationEnd - Date.now();

          if (timeLeft <= 0) {
            return clearInterval(interval);
          }

          const particleCount = 50 * (timeLeft / duration);
          confetti({
            ...defaults,
            particleCount,
            origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 },
            colors: ['#FFD700', '#FFA500', '#8B5CF6']
          });
          confetti({
            ...defaults,
            particleCount,
            origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 },
            colors: ['#FFD700', '#FFA500', '#8B5CF6']
          });
        }, 250);
      } else if (playResult.prize && playResult.prize.rarity !== 'common') {
        // Standard burst for Rare/Epic
        confetti({
          particleCount: 80,
          spread: 70,
          origin: { y: 0.6 },
          colors: playResult.prize.rarity === 'epic' ? ['#A855F7', '#D8B4FE'] : ['#3B82F6', '#93C5FD'],
          zIndex: 2000
        });
      }
    }, 2800);
  };

  const handlePlayAgain = () => {
    setPhase('idle');
    setResult(null);
    setFrozen(false); // Sync back to real Firestore balance (reveal winnings)
  };

  const rarityLabel = (rarity) => {
    switch (rarity) {
      case 'legendary': return 'LEGENDARY';
      case 'epic': return 'EPIC';
      case 'rare': return 'RARE';
      default: return 'COMMON';
    }
  };

  return (
    <div className="loot-box-container">
      {/* LEFT COLUMN: Live Winners Feed */}
      <div className="chest-winners-feed side-panel">
        <div className="chest-meta-buttons">
          <button className="chest-meta-btn" onClick={() => setShowPrizesModal(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: '6px'}}><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>
            Possible Loot
          </button>
          <button className="chest-meta-btn" onClick={() => setShowRulesModal(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: '6px'}}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
            Sacred Rules
          </button>
        </div>
        <div className="feed-header">
          <h4>Recent Action</h4>
          <span className="live-indicator">
            <span className="pulse-dot"></span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v8"/><path d="M8 12h8"/></svg>
            Live
          </span>
        </div>
        <div className="feed-list">
          {displayedWinners.length > 0 ? (
            displayedWinners.map(winner => (
              <div key={winner.id} className={`feed-item ${winner.rarity}`}>
                <img src={winner.playerAvatar} alt="" className="feed-avatar" />
                <div className="feed-info">
                  <span className="feed-name">{winner.playerName}</span>
                  <span className="feed-won">
                    found {winner.icon && winner.icon.endsWith('.png') ? (
                      <img src={`${process.env.PUBLIC_URL}/icons/minigames/${winner.icon}`} alt="" className="feed-prize-icon-img" />
                    ) : (
                      winner.icon
                    )} <span className="feed-prize" style={{ color: getRarityColor(winner.rarity) }}>{winner.prizeName}</span>
                  </span>
                </div>
                <span className="feed-time">
                  {new Date(winner.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))
          ) : (
            <p className="feed-empty">Waiting for the next big winner...</p>
          )}
        </div>
      </div>

      {/* CENTER COLUMN: Chest Visual & Controls */}
      <div className="minigame-main-view">
        <div className="chest-stage-wrapper">
          {error && (
            <div className="chest-error">
              <span>⚠️ {error}</span>
            </div>
          )}
          <div className="chest-stage">
            <div 
              className={`chest-wrapper ${phase} ${phase === 'idle' ? 'interactive' : ''}`}
              onClick={phase === 'idle' ? handleOpen : (phase === 'reveal' ? handlePlayAgain : undefined)}
            >
              {phase === 'idle' && (
                <div className="chest-tap-hint">
                  <div className="tap-pulse-container">
                    <div className="tap-pulse-ring" />
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--accent-gold)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                      <path d="M12 8v4M12 16h.01" strokeWidth="2.5"/>
                    </svg>
                  </div>
                </div>
              )}

              {(phase === 'shaking' || phase === 'opening') && (
                <div className="chest-status-msg">
                  {phase === 'shaking' ? 'SHAKING...' : 'OPENING...'}
                </div>
              )}

              {/* The Chest itself */}
              <div className={`chest-body ${phase}`}>
                <div className="chest-lid">
                  <div className="chest-lid-front">
                    <div className="chest-strap chest-strap-left" />
                    <div className="chest-strap chest-strap-right" />
                    <div className="chest-lock">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    </div>
                  </div>
                </div>
                <div className="chest-base">
                  <div className="chest-base-front">
                    <div className="chest-strap chest-strap-left" />
                    <div className="chest-strap chest-strap-right" />
                  </div>
                </div>
              </div>

              {/* Prize Reveal Card / Empty Message */}
              {phase === 'reveal' && result && (
                <div className={`chest-prize-reveal ${result.prize ? result.prize.rarity : 'none'}`}>
                  {result.prize && (
                    <div
                      className={`chest-glow ${result.prize.rarity}`}
                      style={{ '--rarity-color': getRarityColor(result.prize.rarity) }}
                    />
                  )}
                  {result.prize ? (
                    <>
                      <div className="chest-prize-icon">
                        {result.prize.icon && result.prize.icon.endsWith('.png') ? (
                          <img src={`${process.env.PUBLIC_URL}/icons/minigames/${result.prize.icon}`} alt="" className="chest-icon-img" />
                        ) : (
                          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{color: 'var(--accent-gold)'}}><path d="M20 12V8H4v4"/><rect width="20" height="12" x="2" y="12" rx="2"/><path d="M12 12V3"/><path d="M7 12V7"/><path d="M17 12V7"/><path d="M11 3h2"/></svg>
                        )}
                      </div>
                      <span
                        className="chest-prize-rarity"
                        style={{ color: getRarityColor(result.prize.rarity) }}
                      >
                        {rarityLabel(result.prize.rarity)}
                      </span>
                      <span className="chest-prize-name">{result.prize.name}</span>
                      <span className="chest-prize-credited">Added to your balance!</span>
                    </>
                  ) : (
                    <>
                      <div className="chest-prize-icon">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{color: 'var(--text-muted)'}}><path d="M17.7 7.7A2.5 2.5 0 1 1 20 12H4M17.7 16.3A2.5 2.5 0 1 0 20 12"/></svg>
                      </div>
                      <span className="chest-prize-rarity" style={{ color: '#64748b' }}>
                        EMPTY...
                      </span>
                      <span className="chest-prize-name">Better luck next time!</span>
                    </>
                  )}
                </div>
              )}
              {/* Particles for rare/epic/legendary (Inside wrapper for precise anchoring) */}
              {phase === 'reveal' && result && result.prize && (result.prize.rarity === 'legendary' || result.prize.rarity === 'epic' || result.prize.rarity === 'rare') && (
                <div className="chest-particles">
                  {[...Array(result.prize.rarity === 'rare' ? 12 : 16)].map((_, i) => (
                    <span
                      key={i}
                      className="chest-particle"
                      style={{
                        '--angle': `${(i * (result.prize.rarity === 'rare' ? 30 : 22.5))}deg`,
                        '--delay': `${i * 0.03}s`,
                        '--color': getRarityColor(result.prize.rarity)
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="chest-controls-wrapper">
          <div className="minigame-multiplier-selector">
            <span className="multiplier-label">SELECT STAKE</span>
            <div className="multiplier-options">
              {MULTIPLIERS.map(m => (
                <button
                  key={m}
                  className={`multiplier-opt ${multiplier === m ? 'active' : ''}`}
                  onClick={() => !isOpening && setMultiplier(m)}
                  disabled={isOpening}
                >
                  ×{m}
                </button>
              ))}
            </div>
          </div>

        </div>

      </div>

      {/* Prizes Modal */}
      {showPrizesModal && (
        <div className="chest-result-overlay" onClick={() => setShowPrizesModal(false)}>
          <div className="chest-result-card prize-modal-card" onClick={e => e.stopPropagation()}>
            <h3 className="chest-result-title" style={{ marginBottom: '16px' }}>Possible Loot</h3>
            <div className="chest-prizes-grid" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
              {prizes.map(prize => (
                <div key={prize.id} className={`chest-prize-item ${prize.rarity}`}>
                  <span className="chest-pi-icon">
                    {prize.icon && prize.icon.endsWith('.png') ? (
                      <img src={`${process.env.PUBLIC_URL}/icons/minigames/${prize.icon}`} alt="" className="prize-table-icon-img" />
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 12V8H4v4"/><rect width="20" height="12" x="2" y="12" rx="2"/><path d="M12 12V3"/><path d="M7 12V7"/><path d="M17 12V7"/><path d="M11 3h2"/></svg>
                    )}
                  </span>
                  <div className="chest-pi-info">
                    <span className="chest-pi-name">{prize.name}</span>
                    <span
                      className="chest-pi-rarity"
                      style={{ color: getRarityColor(prize.rarity) }}
                    >
                      {rarityLabel(prize.rarity)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <button className="chest-again-btn" onClick={() => setShowPrizesModal(false)} style={{ marginTop: '20px', width: '100%' }}>
              Close
            </button>
          </div>
        </div>
      )}

      {/* Rules Modal */}
      {showRulesModal && (
        <div className="chest-result-overlay" onClick={() => setShowRulesModal(false)}>
          <div className="chest-result-card rules-modal-card" onClick={e => e.stopPropagation()}>
            <h3 className="chest-result-title" style={{ marginBottom: '16px' }}>How to Play</h3>
            <div className="rules-content" style={{ textAlign: 'left', fontSize: '0.9rem', color: '#cbd5e1', lineHeight: '1.6' }}>
              <p>1. Unlocking costs <strong>{costPerPlay} Valcoins</strong>.</p>
              <p>2. Open the Loot Box to reveal your treasure.</p>
              <p>3. Rarity levels mean better prizes:</p>
              <ul style={{ paddingLeft: '20px', margin: '10px 0' }}>
                <li><span style={{ color: '#78909c' }}>Common</span> - Standard loot</li>
                <li><span style={{ color: '#2196f3' }}>Rare</span> - Valuable hits</li>
                <li><span style={{ color: '#9c27b0' }}>Epic</span> - Massive wins!</li>
                <li><span style={{ color: '#ffb300' }}>Legendary</span> - The Motherlode!</li>
              </ul>
              <p>4. All winnings are automatically credited to your balance.</p>
            </div>
            <button className="chest-again-btn" onClick={() => setShowRulesModal(false)} style={{ marginTop: '20px', width: '100%' }}>
              Got it!
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default TreasureChest;
