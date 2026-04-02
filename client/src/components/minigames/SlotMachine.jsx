import React, { useState, useRef, useCallback, useMemo } from 'react';
import { playMiniGame, getRarityColor } from '../../services/miniGameService';
import confetti from 'canvas-confetti';
import './SlotMachine.css';

const SlotMachine = ({ 
  user, 
  userPoints, 
  gameConfig, 
  onConfigReload,
  setFrozen,
  setDisplayedPoints
}) => {
  const [isSpinning, setIsSpinning] = useState(false);
  const [result, setResult] = useState(null);
  const [showResult, setShowResult] = useState(false);
  const [error, setError] = useState('');
  const [currentIndices, setCurrentIndices] = useState([0, 0, 0]);
  const reelRefs = [useRef(null), useRef(null), useRef(null)];

  const prizes = useMemo(() => gameConfig?.prizes || [], [gameConfig]);
  const costPerPlay = gameConfig?.costPerPlay || 50;

  // Build symbol strip for each reel (repeat prizes several times for visual scrolling)
  const getReelSymbols = useCallback(() => {
    if (prizes.length === 0) return [];
    const symbols = [];
    // Repeat prizes 30 times for the 'Safe Zone' loop trick
    for (let i = 0; i < 30; i++) {
      prizes.forEach(prize => {
        symbols.push(prize);
      });
    }
    return symbols;
  }, [prizes]);

  const reelSymbols = getReelSymbols();
  const symbolHeight = 80; // px per symbol

  const handleSpin = async () => {
    if (isSpinning) return;
    if ((userPoints ?? 0) < costPerPlay) {
      setError(`Not enough Valcoins! Need ${costPerPlay}`);
      setTimeout(() => setError(''), 3000);
      return;
    }

    setError('');
    setResult(null);
    setShowResult(false);
    setIsSpinning(true);

    // 1. Optimistic deduction in UI and Freeze sync
    setFrozen(true);
    setDisplayedPoints(prev => (prev ?? 0) - costPerPlay);

    // Call the service to determine the prize (fixed parameter order)
    const playResult = await playMiniGame(user, 'slotMachine');

    if (!playResult.success) {
      setError(playResult.error);
      setIsSpinning(false);
      setFrozen(false); // Unfreeze on error so user can see it failed
      return;
    }

    // 1. Determine if it's a win or a loss
    const wonPrize = playResult.prize;
    const isLoss = !wonPrize;
    
    let targetPositions = [];
    
    if (isLoss) {
      // Pick 3 mismatched indices
      const idx1 = Math.floor(Math.random() * prizes.length);
      let idx2 = Math.floor(Math.random() * prizes.length);
      let idx3 = Math.floor(Math.random() * prizes.length);
      
      // Ensure they aren't all the same symbols (to avoid visual confusion)
      if (prizes.length > 1) {
        while (idx1 === idx2 && idx2 === idx3) {
          idx2 = (idx1 + 1) % prizes.length;
          idx3 = (idx2 + 1) % prizes.length;
        }
      }
      
      const targetIndices = [idx1, idx2, idx3];
      setCurrentIndices(targetIndices); // Store for safe-zone resync
      
      targetPositions = targetIndices.map(targetIdx => {
        const landingOffset = prizes.length * 15; // Always spin to the 'Landing Zone'
        const finalIndex = landingOffset + targetIdx;
        return -(finalIndex * symbolHeight) + symbolHeight;
      });
    } else {
      // Find the winning prize index
      const winIndex = prizes.findIndex(p => p.id === wonPrize.id);
      const targetIndex = winIndex >= 0 ? winIndex : 0;
      setCurrentIndices([targetIndex, targetIndex, targetIndex]);
      
      // Calculate position
      const landingOffset = prizes.length * 15;
      const finalIndex = landingOffset + targetIndex;
      const pos = -(finalIndex * symbolHeight) + symbolHeight;
      targetPositions = [pos, pos, pos];
    }

    // Spin each reel with staggered timing
    reelRefs.forEach((ref, i) => {
      if (ref.current) {
        const delay = i * 400; // Stagger each reel
        const duration = 2000 + (i * 600); // Each reel spins longer
        const finalPosition = targetPositions[i];
        
        // Remove the reset-to-zero logic to allow persistence
        setTimeout(() => {
          if (ref.current) {
            ref.current.style.transition = `transform ${duration}ms cubic-bezier(0.15, 0.85, 0.25, 1)`;
            ref.current.style.transform = `translateY(${finalPosition}px)`;
          }
        }, delay + 50);
      }
    });

    // Show result after all reels stop
    const totalAnimTime = 2000 + (2 * 600) + 400 + 500;
    setTimeout(() => {
      setResult(playResult);
      setShowResult(true);
      setIsSpinning(false);

      // Trigger confetti for Legendary Win
      if (wonPrize?.rarity === 'legendary') {
        confetti({
          particleCount: 150,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#FFD700', '#FFA500', '#8B5CF6'],
          zIndex: 2000
        });
      }
    }, totalAnimTime);
  };

  const handlePlayAgain = () => {
    setShowResult(false);
    setResult(null);
    setFrozen(false); // Sync back to real Firestore balance (reveal winnings)
    
    // 🛡️ SEAMLESS INFINITE LOOP: 
    // Snap the reels back to an identical 'Ready Zone' instantly (transition: none)
    // Because the icons are identical, the user won't see any jump.
    reelRefs.forEach((ref, i) => {
      if (ref.current) {
        ref.current.style.transition = 'none';
        const readyOffset = prizes.length * 5; // The ready-to-spin zone
        const tPos = -((readyOffset + currentIndices[i]) * symbolHeight) + symbolHeight;
        ref.current.style.transform = `translateY(${tPos}px)`;
      }
    });
  };

  return (
    <div className="slot-machine-container">
      {/* Machine Frame */}
      <div className="slot-machine-frame">
        <div className="slot-machine-top-bar">
          <span className="slot-light" />
          <span className="slot-title">FORTUNE SLOTS</span>
          <span className="slot-light" />
        </div>

        {/* Reels */}
        <div className="slot-reels-window">
          {[0, 1, 2].map(reelIndex => (
            <div key={reelIndex} className="slot-reel-container">
              <div className="slot-reel" ref={reelRefs[reelIndex]}>
                {reelSymbols.map((prize, symIdx) => (
                  <div
                    key={`${reelIndex}-${symIdx}`}
                    className={`slot-symbol ${prize.rarity}`}
                    style={{ height: `${symbolHeight}px` }}
                  >
                    <span className="slot-symbol-icon">{prize.icon || '🎁'}</span>
                    <span className="slot-symbol-name">{prize.name}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {/* Center line indicator */}
          <div className="slot-payline" />
        </div>

        {/* Controls */}
        <div className="slot-controls">
          <button
            className={`slot-spin-btn ${isSpinning ? 'spinning' : ''}`}
            onClick={handleSpin}
            disabled={isSpinning}
          >
            {isSpinning ? (
              <span className="spin-btn-spinning">Spinning...</span>
            ) : (
              <>
                <span className="spin-btn-text">SPIN</span>
                <span className="spin-btn-cost">
                  <img src={process.env.PUBLIC_URL + '/valcoin-icon.jpg'} alt="V" className="spin-cost-icon" />
                  {costPerPlay}
                </span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="slot-error">
          <span>⚠️ {error}</span>
        </div>
      )}

      {/* Result Modal */}
      {showResult && result && (
        <div className="slot-result-overlay" onClick={handlePlayAgain}>
          <div className="slot-result-card" onClick={e => e.stopPropagation()}>
            <div className={`slot-result-rarity-bar ${result.prize ? result.prize.rarity : 'common'}`} />
            <div className="slot-result-icon">{result.prize ? result.prize.icon : '❌'}</div>
            <h3 className="slot-result-title">
              {!result.prize ? 'Better Luck Next Time!' :
               result.prize.rarity === 'legendary' ? '🔥 LEGENDARY WIN! 🔥' :
               result.prize.rarity === 'epic' ? '⚡ EPIC WIN! ⚡' :
               result.prize.rarity === 'rare' ? '💎 RARE WIN!' :
               'You Won!'}
            </h3>
            <p className="slot-result-prize" style={{ color: result.prize ? getRarityColor(result.prize.rarity) : '#64748b' }}>
              {result.prize ? result.prize.name : 'No prize this time.'}
            </p>
            <p className="slot-result-credit">
              {result.prize ? 'Prize automatically credited!' : 'Try spinning again for better odds!'}
            </p>
            <button className="slot-play-again-btn" onClick={handlePlayAgain}>
              {result.prize ? 'Play Again' : 'Try Again'}
            </button>
          </div>
        </div>
      )}

      {/* Prize List */}
      <div className="slot-prize-list">
        <h4>Prize Table</h4>
        <div className="slot-prizes-grid">
          {prizes.map(prize => (
            <div key={prize.id} className={`slot-prize-item ${prize.rarity}`}>
              <span className="prize-icon">{prize.icon || '🎁'}</span>
              <span className="prize-name">{prize.name}</span>
              <span className="prize-rarity-dot" style={{ background: getRarityColor(prize.rarity) }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default SlotMachine;
