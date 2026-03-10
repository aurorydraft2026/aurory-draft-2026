import React from 'react';
import { AMIKOS, ELEMENTS } from '../../data/amikos';

const Mode1Draft = ({
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
        getTeamMembers,
        currentTimerDisplay,
        getUserDisplayName,
        getUserProfilePicture
    } = utils;

    const timerExpired = draftState.status === 'active' && currentTimerDisplay === '00:00:00';
    const timerNotStarted = draftState.manualTimerStart && !draftState.timerStarted;

    // Ban phase helpers
    const isBanPhase = draftState.triadBanPhase === true;
    const isCaptainA = user?.uid === draftState.teamALeader;
    const isCaptainB = user?.uid === draftState.teamBLeader;
    const isCaptain = isCaptainA || isCaptainB;
    const myBanKey = isCaptainA ? 'triadBanA' : isCaptainB ? 'triadBanB' : null;
    const myBanSubmitted = myBanKey && draftState[myBanKey] !== null && draftState[myBanKey] !== undefined;
    const myBannedAmiko = myBanSubmitted ? AMIKOS.find(a => a.id === draftState[myBanKey]) : null;

    const renderPlayerSection = (team, playerIndex, picks) => {
        const leader = getTeamLeader(team);
        const teamMembers = getTeamMembers(team);
        const otherMembers = teamMembers.filter(m => m.uid !== leader?.uid);

        let label = `Player ${playerIndex + 1}`;
        if (playerIndex === 0) {
            label = leader ? getUserDisplayName(leader) : 'Player 1';
        } else {
            label = (otherMembers[playerIndex - 1] ? getUserDisplayName(otherMembers[playerIndex - 1]) : null) || `Player ${playerIndex + 1}`;
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
                            !timerExpired &&
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
        // Use leader's profile as default banner if no team banner is set
        const leaderImage = leader ? getUserProfilePicture(leader) : 'https://cdn.discordapp.com/embed/avatars/0.png';

        const rawBanner = isTeamA
            ? (draftState.teamColors?.teamA === 'blue' ? draftState.teamBanners?.team1 : draftState.teamBanners?.team2)
            : (draftState.teamColors?.teamB === 'blue' ? draftState.teamBanners?.team1 : draftState.teamBanners?.team2);

        const teamBanner = rawBanner || leaderImage;

        return (
            <div className={`team-panel team-${teamColor}`}>
                <div className="team-banner-circle">
                    <img
                        src={teamBanner}
                        alt={getTeamDisplayName(team)}
                        onError={(e) => { e.target.onerror = null; e.target.src = leaderImage; }}
                    />
                </div>
                <h2 className={`team-heading team-${teamColor}-heading`}>
                    {getTeamDisplayName(team)}
                </h2>
                {leader && (
                    <div className="team-leader">
                        <img
                            src={getUserProfilePicture(leader)}
                            alt=""
                            className="leader-avatar"
                            onError={(e) => { e.target.onerror = null; e.target.src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }}
                        />
                        <span className="leader-label">Captain:</span>
                        <span className="leader-name">{getUserDisplayName(leader)}</span>
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
                {/* Ban Phase Message - Above grid, not overlapping */}
                {isBanPhase && draftState.status === 'active' && (() => {
                    const { localBanSelection, handleBanConfirm } = handlers;
                    const selectedAmiko = localBanSelection ? AMIKOS.find(a => a.id === localBanSelection) : null;

                    return (
                        <div className="ban-phase-banner">
                            <div className="ban-phase-content">
                                {myBanSubmitted ? (
                                    <>
                                        <span className="ban-phase-icon">✅</span>
                                        <h3>Ban Confirmed!</h3>
                                        <p>You banned: <strong>{myBannedAmiko?.name || 'Unknown'}</strong></p>
                                        <p className="ban-waiting">Waiting for opponent's ban...</p>
                                    </>
                                ) : isCaptain ? (
                                    <>
                                        <span className="ban-phase-icon">🚫</span>
                                        <h3>Ban Phase</h3>
                                        {selectedAmiko ? (
                                            <div className="ban-selection-preview">
                                                <div className="ban-preview-card" onClick={() => handlers.setLocalBanSelection(null)}>
                                                    <img src={selectedAmiko.image} alt={selectedAmiko.name} />
                                                    <span>{selectedAmiko.name}</span>
                                                    <div className="ban-preview-x">✕</div>
                                                </div>
                                                <div className="ban-confirm-actions">
                                                    <button className="ban-confirm-btn" onClick={handleBanConfirm}>
                                                        ✅ Confirm Ban
                                                    </button>
                                                    <p className="ban-change-hint">Click another Amiko to change</p>
                                                </div>
                                            </div>
                                        ) : (
                                            <>
                                                <p>Select 1 Amiko to ban from the grid below.</p>
                                                <p className="ban-blind-note">This is a blind ban — your opponent cannot see your choice.</p>
                                            </>
                                        )}
                                    </>
                                ) : (
                                    <>
                                        <span className="ban-phase-icon">⏳</span>
                                        <h3>Ban Phase</h3>
                                        <p>Captains are selecting their bans...</p>
                                    </>
                                )}
                            </div>
                        </div>
                    );
                })()}

                {/* Banned Amikos Bar (shown after ban phase resolves) */}
                {!isBanPhase && (draftState.bannedAmikos || []).length > 0 && (
                    <div className="mode4-banned-bar">
                        <span className="banned-bar-label">🚫 Banned ({(draftState.bannedAmikos || []).length}):</span>
                        <div className="banned-bar-icons">
                            {(draftState.bannedAmikos || []).map((id, i) => {
                                const a = AMIKOS.find(x => x.id === id);
                                return a ? (
                                    <div key={i} className="banned-bar-item" title={a.name}>
                                        <img src={a.image} alt={a.name} />
                                        <div className="banned-bar-x">✕</div>
                                    </div>
                                ) : null;
                            })}
                        </div>
                    </div>
                )}

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
                                        {draftState.privateCodes.map((code, idx) => {
                                            const isAdmin = userPermission === 'admin' || handlers.isSuperAdmin(handlers.getUserEmail(user));
                                            const userBattleIdx = handlers.getUserBattleIndex ? handlers.getUserBattleIndex(user?.uid) : -1;
                                            if (!isAdmin && userBattleIdx !== idx) return null;
                                            return (
                                                <div key={idx} className="code-display-compact" onClick={() => utils.copyToClipboard(code, `Private Code ${idx + 1}`)}>
                                                    <span className="code-label">Battle {idx + 1}:</span>
                                                    <span className="code-value">{code}</span>
                                                    <span className="copy-hint">📋 Click to copy</span>
                                                </div>
                                            );
                                        })}
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

                <div className={`amiko-grid ${draftState.status === 'completed' ? 'dimmed' : ''} ${timerExpired ? 'dimmed' : ''}`}>
                    {timerExpired && (
                        <div className="preparation-overlay timer-expired-overlay">
                            <div className="prep-spinner"></div>
                            <p>⏱️ Time's up! Auto-locking selections...</p>
                        </div>
                    )}
                    {AMIKOS.map((amiko) => {
                        const picked = handlers.isAmikoPicked(amiko.id);
                        const banned = handlers.isAmikoBanned ? handlers.isAmikoBanned(amiko.id) : false;
                        const pickVisible = picked && handlers.isAmikoPickVisible(amiko.id);
                        const isAdmin = userPermission === 'admin' || handlers.isSuperAdmin(handlers.getUserEmail(user));
                        const currentPhaseConfig = handlers.getPICK_ORDER(draftState.draftType)[draftState.currentPhase];
                        const phaseComplete = currentPhaseConfig && draftState.picksInPhase >= currentPhaseConfig.count;

                        // During ban phase: captains can click any un-picked Amiko
                        const canBan = isBanPhase && isCaptain && !myBanSubmitted &&
                            draftState.status === 'active' && !timerExpired && !timerNotStarted;

                        const canPick = !isBanPhase && user &&
                            draftState.status === 'active' &&
                            !pickVisible &&
                            !banned &&
                            !draftState.awaitingLockConfirmation &&
                            !timerExpired &&
                            !timerNotStarted &&
                            !phaseComplete &&
                            (userPermission === draftState.currentTeam || isAdmin);

                        const isClickable = canBan || canPick;

                        return (
                            <div
                                key={amiko.id}
                                data-element={amiko.element}
                                className={`amiko-card ${pickVisible ? 'picked' : ''} ${banned ? 'banned' : ''} ${isClickable ? 'selectable' : ''} ${handlers.hoveredCard === amiko.id ? 'parallax-active' : ''} ${handlers.localBanSelection === amiko.id ? 'ban-selected' : ''}`}
                                onClick={() => isClickable && handlers.pickAmiko(amiko.id)}
                                onMouseMove={(e) => isClickable && handlers.handleCardMouseMove(e, amiko.id)}
                                onMouseLeave={handlers.handleCardMouseLeave}
                                style={isClickable ? handlers.getCardTransform(amiko.id) : {}}
                            >
                                <img src={amiko.image} alt={amiko.name} />
                                <span className="amiko-name">{amiko.name}</span>
                                {pickVisible && <div className="picked-overlay">✓</div>}
                                {banned && <div className="banned-overlay">🚫</div>}
                            </div>
                        );
                    })}
                </div>
            </div>

            {renderTeamPanel('B')}
        </>
    );
};

export default Mode1Draft;