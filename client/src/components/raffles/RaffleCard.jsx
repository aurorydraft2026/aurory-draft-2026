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
            <img 
              src={process.env.PUBLIC_URL + (itemType === 'aury' ? '/aury-icon.png' : '/usdc-icon.png')} 
              alt={itemType.toUpperCase()} 
              className="raffle-card-currency-icon" 
            />
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
