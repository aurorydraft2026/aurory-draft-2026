import React from 'react';
import { AMIKOS, ELEMENTS } from '../../data/amikos';

const Mode2Draft = ({
    draftState,
    user,
    userPermission,
    displayTeamA,
    displayTeamB,
    tempPick,
    handlers,
    utils
}) => {
    const {
        removeAmiko,
        isPickLocked,
        isPickVisibleToUser
    } = handlers;

    const {
        getTeamDisplayName,
        getTeamLeader,
        getTeamMembers
    } = utils;

    const renderPlayerSection = (team, playerIndex, picks) => {
        const leader = getTeamLeader(team);
        const teamMembers = getTeamMembers(team);
        const otherMembers = teamMembers.filter(m => m.uid !== leader?.uid);

        let label = `Player ${playerIndex + 1}`;
        if (playerIndex === 0) {
            label = leader?.displayName || 'Player 1';
        } else {
            label = otherMembers[playerIndex - 1]?.displayName || `Player ${playerIndex + 1}`;
        }

        return (
            <div className="player-section" key={`player-${team}-${playerIndex}`}>
                <div className="player-label">{label}</div>
                <div className="player-picks">
                    {picks.map((amikoId, index) => {
                        const actualIndex = (playerIndex * 3) + index;
                        const amiko = AMIKOS.find(a => a.id === amikoId);
                        const locked = isPickLocked(team, actualIndex);
                        const visible = isPickVisibleToUser(team, actualIndex);
                        const canRemove = user && draftState.status === 'active' &&
                            !locked &&
                            !draftState.awaitingLockConfirmation &&
                            userPermission === team;

                        if (!visible) {
                            return (
                                <div key={actualIndex} className="picked-amiko hidden-pick">
                                    <div className="hidden-card-face">?</div>
                                    <span>Hidden</span>
                                </div>
                            );
                        }

                        return (
                            <div
                                key={actualIndex}
                                className={`picked-amiko ${canRemove ? 'removable' : ''} ${locked ? 'locked' : ''}`}
                                onClick={() => canRemove && removeAmiko(team, actualIndex)}
                                title={locked ? 'Locked' : canRemove ? 'Click to remove' : ''}
                            >
                                {amiko?.element && (
                                    <span className="picked-element-icon" title={amiko.element}>
                                        {ELEMENTS[amiko.element]?.icon}
                                    </span>
                                )}
                                <img src={amiko.image} alt={amiko.name} />
                                <span>{amiko.name}</span>
                                {locked && <div className="lock-icon">🔒</div>}
                                {canRemove && <div className="remove-icon">✕</div>}
                                {amikoId === tempPick?.id && <div className="loading-spinner-overlay">⌛</div>}
                            </div>
                        );
                    })}
                    {Array(Math.max(0, 3 - picks.length)).fill(null).map((_, i) => (
                        <div key={`empty-${team}-${playerIndex}-${i}`} className="empty-slot">?</div>
                    ))}
                </div>
            </div>
        );
    };

    const renderTeamPanel = (team) => {
        const isTeamA = team === 'A';
        const teamColor = isTeamA ? (draftState.teamColors?.teamA || 'blue') : (draftState.teamColors?.teamB || 'red');
        const displayPicks = isTeamA ? displayTeamA : displayTeamB;
        const leader = getTeamLeader(team);
        const teamBanner = isTeamA
            ? (draftState.teamColors?.teamA === 'blue' ? draftState.teamBanners?.team1 : draftState.teamBanners?.team2)
            : (draftState.teamColors?.teamB === 'blue' ? draftState.teamBanners?.team1 : draftState.teamBanners?.team2);

        return (
            <div className={`team-panel team-${teamColor}`}>
                {teamBanner && (
                    <div className="team-banner-circle">
                        <img src={teamBanner} alt={getTeamDisplayName(team)} />
                    </div>
                )}
                <h2 className={`team-heading team-${teamColor}-heading`}>
                    {getTeamDisplayName(team)}
                </h2>
                {leader && (
                    <div className="team-leader">
                        <img
                            src={leader.photoURL && leader.photoURL !== '' ? leader.photoURL : 'https://cdn.discordapp.com/embed/avatars/0.png'}
                            alt=""
                            className="leader-avatar"
                            onError={(e) => { e.target.onerror = null; e.target.src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }}
                        />
                        <span className="leader-label">Captain:</span>
                        <span className="leader-name">{leader.displayName}</span>
                    </div>
                )}
                <div className="team-picks-container">
                    {renderPlayerSection(team, 0, displayPicks.slice(0, 3))}
                    {renderPlayerSection(team, 1, displayPicks.slice(3, 6))}
                    {renderPlayerSection(team, 2, displayPicks.slice(6, 9))}
                </div>
            </div>
        );
    };

    return (
        <>
            {renderTeamPanel('A')}

            <div className="amiko-selection-wrapper">
                {/* Preparation overlay */}
                {(handlers.showPreparation || draftState.inPreparation) && (userPermission === 'A' || userPermission === 'B') && (
                    <div className="preparation-overlay">
                        <div className="preparation-content">
                            <span>⏳ Team {handlers.nextTeamAfterPrep || draftState.currentTeam}'s turn starting...</span>
                        </div>
                    </div>
                )}

                {draftState.status === 'completed' && (
                    <div className="completed-overlay">
                        <div className="completed-content">
                            <h3>🏆 Draft Completed!</h3>
                            <p>All picks have been locked in.</p>

                            {draftState.privateCodes && (userPermission === 'A' || userPermission === 'B' || userPermission === 'admin' || handlers.isSuperAdmin(handlers.getUserEmail(user))) && (
                                <div className="completed-private-codes-container">
                                    <p className="codes-intro">Private Battle Codes (3v3):</p>
                                    <div className="codes-stack">
                                        {draftState.privateCodes.map((code, idx) => (
                                            <div key={idx} className="code-display-compact" onClick={() => utils.copyToClipboard(code, `Private Code ${idx + 1}`)}>
                                                <span className="code-label">Battle {idx + 1}:</span>
                                                <span className="code-value">{code}</span>
                                                <span className="copy-hint">📋 Click to copy</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <button
                                className="preview-lineup-btn"
                                onClick={() => handlers.setShowLineupPreview(true)}
                            >
                                ⚔️ Preview Final Lineup
                            </button>
                        </div>
                    </div>
                )}

                <div className={`amiko-grid ${draftState.status === 'completed' ? 'dimmed' : ''}`}>
                    {AMIKOS.map((amiko) => {
                        const picked = handlers.isAmikoPicked(amiko.id);
                        const pickVisible = picked && handlers.isAmikoPickVisible(amiko.id);
                        const isAdmin = userPermission === 'admin' || handlers.isSuperAdmin(handlers.getUserEmail(user));
                        const currentPhaseConfig = handlers.getPICK_ORDER(draftState.draftType)[draftState.currentPhase];
                        const phaseComplete = currentPhaseConfig && draftState.picksInPhase >= currentPhaseConfig.count;

                        const canPick = user &&
                            draftState.status === 'active' &&
                            !pickVisible &&
                            !draftState.awaitingLockConfirmation &&
                            !phaseComplete &&
                            (userPermission === draftState.currentTeam || isAdmin);

                        return (
                            <div
                                key={amiko.id}
                                data-element={amiko.element}
                                className={`amiko-card ${pickVisible ? 'picked' : ''} ${canPick ? 'selectable' : ''} ${handlers.hoveredCard === amiko.id ? 'parallax-active' : ''}`}
                                onClick={() => canPick && handlers.pickAmiko(amiko.id)}
                                onMouseMove={(e) => canPick && handlers.handleCardMouseMove(e, amiko.id)}
                                onMouseLeave={handlers.handleCardMouseLeave}
                                style={canPick ? handlers.getCardTransform(amiko.id) : {}}
                            >
                                {amiko.element && (
                                    <div className="amiko-element-badge">
                                        <utils.ElementBadge element={amiko.element} size="small" />
                                    </div>
                                )}

                                {amiko.seekerRank && (
                                    <div className="amiko-rank-stars">
                                        <utils.RankStars rank={amiko.seekerRank} size="small" />
                                    </div>
                                )}

                                <img src={amiko.image} alt={amiko.name} />
                                <span className="amiko-name">{amiko.name}</span>
                                {pickVisible && <div className="picked-overlay">✓</div>}
                            </div>
                        );
                    })}
                </div>
            </div>

            {renderTeamPanel('B')}
        </>
    );
};

export default Mode2Draft;