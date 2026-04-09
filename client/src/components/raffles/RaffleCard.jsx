import React from 'react';
import { useNavigate } from 'react-router-dom';
import './RaffleCard.css';

const RaffleCard = ({ raffle }) => {
  const navigate = useNavigate();
  
  const {
    id,
    itemType,
    itemImage,
    description,
    entryFee,
    isFree,
    participantsCount,
    maxParticipants,
    status,
    winner
  } = raffle;

  const handleJoinClick = (e) => {
    e.stopPropagation();
    navigate(`/raffle/${id}`);
  };

  const isFull = participantsCount >= maxParticipants;
  const isCompleted = status === 'completed';

  return (
    <div className="raffle-card" onClick={() => navigate(`/raffle/${id}`)}>
      <div className="raffle-card-image-container">
        {itemType === 'aury' || itemType === 'usdc' ? (
          <div className={`raffle-card-currency-prize ${itemType}`}>
            <div className="raffle-card-currency-icon-wrapper">
              {itemType === 'aury' ? (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6a6 6 0 0 1 0 12"/><path d="M12 6v12"/><path d="M12 9h4"/><path x="0" y="0" d="M12 15h4"/></svg>
              ) : (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><path d="M16 8h-1.5c-1.38 0-2.5 1.12-2.5 2.5s1.12 2.5 2.5 2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5H12"/></svg>
              )}
            </div>
            <span className="raffle-card-currency-amount">
              {itemType === 'aury' ? raffle.auryAmount : raffle.usdcAmount}
            </span>
            <span className="raffle-card-currency-label">{itemType.toUpperCase()}</span>
          </div>
        ) : (
          <img src={itemImage || '/images/default-item.png'} alt={itemType} className="raffle-card-image" />
        )}
        {isCompleted && <div className="raffle-winner-badge">Winner: {winner?.playerName}</div>}
      </div>
      
      <div className="raffle-card-content">
        <div className="raffle-card-type">{itemType?.toUpperCase()}</div>
        <div className="raffle-card-description">{description}</div>
        
        <div className="raffle-card-info">
          <div className="raffle-card-fee">
            <span className="fee-label">Entry Fee</span>
            <span className="fee-value">
              {isFree ? 'FREE' : `${entryFee} ${raffle.entryFeeCurrency || 'AURY'}`}
            </span>
          </div>
          
          <div className="raffle-card-participants">
            {participantsCount} / {maxParticipants}
          </div>
        </div>
      </div>
      
      <div className="raffle-card-footer">
        {status === 'active' ? (
          <button 
            className={`raffle-join-button ${isFull ? 'disabled' : ''}`}
            onClick={handleJoinClick}
            disabled={isFull}
          >
            {isFull ? 'Raffle Full' : 'Join Raffle'}
          </button>
        ) : (
          <button className="raffle-join-button completed">
            {status === 'completed' ? 'Raffle Ended' : 
             status === 'entries_closed' ? 'Entries Closed' : 
             'Spinning...'}
          </button>
        )}
      </div>
    </div>
  );
};

export default RaffleCard;
