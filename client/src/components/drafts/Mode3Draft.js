import React from 'react';
import { AMIKOS, ELEMENTS } from '../../data/amikos';

const Mode3Draft = ({
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
        isPickVisibleToUser,
        isTeamLocked,
        lock1v1Picks,
        isSuperAdmin,
        getUserEmail,
        isAmikoPicked,
        isAmikoPickVisible,
        pickAmiko,
        handleCardMouseMove,
        handleCardMouseLeave,
        getCardTransform,
        hoveredCard,
        shuffleHighlights
    } = handlers;

    const {
        getTeamDisplayName,
        getTeamLeader,
        copyToClipboard,
        ElementBadge,
        RankStars
    } = utils;

    const renderPlayerSection = (team, picks) => {
        const leader = getTeamLeader(team);

        return (
            <div className="player-section" key={`player-${team}`}>
                <div className="player-label">{leader?.displayName || (team === 'A' ? 'Player 1' : 'Player 2')}</div>
                <div className="player-picks">
                    {picks.slice(0, 3).map((amikoId, index) => {
                        const amiko = AMIKOS.find(a => a.id === amikoId);
                        const locked = isPickLocked(team, index);
                        const visible = isPickVisibleToUser(team, index);
                        const canRemove = user && draftState.status === 'active' &&
                            !locked &&
                            !draftState.awaitingLockConfirmation &&
                            userPermission === team;

                        if (!visible) {
                            return (
                                <div key={index} className="picked-amiko hidden-pick">
                                    <div className="hidden-card-face">?</div>
                                    <span>Hidden</span>
                                </div>
                            );
                        }

                        return (
                            <div
                                key={index}
                                className={`picked-amiko ${canRemove ? 'removable' : ''} ${locked ? 'locked' : ''}`}
                                onClick={() => canRemove && removeAmiko(team, index)}
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
                    {Array(Math.max(0, 3 - Math.min(3, picks.length))).fill(null).map((_, i) => (
                        <div key={`empty-${team}-${i}`} className="empty-slot">?</div>
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

        const isAdmin = userPermission === 'admin' || isSuperAdmin(getUserEmail(user));

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
                        <span className="leader-name">{leader.displayName}</span>
                    </div>
                )}
                <div className="team-picks-container">
                    {renderPlayerSection(team, displayPicks)}
                </div>

                {/* 1v1 Mode Lock Button */}
                {(userPermission === team || isAdmin) && (
                    <div className="team-lock-actions">
                        {displayPicks.length >= 3 && !isTeamLocked(team) && (
                            <button className="confirm-lock-btn" onClick={() => lock1v1Picks(team)}>
                                🔒 Lock Picks
                            </button>
                        )}
                        {isTeamLocked(team) && (
                            <div className="locked-badge">✅ Picks Locked</div>
                        )}
                    </div>
                )}
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

                {/* Completed overlay */}
                {draftState.status === 'completed' && (
                    <div className="completed-overlay">
                        <div className="completed-content">
                            <h3>🏆 Draft Completed!</h3>
                            <p>All picks have been locked in.</p>

                            {draftState.privateCode && (userPermission === 'A' || userPermission === 'B' || userPermission === 'admin' || isSuperAdmin(getUserEmail(user))) && (
                                <div className="completed-private-code">
                                    <div className="code-display-compact" onClick={() => copyToClipboard(draftState.privateCode, 'Private Code')}>
                                        <span className="code-label">Private Battle Code:</span>
                                        <span className="code-value">{draftState.privateCode}</span>
                                        <span className="copy-hint">📋 Click to copy</span>
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

                {/* Shuffling pools overlay */}
                {draftState.status === 'poolShuffle' && (
                    <div className="preparation-overlay pool-shuffle-overlay">
                        <div className="preparation-content">
                            <span className="shuffling-text">🎲 Shuffling Amiko Pools...</span>
                        </div>
                    </div>
                )}

                <div className={`amiko-grid ${draftState.status === 'completed' ? 'dimmed' : ''}`}>
                    {AMIKOS.map((amiko) => {
                        const picked = isAmikoPicked(amiko.id);
                        const pickVisible = picked && isAmikoPickVisible(amiko.id);
                        const isAdmin = userPermission === 'admin' || isSuperAdmin(getUserEmail(user));

                        // 1v1 specific pool logic
                        let mode3Class = '';
                        let isSelectable = true;

                        if (draftState.draftType === 'mode3' && draftState.simultaneousPicking) {
                            if (draftState.status === 'poolShuffle') {
                                const highlight = shuffleHighlights?.find(h => h.id === amiko.id);
                                if (highlight) {
                                    mode3Class = highlight.team === 'A' ? 'shuffling-a' : 'shuffling-b';
                                } else {
                                    mode3Class = 'unassigned';
                                }
                                isSelectable = false;
                            } else {
                                const userTeam = userPermission === 'A' ? 'A' : userPermission === 'B' ? 'B' : null;
                                const myPool = userTeam === 'A' ? draftState.playerAPool : userTeam === 'B' ? draftState.playerBPool : [];
                                const opponentPool = userTeam === 'A' ? draftState.playerBPool : userTeam === 'B' ? draftState.playerAPool : [];

                                if (userTeam) {
                                    if (myPool?.includes(amiko.id)) {
                                        mode3Class = userTeam === 'A' ? 'team-a-pool select-highlight' : 'team-b-pool select-highlight';
                                        isSelectable = true;
                                    } else if (opponentPool?.includes(amiko.id)) {
                                        mode3Class = userTeam === 'A' ? 'team-b-pool opponent-pool' : 'team-a-pool opponent-pool';
                                        isSelectable = false;
                                    } else {
                                        mode3Class = 'unassigned';
                                        isSelectable = false;
                                    }
                                } else {
                                    if (draftState.playerAPool?.includes(amiko.id)) {
                                        mode3Class = 'team-a-pool';
                                        isSelectable = isAdmin;
                                    } else if (draftState.playerBPool?.includes(amiko.id)) {
                                        mode3Class = 'team-b-pool';
                                        isSelectable = isAdmin;
                                    } else {
                                        mode3Class = 'unassigned';
                                        isSelectable = false;
                                    }
                                }
                            }
                        }

                        const canPick = user &&
                            draftState.status === 'active' &&
                            !pickVisible &&
                            !draftState.awaitingLockConfirmation &&
                            isSelectable &&
                            (draftState.simultaneousPicking || userPermission === draftState.currentTeam || isAdmin);

                        return (
                            <div
                                key={amiko.id}
                                data-element={amiko.element}
                                className={`amiko-card ${pickVisible ? 'picked' : ''} ${canPick ? 'selectable' : ''} ${mode3Class} ${hoveredCard === amiko.id ? 'parallax-active' : ''}`}
                                onClick={() => canPick && pickAmiko(amiko.id)}
                                onMouseMove={(e) => canPick && handleCardMouseMove(e, amiko.id)}
                                onMouseLeave={handleCardMouseLeave}
                                style={canPick ? getCardTransform(amiko.id) : {}}
                            >
                                {amiko.element && (
                                    <div className="amiko-element-badge">
                                        <ElementBadge element={amiko.element} size="small" />
                                    </div>
                                )}

                                {amiko.seekerRank && (
                                    <div className="amiko-rank-stars">
                                        <RankStars rank={amiko.seekerRank} size="small" />
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

export default Mode3Draft;