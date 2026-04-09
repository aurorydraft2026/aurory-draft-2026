import React, { useState, useEffect } from 'react';
import { getMiniGameConfig } from '../../services/miniGameService';
import SlotMachine from './SlotMachine';
import TreasureChest from './TreasureChest';
import DrakkarRace from './DrakkarRace';
import { useWallet } from '../../hooks/useWallet';
import './MiniGamesHub.css';

const GAME_REGISTRY = {
  slotMachine: {
    id: 'slotMachine',
    name: "Odin's Fortune",
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 2h14"/><path d="M5 22h14"/><path d="M5 2v20"/><path d="M19 2v20"/><path d="M10 2v12"/><path d="M14 2v12"/><path d="M5 14h14"/></svg>,
    description: 'Spin the reels and match symbols to win!',
    component: SlotMachine
  },
  treasureChest: {
    id: 'treasureChest',
    name: 'Loot Box',
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 12V8H4v4"/><path d="M2 12h20"/><path d="M20 12v8H4v-8"/><line x1="12" y1="12" x2="12" y2="20"/><path d="m12 8 3-3-3-3-3 3 3 3Z"/></svg>,
    description: 'Unlock a mythic chest to reveal your prize!',
    component: TreasureChest
  },
  drakkarRace: {
    id: 'drakkarRace',
    name: 'Drakkar Race',
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 21h8"/><path d="M12 21V7"/><path d="M12 3c-1.5 0-3 1.5-3 4s1.5 4 3 4 3-1.5 3-4-1.5-4-3-4Z"/><path d="M21 7c0-2-2-3-2-3"/><path d="M3 7c0-2 2-3 2-3"/></svg>,
    description: 'Bet on mythical ships in a real-time global race!',
    component: DrakkarRace
  }
};

