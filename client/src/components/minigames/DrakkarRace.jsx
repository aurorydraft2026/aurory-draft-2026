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
  const [userBets, setUserBets] = useState({}); // Track personal stakes
  const [history, setHistory] = useState([]);
  const [selectedChip, setSelectedChip] = useState(10);
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
        
        // ─── GEOMETRY UPDATE ───
        // Harbor: 0-10% | Race Zone: 10-90% | Finish: 90-100%
        // Base linear progress across the 80% race zone
        const base = 10 + (progress * 80);
        
        // Strategic modifier calculation (Exactly synced to the 3 visual segments)
        // Since the 3 segments occupy the 10-90% zone, progress (0-1) maps directly to them
        const segmentIdx = Math.floor(progress * 2.99); // 2.99 to avoid out of bounds at exactly 1.0
        const segmentType = state.track?.[segmentIdx] || 'calm';
        const targetEfficiency = EFFICIENCY_MATRIX[ship.id]?.[segmentType] || 1.0;

        // Smoothly interpolate the efficiency/boost when switching segments
        const segmentProgress = (progress * 3) % 1;
        let efficiency = targetEfficiency;
        
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
        
        return Math.min(92, base + boost + winnerBoost);
      });

      setShipPositions(newPositions);
    } else if (state && (state.phase === 'betting' || state.phase === 'pause')) {
       // PARKED IN HARBOR (5% position)
       setShipPositions([5, 5, 5]);
    } else if (state && state.phase === 'result') {
       if (state.phase === 'result') {
         setShipPositions(prev => prev.map((p, i) => i === state.stateWinnerIdx ? 92 : Math.min(p, 88)));
       }
    }
    requestRef.current = requestAnimationFrame(animate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, currentShips]);

  useEffect(() => {
    requestRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(requestRef.current);
  }, [animate]);

  // 4. Betting Logic
  const pendingBets = useRef({});
  const debounceTimers = useRef({});
  const inFlightCount = useRef(0); // Track active server requests

  // HELPER: Sync the frozen state with the parent HUB
  const updateFrozenState = useCallback(() => {
    const hasActiveTimers = Object.keys(debounceTimers.current).length > 0;
    const hasInFlightRequests = inFlightCount.current > 0;
    setFrozen(hasActiveTimers || hasInFlightRequests);
  }, [setFrozen]);

  // BUG FIX: BUZZER-SYNC (Flush pending bets when phase ends)
  const flushPendingBets = useCallback(async () => {
    Object.keys(pendingBets.current).forEach(async (shipId) => {
      const totalToBet = pendingBets.current[shipId];
      if (totalToBet > 0) {
        // Clear timer to prevent double-push
        if (debounceTimers.current[shipId]) {
          clearTimeout(debounceTimers.current[shipId]);
          delete debounceTimers.current[shipId];
        }
        
        pendingBets.current[shipId] = 0;
        inFlightCount.current++;
        updateFrozenState();
        
        try {
          const result = await placeDrakkarBet(shipId, totalToBet);
          if (!result.success) {
            // Rollback everything (Global, Personal, and Balance)
            setPools(prev => ({ ...prev, [shipId]: Math.max(0, (prev[shipId] || 0) - totalToBet) }));
            setUserBets(prev => ({ ...prev, [shipId]: Math.max(0, (prev[shipId] || 0) - totalToBet) }));
            setDisplayedPoints(prev => prev + totalToBet);
            setLocalError(`Buzzer beater rejected: ${result.error}`);
          }
        } catch (err) {
          setPools(prev => ({ ...prev, [shipId]: Math.max(0, (prev[shipId] || 0) - totalToBet) }));
          setUserBets(prev => ({ ...prev, [shipId]: Math.max(0, (prev[shipId] || 0) - totalToBet) }));
          setDisplayedPoints(prev => prev + totalToBet);
        } finally {
          inFlightCount.current--;
          updateFrozenState();
        }
      }
    });
  }, [setDisplayedPoints, updateFrozenState]);

  useEffect(() => {
    if (state?.phase !== 'betting' && state?.phase !== undefined) {
      flushPendingBets();
    }
  }, [state?.phase, flushPendingBets]);

  useEffect(() => {
    if (state?.raceId) {
      setUserBets({});
      setLocalError(null); // Clear any buzzer-beater warnings for the new race
      // CLEAN MEMORY FOR NEW RACE
      pendingBets.current = {};
      Object.values(debounceTimers.current).forEach(t => clearTimeout(t));
      debounceTimers.current = {};
      inFlightCount.current = 0;
      updateFrozenState();
    }
  }, [state?.raceId, updateFrozenState]);

  const handlePlaceBet = (shipId) => {
    // ─── INFINITE GRACE CLIENT-SIDE (Allow 300ms overlap) ───
    const isBetting = state?.phase === 'betting';
    const isGracePeriod = state?.phase === 'pause' && (Date.now() - state?.startTime < 300);
    
    if (!isBetting && !isGracePeriod) return;
    // ───────────────────────────────────────────────────────

    if (userPoints < selectedChip) {
      setLocalError(`Insufficient Valcoins!`);
      setTimeout(() => setLocalError(null), 3000);
      return;
    }

    // ─── OPTIMISTIC UI (INSTANT) ───
    setPools(prev => ({ ...prev, [shipId]: (prev[shipId] || 0) + selectedChip }));
    setUserBets(prev => ({ ...prev, [shipId]: (prev[shipId] || 0) + selectedChip }));
    setDisplayedPoints(prev => prev - selectedChip);
    
    // Freeze Hub balance updates while betting
    updateFrozenState();

    setLocalError(null);
    
    // ─── BUFFERING / DEBOUNCE LOGIC ───
    pendingBets.current[shipId] = (pendingBets.current[shipId] || 0) + selectedChip;

    if (debounceTimers.current[shipId]) {
      clearTimeout(debounceTimers.current[shipId]);
    }

    debounceTimers.current[shipId] = setTimeout(async () => {
      const totalToBet = pendingBets.current[shipId];
      if (totalToBet <= 0) return;
      
      // RESET BEFORE CALL to prevent race conditions during async
      pendingBets.current[shipId] = 0;
      delete debounceTimers.current[shipId];
      
      inFlightCount.current++;
      updateFrozenState();

      try {
        const result = await placeDrakkarBet(shipId, totalToBet);
        if (!result.success) {
          setPools(prev => ({ ...prev, [shipId]: Math.max(0, (prev[shipId] || 0) - totalToBet) }));
          setUserBets(prev => ({ ...prev, [shipId]: Math.max(0, (prev[shipId] || 0) - totalToBet) }));
          setDisplayedPoints(prev => prev + totalToBet);
          setLocalError(result.error);
        }
      } catch (err) {
        setPools(prev => ({ ...prev, [shipId]: Math.max(0, (prev[shipId] || 0) - totalToBet) }));
        setUserBets(prev => ({ ...prev, [shipId]: Math.max(0, (prev[shipId] || 0) - totalToBet) }));
        setDisplayedPoints(prev => prev + totalToBet);
        setLocalError(err.message);
      } finally {
        inFlightCount.current--;
        updateFrozenState();
      }
    }, 300);
    
    // Trigger the frozen check immediately so the parent knows a timer started
    updateFrozenState();
  };

  if (!state) return <div className="minigames-loading"><div className="minigames-spinner" /></div>;

  return (
    <div className="drakkar-race-container">
      {/* STICKY HEADER / STATUS */}
      <div className="race-header-sticky">
        <div className="race-status-bar">
          <div className="status-info">
            <span className="status-text">
              {state.phase === 'betting' ? '⚓ Place Your Bets' : 
               state.phase === 'race' ? '⛵ The Race is On!' : 
               state.phase === 'pause' ? '🏁 Reveal Obstacles...' : '🏅 Winner Revealed'}
            </span>
          </div>
          <button className="race-rules-btn" onClick={() => setShowRules(true)}>
            <span>📖</span> Rules & Stats
          </button>
          <div className="timer-pill">
            {Math.ceil(timeLeft / 1000)}s
          </div>
        </div>
        {localError && <div className="race-error-toast">{localError}</div>}
      </div>

      {/* TRACK AREA - FULL WIDTH */}
      <div className="race-track-area">
        <div className="track-water-texture" />
        
        {/* Harbor & Finish Visuals */}
        <div className="track-harbor"><span>START</span></div>
        <div className="track-finish"><span>FINISH</span></div>

        {/* Track Segments Display (10% to 90%) */}
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

        {/* SHIP LANES - EXPLICITLY LIMIT TO 3 */}
        <div className="ships-lane-container">
          {currentShips.slice(0, 3).map((ship, i) => (
            <div key={`${ship.id}-${i}`} className="ship-lane">
              <div 
                className="racer-ship-wrapper"
                style={{ 
                  left: `${shipPositions[i]}%`,
                  '--ship-glow': ship.color,
                  filter: `drop-shadow(0 0 10px ${ship.color})`
                }}
              >
                {/* FLOATING NAME TAG ABOVE */}
                <span className="racer-name-tag" style={{ backgroundColor: ship.color }}>
                  {ship.name}
                </span>
                <img 
                  src={process.env.PUBLIC_URL + '/icons/minigames/legendary_ship.png'} 
                  alt={ship.name} 
                  className="racer-ship-img"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* NEW HUD: HISTORY + BETTING */}
      <div className="drakkar-new-hud-layout">
        {/* History Sidebar Repositioned */}
        <div className="race-history-section">
          <div className="history-header-pill">LATEST RESULTS</div>
          <div className="history-list-mini">
            {history.map((h, i) => {
               const ship = DRAKKAR_SHIPS.find(s => s.id === h.winnerId);
               return (
                 <div key={i} className="history-mini-item">
                   <div className="h-dot" style={{ backgroundColor: ship?.color }} title={ship?.name} />
                   <div className="h-pool">💰{h.totalPool}</div>
                   <div className="h-mult">x{h.multiplier}</div>
                 </div>
               );
            })}
            {history.length === 0 && <div className="history-empty">Waiting...</div>}
          </div>
        </div>

        {/* BETTING SECTION */}
        <div className="race-betting-main">
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
            {currentShips.map((ship) => {
              const personalBet = userBets[ship.id] || 0;
              const globalPool = pools?.[ship.id] || 0;
              // SYNC BUG FIX: Global should always be >= Personal in the UI
              const displayPool = Math.max(globalPool, personalBet);

              return (
                <button 
                  key={ship.id} 
                  className={`ship-v-bet-card ${state.phase !== 'betting' ? 'disabled' : ''}`}
                  onClick={() => handlePlaceBet(ship.id)}
                  disabled={state.phase !== 'betting'}
                  style={{ '--ship-accent': ship.color }}
                >
                  <div className="ship-v-preview">
                    <img src={process.env.PUBLIC_URL + '/icons/minigames/legendary_ship.png'} alt="" />
                  </div>
                  <div className="ship-v-info">
                    <h4>{ship.name}</h4>
                    <div className="ship-v-stats">
                      <span className="ship-v-pool" title="Global Pool">GLOBAL: 💰{displayPool}</span>
                      {personalBet > 0 && (
                        <span className="ship-v-solo" title="Your Personal Bet">YOU: 💰{personalBet}</span>
                      )}
                    </div>
                  </div>
                  <div className="ship-v-add-hint">+{selectedChip}</div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* RULES MODAL */}
      {showRules && (
        <div className="race-rules-overlay" onClick={() => setShowRules(false)}>
          <div className="rules-modal-box" onClick={e => e.stopPropagation()}>
            <div className="rules-modal-header">
              <h3>⚔️ Drakkar Strategy Guide</h3>
              <button className="rules-close-btn" onClick={() => setShowRules(false)}>×</button>
            </div>

            <div className="rules-modal-body">
              <section className="rules-section">
                <h4>⚓ Pool Sharing Payout (Option B)</h4>
                <p>The total betting pool (minus 10% rake) is shared proportionally among all winners of the finishing ship. 
                Payouts are <strong>dynamic</strong>—the less popular a ship is, the higher its multiplier if it wins!</p>
              </section>

              <section className="rules-section">
                <h4>🌊 Efficiency Matrix (Speed %)</h4>
                <div className="efficiency-table-wrapper">
                  <table className="efficiency-table">
                    <thead>
                      <tr>
                        <th>Ship</th>
                        {Object.values(TRACK_ENVIRONMENTS).map((env, i) => (
                          <th key={i} title={env.name}>{env.icon}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {DRAKKAR_SHIPS.map((ship) => (
                        <tr key={ship.id}>
                          <td className="ship-name-cell" style={{ color: ship.color }}>{ship.name}</td>
                          {Object.keys(TRACK_ENVIRONMENTS).map((envKey) => {
                             const val = EFFICIENCY_MATRIX[ship.id][envKey];
                             return (
                               <td key={envKey} className={`eff-cell ${val > 1.0 ? 'high' : val < 1.0 ? 'low' : ''}`}>
                                 {Math.round(val * 100)}%
                               </td>
                             );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            <div className="rules-modal-footer">
              <p>Tip: Check the first weather segment and predict the ship that will gain the most distance!</p>
            </div>
          </div>
        </div>
      )}

      {/* WINNER MODAL */}
      {state.phase === 'result' && (
        <div className="race-result-overlay">
          <div className="winner-content-card" style={{ '--winner-accent': currentShips[state.stateWinnerIdx]?.color }}>
            <div className="victory-crown">👑</div>
            <div className="winner-ship-display">
               <img 
                 src={process.env.PUBLIC_URL + '/icons/minigames/legendary_ship.png'} 
                 alt="" 
                 className="winner-hero-img"
               />
            </div>
            <h2 className="winner-announce-text">
              {currentShips[state.stateWinnerIdx]?.name} Wins!
            </h2>
            <p className="winner-sub-text">Dynamic Payout Distributed</p>
            <div className="winner-payout-confetti" />
          </div>
        </div>
      )}
    </div>
  );
};

export default DrakkarRace;


