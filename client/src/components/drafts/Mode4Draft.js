import React from 'react';
import { AMIKOS, ELEMENTS, getPICK_ORDER } from '../../data/amikos';

const Mode4Draft = ({
    draftState,
    user,
    userPermission,
    displayTeamA,
    displayTeamB,
    displayTeamABans,
    displayTeamBBans,
    tempPick,
    handlers,
    utils
}) => {
    const {
        removeAmiko,
        removeBan,
        isPickLocked,
        isBanLocked,
        isSuperAdmin,
        getUserEmail,
        pickAmiko,
        handleCardMouseMove,
        handleCardMouseLeave,
        getCardTransform,
        hoveredCard,
        showPreparation,
        nextTeamAfterPrep,
        setShowLineupPreview
    } = handlers;

    const {
        getTeamDisplayName,
        getTeamLeader,
        copyToClipboard
    } = utils;

    const isAdmin = userPermission === 'admin' || isSuperAdmin(getUserEmail(user));
    const currentPhaseConfig = getPICK_ORDER('mode4')[draftState.currentPhase || 0];
    const isBanPhase = currentPhaseConfig?.isBan || false;
    const isPickPhase = !isBanPhase && draftState.status === 'active';
    const bannedAmikos = draftState.bannedAmikos || [];

    // ─── BAN SLOTS ───
    const renderBanSlots = (team) => {
        const bans = team === 'A' ? displayTeamABans : displayTeamBBans;
        const isMyTeam = userPermission === team;
        const isCurrentTurn = draftState.currentTeam === team && isBanPhase;

        return (
            <div className="mode4-ban-slots">
                {[0, 1, 2].map(i => {
                    const amikoId = bans[i];
                    const isNoBan = amikoId === 'no_ban';
                    const amiko = amikoId && !isNoBan ? AMIKOS.find(a => a.id === amikoId) : null;
                    const locked = isBanLocked?.(team, i) || false;
                    const canRemove = isMyTeam && isCurrentTurn && !locked && (amiko || isNoBan) &&
                        draftState.status === 'active' && !draftState.awaitingLockConfirmation && !isNoBan;

                    if (!amiko && !isNoBan) {
                        return (
                            <div key={i} className={`mode4-ban-slot empty ${isCurrentTurn ? 'awaiting' : ''}`}>
                                <span className="ban-slot-icon">🚫</span>
                            </div>
                        );
                    }

                    if (isNoBan) {
                        return (
                            <div key={i} className="mode4-ban-slot filled no-ban-slot">
                                <span className="no-ban-text">No Ban</span>
                                {locked && <div className="ban-lock-icon">🔒</div>}
                            </div>
                        );
                    }

                    return (
                        <div
                            key={i}
                            className={`mode4-ban-slot filled ${canRemove ? 'removable' : ''} ${locked ? 'locked' : ''}`}
                            onClick={() => canRemove && removeBan(team, i)}
                            title={canRemove ? 'Click to remove ban' : amiko.name}
                        >
                            <img src={amiko.image} alt={amiko.name} />
                            <div className="ban-x-mark">✕</div>
                            <span className="ban-slot-name">{amiko.name}</span>
                            {amiko.element && (
                                <span className="ban-element-tag" title={amiko.element}>
                                    {ELEMENTS[amiko.element]?.icon}
                                </span>
                            )}
                            {canRemove && <div className="ban-undo-icon">↩</div>}
                            {locked && <div className="ban-lock-icon">🔒</div>}
                            {amikoId === tempPick?.id && <div className="loading-spinner-overlay">⌛</div>}
                        </div>
                    );
                })}
            </div>
        );
    };

    // ─── PICK SLOTS ───
    const renderPickSlots = (team) => {
        const picks = team === 'A' ? displayTeamA : displayTeamB;
        const isMyTeam = userPermission === team;
        const isCurrentTurn = draftState.currentTeam === team && isPickPhase;

        return (
            <div className="mode4-pick-slots">
                {[0, 1, 2].map(i => {
                    const amikoId = picks[i];
                    const amiko = amikoId ? AMIKOS.find(a => a.id === amikoId) : null;
                    const locked = isPickLocked(team, i);
                    const canRemove = isMyTeam && isCurrentTurn && !locked && amiko &&
                        draftState.status === 'active' && !draftState.awaitingLockConfirmation;

                    if (!amiko) {
                        return (
                            <div key={i} className={`mode4-pick-slot empty ${isCurrentTurn ? 'awaiting' : ''}`}>
                                <span className="pick-slot-icon">?</span>
                            </div>
                        );
                    }

                    return (
                        <div
                            key={i}
                            className={`mode4-pick-slot filled ${canRemove ? 'removable' : ''} ${locked ? 'locked' : ''}`}
                            onClick={() => canRemove && removeAmiko(team, i)}
                            title={canRemove ? 'Click to remove' : amiko.name}
                        >
                            {amiko.element && (
                                <span className="pick-element-icon" title={amiko.element}>
                                    {ELEMENTS[amiko.element]?.icon}
                                </span>
                            )}
                            <img src={amiko.image} alt={amiko.name} />
                            <span className="pick-slot-name">{amiko.name}</span>
                            {canRemove && <div className="pick-remove-icon">✕</div>}
                            {locked && <div className="pick-lock-icon">🔒</div>}
                            {amikoId === tempPick?.id && <div className="loading-spinner-overlay">⌛</div>}
                        </div>
                    );
                })}
            </div>
        );
    };

    // ─── TEAM PANEL ───
    const renderTeamPanel = (team) => {
        const isTeamA = team === 'A';
        const teamColor = isTeamA ? (draftState.teamColors?.teamA || 'blue') : (draftState.teamColors?.teamB || 'red');
        const leader = getTeamLeader(team);
        const teamBanner = isTeamA
            ? (draftState.teamColors?.teamA === 'blue' ? draftState.teamBanners?.team1 : draftState.teamBanners?.team2)
            : (draftState.teamColors?.teamB === 'blue' ? draftState.teamBanners?.team1 : draftState.teamBanners?.team2);

        const isCurrentTeam = draftState.currentTeam === team && draftState.status === 'active';

        return (
            <div className={`team-panel team-${teamColor} ${isCurrentTeam ? 'active-turn' : ''}`}>
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

                {/* Ban Zone */}
                <div className="mode4-zone mode4-ban-zone">
                    <div className="mode4-zone-label">🚫 Bans</div>
                    {renderBanSlots(team)}
                </div>

                {/* Pick Zone */}
                <div className={`mode4-zone mode4-pick-zone ${isBanPhase ? 'zone-dimmed' : ''}`}>
                    <div className="mode4-zone-label">⚔️ Picks</div>
                    {renderPickSlots(team)}
                </div>
            </div>
        );
    };

    // ─── GRID LOGIC ───
    const getCardState = (amiko) => {
        const isBanned = bannedAmikos.includes(amiko.id);
        const myTeam = userPermission === 'A' ? 'A' : userPermission === 'B' ? 'B' : null;
        const myPicks = myTeam === 'A' ? displayTeamA : myTeam === 'B' ? displayTeamB : [];
        const opponentPicks = myTeam === 'A' ? displayTeamB : myTeam === 'B' ? displayTeamA : [];
        const isPickedByMe = myPicks.includes(amiko.id);
        const isPickedByOpponent = opponentPicks.includes(amiko.id);

        // My bans
        const myBans = myTeam === 'A' ? displayTeamABans : myTeam === 'B' ? displayTeamBBans : [];

        let canPick = false;
        let cardClass = '';
        let overlay = null;

        if (isBanPhase && draftState.status === 'active') {
            if (isBanned) {
                cardClass = 'mode4-banned';
                overlay = <div className="picked-overlay ban-overlay">🚫</div>;
            } else {
                const isMyTurn = draftState.currentTeam === myTeam;
                const currentPhaseCount = currentPhaseConfig?.count || 0;
                const picksInPhase = draftState.picksInPhase || 0;
                const phaseComplete = picksInPhase >= currentPhaseCount;

                // Element constraint: each player's 3 bans must be different elements
                const myBannedElements = myBans.map(id => AMIKOS.find(a => a.id === id)?.element).filter(Boolean);
                const wouldDuplicateElement = myBannedElements.includes(amiko.element);

                canPick = isMyTurn && !phaseComplete && !draftState.awaitingLockConfirmation &&
                    myBans.length < 3 && !wouldDuplicateElement && (myTeam !== null || isAdmin);

                if (wouldDuplicateElement && isMyTurn && !isBanned) {
                    cardClass = 'mode4-element-blocked';
                }
            }
        } else if (isPickPhase) {
            if (isBanned) {
                cardClass = 'mode4-banned';
                overlay = <div className="picked-overlay ban-overlay">🚫</div>;
            } else if (isPickedByMe) {
                cardClass = 'mode4-picked-by-me';
                overlay = <div className="picked-overlay">✓</div>;
            } else if (isPickedByOpponent) {
                cardClass = 'mode4-picked-by-opponent';
            }

            if (!isBanned && !isPickedByMe) {
                const isMyTurn = draftState.currentTeam === myTeam;
                const currentPhaseCount = currentPhaseConfig?.count || 0;
                const picksInPhase = draftState.picksInPhase || 0;
                const phaseComplete = picksInPhase >= currentPhaseCount;

                canPick = isMyTurn && !phaseComplete && !draftState.awaitingLockConfirmation &&
                    (myTeam !== null || isAdmin);
            }
        } else if (draftState.status === 'completed') {
            if (isBanned) {
                cardClass = 'mode4-banned';
                overlay = <div className="picked-overlay ban-overlay">🚫</div>;
            } else if (isPickedByMe || isPickedByOpponent) {
                cardClass = isPickedByMe ? 'mode4-picked-by-me' : 'mode4-picked-by-opponent';
                overlay = <div className="picked-overlay">✓</div>;
            }
        }

        return { canPick, cardClass, overlay };
    };

    return (
        <>
            {renderTeamPanel('A')}

            <div className="amiko-selection-wrapper">
                {/* Preparation overlay */}
                {(showPreparation || draftState.inPreparation) && (userPermission === 'A' || userPermission === 'B') && (
                    <div className="preparation-overlay">
                        <div className="preparation-content">
                            <span>⏳ {getTeamDisplayName(nextTeamAfterPrep || draftState.currentTeam)}'s turn starting...</span>
                        </div>
                    </div>
                )}

                {/* Completed overlay */}
                {draftState.status === 'completed' && (
                    <div className="completed-overlay">
                        <div className="completed-content">
                            <h3>🏆 Draft Completed!</h3>
                            <p>All bans and picks have been locked in.</p>

                            {draftState.privateCode && (userPermission === 'A' || userPermission === 'B' || isAdmin) && (
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
                                onClick={() => setShowLineupPreview(true)}
                            >
                                ⚔️ Preview Final Lineup
                            </button>
                        </div>
                    </div>
                )}

                {/* Banned summary bar */}
                {bannedAmikos.length > 0 && (
                    <div className="mode4-banned-bar">
                        <span className="banned-bar-label">🚫 Banned ({bannedAmikos.filter(id => id !== 'no_ban').length}):</span>
                        <div className="banned-bar-icons">
                            {bannedAmikos.filter(id => id !== 'no_ban').map((id, i) => {
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

                <div className={`amiko-grid ${draftState.status === 'completed' ? 'dimmed' : ''}`}>
                    {AMIKOS.map((amiko) => {
                        const { canPick, cardClass, overlay } = getCardState(amiko);

                        return (
                            <div
                                key={amiko.id}
                                data-element={amiko.element}
                                className={`amiko-card ${cardClass} ${canPick ? 'selectable' : ''} ${hoveredCard === amiko.id ? 'parallax-active' : ''}`}
                                onClick={() => canPick && pickAmiko(amiko.id)}
                                onMouseMove={(e) => canPick && handleCardMouseMove(e, amiko.id)}
                                onMouseLeave={handleCardMouseLeave}
                                style={canPick ? getCardTransform(amiko.id) : {}}
                            >
                                <img src={amiko.image} alt={amiko.name} />
                                <span className="amiko-name">{amiko.name}</span>
                                {overlay}
                            </div>
                        );
                    })}
                </div>
            </div>

            {renderTeamPanel('B')}
        </>
    );
};

export default Mode4Draft;