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
    <div className="treasure-chest-container">
      {/* LEFT COLUMN: Live Winners Feed */}
      <div className="chest-winners-feed side-panel">
        <div className="feed-header">
          <h4>Recent Action</h4>
          <span className="live-indicator"><span className="pulse-dot"></span> Live</span>
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
            <div className={`chest-wrapper ${phase}`}>
              {/* The Chest itself */}
              <div className={`chest-body ${phase}`}>
                <div className="chest-lid">
                  <div className="chest-lid-front">
                    <div className="chest-lock">🔒</div>
                  </div>
                </div>
                <div className="chest-base">
                  <div className="chest-base-front" />
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
                          result.prize.icon || '🎁'
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
                      <div className="chest-prize-icon">💨</div>
                      <span className="chest-prize-rarity" style={{ color: '#64748b' }}>
                        EMPTY...
                      </span>
                      <span className="chest-prize-name">Better luck next time!</span>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Particles for legendary/epic */}
            {phase === 'reveal' && result && result.prize && (result.prize.rarity === 'legendary' || result.prize.rarity === 'epic') && (
              <div className="chest-particles">
                {[...Array(12)].map((_, i) => (
                  <span
                    key={i}
                    className="chest-particle"
                    style={{
                      '--angle': `${(i * 30)}deg`,
                      '--delay': `${i * 0.05}s`,
                      '--color': getRarityColor(result.prize.rarity)
                    }}
                  />
                ))}
              </div>
            )}
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

          <div className="chest-action-group">
            {phase !== 'reveal' ? (
              <>
                <button
                  className="chest-open-btn"
                  onClick={handleOpen}
                  disabled={isOpening}
                >
                  <span className="chest-btn-text">
                    {isOpening ? 'Opening...' : 'Open Chest'}
                  </span>
                  {!isOpening && (
                    <span className="chest-btn-cost">
                      <img src={process.env.PUBLIC_URL + '/valcoin-icon.jpg'} alt="V" className="chest-cost-icon" />
                      {costPerPlay * multiplier}
                    </span>
                  )}
                </button>
                <div className="chest-meta-buttons">
                  <button className="chest-meta-btn" onClick={() => setShowPrizesModal(true)}>🏆 Prizes</button>
                  <button className="chest-meta-btn" onClick={() => setShowRulesModal(true)}>📖 Rules</button>
                </div>
              </>
            ) : (
              <button className="chest-again-btn" onClick={handlePlayAgain}>
                Open Another
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Prizes Modal */}
      {showPrizesModal && (
        <div className="chest-result-overlay" onClick={() => setShowPrizesModal(false)}>
          <div className="chest-result-card prize-modal-card" onClick={e => e.stopPropagation()}>
            <h3 className="chest-result-title" style={{ marginBottom: '16px' }}>Possible Treasures</h3>
            <div className="chest-prizes-grid" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
              {prizes.map(prize => (
                <div key={prize.id} className={`chest-prize-item ${prize.rarity}`}>
                  <span className="chest-pi-icon">
                    {prize.icon && prize.icon.endsWith('.png') ? (
                      <img src={`${process.env.PUBLIC_URL}/icons/minigames/${prize.icon}`} alt="" className="prize-table-icon-img" />
                    ) : (
                      prize.icon || '🎁'
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
              <p>2. Open the chest to reveal your treasure.</p>
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
