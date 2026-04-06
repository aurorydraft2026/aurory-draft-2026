import React, { useState, useEffect, useRef, useCallback } from 'react';
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

const FINISH_LINE = DOCK_WIDTH + 3 * ZONE_WIDTH; // 98%
const HOUSE_SEED = 500;

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

  // Animation
  const animFrameRef = useRef();
  const [shipPositions, setShipPositions] = useState([SHIP_START, SHIP_START, SHIP_START]);
  const [raceFinished, setRaceFinished] = useState(false);
  const prevRaceIdRef = useRef(null);

  const [localRaceStartTime, setLocalRaceStartTime] = useState(null);

  // ─── 0. Local Clock Sync ───
  useEffect(() => {
    if (state?.phase === 'racing' && !localRaceStartTime) {
      setLocalRaceStartTime(Date.now());
    } else if (state?.phase !== 'racing') {
      setLocalRaceStartTime(null);
    }
  }, [state?.phase, localRaceStartTime]);

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

  // ─── 3. Race Animation ───
  const animate = useCallback(() => {
    if (state && state.phase === 'racing' && state.shipIndices && state.weatherIndices && localRaceStartTime && !raceFinished) {
      const now = Date.now();
      const elapsed = now - localRaceStartTime;
      const winnerFinishTime = state.finishTimes ? state.finishTimes[state.winnerIdx] : 999999;

      // 1. If we've passed the winner's finish time, stop EVERYTHING
      if (elapsed >= winnerFinishTime) {
        const finalPositions = state.shipIndices.map((sIdx, i) => {
          if (i === state.winnerIdx) return FINISH_LINE;
          const shipTotalTime = state.finishTimes[i];
          const shipSpeeds = state.weatherIndices.map((wIdx) => SPEED_MATRIX[sIdx][wIdx]);
          return computeShipPosition(shipSpeeds, Math.min(winnerFinishTime, shipTotalTime));
        });
        setShipPositions(finalPositions);
        setRaceFinished(true);
        return;
      }

      // 2. Normal race movement
      const newPositions = state.shipIndices.map((sIdx) => {
        const shipSpeeds = state.weatherIndices.map((wIdx) => SPEED_MATRIX[sIdx][wIdx]);
        return computeShipPosition(shipSpeeds, Math.max(0, elapsed));
      });

      setShipPositions(newPositions);
    } else if (state && state.phase === 'result' && state.finishTimes && !raceFinished) {
      // 3. Fallback: If server jumped to 'result' phase before client finished animation,
      // instantly snap ships to exact mathematical finish positions.
      const winnerFinishTime = state.finishTimes[state.winnerIdx] || 999999;
      const finalPositions = state.shipIndices.map((sIdx, i) => {
        if (i === state.winnerIdx) return FINISH_LINE;
        const shipTotalTime = state.finishTimes[i] || 999999;
        const shipSpeeds = state.weatherIndices.map((wIdx) => SPEED_MATRIX[sIdx][wIdx]);
        return computeShipPosition(shipSpeeds, Math.min(winnerFinishTime, shipTotalTime));
      });
      setShipPositions(finalPositions);
      setRaceFinished(true);
    } else if (state && (state.phase === 'betting' || state.phase === 'reveal')) {
      setShipPositions([SHIP_START, SHIP_START, SHIP_START]);
    }
    // In result phase or raceFinished, keep final positions
    animFrameRef.current = requestAnimationFrame(animate);
  }, [state, raceFinished, localRaceStartTime]);

  useEffect(() => {
    animFrameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [animate]);

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

    // ── OPTIMISTIC UI UPDATE ──
    setMyBets(prev => ({
      ...prev,
      [shipId]: (prev[shipId] || 0) + amount
    }));
    setPendingBetsTotal(prev => prev + amount);

    try {
      const result = await placeDrakkarBet(shipId, amount);
      if (result.success) {
        setDisplayedPoints(result.newBalance);
        // Note: myBets is already updated optimistically!
      } else {
        // ROLLBACK 
        setMyBets(prev => ({ ...prev, [shipId]: Math.max(0, (prev[shipId] || 0) - amount) }));
        setLocalError(result.error);
      }
    } catch (err) {
      // ROLLBACK
      setMyBets(prev => ({ ...prev, [shipId]: Math.max(0, (prev[shipId] || 0) - amount) }));
      setLocalError(err.message);
    } finally {
      setPendingBetsTotal(prev => prev - amount);
    }
  };

  // ─── Derived Data ───
  const raceShips = state?.ships || [];
  const raceWeathers = state?.weathers || [];
  const totalPool = raceShips.reduce((sum, s) => sum + (pools[s.id] || 0), 0) + (HOUSE_SEED * 3);

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
    const shipPool = (pools[shipId] || 0) + HOUSE_SEED;
    if (shipPool === 0 || totalPool === 0) return '—';
    const multiplier = (totalPool / shipPool) * 0.9;
    return multiplier.toFixed(1) + 'x';
  };

  // ─── Loading ───
  if (!state) return <div className="minigames-loading"><div className="minigames-spinner" /></div>;

  return (
    <div className="drakkar-v2-container">
      {/* ═══ STATUS BAR ═══ */}
      <div className="dv2-status-bar">
        <div className="dv2-status-left">
          <span className="dv2-phase-label">{getPhaseLabel()}</span>
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
            <div className="dv2-weather-dock">🏰 Dock</div>
            {raceWeathers.map((w, i) => (
              <div
                key={i}
                className={`dv2-weather-zone ${(state.phase === 'betting' && i > 0) ? 'hidden' : ''}`}
              >
                <span className="dv2-weather-icon">
                  {(state.phase === 'betting' && i > 0) ? '❓' : w.icon}
                </span>
                <span className="dv2-weather-name">
                  {(state.phase === 'betting' && i > 0) ? 'Hidden' : w.name}
                </span>
              </div>
            ))}
            <div className="dv2-weather-finish">🏁</div>
          </div>

          {/* ═══ RACE TRACK ═══ */}
          <div className="dv2-track-area">
            <div className="dv2-track-water" />

            {/* Dashed zone dividers */}
            <div className="dv2-zone-divider" style={{ left: `${DOCK_WIDTH}%` }} />
            <div className="dv2-zone-divider" style={{ left: `${DOCK_WIDTH + ZONE_WIDTH}%` }} />
            <div className="dv2-zone-divider" style={{ left: `${DOCK_WIDTH + 2 * ZONE_WIDTH}%` }} />
            <div className="dv2-finish-line" style={{ left: `${FINISH_LINE}%` }} />

            {/* Ship Lanes */}
            <div className="dv2-lanes">
              {raceShips.map((ship, i) => (
                <div key={ship.id} className="dv2-lane">
                  <div className="dv2-lane-label" style={{ color: ship.color }}>{ship.name}</div>
                  <div
                    className={`dv2-ship-wrapper ${state.phase === 'result' && state.winnerIdx === i ? 'winner' : ''}`}
                    style={{
                      left: `calc(${shipPositions[i]}% - (${shipPositions[i]} / ${FINISH_LINE} * 50px))`,
                      '--ship-glow': ship.color
                    }}
                  >
                    <img
                      src={`${process.env.PUBLIC_URL}/icons/minigames/ships/${ship.id}.png`}
                      alt={ship.name}
                      className="dv2-ship-img"
                      style={{ filter: `drop-shadow(0 0 6px ${ship.color})` }}
                    />
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
                const firstWeatherIdx = raceWeathers.length > 0 ? getWeatherGlobalIndex(raceWeathers[0].id) : -1;
                const firstWeatherSpeed = firstWeatherIdx >= 0 && shipGlobalIdx >= 0
                  ? SPEED_MATRIX[shipGlobalIdx][firstWeatherIdx]
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
                        style={{ filter: `drop-shadow(0 0 6px ${ship.color})` }}
                      />
                      <div className="dv2-bet-card-info">
                        <h4 style={{ color: ship.color }}>{ship.name}</h4>
                        {firstWeatherSpeed !== null && (
                          <span className="dv2-speed-hint">
                            {raceWeathers[0]?.icon} {formatSpeed(firstWeatherSpeed)}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="dv2-bet-card-pools">
                      <div className="dv2-pool-row">
                        <span>Global Pool</span>
                        <span className="dv2-pool-amount">🪙 {(pools[ship.id] || 0) + HOUSE_SEED}</span>
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
                      style={{ filter: `drop-shadow(0 0 4px ${entry.winner?.color || '#fff'})` }}
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
              <p>3 random ships and 3 random weather zones are selected each race. Only Weather #1 is visible during betting — Weathers #2 and #3 are hidden until the race starts!</p>

              <h3>Parimutuel Payout</h3>
              <p>Wins are calculated based on the total pool shared among winners. To ensure high multipliers even when you are playing solo:</p>
              <ul>
                <li>The House seeds each ship with <strong>{HOUSE_SEED} Valcoins</strong> every race.</li>
                <li>Wins with a multiplier of <strong>2.0x or higher</strong> trigger a Global Win Announcement!</li>
              </ul>
              <div className="dv2-formula">
                Payout = (Total Pool ÷ Winning Ship Pool) × 0.90
              </div>
              <p>The house takes 10%. Bet on underdogs to swipe the House's virtual seed for massive potential returns!</p>

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
    </div>
  );
};

export default DrakkarRace;
