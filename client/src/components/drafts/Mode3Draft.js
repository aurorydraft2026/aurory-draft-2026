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
        shuffleHighlights,
        // 1v1 inline overlay handlers
        handleSelfRemove,
        lockRoll,
        showRoulette,
        roulettePhase,
        walletBalance,
        formatAuryAmount
    } = handlers;

    const {
        getTeamDisplayName,
        getTeamLeader,
        copyToClipboard,
        getUserProfilePicture,
        DEFAULT_AVATAR
    } = utils;

    // Helper: Check if current user is a participant
    const isParticipant = user && draftState.preAssignedTeams && (
        user.uid === draftState.preAssignedTeams.team1?.leader ||
        user.uid === draftState.preAssignedTeams.team2?.leader
    );
    const isTeam1Leader = user && user.uid === draftState.preAssignedTeams?.team1?.leader;
    const isTeam2Leader = user && user.uid === draftState.preAssignedTeams?.team2?.leader;

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

    const renderPlayerPanel = (team) => {
        const isTeamA = team === 'A';
        const teamColor = isTeamA ? (draftState.teamColors?.teamA || 'blue') : (draftState.teamColors?.teamB || 'red');
        const displayPicks = isTeamA ? displayTeamA : displayTeamB;
        const leader = getTeamLeader(team);
        const teamBanner = isTeamA
            ? (draftState.teamColors?.teamA === 'blue' ? draftState.teamBanners?.team1 : draftState.teamBanners?.team2)
            : (draftState.teamColors?.teamB === 'blue' ? draftState.teamBanners?.team1 : draftState.teamBanners?.team2);

        const leaderImage = leader ? (getUserProfilePicture ? getUserProfilePicture(leader) : (leader.photoURL || DEFAULT_AVATAR)) : DEFAULT_AVATAR;
        const playerBanner = teamBanner || leaderImage;


        return (
            <div className={`team-panel team-${teamColor}`}>
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
                <div className="team-picks-container">
                    {renderPlayerSection(team, displayPicks)}
                </div>

                {/* Lock Button - Participant Only */}
                {userPermission === team && (
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

    // ─── COIN FLIP INLINE OVERLAY (Mode3 = readiness check) ───
    const renderCoinFlipOverlay = () => {
        if (draftState.status !== 'coinFlip' || !draftState.coinFlip) return null;

        const p1Name = draftState.teamNames?.team1 || 'Player 1';
        const p2Name = draftState.teamNames?.team2 || 'Player 2';

        return (
            <div className="inline-overlay coinflip-inline-overlay">
                <div className="inline-overlay-content">
                    <h3>✅ Ready Check</h3>

                    {/* Rolling Phase - Readiness check */}
                    {draftState.coinFlip.phase === 'rolling' && (
                        <div className="roll-section">
                            <p className="roll-instruction">Confirm when you are ready to start the draft.</p>

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

                            {/* Ready button */}
                            {user && (
                                (isTeam1Leader && !draftState.coinFlip.team1Locked) ||
                                (isTeam2Leader && !draftState.coinFlip.team2Locked)
                            ) && (
                                    <button className="roll-btn" onClick={lockRoll}
                                        disabled={!draftState.isFriendly && (draftState.entryFee || 0) > 0 && !draftState.entryPaid?.[user.uid] && walletBalance < draftState.entryFee}
                                    >
                                        I'm Ready
                                    </button>
                                )}

                            {/* Already confirmed */}
                            {user && (
                                (isTeam1Leader && draftState.coinFlip.team1Locked) ||
                                (isTeam2Leader && draftState.coinFlip.team2Locked)
                            ) && (
                                    <p className="locked-message">✓ You are ready! Waiting for opponent...</p>
                                )}

                            {/* Self-remove button */}
                            {isParticipant && (
                                <button className="self-remove-btn inline-self-remove" onClick={handleSelfRemove}>
                                    🚪 Leave Match
                                </button>
                            )}
                        </div>
                    )}

                    {/* Done/Starting phase */}
                    {draftState.coinFlip.phase !== 'rolling' && (
                        <div className="coin-done-simple">
                            <p>🚀 Starting draft...</p>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    // ─── ROULETTE INLINE OVERLAY ───
    const renderRouletteOverlay = () => {
        if (!showRoulette) return null;

        return (
            <div className="inline-overlay roulette-inline-overlay">
                <div className="inline-overlay-content">
                    <h3>⚔️ Match Starting</h3>
                    {roulettePhase === 'scrambling' && (
                        <p className="scramble-text">🎲 Shuffling Amiko Pools...</p>
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

                {/* Preparation overlay */}
                {(handlers.showPreparation || draftState.inPreparation) && (userPermission === 'A' || userPermission === 'B') && (
                    <div className="preparation-overlay">
                        <div className="preparation-content">
                            <span>⏳ {getTeamDisplayName(handlers.nextTeamAfterPrep || draftState.currentTeam)}'s turn starting...</span>
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
                                let userTeam = userPermission === 'A' ? 'A' : userPermission === 'B' ? 'B' : null;
                                if (!userTeam && userPermission === 'admin') {
                                    if (draftState.preAssignedTeams?.team1?.leader === user?.uid) userTeam = 'A';
                                    else if (draftState.preAssignedTeams?.team2?.leader === user?.uid) userTeam = 'B';
                                }

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
                                        isSelectable = false;
                                    } else if (draftState.playerBPool?.includes(amiko.id)) {
                                        mode3Class = 'team-b-pool';
                                        isSelectable = false;
                                    } else {
                                        mode3Class = 'unassigned';
                                        isSelectable = false;
                                    }
                                }
                            }
                        }

                        // Derive effective team for pickability if user is an admin participant
                        let effectivePermission = userPermission;
                        if (effectivePermission === 'admin') {
                            if (draftState.preAssignedTeams?.team1?.leader === user?.uid) effectivePermission = 'A';
                            else if (draftState.preAssignedTeams?.team2?.leader === user?.uid) effectivePermission = 'B';
                        }

                        const canPick = user &&
                            draftState.status === 'active' &&
                            !pickVisible &&
                            !draftState.awaitingLockConfirmation &&
                            isSelectable &&
                            (draftState.simultaneousPicking || effectivePermission === draftState.currentTeam);

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
                                <img src={amiko.image} alt={amiko.name} />
                                <span className="amiko-name">{amiko.name}</span>
                                {pickVisible && <div className="picked-overlay">✓</div>}
                            </div>
                        );
                    })}
                </div>
            </div>

            {renderPlayerPanel('B')}
        </>
    );
};

export default Mode3Draft;