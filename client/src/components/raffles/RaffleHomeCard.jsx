import React from 'react';
import { useNavigate } from 'react-router-dom';
import '../MatchupCard.css'; // Reuse existing matchup card styles

const RaffleHomeCard = ({ raffle }) => {
    const navigate = useNavigate();

    const handleView = () => {
        navigate(`/raffle/${raffle.id}`);
    };

    return (
        <div className={`matchup-card raffle-card-style ${raffle.status}`} onClick={handleView}>
            <div className="card-content">
                <div className="tournament-header">
                    <h4 className="matchup-title">{raffle.itemType} Raffle</h4>
                    <div className="card-badges">
                        <span className="mode-badge mode-mode3">
                            RAFFLE
                        </span>
                        <span className={`status-badge ${raffle.status}`}>
                            {raffle.status === 'active' ? 'Open' : raffle.status === 'spinning' ? 'Spinning' : raffle.status === 'completed' ? 'Ended' : raffle.status}
                        </span>
                    </div>
                </div>

                <p className="matchup-description">{raffle.description}</p>

                <div className="matchup-details">
                    <div className="detail-item">
                        <span className="detail-icon">🎁</span>
                        <span className="detail-text">Item: {raffle.itemType}</span>
                    </div>
                    <div className="detail-item prize-pool-details">
                        <div className="pool-main">
                            <span className="detail-icon">💰</span>
                            <span>{raffle.isFree ? 'FREE' : `${raffle.entryFee} AURY`} Entry</span>
                        </div>
                    </div>
                    {raffle.status === 'completed' && raffle.winner && (
                        <div className="detail-item fee">
                            <span className="detail-icon">🏆</span>
                            <span>Winner: {raffle.winner.playerName}</span>
                        </div>
                    )}
                </div>

                <div className="matchup-footer">
                    <div className="progress-info">
                        <span>{raffle.participantsCount} / {raffle.maxParticipants} Participants</span>
                    </div>
                    <div className="progress-bar">
                        <div
                            className="progress-fill"
                            style={{ 
                                width: `${Math.min(100, (raffle.participantsCount / raffle.maxParticipants) * 100)}%`,
                                background: raffle.status === 'completed' ? '#4caf50' : '#2563eb'
                            }}
                        ></div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default RaffleHomeCard;
