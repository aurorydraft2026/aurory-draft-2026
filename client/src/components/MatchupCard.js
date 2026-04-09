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
                        <span className="detail-icon">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                        </span>
                        <span className="detail-text">Starts: {formatDate(matchup.startDate)}</span>
                    </div>
                    <div className="detail-item prize-pool-details">
                        <div className="pool-main">
                            <span className="detail-icon">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h12l4 6-10 12L2 9z"/><path d="M11 3 8 9l3 12"/><path d="M13 3l3 6-3 12"/><path d="M2 9h20"/></svg>
                            </span>
                            <span>{matchup.poolPrize} AURY Pool</span>
                        </div>
                        {(matchup.prize1 || matchup.prize2 || matchup.prize3) && (
                            <div className="prize-tiers">
                                {matchup.prize1 > 0 && <span className="tier"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: '2px'}}><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg> {matchup.prize1}</span>}
                                {matchup.prize2 > 0 && <span className="tier" style={{opacity: 0.8}}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: '2px'}}><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg> {matchup.prize2}</span>}
                                {matchup.prize3 > 0 && <span className="tier" style={{opacity: 0.6}}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: '2px'}}><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg> {matchup.prize3}</span>}
                            </div>
                        )}
                    </div>
                    <div className={`detail-item ${matchup.requiresEntryFee ? 'fee' : 'free'}`}>
                        <span className="detail-icon">
                            {matchup.requiresEntryFee ? (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                            ) : (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
                            )}
                        </span>
                        <span>{matchup.requiresEntryFee ? `${((matchup.entryFeeAmount || 0) / 1e9).toFixed(2)} AURY` : 'Free'}</span>
                    </div>
                    {matchup.allowedRarities && (
                        <div className="detail-item">
                            <span className="detail-icon">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                            </span>
                            <span className="detail-text">{matchup.allowedRarities}</span>
                        </div>
                    )}
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
