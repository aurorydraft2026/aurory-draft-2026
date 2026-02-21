import React from 'react';
import './MatchResultsBoard.css';

const MatchResultsBoard = ({
    draftState,
    isVerifying,
    handleVerifyMatch,
    getTeamDisplayName,
    isParticipantOrAdmin,
    user,
    getUserEmail,
    isCreator,
    isSuperAdmin,
    AMIKOS
}) => {
    // Show if completed OR if we have results (partial verification)
    const hasResults = draftState.matchResults && draftState.matchResults.length > 0;

    if (draftState.status !== 'completed' && !hasResults) {
        return null;
    }

    const matchResults = draftState.matchResults || [];
    const overallWinner = draftState.overallWinner;

    // Helper to find Amiko by ID, apiId, or Name
    const findAmiko = (searchId) => {
        if (!searchId) return null;
        const normalized = searchId.toLowerCase().replace(/\s+/g, '-');
        return AMIKOS.find(a =>
            a.id === searchId ||
            a.id === normalized ||
            a.apiId === searchId ||
            a.apiId === `id_${searchId}_Basic` ||
            a.name.toLowerCase() === searchId.toLowerCase()
        );
    };

    return (
        <div className="match-verification-section">
            <div className="verification-header">
                <h3>📊 Match Results</h3>
                {(user && isSuperAdmin(getUserEmail(user))) && (
                    <button
                        onClick={handleVerifyMatch}
                        disabled={isVerifying}
                        className="verify-btn"
                    >
                        {isVerifying ? '⌛ Verifying...' : '🔄 Verify Now'}
                    </button>
                )}
            </div>

            {hasResults ? (
                <div className="verification-results">
                    {/* Winner Announcement */}
                    {overallWinner && (
                        <div className={`winner-announcement team-${overallWinner === 'A' ? 'blue' : overallWinner === 'B' ? 'red' : 'draw'}`}>
                            <span className="trophy">{overallWinner === 'draw' ? '🤝' : '🏆'}</span>
                            <span className="winner-text">
                                {overallWinner === 'draw'
                                    ? "Match Result: DRAW"
                                    : `${getTeamDisplayName(overallWinner)} WINS!`}
                            </span>
                            <span className="trophy">{overallWinner === 'draw' ? '🤝' : '🏆'}</span>
                        </div>
                    )}

                    <div className="battle-results-list">
                        {matchResults.map((battle, index) => (
                            <div key={index} className={`battle-result-card ${battle.status}`}>
                                <div className="battle-result-header">
                                    <span className="battle-label">
                                        {(draftState.draftType === 'mode3' || draftState.draftType === 'mode4') ? 'Match' : `Battle ${index + 1}`}
                                    </span>
                                    {battle.battleCode && (
                                        <span className="battle-code" title="Battle Code">
                                            #{battle.battleCode}
                                        </span>
                                    )}
                                    <div className={`battle-status status-${battle.status}`}>
                                        {battle.status === 'verified' ? '✓ Verified' :
                                            battle.status === 'not_found' ? '🔍 Pending' :
                                                battle.status === 'error' ? '⚠️ Error' :
                                                    battle.status === 'player_mismatch' ? '⛔ Wrong Player' :
                                                        battle.status === 'wrong_players' ? '⛔ Wrong Players' :
                                                            battle.status === 'conceded' ? '🏳️ Conceded' :
                                                                battle.status === 'conceded_A' ? '🏳️ Team A Conceded' :
                                                                    battle.status === 'conceded_B' ? '🏳️ Team B Conceded' :
                                                                        battle.status.startsWith('disqualified') ? '🚫 DQ' : '❓ Unknown'}
                                    </div>
                                </div>

                                <div className="battle-result-body">
                                    {/* Team A Player */}
                                    <div className={`battle-player ${battle.winner === 'A' ? 'winner' : 'loser'}`}>
                                        <span className="player-outcome">{battle.winner === 'A' ? '🏆' : '💀'}</span>
                                        <div className="player-info">
                                            <span className="player-name">{battle.playerA?.displayName || getTeamDisplayName('A')}</span>
                                            {battle.status === 'disqualified_A' && <span className="dq-badge">DQ</span>}

                                            {battle.playerA?.usedAmikos && (
                                                <div className="battle-amikos">
                                                    {battle.playerA.usedAmikos.map((amikoId, i) => {
                                                        const amiko = findAmiko(amikoId);
                                                        return amiko ? (
                                                            <img
                                                                key={i}
                                                                src={amiko.image}
                                                                alt={amiko.name}
                                                                className="battle-amiko-img"
                                                                title={amiko.name}
                                                            />
                                                        ) : (
                                                            <span key={i} className="unknown-amiko">?</span>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <div className="vs-divider">VS</div>

                                    {/* Team B Player */}
                                    <div className={`battle-player ${battle.winner === 'B' ? 'winner' : 'loser'}`}>
                                        <span className="player-outcome">{battle.winner === 'B' ? '🏆' : '💀'}</span>
                                        <div className="player-info">
                                            <span className="player-name">{battle.playerB?.displayName || getTeamDisplayName('B')}</span>
                                            {battle.status === 'disqualified_B' && <span className="dq-badge">DQ</span>}

                                            {battle.playerB?.usedAmikos && (
                                                <div className="battle-amikos">
                                                    {battle.playerB.usedAmikos.map((amikoId, i) => {
                                                        const amiko = findAmiko(amikoId);
                                                        return amiko ? (
                                                            <img
                                                                key={i}
                                                                src={amiko.image}
                                                                alt={amiko.name}
                                                                className="battle-amiko-img"
                                                                title={amiko.name}
                                                            />
                                                        ) : (
                                                            <span key={i} className="unknown-amiko">?</span>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {battle.disqualificationReason && (
                                    <div className="dq-reason">
                                        <strong>Reason:</strong> {battle.disqualificationReason}
                                    </div>
                                )}

                                {battle.status === 'not_found' && (
                                    <div className="pending-message">
                                        Waiting for match to be played in-game...
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="verification-pending">
                    <p>Match results are pending verification.</p>
                    <p className="verification-hint">Click "Verify Now" to fetch latest results from the Aurory API.</p>
                </div>
            )}
        </div>
    );
};

export default MatchResultsBoard;
