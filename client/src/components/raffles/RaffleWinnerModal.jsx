import ReactDOM from 'react-dom';
import AvatarWithAura from '../AvatarWithAura';
import './RaffleWinnerModal.css';

const RaffleWinnerModal = ({ winner, itemType, itemImage, auryAmount, onClose }) => {
  if (!winner) return null;

  const isAury = itemType === 'aury';

  return ReactDOM.createPortal(
    <div className="rwm-overlay" onClick={onClose}>
      <div className="rwm-card" onClick={e => e.stopPropagation()}>
        {/* Close Button */}
        <button className="rwm-close" onClick={onClose} title="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>

        {/* Trophy */}
        <div className="rwm-trophy">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>
        </div>

        {/* Title */}
        <h1 className="rwm-title">Congratulations!</h1>

        {/* Winner Info */}
        <div className="rwm-avatar">
          <AvatarWithAura user={winner} size={80} />
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
              <div className="rwm-prize-name">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: '8px'}}><path d="M20 12v10H4V12"/><path d="M2 7h20v5H2z"/><path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>
                {itemType || 'Raffle Item'}
              </div>
            </div>
          )}
        </div>

        <button className="rwm-claim-btn" onClick={onClose}>
          Awesome!
        </button>
      </div>
    </div>,
    document.body
  );
};

export default RaffleWinnerModal;
