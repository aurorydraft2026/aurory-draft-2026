import React, { useState, useEffect } from 'react';
import { getMiniGameConfig } from '../../services/miniGameService';
import SlotMachine from './SlotMachine';
import TreasureChest from './TreasureChest';
import { useWallet } from '../../hooks/useWallet';
import './MiniGamesHub.css';

const GAME_REGISTRY = {
  slotMachine: {
    id: 'slotMachine',
    name: 'Slot Machine',
    icon: '🎰',
    description: 'Spin the reels and match symbols to win!',
    component: SlotMachine
  },
  treasureChest: {
    id: 'treasureChest',
    name: 'Treasure Chest',
    icon: '🎁',
    description: 'Unlock a treasure chest to reveal your prize!',
    component: TreasureChest
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
      <div className="minigames-overlay" onClick={onClose}>
        <div className="minigames-modal minigames-game-view" onClick={e => e.stopPropagation()}>
          <div className="minigames-modal-header">
            <button className="minigames-back-btn" onClick={handleBackToHub}>
              ← Games
            </button>
            <h2>{gameInfo.icon} {gameInfo.name}</h2>
            <div className="minigames-balances-group">
              <div className="minigames-balance" title="Valcoins">
                <img src={process.env.PUBLIC_URL + '/valcoin-icon.jpg'} alt="Valcoins" className="valcoin-icon-sm" />
                <span>{displayedPoints ?? 0}</span>
              </div>
              <div className="minigames-balance aury-pill" title="AURY Balance">
                <img src={process.env.PUBLIC_URL + '/aury-icon.png'} alt="AURY" className="valcoin-icon-sm" />
                <span>{formatAuryAmount ? formatAuryAmount(displayedAury) : (displayedAury / 1e9).toFixed(2)}</span>
              </div>
              <div className="minigames-balance usdc-pill" title="USDC Balance">
                <img src="https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/usdc.png" alt="USDC" className="valcoin-icon-sm" />
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
    );
  }

  // Hub view — game selector
  return (
    <div className="minigames-overlay" onClick={onClose}>
      <div className="minigames-modal" onClick={e => e.stopPropagation()}>
        <div className="minigames-modal-header">
          <h2>🎮 Mini-Games</h2>
          <div className="minigames-balances-group">
            <div className="minigames-balance" title="Valcoins">
              <img src={process.env.PUBLIC_URL + '/valcoin-icon.jpg'} alt="Valcoins" className="valcoin-icon-sm" />
              <span>{displayedPoints ?? 0}</span>
            </div>
            <div className="minigames-balance aury-pill" title="AURY Balance">
              <img src={process.env.PUBLIC_URL + '/aury-icon.png'} alt="AURY" className="valcoin-icon-sm" />
              <span>{formatAuryAmount ? formatAuryAmount(displayedAury) : (displayedAury / 1e9).toFixed(2)}</span>
            </div>
            <div className="minigames-balance usdc-pill" title="USDC Balance">
              <img src="https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/usdc.png" alt="USDC" className="valcoin-icon-sm" />
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
              <span className="empty-icon">🎮</span>
              <p>No games available right now. Check back later!</p>
            </div>
          ) : (
            <div className="minigames-grid">
              {availableGames.map(gameKey => {
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
                      <img src={process.env.PUBLIC_URL + '/valcoin-icon.jpg'} alt="V" className="valcoin-icon-xs" />
                      <span>{gameCfg.costPerPlay} per play</span>
                    </div>
                    <div className="minigame-card-prizes">
                      {gameCfg.prizes?.length || 0} prizes available
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MiniGamesHub;
