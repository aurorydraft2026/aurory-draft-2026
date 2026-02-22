import React from 'react';
import { useNavigate } from 'react-router-dom';
import './MatchupCard.css';

const MatchupCard = ({ matchup, user }) => {
    const navigate = useNavigate();

    const handleView = () => {
        navigate(`/matchup/${matchup.id}`);
    };

    const formatDate = (date) => {
        if (!date) return 'TBA';
        const d = date.toDate ? date.toDate() : new Date(date);
        return d.toLocaleString([], {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const getModeLabel = (mode) => {
        switch (mode) {
            case 'mode1': return 'Triad 3-6-3';
            case 'mode2': return 'Triad 1-2-1';
            case 'mode3': return 'DM 3-3';
            case 'mode4': return 'Ban 1-2-1';
            default: return mode;
        }
    };


    return (
        <div className={`matchup-card ${matchup.status}`} onClick={handleView}>
            <div className="card-content">
                <div className="tournament-header">
                    <h4 className="matchup-title">{matchup.title}</h4>
                    <div className="card-badges">
                        <span className={`mode-badge mode-${matchup.draftType}`}>
                            {getModeLabel(matchup.draftType)}
                        </span>
                        <span className={`status-badge ${matchup.status}`}>
                            {matchup.status === 'waiting' ? 'Waiting' : 'Active'}
                        </span>
                    </div>
                </div>

                <p className="matchup-description">{matchup.description}</p>

                <div className="matchup-details">
                    <div className="detail-item">
                        <span className="detail-icon">📅</span>
                        <span className="detail-text">Starts: {formatDate(matchup.startDate)}</span>
                    </div>
                    <div className="detail-item prize">
                        <span className="detail-icon">💎</span>
                        <span>{matchup.poolPrize} AURY Pool</span>
                    </div>
                </div>

                <div className="matchup-footer">
                    <div className="progress-info">
                        <span>{matchup.participants?.length || 0} / {matchup.maxParticipants} Joined</span>
                    </div>
                    <div className="progress-bar">
                        <div
                            className="progress-fill"
                            style={{ width: `${((matchup.participants?.length || 0) / matchup.maxParticipants) * 100}%` }}
                        ></div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MatchupCard;
