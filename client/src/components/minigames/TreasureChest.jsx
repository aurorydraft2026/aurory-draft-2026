import React, { useState } from 'react';
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

  const prizes = gameConfig?.prizes || [];
  const costPerPlay = gameConfig?.costPerPlay || 30;

  const handleOpen = async () => {
    if (isOpening) return;
    if ((userPoints ?? 0) < costPerPlay) {
      setError(`Not enough Valcoins! Need ${costPerPlay}`);
      setTimeout(() => setError(''), 3000);
      return;
    }

    setError('');
    setResult(null);
    setIsOpening(true);

    // 1. Optimistic deduction in UI and Freeze sync
    setFrozen(true);
    setDisplayedPoints(prev => (prev ?? 0) - costPerPlay);

    // Phase 1: Shaking animation
    setPhase('shaking');

    // Call service while animation plays (fixed parameter order)
    const playResult = await playMiniGame(user, 'treasureChest');

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
      {/* Chest Visual */}
      <div className="chest-stage">
        <div className={`chest-wrapper ${phase}`}>
          {/* Glow behind chest */}
          {phase === 'reveal' && result && result.prize && (
            <div
              className={`chest-glow ${result.prize.rarity}`}
              style={{ '--rarity-color': getRarityColor(result.prize.rarity) }}
            />
          )}

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
              {result.prize ? (
                <>
                  <div className="chest-prize-icon">{result.prize.icon || '🎁'}</div>
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

      {/* Action Button */}
      <div className="chest-controls">
        {phase === 'idle' && (
          <button
            className="chest-open-btn"
            onClick={handleOpen}
            disabled={isOpening}
          >
            <span className="chest-btn-text">OPEN CHEST</span>
            <span className="chest-btn-cost">
              <img src={process.env.PUBLIC_URL + '/valcoin-icon.jpg'} alt="V" className="chest-cost-icon" />
              {costPerPlay}
            </span>
          </button>
        )}
        {phase === 'reveal' && (
          <button className="chest-again-btn" onClick={handlePlayAgain}>
            Open Another
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="chest-error">
          <span>⚠️ {error}</span>
        </div>
      )}

      {/* Prize List */}
      <div className="chest-prize-list">
        <h4>Possible Treasures</h4>
        <div className="chest-prizes-grid">
          {prizes.map(prize => (
            <div key={prize.id} className={`chest-prize-item ${prize.rarity}`}>
              <span className="chest-pi-icon">{prize.icon || '🎁'}</span>
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
      </div>
    </div>
  );
};

export default TreasureChest;
