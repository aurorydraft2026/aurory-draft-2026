import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  DRAKKAR_SHIPS, 
  TRACK_ENVIRONMENTS, 
  EFFICIENCY_MATRIX,
  subscribeDrakkarRaceState, 
  subscribeDrakkarPools,
  subscribeDrakkarHistory,
  refreshDrakkarRace,
  placeDrakkarBet
} from '../../services/miniGameService';
import './DrakkarRace.css';

const DURATIONS = { betting: 20000, pause: 2000, race: 7000, result: 3000 };

const DrakkarRace = ({ user, userPoints, setFrozen, setDisplayedPoints }) => {
  const [state, setState] = useState(null);
  const [pools, setPools] = useState({});
  const [history, setHistory] = useState([]);
  const [selectedChip, setSelectedChip] = useState(10);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localError, setLocalError] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [showRules, setShowRules] = useState(false);
  
  // Animation refs
  const requestRef = useRef();
  const [shipPositions, setShipPositions] = useState([5, 5, 5]); // Percentage left

  // 1. Subscriptions
  useEffect(() => {
    const unsubState = subscribeDrakkarRaceState((newState) => {
      setState(newState);
    });
    const unsubPools = subscribeDrakkarPools((newPools) => {
      // Merge optimistic updates with server state
      setPools(prev => ({ ...newPools, ...prev, ...newPools }));
    });
    const unsubHistory = subscribeDrakkarHistory((newHistory) => {
      setHistory(newHistory);
    });

    return () => {
      unsubState();
      unsubPools();
      unsubHistory();
    };
  }, []);

  // 2. Heartbeat & Timer
  useEffect(() => {
    const interval = setInterval(() => {
      if (!state) return;

      const now = Date.now();
      const diff = state.endTime - now;
      setTimeLeft(Math.max(0, diff));

      if (diff <= 0) {
        refreshDrakkarRace();
      }
    }, 500);

    return () => clearInterval(interval);
  }, [state]);

  // Derived: Get the 3 selected ships for this race
  const currentShips = useMemo(() => {
    if (!state?.selectedShips) return [];
    return state.selectedShips.map(id => DRAKKAR_SHIPS.find(s => s.id === id)).filter(Boolean);
  }, [state?.selectedShips]);

  // 3. Race Animation Logic
  const animate = useCallback(() => {
    if (state && state.phase === 'race' && currentShips.length > 0) {
      const now = Date.now();
      // Anchor race start to server-synced time to eliminate lag jumps
      const raceStartTime = state.startTime + DURATIONS.betting + DURATIONS.pause;
      const progress = Math.max(0, Math.min(1, (now - raceStartTime) / DURATIONS.race));
      
      const newPositions = currentShips.map((ship, idx) => {
        const isWinner = idx === state.stateWinnerIdx;
        
        // Base linear progress
        const base = 5 + (progress * 80);
        
        // Strategic modifier calculation
        const segmentIdx = Math.floor(progress * 3);
        const segmentType = state.track?.[segmentIdx] || 'calm';
        const targetEfficiency = EFFICIENCY_MATRIX[ship.id]?.[segmentType] || 1.0;

        // Smoothly interpolate the efficiency/boost when switching segments
        // This prevents the ship from "jumping" suddenly at the border
        const segmentProgress = (progress * 3) % 1;
        let efficiency = targetEfficiency;
        
        // If we are at the very start of a segment, blend from the previous segment's efficiency
        if (segmentProgress < 0.2 && segmentIdx > 0) {
            const prevSegmentType = state.track?.[segmentIdx - 1] || 'calm';
            const prevEfficiency = EFFICIENCY_MATRIX[ship.id]?.[prevSegmentType] || 1.0;
            const blend = segmentProgress / 0.2;
            efficiency = prevEfficiency + (targetEfficiency - prevEfficiency) * blend;
        }
        
        // Speed variation based on weather efficiency (accumulated offset)
        const boost = (efficiency - 1.0) * 12;
        
        // Final winner push to ensure they hit the line first
        const winnerBoost = isWinner && progress > 0.85 ? (progress - 0.85) * 60 : 0;
        
        return Math.min(88, base + boost + winnerBoost);
      });

      setShipPositions(newPositions);
    } else if (state && state.phase === 'betting') {
       setShipPositions([5, 5, 5]);
    } else if (state && (state.phase === 'result' || state.phase === 'pause')) {
       if (state.phase === 'result') {
         setShipPositions(prev => prev.map((p, i) => i === state.stateWinnerIdx ? 88 : Math.min(p, 82)));
       }
    }
    requestRef.current = requestAnimationFrame(animate);
  }, [state, currentShips]);

  useEffect(() => {
    requestRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(requestRef.current);
  }, [animate]);

  // 4. Betting Logic
  const handlePlaceBet = async (shipId) => {
    if (isSubmitting || state?.phase !== 'betting') return;
    if (userPoints < selectedChip) {
      setLocalError(`Insufficient Valcoins!`);
      setTimeout(() => setLocalError(null), 3000);
      return;
    }

    // ─── OPTIMISTIC UI ───
    const prevPools = { ...pools };
    const prevPoints = userPoints;
    
    setPools(prev => ({
      ...prev,
      [shipId]: (prev[shipId] || 0) + selectedChip
    }));
    setDisplayedPoints(prevPoints - selectedChip);
    // ─────────────────────

    setLocalError(null);
    setIsSubmitting(true);
    
    try {
      const result = await placeDrakkarBet(shipId, selectedChip);
      if (!result.success) {
        // Rollback on failure
        setPools(prevPools);
        setDisplayedPoints(prevPoints);
        setLocalError(result.error);
      }
    } catch (err) {
      setPools(prevPools);
      setDisplayedPoints(prevPoints);
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
             state.phase === 'pause' ? '🏁 Reveal Obstacles...' : '🏅 Winner Revealed'}
          </span>
        </div>
        <button className="race-rules-btn" onClick={() => setShowRules(true)}>📖 Rules & Stats</button>
        <div className="timer-pill">
          {Math.ceil(timeLeft / 1000)}s
        </div>
      </div>

      {localError && <div className="race-error-toast">{localError}</div>}

      {/* RACE LAYOUT: HISTORY + TRACK */}
      <div className="race-main-layout">
        {/* Left Sidebar: History */}
        <div className="race-history-sidebar">
          <div className="history-header">LAST 20</div>
          <div className="history-list">
            {history.map((h, i) => {
               const ship = DRAKKAR_SHIPS.find(s => s.id === h.winnerId);
               return (
                 <div key={i} className="history-item">
                   <div className="history-ship-dot" style={{ backgroundColor: ship?.color }} title={ship?.name} />
                   <div className="history-pool">🪙{h.totalPool}</div>
                   <div className="history-mult">x{h.multiplier}</div>
                 </div>
               );
            })}
            {history.length === 0 && <div className="history-empty">No races yet</div>}
          </div>
        </div>

        {/* TRACK AREA */}
        <div className="race-track-area">
          <div className="track-water-texture" />
          
          {/* Track Segments Display */}
          <div className="track-segments">
            {[0, 1, 2].map((i) => {
              const isRevealed = state.phase === 'race' || state.phase === 'result' || state.phase === 'pause' || i === 0;
              const env = state.track?.[i];
              
              return (
                <div key={i} className={`track-segment ${!isRevealed ? 'mystery' : ''}`}>
                   {isRevealed && env ? (
                     <>
                       <span className="segment-icon">{TRACK_ENVIRONMENTS[env].icon}</span> 
                       <span className="segment-name">{TRACK_ENVIRONMENTS[env].name}</span>
                     </>
                   ) : (
                     <span className="segment-placeholder">???</span>
                   )}
                </div>
              );
            })}
          </div>

          {/* SHIP LANES */}
          <div className="ships-lane-container">
            {currentShips.map((ship, i) => (
              <div key={ship.id} className="ship-lane">
                <div 
                  className="racer-ship-wrapper"
                  style={{ 
                    left: `${shipPositions[i]}%`,
                    '--ship-glow': ship.color,
                    filter: `drop-shadow(0 0 10px ${ship.color})`
                  }}
                >
                  <img 
                    src={process.env.PUBLIC_URL + '/icons/minigames/legendary_ship.png'} 
                    alt={ship.name} 
                    className="racer-ship-img"
                  />
                  <span className="racer-name-tag" style={{ borderLeftColor: ship.color }}>{ship.name}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* NEW BETTING HUD */}
      <div className="drakkar-new-hud">
        {/* Chips Selection */}
        <div className="chip-selector-bar">
          {[1, 5, 10, 50, 100].map(val => (
            <button 
              key={val} 
              className={`bet-chip-btn ${selectedChip === val ? 'active' : ''}`}
              onClick={() => setSelectedChip(val)}
            >
              <img src={process.env.PUBLIC_URL + '/valcoin-icon.jpg'} alt="" className="chip-icon" />
              <span>x{val}</span>
            </button>
          ))}
        </div>

        {/* SHIP SELECTION CARDS */}
        <div className="ship-betting-row">
          {currentShips.map((ship) => (
            <button 
              key={ship.id} 
              className={`ship-v-bet-card ${state.phase !== 'betting' ? 'disabled' : ''}`}
              onClick={() => handlePlaceBet(ship.id)}
              disabled={isSubmitting || state.phase !== 'betting'}
              style={{ '--ship-accent': ship.color }}
            >
              <div className="ship-v-preview">
                <img src={process.env.PUBLIC_URL + '/icons/minigames/legendary_ship.png'} alt="" />
              </div>
              <div className="ship-v-info">
                <h4>{ship.name}</h4>
                <div className="ship-v-pool">Pool: 💰{pools?.[ship.id] || 0}</div>
              </div>
              <div className="ship-v-add-hint">+{selectedChip}</div>
            </button>
          ))}
        </div>
      </div>

      {/* RULES MODAL */}
      {showRules && (
        <div className="rules-overlay" onClick={() => setShowRules(false)}>
          <div className="rules-card" onClick={e => e.stopPropagation()}>
            <div className="rules-header">
              <h3>Drakkar Strategy Guide</h3>
              <button className="rules-close" onClick={() => setShowRules(false)}>×</button>
            </div>
            <div className="rules-payout-info">
              <p>⚓ <strong>Pool Sharing Payout (Option B)</strong>: The total betting pool (minus 10% rake) is shared among the winners. Payouts are dynamic based on popularity!</p>
            </div>
            <div className="rules-table-wrapper">
              <table className="efficiency-table">
                <thead>
                  <tr>
                    <th>Ship</th>
                    {Object.keys(TRACK_ENVIRONMENTS).map(k => (
                      <th key={k}>{TRACK_ENVIRONMENTS[k].icon}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {DRAKKAR_SHIPS.map(ship => (
                    <tr key={ship.id}>
                      <td className="ship-cell" style={{ color: ship.color }}>{ship.name}</td>
                      {Object.keys(TRACK_ENVIRONMENTS).map(w => {
                        const eff = EFFICIENCY_MATRIX[ship.id][w];
                        const className = eff > 1 ? 'eff-good' : eff < 1 ? 'eff-bad' : 'eff-neutral';
                        return <td key={w} className={className}>{Math.round(eff * 100)}%</td>
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* RESULT OVERLAY */}
      {state.phase === 'result' && state.stateWinnerIdx !== null && currentShips[state.stateWinnerIdx] && (
        <div className="race-result-overlay">
          <div className="winner-celebration">
            <div className="winner-crown">👑</div>
            <h2>{currentShips[state.stateWinnerIdx].name} Wins!</h2>
            <div className="payout-note">Dynamic Payout Distributed</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DrakkarRace;

