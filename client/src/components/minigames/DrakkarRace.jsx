import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  DRAKKAR_SHIPS, 
  TRACK_ENVIRONMENTS, 
  subscribeDrakkarRaceState, 
  subscribeDrakkarPools,
  refreshDrakkarRace,
  placeDrakkarBet
} from '../../services/miniGameService';
import './DrakkarRace.css';

const DURATIONS = { betting: 20000, pause: 2000, race: 5000, result: 3000 };

const DrakkarRace = ({ user, userPoints, setFrozen, setDisplayedPoints }) => {
  const [state, setState] = useState(null);
  const [pools, setPools] = useState({ gold: 0, red: 0, blue: 0, green: 0 });
  const [betAmount, setBetAmount] = useState(10);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localError, setLocalError] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  
  // Animation refs
  const requestRef = useRef();
  const [shipPositions, setShipPositions] = useState([5, 5, 5, 5]); // Percentage left

  // 1. Subscriptions
  useEffect(() => {
    const unsubState = subscribeDrakkarRaceState((newState) => {
      setState(newState);
    });
    const unsubPools = subscribeDrakkarPools((newPools) => {
      setPools(newPools);
    });

    return () => {
      unsubState();
      unsubPools();
    };
  }, []);

  // 2. Heartbeat & Timer
  useEffect(() => {
    const interval = setInterval(() => {
      if (!state) return;

      const now = Date.now();
      const diff = state.endTime - now;
      setTimeLeft(Math.max(0, diff));

      // If phase expired, pulse the server
      if (diff <= 0) {
        refreshDrakkarRace();
      }
    }, 500);

    return () => clearInterval(interval);
  }, [state]);

  // 3. Race Animation
  const animate = useCallback(() => {
    if (state && state.phase === 'race') {
      const now = Date.now();
      const raceStartTime = state.endTime - DURATIONS.race;
      const progress = Math.max(0, Math.min(1, (now - raceStartTime) / DURATIONS.race));
      
      const newPositions = [0, 1, 2, 3].map(idx => {
        const isWinner = idx === state.winnerIdx;
        
        // Base linear progress
        const base = 5 + (progress * 80);
        
        // Use segmentType for a more 'calculated' surge
        const segmentIdx = Math.floor(progress * 3);
        const segmentType = state.track?.[segmentIdx] || 'calm';
        
        // Ships perform differently based on the environment
        let environmentalSurge = 0;
        if (segmentType === 'stormy' && idx === state.winnerIdx) environmentalSurge = 2;
        if (segmentType === 'rough' && idx === state.winnerIdx) environmentalSurge = 1;
        
        // Fake speed variations
        const speedMod = Math.sin(now / 200 + idx) * 2;
        
        // If winner, they must cross the line first
        const winnerBoost = isWinner && progress > 0.8 ? (progress - 0.8) * 50 : 0;
        
        return Math.min(90, base + speedMod + environmentalSurge + winnerBoost);
      });

      setShipPositions(newPositions);
    } else if (state && state.phase === 'betting') {
       setShipPositions([5, 5, 5, 5]);
    } else if (state && (state.phase === 'result' || state.phase === 'pause')) {
       // Keep positions at the end if it's result/pause phase
       if (state.phase === 'result') {
         setShipPositions(prev => prev.map((p, i) => i === state.winnerIdx ? 85 : Math.min(p, 80)));
       }
    }
    requestRef.current = requestAnimationFrame(animate);
  }, [state]);

  useEffect(() => {
    requestRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(requestRef.current);
  }, [animate]);

  // 4. Betting Logic
  const handlePlaceBet = async (shipId) => {
    if (isSubmitting || state?.phase !== 'betting') return;
    setLocalError(null);
    setIsSubmitting(true);
    
    try {
      const result = await placeDrakkarBet(shipId, parseInt(betAmount));
      if (result.success) {
        setDisplayedPoints(result.newBalance);
      } else {
        setLocalError(result.error);
      }
    } catch (err) {
      setLocalError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!state) return <div className="minigames-loading"><div className="minigames-spinner" /></div>;

  return (
    <div className="drakkar-race-container">
      {/* HEADER / STATUS */}
      <div className="race-status-bar">
        <div className="status-info">
          <span className="status-text">
            {state.phase === 'betting' ? '⚓ Place Your Bets' : 
             state.phase === 'race' ? '⛵ The Race is On!' : 
             state.phase === 'pause' ? '🏁 Prepare for Start' : '🏅 Winner Revealed'}
          </span>
        </div>
        <div className="timer-pill">
          {Math.ceil(timeLeft / 1000)}s
        </div>
      </div>

      {localError && <div className="chest-error">{localError}</div>}

      {/* TRACK AREA */}
      <div className="race-track-area">
        <div className="track-water-texture" />
        
        {/* Track Segments Display */}
        <div className="track-segments">
          {state.track?.map((env, i) => (
            <div key={i} className={`track-segment ${state.phase === 'betting' && i > 0 ? 'hidden' : ''}`}>
               {state.phase === 'betting' && i > 0 ? '???' : (
                 <><span>{TRACK_ENVIRONMENTS[env].icon}</span> {TRACK_ENVIRONMENTS[env].name}</>
               )}
            </div>
          ))}
        </div>

        {/* SHIP LANES */}
        <div className="ships-lane-container">
          {DRAKKAR_SHIPS.map((ship, i) => (
            <div key={ship.id} className="ship-lane">
              <div 
                className="racer-ship-wrapper"
                style={{ 
                  left: `${shipPositions[i]}%`,
                  '--ship-glow': ship.color 
                }}
              >
                <img 
                  src={process.env.PUBLIC_URL + '/icons/minigames/legendary_ship.png'} 
                  alt={ship.name} 
                  className="racer-ship-img"
                />
                <span className="racer-name-tag">{ship.name}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* BETTING CONTROLS */}
      <div className="drakkar-betting-grid">
        {DRAKKAR_SHIPS.map((ship) => (
          <div 
            key={ship.id} 
            className={`ship-bet-card ${state.phase !== 'betting' ? 'disabled' : ''}`}
            style={{ '--ship-color': ship.color, '--ship-gradient': ship.gradient }}
          >
            <div className="bet-card-header">
              <div className="bet-card-icon">
                <img src={process.env.PUBLIC_URL + '/icons/minigames/legendary_ship.png'} width="20" alt="" />
              </div>
              <div className="bet-card-info">
                <h4>{ship.name}</h4>
                <div className="bet-card-pool">Pool: 🪙{pools?.[ship.id] || 0}</div>
              </div>
            </div>

            {state.phase === 'betting' && (
              <div className="bet-input-wrapper">
                <input 
                  type="number" 
                  min="10" 
                  className="bet-input" 
                  value={betAmount} 
                  onChange={(e) => setBetAmount(e.target.value)}
                  onClick={e => e.stopPropagation()}
                />
                <button 
                  className="btn-place-bet"
                  disabled={isSubmitting}
                  onClick={() => handlePlaceBet(ship.id)}
                >
                  Bet
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* RESULT OVERLAY */}
      {state.phase === 'result' && (
        <div className="race-result-overlay">
          <div className="winner-crown">👑</div>
          <div className="winner-announce-card">
             <h2>{DRAKKAR_SHIPS[state.winnerIdx].name} Wins!</h2>
             <p>All bets on this ship paid out 3.8x</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default DrakkarRace;
