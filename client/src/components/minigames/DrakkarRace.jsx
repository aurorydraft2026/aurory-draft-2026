import React, { useState, useEffect, useRef } from 'react';
import { ref, onValue } from 'firebase/database';
import { database } from '../../firebase';
import {
  ALL_SHIPS,
  ALL_WEATHERS,
  SPEED_MATRIX,
  CHIP_VALUES,
  MAX_BET_PER_USER,
  ZONE_WIDTH,
  DOCK_WIDTH,
  SHIP_START,
  computeShipPosition,
  formatSpeed,
  getShipGlobalIndex,
  getWeatherGlobalIndex,
  subscribeDrakkarRaceState,
  subscribeDrakkarPools,
  subscribeDrakkarHistory,
  refreshDrakkarRace,
  placeDrakkarBet
} from '../../services/miniGameService';
import './DrakkarRace.css';

const FINISH_LINE = DOCK_WIDTH + 5 * ZONE_WIDTH; // 100%
const DEFAULT_HOUSE_SEED = 500;
const DEFAULT_MULTIPLIER = 0.9;

const DrakkarRace = ({ user, userPoints, setFrozen, setDisplayedPoints }) => {
  const [state, setState] = useState(null);
  const [pools, setPools] = useState({});
  const [history, setHistory] = useState([]);
  const [selectedChip, setSelectedChip] = useState(5);
  const [myBets, setMyBets] = useState({});
  const [pendingBetsTotal, setPendingBetsTotal] = useState(0);
  const [localError, setLocalError] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [showRules, setShowRules] = useState(false);
  const [isPeeking, setIsPeeking] = useState(false);

  // Animation
  const animFrameRef = useRef();
  const shipRefs = useRef([]);
  const [shipPositions, setShipPositions] = useState([SHIP_START, SHIP_START, SHIP_START]);
  const [raceFinished, setRaceFinished] = useState(false);
  const [tickCount, setTickCount] = useState(0); // Forced repaint counter
  const prevRaceIdRef = useRef(null);

  const pendingRequestsRef = useRef(0);
  const [serverOffset, setServerOffset] = useState(0);

  // Animation Strategy: Use refs to prevent stale closures and competing loops
  const stateRef = useRef(null);
  const raceFinishedRef = useRef(false);
  const serverOffsetRef = useRef(0);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { raceFinishedRef.current = raceFinished; }, [raceFinished]);
  useEffect(() => { serverOffsetRef.current = serverOffset; }, [serverOffset]);

  // ─── 0. Server Time Offset ───
  useEffect(() => {
    const offsetRef = ref(database, ".info/serverTimeOffset");
    const unsub = onValue(offsetRef, (snap) => {
      setServerOffset(snap.val() || 0);
    });
    return () => unsub();
  }, []);

  // ─── 1. Subscriptions ───
  useEffect(() => {
    const unsubState = subscribeDrakkarRaceState((newState) => {
      setState(newState);
    });
    const unsubPools = subscribeDrakkarPools((newPools) => {
      setPools(newPools);
    });
    const unsubHistory = subscribeDrakkarHistory((entries) => {
      setHistory(entries);
    });

    return () => {
      unsubState();
      unsubPools();
      unsubHistory();
    };
  }, []);

  // Reset bets when a new race starts
  useEffect(() => {
    if (state && state.raceId !== prevRaceIdRef.current) {
      prevRaceIdRef.current = state.raceId;
      setMyBets({});
      setLocalError(null);
      setRaceFinished(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.raceId]);

  // ─── 2. Heartbeat & Timer ───
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

  // ─── 3. Stable Animation Engine ───
  useEffect(() => {
    const tick = () => {
      const s = stateRef.current;
      const rf = raceFinishedRef.current;
      const offset = serverOffsetRef.current;

      if (!s || rf) {
        animFrameRef.current = requestAnimationFrame(tick);
        return;
      }

      // ─── 3.1 Racing or Result Phase ───
      if (s.phase === 'racing' || s.phase === 'result') {
        if (!s.shipIndices || !s.weatherIndices) {
          animFrameRef.current = requestAnimationFrame(tick);
          return;
        }

        const now = Date.now() + offset;
        const duration = s.raceDuration || 25000;
        const serverStart = s.raceStartTime || (s.endTime - duration);

        if (!serverStart) {
          animFrameRef.current = requestAnimationFrame(tick);
          return;
        }

        const elapsed = now - serverStart;
        const winnerFinishTime = s.finishTimes ? s.finishTimes[s.winnerIdx] : 999999;

        // Finish Condition
        if (elapsed >= winnerFinishTime) {
          const finalPositions = s.shipIndices.map((sIdx, i) => {
            if (i === s.winnerIdx) return FINISH_LINE;
            const shipTotalTime = s.finishTimes[i];
            const shipSpeeds = s.weatherIndices.map((wIdx) => SPEED_MATRIX[sIdx][wIdx]);
            return computeShipPosition(shipSpeeds, Math.min(winnerFinishTime, shipTotalTime));
          });

          // Direct-DOM Final Snap
          finalPositions.forEach((pos, i) => {
            if (shipRefs.current[i]) {
              shipRefs.current[i].style.setProperty('--dv2-ship-pos', `${pos}%`);
            }
          });

          setShipPositions(finalPositions);
          setRaceFinished(true); // Triggers re-render and ref update
          animFrameRef.current = requestAnimationFrame(tick);
          return;
        }

        // Live Movement
        const newPositions = s.shipIndices.map((sIdx) => {
          const shipSpeeds = s.weatherIndices.map((wIdx) => SPEED_MATRIX[sIdx][wIdx]);
          return computeShipPosition(shipSpeeds, elapsed);
        });
        
        // Direct-DOM Update for perfectly smooth 60fps movement
        newPositions.forEach((pos, i) => {
          if (shipRefs.current[i]) {
            shipRefs.current[i].style.setProperty('--dv2-ship-pos', `${pos}%`);
          }
        });

        setShipPositions(newPositions);
        setTickCount(c => (c + 1) % 1000); // Pulse a re-render

        // Deep Diagnostic Log
        if (Math.random() < 0.05) {
          console.log(`Drakkar Engine v2.11 | Race#${s.raceId} | Elapsed: ${elapsed}ms | Positions:`, newPositions);
        }
      } else {
        // Idle / Betting Phase: Clear Direct-DOM variables to avoid "stuck" visuals
        shipRefs.current.forEach(ref => {
          if (ref) ref.style.removeProperty('--dv2-ship-pos');
        });

        setShipPositions([SHIP_START, SHIP_START, SHIP_START]);
        setRaceFinished(false);
      }

      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, []); // Run only once on mount

  // ─── 4. Betting Logic ───
  const handlePlaceBet = async (shipId) => {
    if (state?.phase !== 'betting') return;
    setLocalError(null);

    const amount = selectedChip;
    const currentTotal = Object.values(myBets).reduce((a, b) => a + b, 0);
    if (currentTotal + pendingBetsTotal + amount > MAX_BET_PER_USER) {
      setLocalError(`Max bet is ${MAX_BET_PER_USER} per race. You have ${currentTotal + pendingBetsTotal} placed/pending.`);
      return;
    }

    // ── Pre-flight Balance Check ──
    if (amount > userPoints) {
      setLocalError(`Insufficient Valcoins. You have ${userPoints} available.`);
      return;
    }

    // ── OPTIMISTIC UI UPDATE ──
    setFrozen(true); // Disable global sync while we are betting
    setMyBets(prev => ({
      ...prev,
      [shipId]: (prev[shipId] || 0) + amount
    }));
    setPendingBetsTotal(prev => prev + amount);
    setDisplayedPoints(prev => prev - amount); // Optimistic deduction
    pendingRequestsRef.current += 1;

    try {
      const result = await placeDrakkarBet(shipId, amount);
      if (result.success) {
        pendingRequestsRef.current -= 1;
        // ONLY sync with server if this is the LAST pending request
        if (pendingRequestsRef.current === 0) {
          setDisplayedPoints(result.newBalance);
          setFrozen(false); // Re-enable global sync
        }
      } else {
        // ROLLBACK 
        pendingRequestsRef.current -= 1;
        setMyBets(prev => ({ ...prev, [shipId]: Math.max(0, (prev[shipId] || 0) - amount) }));
        setDisplayedPoints(prev => prev + amount); // Rollback optimistic deduction
        if (pendingRequestsRef.current === 0) setFrozen(false);
        setLocalError(result.error);
      }
    } catch (err) {
      // ROLLBACK
      pendingRequestsRef.current -= 1;
      setMyBets(prev => ({ ...prev, [shipId]: Math.max(0, (prev[shipId] || 0) - amount) }));
      setDisplayedPoints(prev => prev + amount); // Rollback optimistic deduction
      if (pendingRequestsRef.current === 0) setFrozen(false);
      setLocalError(err.message);
    } finally {
      setPendingBetsTotal(prev => prev - amount);
    }
  };

  // ─── Derived Data ───
  const raceShips = state?.ships || [];
  const raceWeathers = state?.weathers || [];

  const currentHouseSeed = state?.houseSeed ?? DEFAULT_HOUSE_SEED;
  const currentMultiplier = state?.multiplierFactor ?? DEFAULT_MULTIPLIER;
  const highestProgress = Math.max(...shipPositions);

  const totalPool = raceShips.reduce((sum, s) => sum + (pools[s.id] || 0), 0) + (currentHouseSeed * 3);

  const getPhaseLabel = () => {
    if (!state) return '';
    switch (state.phase) {
      case 'betting': return '⚓ PLACE YOUR BETS';
      case 'reveal': return '🌊 WEATHERS REVEALED';
      case 'racing': return '⛵ RACE IN PROGRESS';
      case 'result': return '🏅 WINNER REVEALED';
      default: return '';
    }
  };

  const getEstimatedPayout = (shipId) => {
    const shipPool = (pools[shipId] || 0) + currentHouseSeed;
    if (shipPool === 0 || totalPool === 0) return '—';
    const multiplier = (totalPool / shipPool) * currentMultiplier;
    return multiplier.toFixed(1) + 'x';
  };

  // ─── Loading ───
  if (!state) return <div className="minigames-loading"><div className="minigames-spinner" /></div>;

  return (
    <div className="drakkar-v2-container">
      {/* ═══ STATUS BAR ═══ */}
      <div className="dv2-status-bar">
        <div className="dv2-status-left">
          <span
            className="dv2-phase-label"
            onMouseDown={() => setIsPeeking(true)}
            onMouseUp={() => setIsPeeking(false)}
            onMouseLeave={() => setIsPeeking(false)}
            onTouchStart={() => setIsPeeking(true)}
            onTouchEnd={() => setIsPeeking(false)}
          >
            {getPhaseLabel()}
          </span>
          <span className="dv2-race-id">Race #{state.raceId || 0}</span>
        </div>
        <div className="dv2-status-right">
          <button className="dv2-rules-btn" onClick={() => setShowRules(true)}>📜 Rules</button>
          <div className="dv2-timer-pill">
            {state.phase === 'racing' ? '🏁' :
              state.phase === 'betting' ? `${Math.ceil(timeLeft / 1000)}s` :
                <div className="dv2-spinner" />}
          </div>
        </div>
      </div>

      {localError && <div className="dv2-error">{localError}</div>}

      {/* ═══ MAIN LAYOUT: History | Track+Betting ═══ */}
      <div className="dv2-main-layout">

        {/* ── TRACK & BETTING ── */}
        <div className="dv2-race-section">

          {/* ═══ WEATHER BAR ═══ */}
          <div className="dv2-weather-bar">
            <div className="dv2-weather-dock" style={{ width: `${DOCK_WIDTH}%` }}>
              <span className="dv2-dock-icon">🏰</span>
              <span className="dv2-dock-text">Dock</span>
            </div>
            {raceWeathers.map((w, i) => {
              const isHidden = state.phase === 'betting' && i !== state.revealedIndex;
              const isTouched = highestProgress >= (DOCK_WIDTH + i * ZONE_WIDTH);
              const statusClass = state.phase === 'racing' || state.phase === 'result'
                ? (isTouched ? 'zone-active' : 'zone-untouched')
                : '';

              return (
                <div
                  key={i}
                  className={`dv2-weather-zone ${isHidden ? 'hidden' : ''} ${statusClass}`}
                >
                  <span className="dv2-weather-icon">
                    {isHidden ? '❓' : w.icon}
                  </span>
                  <span className="dv2-weather-name">
                    {isHidden ? 'Hidden' : w.name}
                  </span>
                </div>
              );
            })}
          </div>

          {/* ═══ RACE TRACK ═══ */}
          <div className="dv2-track-area">
            <div className="dv2-track-water" />

            {/* Weather Zone Tints */}
            {raceWeathers.map((w, i) => {
              const isHidden = state.phase === 'betting' && i !== state.revealedIndex;
              const isTouched = highestProgress >= (DOCK_WIDTH + i * ZONE_WIDTH);
              const statusClass = state.phase === 'racing' || state.phase === 'result'
                ? (isTouched ? 'zone-active' : 'zone-untouched')
                : '';

              return (
                <div
                  key={i}
                  className={`dv2-zone-tint ${statusClass}`}
                  style={{
                    left: `${DOCK_WIDTH + i * ZONE_WIDTH}%`,
                    width: `${ZONE_WIDTH}%`,
                    background: isHidden ? 'transparent' : `${w.color}CC` // CC = approx 0.8 opacity solid
                  }}
                />
              );
            })}

            {/* Dashed zone dividers */}
            <div className="dv2-zone-divider" style={{ left: `${DOCK_WIDTH}%` }} />
            <div className="dv2-zone-divider" style={{ left: `${DOCK_WIDTH + ZONE_WIDTH}%` }} />
            <div className="dv2-zone-divider" style={{ left: `${DOCK_WIDTH + 2 * ZONE_WIDTH}%` }} />
            <div className="dv2-zone-divider" style={{ left: `${DOCK_WIDTH + 3 * ZONE_WIDTH}%` }} />
            <div className="dv2-zone-divider" style={{ left: `${DOCK_WIDTH + 4 * ZONE_WIDTH}%` }} />
            <div className="dv2-finish-line" />

            {/* Ship Lanes */}
            <div className="dv2-lanes">
              {raceShips.map((ship, i) => (
                <div key={ship.id} className="dv2-lane">
                  <div className="dv2-lane-label" style={{ color: ship.color }}>{ship.name}</div>
                  <div
                    ref={el => shipRefs.current[i] = el}
                    className={`dv2-ship-wrapper ${state.phase === 'racing' ? 'racing' : ''} ${state.phase === 'result' && state.winnerIdx === i ? 'winner' : ''}`}
                    style={{
                      // Nose-Centric Positioning: Priority to CSS Variable for Direct-DOM performance
                      left: `calc(var(--dv2-ship-pos, ${shipPositions[i]}%) + 1.5% - var(--dv2-ship-width))`,
                    }}
                  >
                    <img
                      src={`${process.env.PUBLIC_URL}/icons/minigames/ships/${ship.id}.png`}
                      alt={ship.name}
                      className="dv2-ship-img"
                    />
                    {state.phase === 'racing' && (
                      <div className={`dv2-ship-speed speed-tag-${SPEED_MATRIX[getShipGlobalIndex(ship.id)][state.weatherIndices[Math.max(0, Math.min(4, Math.floor((shipPositions[i] - DOCK_WIDTH) / ZONE_WIDTH)))]]
                        }`}>
                        {raceWeathers[Math.max(0, Math.min(4, Math.floor((shipPositions[i] - DOCK_WIDTH) / ZONE_WIDTH)))]?.icon} {formatSpeed(SPEED_MATRIX[getShipGlobalIndex(ship.id)][state.weatherIndices[Math.max(0, Math.min(4, Math.floor((shipPositions[i] - DOCK_WIDTH) / ZONE_WIDTH)))]])}
                      </div>
                    )}
                    {state.phase === 'result' && state.winnerIdx === i && (
                      <span className="dv2-winner-badge">👑</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ═══ RESULT OVERLAY ═══ */}
          {state.phase === 'result' && state.winnerIdx !== null && raceShips[state.winnerIdx] && (
            <div className="dv2-result-banner">
              <span className="dv2-result-crown">👑</span>
              <span className="dv2-result-name" style={{ color: raceShips[state.winnerIdx].color }}>
                {raceShips[state.winnerIdx].name} Wins!
              </span>
              {totalPool > 0 && (
                <span className="dv2-result-payout">
                  Payout: {getEstimatedPayout(raceShips[state.winnerIdx].id)}
                </span>
              )}
            </div>
          )}

          {/* ═══ BETTING SECTION ═══ */}
          <div className="dv2-betting-section">
            {/* Chip Selector */}
            <div className="dv2-chip-selector">
              <span className="dv2-chip-label">Bet Amount:</span>
              {CHIP_VALUES.map(chip => (
                <button
                  key={chip}
                  className={`dv2-chip ${selectedChip === chip ? 'active' : ''}`}
                  onClick={() => setSelectedChip(chip)}
                >
                  ×{chip}
                </button>
              ))}
            </div>

            {/* Ship Betting Cards */}
            <div className="dv2-bet-cards">
              {raceShips.map((ship) => {
                const shipGlobalIdx = getShipGlobalIndex(ship.id);
                const revealedIdx = (state.revealedIndex !== undefined && raceWeathers[state.revealedIndex])
                  ? getWeatherGlobalIndex(raceWeathers[state.revealedIndex].id)
                  : -1;
                const revealedWeatherSpeed = revealedIdx >= 0 && shipGlobalIdx >= 0
                  ? SPEED_MATRIX[shipGlobalIdx][revealedIdx]
                  : null;

                return (
                  <div
                    key={ship.id}
                    className={`dv2-bet-card ${state.phase !== 'betting' ? 'disabled' : ''}`}
                    style={{ '--ship-accent': ship.color }}
                    onClick={() => {
                      if (state.phase === 'betting') {
                        handlePlaceBet(ship.id);
                      }
                    }}
                  >
                    <div className="dv2-bet-card-top">
                      <img
                        src={`${process.env.PUBLIC_URL}/icons/minigames/ships/${ship.id}.png`}
                        alt={ship.name}
                        className="dv2-bet-card-ship"
                      />
                      <div className="dv2-bet-card-info">
                        <h4 style={{ color: ship.color }}>{ship.name}</h4>
                        {revealedWeatherSpeed !== null && (
                          <span className="dv2-speed-hint">
                            {isPeeking ? (
                              <>{raceWeathers[state.revealedIndex]?.icon} {formatSpeed(revealedWeatherSpeed)}</>
                            ) : (
                              ''
                            )}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="dv2-bet-card-pools">
                      <div className="dv2-pool-row">
                        <span>Global Pool</span>
                        <span className="dv2-pool-amount">🪙 {(pools[ship.id] || 0) + currentHouseSeed}</span>
                      </div>
                      <div className="dv2-pool-row">
                        <span>Your Bet</span>
                        <span className="dv2-pool-amount dv2-my-bet">🪙 {myBets[ship.id] || 0}</span>
                      </div>
                      <div className="dv2-pool-row">
                        <span>Est. Payout</span>
                        <span className="dv2-pool-amount dv2-payout">{getEstimatedPayout(ship.id)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Totals */}
            <div className="dv2-totals-bar">
              <span>Total Pool: 🪙 {totalPool}</span>
              <span>Your Total: 🪙 {Object.values(myBets).reduce((a, b) => a + b, 0)} / {MAX_BET_PER_USER}</span>
            </div>
          </div>
        </div>

        {/* ── BOTTOM: Race History ── */}
        <div className="dv2-history-panel">
          <h3 className="dv2-history-title">📜 Recent Races</h3>
          <div className="dv2-history-list">
            {history.length === 0 ? (
              <div className="dv2-history-empty">No races yet</div>
            ) : (
              history.map((entry, idx) => (
                <div key={idx} className="dv2-history-item">
                  <div className="dv2-history-winner-row">
                    <img
                      src={`${process.env.PUBLIC_URL}/icons/minigames/ships/${entry.winner?.id}.png`}
                      alt=""
                      className="dv2-history-ship-icon"
                      style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))' }}
                    />
                    <span className="dv2-history-ship-name" style={{ color: entry.winner?.color }}>
                      {entry.winner?.name || '???'}
                    </span>
                  </div>
                  <div className="dv2-history-details">
                    <span>🪙 {entry.totalPool || 0}</span>
                    <span className="dv2-history-multiplier">{entry.payoutMultiplier?.toFixed(1) || '—'}x</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

      </div>

      {/* ═══ RULES MODAL ═══ */}
      {showRules && (
        <div className="dv2-rules-overlay" onClick={() => setShowRules(false)}>
          <div className="dv2-rules-modal" onClick={e => e.stopPropagation()}>
            <div className="dv2-rules-header">
              <h2>📜 Drakkar Race Rules</h2>
              <button className="dv2-rules-close" onClick={() => setShowRules(false)}>✕</button>
            </div>
            <div className="dv2-rules-body">
              <h3>How It Works</h3>
              <p>3 random ships and <strong>5 random weather zones</strong> are selected for each race. Only 1 weather zone is revealed during betting — the other 4 zones remain hidden until the race begins! Each zone affects a ship's speed based on its unique stats.</p>

              <h3>Parimutuel Payout</h3>
              <p>Drakkar Race uses a <strong>Parimutuel Payout</strong> system where total bets are shared among winners. To ensure high payouts even for solo players:</p>
              <ul>
                <li>The House seeds <strong>{currentHouseSeed} Valcoins</strong> on each ship (Total {currentHouseSeed * 3} seed per race).</li>
                <li><strong>Total Pool</strong> = All player bets + {currentHouseSeed * 3} House Seed.</li>
                <li><strong>Multiplier</strong> = (Total Pool ÷ Winning Ship's Total Pool) × {currentMultiplier.toFixed(2)}</li>
                <li>Wins that <strong>double your total investment (2x+)</strong> trigger a Global Win Announcement!</li>
              </ul>

              <div className="dv2-formula" style={{ margin: '15px 0', background: 'rgba(0,0,0,0.4)', padding: '15px', borderRadius: '8px', textAlign: 'center', fontWeight: 'bold' }}>
                Your Winning = (Your Bet ÷ Winning Ship Pool) × Total Pool × {currentMultiplier.toFixed(2)}
              </div>
              <p style={{ marginTop: '10px', fontSize: '0.9em', opacity: 0.8 }}>
                The house takes a {Math.round((1 - currentMultiplier) * 100)}% fee. You swipe the House's seed if you are the only one who correctly predicts the winner!
              </p>

              <h3>Speed Multiplier Table</h3>
              <p>Each ship has strengths and weaknesses across 7 weather types:</p>
              <div className="dv2-rules-table-wrapper">
                <table className="dv2-speed-table">
                  <thead>
                    <tr>
                      <th>Ship</th>
                      {ALL_WEATHERS.map(w => (
                        <th key={w.id}>{w.icon}<br /><small>{w.name}</small></th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ALL_SHIPS.map((ship, sIdx) => (
                      <tr key={ship.id}>
                        <td style={{ color: ship.color, fontWeight: 700 }}>{ship.name}</td>
                        {ALL_WEATHERS.map((_, wIdx) => {
                          const val = SPEED_MATRIX[sIdx][wIdx];
                          const isBest = val === 13;
                          const isWorst = val === 5;
                          return (
                            <td
                              key={wIdx}
                              className={isBest ? 'speed-best' : isWorst ? 'speed-worst' : ''}
                            >
                              {formatSpeed(val)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h3>Betting Rules</h3>
              <ul>
                <li>Max bet per user per race: <strong>{MAX_BET_PER_USER} Valcoins</strong></li>
                <li>You can bet on multiple ships</li>
                <li>Select a chip value (×1, ×5, ×10, ×50, ×100) and click a ship to bet</li>
                <li>Bets are deducted from your balance immediately</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Version Stamp for Diagnostic */}
      <div style={{
        position: 'absolute',
        bottom: '10px',
        right: '20px',
        fontSize: '10px',
        color: 'rgba(255,255,255,0.4)',
        pointerEvents: 'none',
        zIndex: 1000
      }}>
        v2.12.Final [{tickCount}]
      </div>
    </div>
  );
};

export default DrakkarRace;
