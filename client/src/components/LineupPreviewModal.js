import React from 'react';
import { AMIKOS, ELEMENTS } from '../data/amikos';
import { ElementBadge, RankStars } from './AmikoEnhancements';
import './LineupPreviewModal.css';

const LineupPreviewModal = ({
    isOpen,
    onClose,
    draftState,
    registeredUsers,
    user,
    userVote,
    isParticipantOrAdmin,
    getTeamDisplayName,
    getTeamLeader,
    getTeamMembers,
    getVoteCount,
    voteForTeam,
    copyToClipboard,
    getUserProfilePicture,
    DEFAULT_AVATAR
}) => {
    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="lineup-preview-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>Lineup Preview</h3>
                    <button className="close-modal" onClick={onClose}>×</button>
                </div>

                <div className="modal-body">
                    {/* Version 1: 3v3 and other multi-player modes */}
                    {draftState.draftType !== 'mode3' && draftState.draftType !== 'mode4' ? (
                        <div className="lineup-content">
                            {/* Team A Lineup */}
                            <div className={`team-lineup team-blue-lineup ${userVote === 'A' ? 'voted' : ''}`}>
                                <h4>{getTeamDisplayName('A')}</h4>
                                <div className="lineup-grid">
                                    {[0, 1, 2].map(playerIndex => (
                                        <div key={playerIndex} className="lineup-player">
                                            <span className="player-number">PLAYER {playerIndex + 1}</span>
                                            <div className="player-amikos">
                                                {(draftState.teamA?.slice(playerIndex * 3, (playerIndex + 1) * 3) || []).map((amikoId, amikoIndex) => {
                                                    const amiko = AMIKOS.find(a => a.id === amikoId);
                                                    return (
                                                        <div key={amikoIndex} className="lineup-amiko">
                                                            {amiko?.element && (
                                                                <span className="lineup-element-icon" title={amiko.element}>
                                                                    {ELEMENTS[amiko.element]?.icon}
                                                                </span>
                                                            )}
                                                            <img src={amiko?.image} alt={amiko?.name} />
                                                            <span>{amiko?.name}</span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <button
                                    className={`vote-btn vote-team-blue ${userVote === 'A' ? 'voted' : ''}`}
                                    onClick={() => voteForTeam('A')}
                                >
                                    <span className="vote-icon">{userVote === 'A' ? '❤️' : '🤍'}</span>
                                    <span className="vote-count">{getVoteCount('A')}</span>
                                    <span className="vote-label">{userVote === 'A' ? 'Voted' : 'Vote Team Blue'}</span>
                                </button>
                            </div>

                            <div className="vs-divider">
                                <div className="vs-center-content">
                                    <span className="vs-text">VS</span>
                                </div>
                            </div>

                            {/* Team B Lineup */}
                            <div className={`team-lineup team-red-lineup ${userVote === 'B' ? 'voted' : ''}`}>
                                <h4>{getTeamDisplayName('B')}</h4>
                                <div className="lineup-grid">
                                    {[0, 1, 2].map(playerIndex => (
                                        <div key={playerIndex} className="lineup-player">
                                            <span className="player-number">PLAYER {playerIndex + 1}</span>
                                            <div className="player-amikos">
                                                {(draftState.teamB?.slice(playerIndex * 3, (playerIndex + 1) * 3) || []).map((amikoId, amikoIndex) => {
                                                    const amiko = AMIKOS.find(a => a.id === amikoId);
                                                    return (
                                                        <div key={amikoIndex} className="lineup-amiko">
                                                            {amiko?.element && (
                                                                <span className="lineup-element-icon" title={amiko.element}>
                                                                    {ELEMENTS[amiko.element]?.icon}
                                                                </span>
                                                            )}
                                                            <img src={amiko?.image} alt={amiko?.name} />
                                                            <span>{amiko?.name}</span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <button
                                    className={`vote-btn vote-team-red ${userVote === 'B' ? 'voted' : ''}`}
                                    onClick={() => voteForTeam('B')}
                                >
                                    <span className="vote-icon">{userVote === 'B' ? '❤️' : '🤍'}</span>
                                    <span className="vote-count">{getVoteCount('B')}</span>
                                    <span className="vote-label">{userVote === 'B' ? 'Voted' : 'Vote Team Red'}</span>
                                </button>
                            </div>
                        </div>
                    ) : (
                        /* Version 2: 1v1 (Mode 3 and Mode 4) */
                        <div className="lineup-content-v2">
                            <div className="lineup-top-header">
                                <div className="vs-badge">VS</div>
                                {(draftState.draftType === 'mode3' || draftState.draftType === 'mode4') && draftState.privateCode && isParticipantOrAdmin && (
                                    <div
                                        className="private-code-top copyable"
                                        onClick={() => copyToClipboard(draftState.privateCode, 'Private Code')}
                                        title="Click to copy Private Code"
                                    >
                                        <span className="code-label">Private Code</span>
                                        <span className="code-value">{draftState.privateCode}</span>
                                        <span className="code-hint">📋 Click to copy</span>
                                    </div>
                                )}
                            </div>

                            <div className="lineup-team-headers">
                                <div className="team-header team-blue">{getTeamDisplayName('A')}</div>
                                <div className="spacer"></div>
                                <div className="team-header team-red">{getTeamDisplayName('B')}</div>
                            </div>

                            <div className="lineup-rows-container">
                                {[0, 1, 2].map(playerIndex => (
                                    <div key={playerIndex} className="lineup-match-row">
                                        <div className="lineup-player-column">
                                            <div className="player-amikos">
                                                {[draftState.teamA[playerIndex]].map((amikoId, amikoIndex) => {
                                                    const amiko = AMIKOS.find(a => a.id === amikoId);
                                                    return (
                                                        <div key={amikoIndex} className="lineup-amiko sticky-card">
                                                            {amiko?.element && <ElementBadge element={amiko.element} className="amiko-element-badge" />}
                                                            <RankStars rank={amiko?.rank || 1} className="amiko-rank-stars" />
                                                            <img src={amiko?.image} alt={amiko?.name} />
                                                            <span className="amiko-name">{amiko?.name}</span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>

                                        <div className="lineup-code-column">
                                            {(draftState.draftType === 'mode1' || draftState.draftType === 'mode2') && draftState.privateCodes && draftState.privateCodes[playerIndex] && isParticipantOrAdmin && (
                                                <div
                                                    className="private-code-display row-aligned copyable"
                                                    onClick={() => copyToClipboard(draftState.privateCodes[playerIndex], `Battle Code ${playerIndex + 1}`)}
                                                    title={`Click to copy Battle Code ${playerIndex + 1}`}
                                                >
                                                    <span className="code-label">BATTLE {playerIndex + 1}</span>
                                                    <span className="code-value">{draftState.privateCodes[playerIndex]}</span>
                                                    <span className="copy-icon-row">📋</span>
                                                </div>
                                            )}
                                            {!(draftState.privateCodes && draftState.privateCodes[playerIndex]) && <div className="row-divider-line"></div>}
                                        </div>

                                        <div className="lineup-player-column">
                                            <div className="player-amikos">
                                                {[draftState.teamB[playerIndex]].map((amikoId, amikoIndex) => {
                                                    const amiko = AMIKOS.find(a => a.id === amikoId);
                                                    return (
                                                        <div key={amikoIndex} className="lineup-amiko sticky-card">
                                                            {amiko?.element && <ElementBadge element={amiko.element} className="amiko-element-badge" />}
                                                            <RankStars rank={amiko?.rank || 1} className="amiko-rank-stars" />
                                                            <img src={amiko?.image} alt={amiko?.name} />
                                                            <span className="amiko-name">{amiko?.name}</span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="lineup-footer-actions">
                                <button
                                    className={`vote-btn vote-team-blue ${userVote === 'A' ? 'voted' : ''}`}
                                    onClick={() => voteForTeam('A')}
                                >
                                    <span className="vote-icon">{userVote === 'A' ? '❤️' : '🤍'}</span>
                                    <span className="vote-count">{getVoteCount('A')}</span>
                                    <span className="vote-label">{userVote === 'A' ? 'Voted' : 'Vote Blue'}</span>
                                </button>

                                <div className="spacer"></div>

                                <button
                                    className={`vote-btn vote-team-red ${userVote === 'B' ? 'voted' : ''}`}
                                    onClick={() => voteForTeam('B')}
                                >
                                    <span className="vote-icon">{userVote === 'B' ? '❤️' : '🤍'}</span>
                                    <span className="vote-count">{getVoteCount('B')}</span>
                                    <span className="vote-label">{userVote === 'B' ? 'Voted' : 'Vote Red'}</span>
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                <div className="modal-footer">
                    <button className="close-lineup-btn" onClick={onClose}>Close Preview</button>
                </div>
            </div>
        </div>
    );
};

export default LineupPreviewModal;
