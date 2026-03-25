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
        {itemType === 'aury' ? (
          <div className="raffle-card-aury-prize">
            <img src="/aury-icon.png" alt="AURY" className="raffle-card-aury-icon" />
            <span className="raffle-card-aury-amount">{raffle.auryAmount}</span>
            <span className="raffle-card-aury-label">AURY</span>
          </div>
        ) : (
          <img src={itemImage || '/images/default-item.png'} alt={itemType} className="raffle-card-image" />
        )}
        {isCompleted && <div className="raffle-winner-badge">Winner: {winner?.playerName}</div>}
      </div>
      
      <div className="raffle-card-content">
        <div className="raffle-card-type">{itemType}</div>
        <div className="raffle-card-description">{description}</div>
        
        <div className="raffle-card-info">
          <div className="raffle-card-fee">
            <span className="fee-label">Entry Fee</span>
            <span className="fee-value">{isFree ? 'FREE' : `${entryFee} AURY`}</span>
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
            {isCompleted ? 'Raffle Ended' : 'Spinning...'}
          </button>
        )}
      </div>
    </div>
  );
};

export default RaffleCard;
