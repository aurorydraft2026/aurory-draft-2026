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
        setShowLineupPreview,
        // 1v1 inline overlay handlers
        handleSelfRemove,
        lockRoll,
        selectTurnOrder,
        showLockConfirmation,
        confirmLockPicks,
        cancelLockConfirmation,
        currentTimerDisplay,
        walletBalance,
        formatAuryAmount,
        showRoulette,
        roulettePhase,
        getCurrentPhasePicks
    } = handlers;

    const {
        getTeamDisplayName,
        getTeamLeader,
        copyToClipboard,
        getUserProfilePicture,
        DEFAULT_AVATAR
    } = utils;

    const currentPhaseConfig = getPICK_ORDER('mode4')[draftState.currentPhase || 0];
    const isBanPhase = currentPhaseConfig?.isBan || false;
    const isPickPhase = !isBanPhase && draftState.status === 'active';
    const isAdmin = userPermission === 'admin' || isSuperAdmin(getUserEmail(user));
    const bannedAmikos = draftState.bannedAmikos || [];
    const timerExpired = draftState.status === 'active' && currentTimerDisplay === '00:00:00';

    // Helper: Check if current user is a participant
    const isParticipant = user && draftState.preAssignedTeams && (
        user.uid === draftState.preAssignedTeams.team1?.leader ||
        user.uid === draftState.preAssignedTeams.team2?.leader
    );
    const isTeam1Leader = user && user.uid === draftState.preAssignedTeams?.team1?.leader;
    const isTeam2Leader = user && user.uid === draftState.preAssignedTeams?.team2?.leader;

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
                        draftState.status === 'active' && !draftState.awaitingLockConfirmation && !timerExpired && !isNoBan;

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
                        draftState.status === 'active' && !draftState.awaitingLockConfirmation && !timerExpired;

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

    // ─── PLAYER PANEL ───
    const renderPlayerPanel = (team) => {
        const isTeamA = team === 'A';
        const teamColor = isTeamA ? (draftState.teamColors?.teamA || 'blue') : (draftState.teamColors?.teamB || 'red');
        const leader = getTeamLeader(team);
        const teamBanner = isTeamA
            ? (draftState.teamColors?.teamA === 'blue' ? draftState.teamBanners?.team1 : draftState.teamBanners?.team2)
            : (draftState.teamColors?.teamB === 'blue' ? draftState.teamBanners?.team1 : draftState.teamBanners?.team2);

        const leaderImage = leader ? (getUserProfilePicture ? getUserProfilePicture(leader) : (leader.photoURL || DEFAULT_AVATAR)) : DEFAULT_AVATAR;
        const playerBanner = teamBanner || leaderImage;
        const isCurrentTeam = draftState.currentTeam === team && draftState.status === 'active';

        return (
            <div className={`team-panel team-${teamColor} ${isCurrentTeam ? 'active-turn' : ''}`}>
                <div className="team-banner-circle">
                    <img
                        src={playerBanner}
                        alt={getTeamDisplayName(team)}
                        onError={(e) => { e.target.onerror = null; e.target.src = DEFAULT_AVATAR || 'https://cdn.discordapp.com/embed/avatars/0.png'; }}
                    />
                </div>
                <h2 className={`team-heading team-${teamColor}-heading`}>
                    {getTeamDisplayName(team)}
                </h2>

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
        let myTeam = userPermission === 'A' ? 'A' : userPermission === 'B' ? 'B' : null;
        if (!myTeam && (userPermission === 'admin' || isSuperAdmin(getUserEmail(user)))) {
            if (draftState.preAssignedTeams?.team1?.leader === user?.uid) myTeam = 'A';
            else if (draftState.preAssignedTeams?.team2?.leader === user?.uid) myTeam = 'B';
        }

        const myPicks = myTeam === 'A' ? displayTeamA : myTeam === 'B' ? displayTeamB : [];
        const opponentPicks = myTeam === 'A' ? displayTeamB : myTeam === 'B' ? displayTeamA : [];
        const isPickedByMe = myPicks.includes(amiko.id);
        const isPickedByOpponent = opponentPicks.includes(amiko.id);
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
                const myBannedElements = myBans.map(id => AMIKOS.find(a => a.id === id)?.element).filter(Boolean);
                const wouldDuplicateElement = myBannedElements.includes(amiko.element);

                canPick = isMyTurn && !phaseComplete && !draftState.awaitingLockConfirmation &&
                    !timerExpired && myBans.length < 3 && !wouldDuplicateElement && (myTeam !== null);

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
                    !timerExpired && (myTeam !== null);
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

    // ─── COIN FLIP INLINE OVERLAY ───
    const renderCoinFlipOverlay = () => {
        if (draftState.status !== 'coinFlip' || !draftState.coinFlip) return null;

        const p1Name = draftState.teamNames?.team1 || 'Player 1';
        const p2Name = draftState.teamNames?.team2 || 'Player 2';

        return (
            <div className="inline-overlay coinflip-inline-overlay">
                <div className="inline-overlay-content">
                    <h3>🪙 Coin Flip</h3>

                    {/* 3D Coin Display */}
                    {draftState.coinFlip.phase !== 'rolling' && (
                        <div className="coin-display coin-display-inline">
                            <div className={`coin-3d ${draftState.coinFlip.phase === 'spinning' ? 'spinning-fast' : 'spinning-slow'} ${draftState.coinFlip.phase === 'result' || draftState.coinFlip.phase === 'turnChoice' || draftState.coinFlip.phase === 'done' ? 'stopped' : ''}`}
                                data-result={draftState.coinFlip.result}>
                                <div className="coin-face-3d blue-face has-banner">
                                    <img
                                        src={(() => {
                                            const leaderUid = draftState.preAssignedTeams?.team1?.leader;
                                            if (!leaderUid) return DEFAULT_AVATAR;
                                            const foundUser = handlers.registeredUsers?.find(u => (u.uid || u.id) === leaderUid);
                                            if (foundUser && getUserProfilePicture) return getUserProfilePicture(foundUser);
                                            if (user && user.uid === leaderUid && getUserProfilePicture) return getUserProfilePicture(user);
                                            return DEFAULT_AVATAR;
                                        })()}
                                        alt={p1Name}
                                        className="coin-profile-img"
                                        onError={(e) => { e.target.onerror = null; e.target.src = DEFAULT_AVATAR; }}
                                    />
                                </div>
                                {[...Array(12)].map((_, i) => (
                                    <div key={i} className="coin-thickness" style={{ transform: `translateZ(${5.5 - i}px)` }}></div>
                                ))}
                                <div className="coin-face-3d red-face has-banner">
                                    <img
                                        src={(() => {
                                            const leaderUid = draftState.preAssignedTeams?.team2?.leader;
                                            if (!leaderUid) return DEFAULT_AVATAR;
                                            const foundUser = handlers.registeredUsers?.find(u => (u.uid || u.id) === leaderUid);
                                            if (foundUser && getUserProfilePicture) return getUserProfilePicture(foundUser);
                                            if (user && user.uid === leaderUid && getUserProfilePicture) return getUserProfilePicture(user);
                                            return DEFAULT_AVATAR;
                                        })()}
                                        alt={p2Name}
                                        className="coin-profile-img"
                                        onError={(e) => { e.target.onerror = null; e.target.src = DEFAULT_AVATAR; }}
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Rolling Phase */}
                    {draftState.coinFlip.phase === 'rolling' && (
                        <div className="roll-section">
                            <p className="roll-instruction">Please confirm to start the coin flip.</p>
                            <div className="roll-status">
                                <div className={`roll-status-item ${draftState.coinFlip.team1Locked ? 'locked' : ''}`}>
                                    <span className="player-color blue">🔵 {p1Name}</span>
                                    <span className={`lock-status ${draftState.coinFlip.team1Locked ? 'locked' : 'waiting'}`}>
                                        {draftState.coinFlip.team1Locked ? '✓ Ready' : 'Waiting...'}
                                    </span>
                                </div>
                                <div className={`roll-status-item ${draftState.coinFlip.team2Locked ? 'locked' : ''}`}>
                                    <span className="player-color red">🔴 {p2Name}</span>
                                    <span className={`lock-status ${draftState.coinFlip.team2Locked ? 'locked' : 'waiting'}`}>
                                        {draftState.coinFlip.team2Locked ? '✓ Ready' : 'Waiting...'}
                                    </span>
                                </div>
                            </div>

                            {/* Entry fee notice */}
                            {user && !draftState.isFriendly && (draftState.entryFee || 0) > 0 && !draftState.entryPaid?.[user.uid] && isParticipant && (
                                <div className="entry-fee-notice">
                                    <p>💰 Entry Fee: <strong>{formatAuryAmount(draftState.entryFee)} AURY</strong></p>
                                    <p className="fee-balance">Your Balance: {formatAuryAmount(walletBalance)} AURY</p>
                                    {walletBalance < draftState.entryFee && (
                                        <p className="fee-insufficient">⚠️ Insufficient balance</p>
                                    )}
                                </div>
                            )}

                            {/* Confirm button */}
                            {user && (
                                (isTeam1Leader && !draftState.coinFlip.team1Locked) ||
                                (isTeam2Leader && !draftState.coinFlip.team2Locked)
                            ) && (
                                    <button className="roll-btn" onClick={lockRoll}
                                        disabled={!draftState.isFriendly && (draftState.entryFee || 0) > 0 && !draftState.entryPaid?.[user.uid] && walletBalance < draftState.entryFee}
                                    >
                                        Confirm
                                    </button>
                                )}

                            {/* Already confirmed */}
                            {user && (
                                (isTeam1Leader && draftState.coinFlip.team1Locked) ||
                                (isTeam2Leader && draftState.coinFlip.team2Locked)
                            ) && (
                                    <p className="locked-message">✓ Confirmed! Waiting for opponent...</p>
                                )}

                            {/* Self-remove button */}
                            {isParticipant && (
                                <button className="self-remove-btn inline-self-remove" onClick={handleSelfRemove}>
                                    🚪 Leave Match
                                </button>
                            )}
                        </div>
                    )}

                    {/* Spinning Phase */}
                    {draftState.coinFlip.phase === 'spinning' && (
                        <div className="spinning-section">
                            <p className="spin-text">Flipping...</p>
                        </div>
                    )}

                    {/* Result Phase */}
                    {draftState.coinFlip.phase === 'result' && (
                        <div className="coin-result">
                            <p className={`winner-text ${draftState.coinFlip.result}`}>
                                🎉 {draftState.coinFlip.winner === 1 ? p1Name : p2Name} wins the flip!
                            </p>
                        </div>
                    )}

                    {/* Turn Choice Phase */}
                    {draftState.coinFlip.phase === 'turnChoice' && (
                        <div className="turn-choice">
                            <p className={`winner-banner ${draftState.coinFlip.result}`}>
                                🏆 {draftState.coinFlip.winner === 1 ? p1Name : p2Name} won the coin flip!
                            </p>
                            <p className="choice-text">
                                {user && (
                                    (draftState.coinFlip.winner === 1 && isTeam1Leader) ||
                                    (draftState.coinFlip.winner === 2 && isTeam2Leader)
                                ) ? (
                                    <>Choose your advantage:</>
                                ) : (
                                    <>Waiting for winner to choose...</>
                                )}
                            </p>
                            {user && (
                                (draftState.coinFlip.winner === 1 && isTeam1Leader) ||
                                (draftState.coinFlip.winner === 2 && isTeam2Leader)
                            ) && (
                                    <div className="turn-choice-buttons">
                                        <button className="turn-choice-btn first-pick" onClick={() => selectTurnOrder('first')}>
                                            1️⃣ 1st Ban
                                        </button>
                                        <button className="turn-choice-btn second-pick" onClick={() => selectTurnOrder('second')}>
                                            2️⃣ 1st Pick
                                        </button>
                                    </div>
                                )}
                        </div>
                    )}

                    {/* Done Phase */}
                    {draftState.coinFlip.phase === 'done' && (
                        <div className="coin-done-simple">
                            <p>🚀 Starting draft...</p>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    // ─── LOCK CONFIRMATION INLINE OVERLAY ───
    const renderLockConfirmationOverlay = () => {
        if (!showLockConfirmation) return null;
        const phaseConfig = getPICK_ORDER('mode4')[draftState.currentPhase];
        const isBan = phaseConfig?.isBan;

        return (
            <div className="inline-overlay lock-confirm-inline-overlay">
                <div className="inline-overlay-content">
                    <h3>{isBan ? '🚫 Confirm Your Bans' : '🔒 Confirm Your Picks'}</h3>

                    <div className={`modal-timer ${currentTimerDisplay === '00:00:00' ? 'expired' : ''}`}>
                        ⏱️ Time: <strong>{currentTimerDisplay === '00:00:00' ? 'EXPIRED' : currentTimerDisplay}</strong>
                    </div>

                    <div className="phase-picks-preview">
                        <div className="picks-grid">
                            {getCurrentPhasePicks().map((amikoId, index) => {
                                if (amikoId === 'no_ban') {
                                    return (
                                        <div key={index} className="preview-pick no-ban-preview">
                                            <span>No Ban</span>
                                        </div>
                                    );
                                }
                                const amiko = AMIKOS.find(a => a.id === amikoId);
                                return (
                                    <div key={index} className="preview-pick">
                                        {amiko?.element && (
                                            <span className="picked-element-icon" title={amiko.element}>
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

                    {currentTimerDisplay !== '00:00:00' && (
                        <p className="auto-lock-notice">🔄 Auto-lock when timer expires</p>
                    )}

                    <div className="inline-overlay-actions">
                        <button
                            onClick={confirmLockPicks}
                            className={`confirm-lock-btn ${currentTimerDisplay === '00:00:00' ? 'disabled' : ''}`}
                            disabled={currentTimerDisplay === '00:00:00'}
                        >
                            ✓ Confirm & Lock
                        </button>
                        <button
                            onClick={cancelLockConfirmation}
                            className={`cancel-lock-btn ${currentTimerDisplay === '00:00:00' ? 'disabled' : ''}`}
                            disabled={currentTimerDisplay === '00:00:00'}
                        >
                            ← Change {isBan ? 'Bans' : 'Picks'}
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    // ─── ROULETTE INLINE OVERLAY ───
    const renderRouletteOverlay = () => {
        if (!showRoulette) return null;
        const p1Name = draftState.teamNames?.team1 || 'Player 1';
        const p2Name = draftState.teamNames?.team2 || 'Player 2';

        return (
            <div className="inline-overlay roulette-inline-overlay">
                <div className="inline-overlay-content">
                    <h3>⚔️ Match Starting</h3>
                    {draftState.coinFlip?.phase === 'done' && (
                        <div className="coin-done-detailed in-roulette">
                            <div className="winner-summary">
                                <h4>{draftState.coinFlip.winner === 1 ? p1Name : p2Name}</h4>
                                <p className="choice-summary">
                                    chooses {draftState.coinFlip.winnerTurnChoice === 'first' ? '1st Ban' : '1st Pick'}
                                </p>
                            </div>
                        </div>
                    )}
                    {roulettePhase === 'done' && (
                        <div className="roulette-done">
                            <p>🚀 Starting draft...</p>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    return (
        <>
            {renderPlayerPanel('A')}

            <div className="amiko-selection-wrapper">
                {/* Coin Flip Inline Overlay */}
                {renderCoinFlipOverlay()}

                {/* Roulette Inline Overlay */}
                {renderRouletteOverlay()}

                {/* Lock Confirmation Inline Overlay */}
                {renderLockConfirmationOverlay()}

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

                <div className={`amiko-grid ${draftState.status === 'completed' ? 'dimmed' : ''} ${timerExpired ? 'dimmed' : ''}`}>
                    {timerExpired && (
                        <div className="preparation-overlay timer-expired-overlay">
                            <div className="prep-spinner"></div>
                            <p>⏱️ Time's up! Auto-locking selections...</p>
                        </div>
                    )}
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

            {renderPlayerPanel('B')}
        </>
    );
};

export default Mode4Draft;