import { resolveDisplayName } from '../utils/userUtils';
import './MatchResultsBoard.css';

const MatchResultsBoard = ({
    draftState,
    isVerifying,
    handleVerifyMatch,
    handleConcedeBattle,
    getTeamDisplayName,
    isParticipantOrAdmin,
    user,
    getUserEmail,
    isCreator,
    isSuperAdmin,
    AMIKOS
}) => {
    const is3v3 = draftState.draftType === 'mode1' || draftState.draftType === 'mode2';
    const isSA = user && isSuperAdmin(getUserEmail(user));
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
                        {(() => {
                            // For 3v3, ensure we always show 3 battle cards
                            const battleCards = is3v3
                                ? [0, 1, 2].map(i => matchResults.find(r => r.battleIndex === i) || { battleIndex: i, status: 'not_found', _placeholder: true })
                                : matchResults;

                            return battleCards.map((battle, index) => {
                                const isUnresolved = ['not_found', 'error'].includes(battle.status) || battle._placeholder;
                                const battleIdx = battle.battleIndex ?? index;

                                // Get player names for concede buttons
                                const teamAPlayers = (draftState.matchPlayers || []).filter(p => p.team === 'A');
                                const teamBPlayers = (draftState.matchPlayers || []).filter(p => p.team === 'B');
                                const pA = teamAPlayers[battleIdx];
                                const pB = teamBPlayers[battleIdx];

                                return (
                                    <div key={battleIdx} className={`battle-result-card ${battle.status}`}>
                                        <div className="battle-result-header">
                                            <span className="battle-label">
                                                {(draftState.draftType === 'mode3' || draftState.draftType === 'mode4') ? 'Match' : `Battle ${battleIdx + 1}`}
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
                                            <div className={`battle-player ${battle.winner === 'A' ? 'winner' : battle.winner ? 'loser' : ''}`}>
                                                <span className="player-outcome">{battle.winner === 'A' ? '🏆' : battle.winner ? '💀' : '⏳'}</span>
                                                <div className="player-info">
                                                    <span className="player-name">{battle.playerA?.displayName || resolveDisplayName(pA) || getTeamDisplayName('A')}</span>
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
                                            <div className={`battle-player ${battle.winner === 'B' ? 'winner' : battle.winner ? 'loser' : ''}`}>
                                                <span className="player-outcome">{battle.winner === 'B' ? '🏆' : battle.winner ? '💀' : '⏳'}</span>
                                                <div className="player-info">
                                                    <span className="player-name">{battle.playerB?.displayName || resolveDisplayName(pB) || getTeamDisplayName('B')}</span>
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

                                        {isUnresolved && (
                                            <div className="pending-message">
                                                Waiting for match to be played in-game...
                                            </div>
                                        )}

                                        {/* Per-battle concede buttons for 3v3 (admin only) */}
                                        {is3v3 && isUnresolved && isSA && handleConcedeBattle && !overallWinner && (
                                            <div className="battle-concede-controls">
                                                <button
                                                    className="battle-concede-btn team-A"
                                                    onClick={() => handleConcedeBattle(battleIdx, 'A')}
                                                    title={`Concede this battle for ${resolveDisplayName(pA) || 'Team A'}`}
                                                >
                                                    🏳️ Concede {resolveDisplayName(pA) || getTeamDisplayName('A')}
                                                </button>
                                                <button
                                                    className="battle-concede-btn team-B"
                                                    onClick={() => handleConcedeBattle(battleIdx, 'B')}
                                                    title={`Concede this battle for ${resolveDisplayName(pB) || 'Team B'}`}
                                                >
                                                    🏳️ Concede {resolveDisplayName(pB) || getTeamDisplayName('B')}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                );
                            });
                        })()}
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