const MiniGamesHub = ({ user, userPoints, onClose }) => {
  const [config, setConfig] = useState(null);
  const [selectedGame, setSelectedGame] = useState(null);
  const [loading, setLoading] = useState(true);
  
  // Real Firestore balances from wallet hook
  const { walletBalance, usdcBalance, formatAuryAmount, formatUsdcAmount } = useWallet(user);
  
  // UI "Suspense" balances
  const [displayedPoints, setDisplayedPoints] = useState(userPoints);
  const [displayedAury, setDisplayedAury] = useState(walletBalance);
  const [displayedUsdc, setDisplayedUsdc] = useState(usdcBalance);
  const [isFrozen, setIsFrozen] = useState(false);

  // Sync all displayed balances with real Firestore balances when NOT in a game
  useEffect(() => {
    if (!isFrozen) {
      setDisplayedPoints(userPoints);
      setDisplayedAury(walletBalance);
      setDisplayedUsdc(usdcBalance);
    }
  }, [userPoints, walletBalance, usdcBalance, isFrozen]);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setLoading(true);
    const cfg = await getMiniGameConfig();
    setConfig(cfg);
    setLoading(false);
  };

  // Prevent background scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const handleBackToHub = () => {
    setSelectedGame(null);
  };

  const availableGames = config
    ? Object.keys(GAME_REGISTRY).filter(key => config[key]?.enabled)
    : [];

  // If a game is selected, render it full-screen in the modal
  if (selectedGame) {
    const gameInfo = GAME_REGISTRY[selectedGame];
    const GameComponent = gameInfo.component;
    const gameConfig = config[selectedGame];

    return (
      <>
        <div className="minigames-backdrop" onClick={onClose} />
        <div className="minigames-overlay">
          <div className="minigames-modal minigames-game-view" onClick={e => e.stopPropagation()}>
            <div className="minigames-modal-header">
              <button className="minigames-back-btn" onClick={handleBackToHub}>
                ← <span className="back-btn-text">Games</span>
              </button>
              <h2>{gameInfo.icon} {gameInfo.name}</h2>
              <div className="minigames-balances-group">
                <div className="minigames-balance" title="Valcoins">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>
                  <span>{displayedPoints ?? 0}</span>
                </div>
                <div className="minigames-balance aury-pill" title="AURY Balance">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6a6 6 0 0 1 0 12"/><path d="M12 6v12"/><path d="M12 9h4"/><path d="M12 15h4"/></svg>
                  <span>{formatAuryAmount ? formatAuryAmount(displayedAury) : (displayedAury / 1e9).toFixed(2)}</span>
                </div>
                <div className="minigames-balance usdc-pill" title="USDC Balance">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><path d="M16 8h-1.5c-1.38 0-2.5 1.12-2.5 2.5s1.12 2.5 2.5 2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5H12"/></svg>
                  <span>{formatUsdcAmount ? formatUsdcAmount(displayedUsdc) : (displayedUsdc / 1e6).toFixed(2)}</span>
                </div>
              </div>
              <button className="minigames-close-btn" onClick={onClose}>✕</button>
            </div>

            <div className="minigames-game-content">
              <GameComponent
                user={user}
                userPoints={userPoints}
                gameConfig={gameConfig}
                onConfigReload={loadConfig}
                setFrozen={setIsFrozen}
                setDisplayedPoints={setDisplayedPoints}
              />
            </div>
          </div>
        </div>
      </>
    );
  }

  const renderGameCard = (gameKey) => {
    const game = GAME_REGISTRY[gameKey];
    const gameCfg = config[gameKey];
    return (
      <div
        key={gameKey}
        className="minigame-card"
        onClick={() => setSelectedGame(gameKey)}
      >
        <div className="minigame-card-icon">{game.icon}</div>
        <h3>{game.name}</h3>
        <p>{game.description}</p>
        <div className="minigame-card-cost">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>
          <span>{gameKey === 'drakkarRace' ? 'Bet to play' : `${gameCfg.costPerPlay} per play`}</span>
        </div>
        <div className="minigame-card-prizes">
          {gameKey === 'drakkarRace' ? 'Parimutuel payouts' : `${gameCfg.prizes?.length || 0} prizes available`}
        </div>
      </div>
    );
  };

  // Hub view — game selector
  return (
    <>
      <div className="minigames-backdrop" onClick={onClose} />
      <div className="minigames-overlay">
        <div className="minigames-modal" onClick={e => e.stopPropagation()}>
          <div className="minigames-modal-header">
            <h2><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: '8px'}}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 22V12"/><path d="M12 12l8-4"/><path d="M12 12L4 8"/></svg> Trials</h2>
            <div className="minigames-balances-group">
              <div className="minigames-balance" title="Valcoins">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>
                <span>{displayedPoints ?? 0}</span>
              </div>
              <div className="minigames-balance aury-pill" title="AURY Balance">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6a6 6 0 0 1 0 12"/><path d="M12 6v12"/><path d="M12 9h4"/><path d="M12 15h4"/></svg>
                <span>{formatAuryAmount ? formatAuryAmount(displayedAury) : (displayedAury / 1e9).toFixed(2)}</span>
              </div>
              <div className="minigames-balance usdc-pill" title="USDC Balance">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><path d="M16 8h-1.5c-1.38 0-2.5 1.12-2.5 2.5s1.12 2.5 2.5 2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5H12"/></svg>
                <span>{formatUsdcAmount ? formatUsdcAmount(displayedUsdc) : (displayedUsdc / 1e6).toFixed(2)}</span>
              </div>
            </div>
            <button className="minigames-close-btn" onClick={onClose}>✕</button>
          </div>

          <div className="minigames-hub-body">
            {loading ? (
              <div className="minigames-loading">
                <div className="minigames-spinner" />
                <p>Loading games...</p>
              </div>
            ) : availableGames.length === 0 ? (
              <div className="minigames-empty">
                <span className="empty-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 22V12"/><path d="M12 12l8-4"/><path d="M12 12L4 8"/></svg></span>
                <p>The Sacred Trials are closed. Check back later!</p>
              </div>
            ) : (
              <div className="minigames-hub-sections">
                {/* SOLO PLAY */}
                {availableGames.filter(k => k === 'slotMachine' || k === 'treasureChest').length > 0 && (
                  <div className="minigames-section">
                    <h3 className="minigames-section-title">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: '8px'}}><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                      Solo Play
                    </h3>
                    <div className="minigames-grid">
                      {availableGames
                        .filter(k => k === 'slotMachine' || k === 'treasureChest')
                        .map(gameKey => renderGameCard(gameKey))}
                    </div>
                  </div>
                )}

                {/* SOCIAL PLAY */}
                {availableGames.filter(k => k === 'drakkarRace').length > 0 && (
                  <div className="minigames-section">
                    <h3 className="minigames-section-title">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: '8px'}}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                      Social Play
                    </h3>
                    <div className="minigames-grid">
                      {availableGames
                        .filter(k => k === 'drakkarRace')
                        .map(gameKey => renderGameCard(gameKey))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default MiniGamesHub;
