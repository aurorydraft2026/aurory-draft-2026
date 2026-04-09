import React from 'react';
import { useNavigate } from 'react-router-dom';
import './RaffleHomeCard.css';
import '../MatchupCard.css'; // Reuse existing matchup card styles

const RaffleHomeCard = ({ raffle }) => {
    const navigate = useNavigate();

    const handleView = () => {
        navigate(`/raffle/${raffle.id}`);
    };

    return (
        <div className={`tournament-card ${raffle.status}`} onClick={handleView}>
            <div className="card-content">
                <div className="tournament-header">
                    <h4 className="matchup-title">{raffle.itemType?.toUpperCase()} Raffle</h4>
                    <div className="card-badges">
                        <span className="mode-badge mode-mode3">
                            RAFFLE
                        </span>
                        <span className={`status-badge ${raffle.status === 'completed' ? 'ended' : raffle.status}`}>
                            {raffle.status === 'active' ? 'Open' : raffle.status === 'spinning' ? 'Spinning' : raffle.status === 'completed' ? 'Ended' : raffle.status}
                        </span>
                    </div>
                </div>
                
                <div className="raffle-prize-display">
                    {raffle.itemType === 'aury' || raffle.itemType === 'usdc' ? (
                        <div className={`raffle-currency-prize-sm ${raffle.itemType}`}>
                            <div className="raffle-currency-icon-wrapper-sm">
                                {raffle.itemType === 'aury' ? (
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6a6 6 0 0 1 0 12"/><path d="M12 6v12"/><path d="M12 9h4"/><path d="M12 15h4"/></svg>
                                ) : (
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><path d="M16 8h-1.5c-1.38 0-2.5 1.12-2.5 2.5s1.12 2.5 2.5 2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5H12"/></svg>
                                )}
                            </div>
                            <span className="raffle-currency-amount-sm">
                                {raffle.itemType === 'aury' ? raffle.auryAmount : raffle.usdcAmount}
                            </span>
                        </div>
                    ) : (
                        raffle.itemImage && <img src={raffle.itemImage} alt={raffle.itemType} className="raffle-prize-image-sm" />
                    )}
                </div>

                <p className="matchup-description">{raffle.description}</p>

                <div className="matchup-details">
                    <div className="detail-item">
                        <span className="detail-icon">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 12V8H4v4"/><path d="M2 12h20"/><path d="M20 12v8H4v-8"/><line x1="12" y1="12" x2="12" y2="20"/><path d="m12 8 3-3-3-3-3 3 3 3Z"/></svg>
                        </span>
                        <span className="detail-text">Item: {raffle.itemType?.toUpperCase()}</span>
                    </div>
                    <div className="detail-item prize-pool-details">
                        <div className="pool-main">
                            <span className="detail-icon">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                            </span>
                            <span>{raffle.isFree ? 'FREE' : `${raffle.entryFee} ${raffle.entryFeeCurrency || 'AURY'}`} Entry</span>
                        </div>
                    </div>
                    {raffle.status === 'completed' && raffle.winner && (
                        <div className="detail-item fee">
                            <span className="detail-icon">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>
                            </span>
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
