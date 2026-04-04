import React, { useState, useEffect, useRef } from 'react';
import { database } from '../../firebase';
import { ref, query, orderByChild, startAt, onChildAdded, off } from 'firebase/database';
import { getRarityColor } from '../../services/miniGameService';
import './GlobalWinNotifier.css';

const GlobalWinNotifier = () => {
  const [activeWinners, setActiveWinners] = useState([]);
  const mountedTime = useRef(Date.now());

  useEffect(() => {
    // Listen for new high-rarity winners added after the component mounted
    const recentRef = query(
      ref(database, 'recentMiniGameWinners'),
      orderByChild('timestamp'),
      startAt(mountedTime.current)
    );

    const handleNewWinner = (snapshot) => {
      if (snapshot.exists()) {
        const winner = snapshot.val();
        const winnerId = snapshot.key;
        
        // Only notify for Epic and Legendary
        if (winner.rarity === 'epic' || winner.rarity === 'legendary') {
          // Delay by 3 seconds so the winner sees their own reveal first
          setTimeout(() => {
            const newWinnerEntry = {
              ...winner,
              id: winnerId,
              addedAt: Date.now()
            };
            
            setActiveWinners(prev => {
              // Avoid duplicates (safety check)
              if (prev.some(w => w.id === winnerId)) return prev;
              return [...prev, newWinnerEntry];
            });

            // Automatically remove winner from the ticker after it finishes its scroll (approx 20s)
            setTimeout(() => {
              setActiveWinners(prev => prev.filter(w => w.id !== winnerId));
            }, 25000);
          }, 3000);
        }
      }
    };

    onChildAdded(recentRef, handleNewWinner);

    return () => {
      off(recentRef, 'child_added', handleNewWinner);
    };
  }, []);

  const handleOpenArcade = () => {
    window.dispatchEvent(new CustomEvent('openMiniGames'));
  };

  if (activeWinners.length === 0) return null;

  return (
    <div className="global-win-ticker">
      <div className="ticker-track">
        {activeWinners.map(winner => (
          <div key={winner.id} className={`ticker-item ${winner.rarity}`}>
            <span className="ticker-badge" style={{ backgroundColor: getRarityColor(winner.rarity) }}>
              {winner.rarity.toUpperCase()}
            </span>
            <img src={winner.playerAvatar} alt="" className="ticker-avatar" />
            <span className="ticker-player">{winner.playerName}</span>
            <span className="ticker-text">just won</span>
            <span className="ticker-prize">{winner.icon} {winner.prizeName}</span>
            <button className="ticker-link" onClick={handleOpenArcade}>
              &bull; <span>Try your luck &rarr;</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default GlobalWinNotifier;
