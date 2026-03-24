import React from 'react';
import ReactDOM from 'react-dom';
import './RaffleWinnerModal.css';

const RaffleWinnerModal = ({ winner, itemType, itemImage, auryAmount, onClose }) => {
  if (!winner) return null;

  const isAury = itemType === 'aury';

  return ReactDOM.createPortal(
    <div className="raffle-winner-modal-overlay" onClick={onClose}>
      <div className="raffle-winner-modal-content" onClick={e => e.stopPropagation()}>
        <div className="raffle-winner-shine"></div>
        
        <div className="raffle-winner-body">
            <div className="raffle-celebration-container">
                <div className="raffle-trophy-wrapper">
                    <span className="raffle-trophy-main">🏆</span>
                    <span className="raffle-sparkle s1">✨</span>
                    <span className="raffle-sparkle s2">✨</span>
                    <span className="raffle-sparkle s3">✨</span>
                </div>
            </div>
            
            <h1 className="raffle-winner-title">Congratulations!</h1>
            
            <div className="raffle-winner-profile">
                <div className="winner-avatar">
                   {winner.playerName?.charAt(0).toUpperCase() || 'W'}
                </div>
                <div className="raffle-winner-name">{winner.playerName}</div>
                <div className="raffle-winner-id">{winner.auroryPlayerId}</div>
            </div>

            <div className="raffle-win-box">
                <p>You have won the</p>
                {isAury ? (
                    <div className="raffle-prize-aury">
                        <span className="prize-aury-amount">{auryAmount}</span>
                        <span className="prize-aury-unit">AURY</span>
                    </div>
                ) : (
                    <>
                        {itemImage && (
                            <div className="raffle-prize-image-container">
                                <img src={itemImage} alt={itemType} className="raffle-prize-image" />
                            </div>
                        )}
                        <div className="raffle-prize-name">🎁 {itemType || 'Raffle Item'}</div>
                    </>
                )}
            </div>

            <p className="raffle-winner-note">
                The prize has been allocated to your account. Our team will contact you for any further steps.
            </p>

            <button className="raffle-winner-claim-btn" onClick={onClose}>
                Awesome!
            </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default RaffleWinnerModal;
