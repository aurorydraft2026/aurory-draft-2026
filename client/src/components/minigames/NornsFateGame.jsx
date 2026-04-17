import React, { useState, useEffect, useRef } from 'react';
import { 
    subscribeNornsFateState, 
    subscribeNornsFatePools, 
    subscribeNornsFateBettors,
    refreshNornsFate,
    placeNornsFateBet
} from '../../services/miniGameService';
import { ref, onValue } from 'firebase/database';
import { database as importedDb } from '../../firebase';
import './NornsFateStyles.css';

const NornsFate = ({ user, userPoints, setDisplayedPoints, onClose }) => {
    const [gameState, setGameState] = useState(null);
    const [pools, setPools] = useState({ odin: 0, thor: 0, loki: 0 });
    const [bettors, setBettors] = useState({ odin: {}, thor: {}, loki: {} });
    const [myBets, setMyBets] = useState({ odin: 0, thor: 0, loki: 0 });
    const [betAmount, setBetAmount] = useState(10);
    const [placingBet, setPlacingBet] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const [timeLeft, setTimeLeft] = useState(0);
    const [serverOffset, setServerOffset] = useState(0);
    const prevPhaseRef = useRef(null);
    const db = importedDb;

    // ─── 0. Server Time Offset ───
    useEffect(() => {
        const offsetRef = ref(db, ".info/serverTimeOffset");
        const unsub = onValue(offsetRef, (snap) => {
            setServerOffset(snap.val() || 0);
        });
        return () => unsub();
    }, [db]);

    // ─── 1. Subscriptions ───
    useEffect(() => {
        const unsubState = subscribeNornsFateState((data) => {
            if (data) {
                setGameState(data);
                if (data.phase === 'betting' && prevPhaseRef.current !== 'betting') {
                    setMyBets({ odin: 0, thor: 0, loki: 0 });
                }
                prevPhaseRef.current = data.phase;
            }
        });
        const unsubPools = subscribeNornsFatePools(setPools);
        const unsubBettors = subscribeNornsFateBettors((data) => {
            setBettors(data || { odin: {}, thor: {}, loki: {} });
        });

        return () => {
            unsubState();
            unsubPools();
            unsubBettors();
        };
    }, []);

    // ─── 2. Heartbeat ───
    useEffect(() => {
        const interval = setInterval(async () => {
            if (!gameState) {
                // SHADOW INITIALIZATION: If RTDB is empty/desynced, fetch master state directly
                console.log("Norns Heartbeat: gameState is null. Attempting shadow initialization...");
                const result = await refreshNornsFate(true); // true = force sync to RTDB
                if (result?.success && result.state) {
                    console.log("Norns Heartbeat: Shadow state received:", result.state);
                    setGameState(result.state);
                }
                return;
            }

            const now = Date.now() + serverOffset;
            const diff = gameState.endTime - now;
            setTimeLeft(Math.max(0, diff));

            if (diff <= 0) {
                console.log("Norns Heartbeat: Phase expired. Refreshing...");
                refreshNornsFate();
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [gameState, serverOffset]);

    const handleForceReset = async () => {
        if (!window.confirm("Admin: Force reset game state?")) return;
        console.log("Admin: Forcing round reset...");
        const result = await refreshNornsFate(true);
        if (result?.success) {
            setGameState(result.state);
            alert("Game reset successfully!");
        } else {
            alert("Reset failed: " + (result?.error || "Unknown error"));
        }
    };

    const handleBet = async (handId) => {
        if (!user) { setErrorMsg("Please login to bet."); return; }
        if (betAmount <= 0) { setErrorMsg("Invalid bet amount."); return; }
        if (userPoints < betAmount) { setErrorMsg("Not enough Valcoins."); return; }
        if (gameState?.phase !== 'betting') { setErrorMsg("Betting is closed!"); return; }

        setPlacingBet(true);
        setErrorMsg('');
        
        try {
            const result = await placeNornsFateBet(handId, Number(betAmount));
            if (result.success) {
                setDisplayedPoints(result.newBalance);
                setMyBets(prev => ({ ...prev, [handId]: prev[handId] + Number(betAmount) }));
            } else {
                setErrorMsg(result.error || "Failed to place bet");
            }
        } catch (err) {
            setErrorMsg(err.message || 'Error placing bet.');
        } finally {
            setPlacingBet(false);
        }
    };

    const getSuitSymbol = (suitName) => {
        switch (suitName) {
            case 'Hearts': return '♥';
            case 'Diamonds': return '♦';
            case 'Clubs': return '♣';
            case 'Spades': return '♠';
            default: return '';
        }
    };

    const renderCard = (cardData, isRevealed, index) => {
        const suitSymbol = getSuitSymbol(cardData?.suit);
        const colorClass = (cardData?.suit === 'Hearts' || cardData?.suit === 'Diamonds') ? 'red' : 'black';

        return (
            <div className="nf-card-container" data-index={index}>
                <div className={`nf-card ${isRevealed ? 'flipped' : ''}`}>
                    {/* Back of Card */}
                    <div className="nf-face nf-back" style={{ backgroundImage: `url('${process.env.PUBLIC_URL}/Card Back.png')` }}></div>
                    
                    {/* Front of Card */}
                    <div className="nf-face nf-front">
                        {cardData && (
                            <>
                                <div className={`nf-suit ${colorClass}`}>{suitSymbol}</div>
                                <div className={`nf-suit-center ${colorClass}`}>{suitSymbol}</div>
                                <div className={`nf-suit ${colorClass}`} style={{transform: 'rotate(180deg)'}}>{suitSymbol}</div>
                                <div style={{position: 'absolute', top: '5px', left: '8px'}} className={`nf-rank ${colorClass}`}>{cardData.rank}</div>
                                <div style={{position: 'absolute', bottom: '5px', right: '8px', transform: 'rotate(180deg)'}} className={`nf-rank ${colorClass}`}>{cardData.rank}</div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    const renderHand = (handId) => {
        const handData = gameState?.hands?.[handId];
        if (!handData) return null;

        const isRevealOrResult = gameState?.phase === 'reveal' || gameState?.phase === 'result';
        
        const isWinner = gameState?.winnerHand === handId && gameState?.phase === 'result';
        const isLoser = gameState?.winnerHand && gameState?.winnerHand !== handId && gameState?.phase === 'result';

        const totalPool = (pools[handId] || 0);
        let allPools = 0;
        ['odin', 'thor', 'loki'].forEach(k => allPools += (pools[k] || 0));
        const multiplier = totalPool > 0 ? (allPools / totalPool * (gameState?.multiplierFactor || 0.9)).toFixed(2) : "0.00";

        const botBubbles = (gameState?.botActions || [])
            .filter(b => b.shipId === handId)
            .map((b, i) => (
                <div key={`bot-${i}`} className="nf-bubble" style={{background: b.color}} title={`Guest Bet`}>
                    {b.initial}
                </div>
            ));

        const playerBubbles = Object.entries(bettors[handId] || {}).map(([uid, pData]) => (
            pData.avatar ? (
                <div key={uid} className="nf-bubble" title={pData.name}>
                    <img src={pData.avatar} alt="P" className="nf-bubble-img" />
                </div>
            ) : (
                <div key={uid} className="nf-bubble" style={{background: '#374151'}} title={pData.name}>
                    {(pData.name || 'U')[0]}
                </div>
            )
        ));

        const bubbles = [...playerBubbles, ...botBubbles].slice(0, 15);

        return (
            <div className={`nf-table ${handId} ${isWinner ? 'winner' : ''} ${isLoser ? 'loser' : ''}`}>
                <div className="nf-table-title">{handId}</div>
                
                <div className="nf-cards">
                    {renderCard(handData[0], true, 0)} {/* Always revealed */}
                    {renderCard(handData[1], isRevealOrResult, 1)}
                    {renderCard(handData[2], isRevealOrResult, 2)}
                </div>

                <div className="nf-pool-info">
                    <div className="nf-pool-total">{totalPool} VC</div>
                    <div className="nf-payout-est">Pays {multiplier}x</div>
                </div>

                <div className="nf-bettors">
                    {bubbles}
                </div>
            </div>
        );
    };

    if (!gameState) {
        return (
            <div className="norns-fate-container" style={{justifyContent: 'center', alignItems: 'center'}}>
                <h2>The Norns are shuffling the deck...</h2>
            </div>
        );
    }

    return (
        <div className="norns-fate-container">
            <div className="nf-header">
                <div className="nf-timer-pill">
                    {Math.ceil(timeLeft / 1000)}s
                </div>
                {(user?.role === 'admin' || user?.role === 'superadmin') && (
                    <button 
                        onClick={handleForceReset}
                        style={{position: 'absolute', right: '10px', top: '10px', opacity: 0.5, fontSize: '0.7rem', padding: '2px 5px'}}
                    >
                        Force Sync
                    </button>
                )}
                {gameState.phase === 'betting' && <p>Betting Phase: Look at the open cards and place your bets!</p>}
                {gameState.phase === 'reveal' && <p style={{color: '#fff'}}>The Norns reveal the hidden strings of fate!</p>}
                {gameState.phase === 'result' && <p style={{color: '#10b981'}}>Winner: {gameState.winnerHand?.toUpperCase()}!</p>}
            </div>

            <div className="nf-tables-container">
                {renderHand('odin')}
                {renderHand('thor')}
                {renderHand('loki')}
            </div>

            <div className="nf-betting-panel">
                {errorMsg && <div style={{color: '#ef4444', fontSize: '0.9rem', marginBottom: '8px'}}>{errorMsg}</div>}
                
                <div className="nf-my-bets">
                    My Bets: 
                    {myBets.odin > 0 && <span>Odin: {myBets.odin}</span>}
                    {myBets.thor > 0 && <span>Thor: {myBets.thor}</span>}
                    {myBets.loki > 0 && <span>Loki: {myBets.loki}</span>}
                    {myBets.odin === 0 && myBets.thor === 0 && myBets.loki === 0 && <span style={{fontWeight: 'normal'}}> None</span>}
                </div>

                <div className="nf-bet-inputs">
                    <input 
                        type="number" 
                        value={betAmount} 
                        onChange={(e) => setBetAmount(e.target.value)}
                        className="nf-bet-amount"
                        disabled={gameState.phase !== 'betting'}
                        min="10"
                    />
                    
                    <button 
                        className="nf-bet-btn odin" 
                        onClick={() => handleBet('odin')}
                        disabled={gameState.phase !== 'betting' || placingBet}
                    >
                        Bet Odin
                        <span>(A)</span>
                    </button>
                    
                    <button 
                        className="nf-bet-btn thor" 
                        onClick={() => handleBet('thor')}
                        disabled={gameState.phase !== 'betting' || placingBet}
                    >
                        Bet Thor
                        <span>(B)</span>
                    </button>
                    
                    <button 
                        className="nf-bet-btn loki" 
                        onClick={() => handleBet('loki')}
                        disabled={gameState.phase !== 'betting' || placingBet}
                    >
                        Bet Loki
                        <span>(C)</span>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default NornsFate;
