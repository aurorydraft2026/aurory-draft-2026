import React from 'react';
import ReactDOM from 'react-dom';
import './RaffleWinnerModal.css';

const RaffleWinnerModal = ({ winner, itemType, itemImage, auryAmount, onClose }) => {
  if (!winner) return null;

  const isAury = itemType === 'aury';

  return ReactDOM.createPortal(
    <div className="rwm-overlay" onClick={onClose}>
      <div className="rwm-card" onClick={e => e.stopPropagation()}>
        {/* Close Button */}
        <button className="rwm-close" onClick={onClose} title="Close">✕</button>

        {/* Trophy */}
        <div className="rwm-trophy">🏆</div>

        {/* Title */}
        <h1 className="rwm-title">Congratulations!</h1>

        {/* Winner Info */}
        <div className="rwm-avatar">
          {winner.playerName?.charAt(0).toUpperCase() || 'W'}
        </div>
        <div className="rwm-winner-name">{winner.playerName}</div>
        {winner.auroryPlayerId && (
          <div className="rwm-winner-id">{winner.auroryPlayerId}</div>
        )}

        {/* Prize */}
        <div className="rwm-prize-box">
          <span className="rwm-prize-label">You won</span>
          {isAury ? (
            <div className="rwm-prize-aury">
              <img src="/aurory-logo.png" alt="AURY" className="rwm-aury-icon" />
              <span className="rwm-aury-amount">{auryAmount}</span>
              <span className="rwm-aury-unit">AURY</span>
            </div>
          ) : (
            <div className="rwm-prize-item">
              {itemImage && (
                <img src={itemImage} alt={itemType} className="rwm-prize-image" />
              )}
              <div className="rwm-prize-name">🎁 {itemType || 'Raffle Item'}</div>
            </div>
          )}
        </div>

        <button className="rwm-claim-btn" onClick={onClose}>
          🎉 Awesome!
        </button>
      </div>
    </div>,
    document.body
  );
};

export default RaffleWinnerModal;
