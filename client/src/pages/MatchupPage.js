import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db, auth } from '../firebase';
import { doc, onSnapshot, updateDoc, setDoc, arrayUnion, arrayRemove, deleteDoc, collection, getDocs, query, where, documentId, serverTimestamp } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { isUserSuperAdmin } from '../config/admins';
import JoinTeamModal from '../components/JoinTeamModal';
import { generateSingleElimination, generateRoundRobin } from '../utils/tournamentUtils';
import './MatchupPage.css';


const MatchupPage = () => {
    const { matchupId } = useParams();
    const navigate = useNavigate();
    const [matchup, setMatchup] = useState(null);
    const [participants, setParticipants] = useState([]);
    const [loading, setLoading] = useState(true);
    const [user, setUser] = useState(null);
    const [profile, setProfile] = useState(null);
    const [isAdmin, setIsAdmin] = useState(false);
    const [showJoinTeamModal, setShowJoinTeamModal] = useState(false);
    const [registeredUsers, setRegisteredUsers] = useState([]);
    const [activeTab, setActiveTab] = useState('matches');
    const [expandedRounds, setExpandedRounds] = useState({});

    useEffect(() => {
        const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
            if (currentUser) {
                const userRef = doc(db, 'users', currentUser.uid);
                onSnapshot(userRef, (docSnap) => {
                    if (docSnap.exists()) {
                        const userData = docSnap.data();
                        setProfile(userData);
                        const isStaff = isUserSuperAdmin(currentUser) || userData.role === 'admin' || userData.role === 'superadmin';
                        setIsAdmin(isStaff);
                    } else {
                        setIsAdmin(isUserSuperAdmin(currentUser));
                    }
                });
            } else {
                setProfile(null);
                setIsAdmin(false);
            }
        });

        const matchupRef = doc(db, 'matchups', matchupId);
        const unsubscribeMatchup = onSnapshot(matchupRef, (docSnap) => {
            if (docSnap.exists()) {
                setMatchup({ id: docSnap.id, ...docSnap.data() });
                setLoading(false);
            } else {
                setLoading(false);
            }
        }, (err) => {
            console.error('Error fetching matchup:', err);
            setLoading(false);
        });

        return () => {
            unsubscribeAuth();
            unsubscribeMatchup();
        };
    }, [matchupId]);

    useEffect(() => {
        if (matchup?.format === 'teams' && matchup?.status === 'waiting') {
            const fetchUsers = async () => {
                try {
                    const usersRef = collection(db, 'users');
                    const querySnapshot = await getDocs(usersRef);
                    const users = querySnapshot.docs.map(doc => ({
                        id: doc.id,
                        ...doc.data()
                    }));
                    setRegisteredUsers(users);
                } catch (err) {
                    console.error('Error fetching registered users:', err);
                }
            };
            fetchUsers();
        }
    }, [matchup?.format, matchup?.status]);

    useEffect(() => {
        if (matchup?.participants?.length > 0) {
            const fetchParticipants = async () => {
                try {
                    const realUids = (matchup.participantUids || []).filter(uid =>
                        typeof uid === 'string' && !uid.startsWith('mock-')
                    );

                    if (realUids.length === 0) {
                        setParticipants([]);
                        return;
                    }

                    const usersRef = collection(db, 'users');
                    const chunks = [];
                    for (let i = 0; i < realUids.length; i += 30) {
                        chunks.push(realUids.slice(i, i + 30));
                    }

                    const allUserData = [];
                    for (const chunk of chunks) {
                        const q = query(usersRef, where(documentId(), 'in', chunk));
                        const querySnapshot = await getDocs(q);
                        allUserData.push(...querySnapshot.docs.map(doc => ({
                            uid: doc.id,
                            ...doc.data()
                        })));
                    }

                    setParticipants(allUserData);
                } catch (err) {
                    console.error('Error fetching participants:', err);
                }
            };
            fetchParticipants();
        } else {
            setParticipants([]);
        }
    }, [matchup?.participants, matchup?.format, matchup?.participantUids]);

    const handleJoin = async () => {
        if (!user) return;
        if (matchup.participants.length >= matchup.maxParticipants) return;

        if (matchup.format === 'teams') {
            setShowJoinTeamModal(true);
            return;
        }

        try {
            const matchupRef = doc(db, 'matchups', matchupId);
            await updateDoc(matchupRef, {
                participants: arrayUnion(user.uid),
                participantUids: arrayUnion(user.uid)
            });
        } catch (err) {
            console.error('Error joining matchup:', err);
        }
    };

    const handleJoinTeam = async (teamData) => {
        try {
            const matchupRef = doc(db, 'matchups', matchupId);
            const uidsToAdd = [teamData.leader, ...teamData.members];
            await updateDoc(matchupRef, {
                participants: arrayUnion(teamData),
                participantUids: arrayUnion(...uidsToAdd)
            });
        } catch (err) {
            console.error('Error joining as team:', err);
            alert('Failed to join as team. Maybe it just filled up?');
        }
    };

    const handleLeave = async () => {
        if (!user) return;

        try {
            const matchupRef = doc(db, 'matchups', matchupId);
            if (matchup.format === 'teams') {
                const teamToLeave = matchup.participants.find(p =>
                    typeof p === 'object' && (p.leader === user.uid || p.members?.includes(user.uid))
                );

                if (teamToLeave) {
                    const updatedParticipants = matchup.participants.filter(p => p !== teamToLeave);
                    const uidsToRemove = [teamToLeave.leader, ...(teamToLeave.members || [])];
                    const updatedUids = (matchup.participantUids || []).filter(uid => !uidsToRemove.includes(uid));

                    await updateDoc(matchupRef, {
                        participants: updatedParticipants,
                        participantUids: updatedUids
                    });
                }
            } else {
                await updateDoc(matchupRef, {
                    participants: arrayRemove(user.uid),
                    participantUids: arrayRemove(user.uid)
                });
            }
        } catch (err) {
            console.error('Error leaving matchup:', err);
        }
    };

    const handleStart = async () => {
        if (!isAdmin) return;
        if (matchup.participants.length < 2) return;

        try {
            const matchupRef = doc(db, 'matchups', matchupId);
            let structure = [];
            if (matchup.tournamentType === 'single_elimination') {
                structure = generateSingleElimination(matchup.participants);
            } else if (matchup.tournamentType === 'round_robin') {
                structure = generateRoundRobin(matchup.participants);
            }

            await updateDoc(matchupRef, {
                status: 'active',
                matchupStructure: structure,
                startedAt: new Date()
            });
        } catch (err) {
            console.error('Error starting matchup:', err);
        }
    };

    const handleReportWinner = async (roundIndex, matchIndex, winnerId) => {
        if (!isAdmin || !winnerId) return;
        try {
            const newStructure = JSON.parse(JSON.stringify(matchup.matchupStructure));
            const currentMatch = newStructure[roundIndex].matches[matchIndex];
            currentMatch.winner = winnerId;

            if (matchup.tournamentType === 'single_elimination' && roundIndex < newStructure.length - 1) {
                const nextRound = newStructure[roundIndex + 1];
                const nextMatchIndex = Math.floor(matchIndex / 2);
                const isFirstInPair = matchIndex % 2 === 0;

                if (nextRound && nextRound.matches[nextMatchIndex]) {
                    if (isFirstInPair) {
                        nextRound.matches[nextMatchIndex].player1 = winnerId;
                    } else {
                        nextRound.matches[nextMatchIndex].player2 = winnerId;
                    }
                }
            }

            const matchupRef = doc(db, 'matchups', matchupId);
            await updateDoc(matchupRef, {
                matchupStructure: newStructure
            });
        } catch (err) {
            console.error('Error reporting winner:', err);
        }
    };

    const handleScoreUpdate = async (uid, score) => {
        if (!isAdmin) return;
        try {
            const matchupRef = doc(db, 'matchups', matchupId);
            await updateDoc(matchupRef, {
                [`playerScores.${uid}`]: parseInt(score) || 0
            });
        } catch (err) {
            console.error('Error updating score:', err);
        }
    };

    const calculateTeamScore = (team) => {
        if (!team || !matchup.playerScores) return 0;
        const uids = [team.leader, ...(team.members || [])];
        return uids.reduce((sum, uid) => sum + (matchup.playerScores[uid] || 0), 0);
    };

    const handleDelete = async () => {
        if (!isAdmin) return;
        if (window.confirm('Are you sure you want to delete this matchup?')) {
            try {
                await deleteDoc(doc(db, 'matchups', matchupId));
                navigate('/');
            } catch (err) {
                console.error('Error deleting matchup:', err);
            }
        }
    };

    const copyToClipboard = (text, label) => {
        navigator.clipboard.writeText(text);
        alert(`${label} copied to clipboard!`);
    };

    const handleCreateDraftFromMatch = async (roundIndex, matchIndex) => {
        if (!isAdmin || !matchup) return;

        const structure = matchup.matchupStructure;
        const match = structure[roundIndex]?.matches[matchIndex];
        if (!match || !match.player1 || !match.player2) {
            alert('Both players/teams must be determined before creating a draft.');
            return;
        }
        if (match.draftId) {
            navigate(`/tournament/${match.draftId}`);
            return;
        }
        if (match.winner) {
            alert('This match already has a winner.');
            return;
        }

        const roundLabel = structure[roundIndex].title || `Round ${roundIndex + 1}`;
        const draftTitle = `${matchup.title} — ${roundLabel} M${matchIndex + 1}`;
        const draftType = matchup.draftType || 'mode3';
        const is1v1 = draftType === 'mode3' || draftType === 'mode4';

        try {
            const tournamentId = `tournament_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const draftRef = doc(db, 'drafts', tournamentId);

            const permissions = {};
            permissions[user.uid] = 'admin';

            let preAssignedTeams, teamNames, teamBanners;

            if (matchup.format === 'teams') {
                // Teams format — map bracket team objects to draft preAssignedTeams
                const t1 = match.player1; // team object { teamName, leader, members: [m1, m2], banner }
                const t2 = match.player2;

                preAssignedTeams = {
                    team1: { leader: t1.leader || null, member1: t1.members?.[0] || null, member2: t1.members?.[1] || null },
                    team2: { leader: t2.leader || null, member1: t2.members?.[0] || null, member2: t2.members?.[1] || null }
                };
                teamNames = {
                    team1: t1.teamName || 'Team 1',
                    team2: t2.teamName || 'Team 2'
                };
                teamBanners = {
                    team1: t1.banner || null,
                    team2: t2.banner || null
                };

                // Add all team members to permissions
                [t1.leader, ...(t1.members || []), t2.leader, ...(t2.members || [])].forEach(uid => {
                    if (uid && !permissions[uid]) permissions[uid] = 'spectator';
                });
            } else {
                // Individual format — player UIDs directly
                const p1uid = typeof match.player1 === 'object' ? match.player1.uid : match.player1;
                const p2uid = typeof match.player2 === 'object' ? match.player2.uid : match.player2;
                const p1user = getUserById(p1uid);
                const p2user = getUserById(p2uid);

                preAssignedTeams = {
                    team1: { leader: p1uid || null, member1: null, member2: null },
                    team2: { leader: p2uid || null, member1: null, member2: null }
                };
                teamNames = {
                    team1: p1user?.auroryPlayerName || p1user?.displayName || 'Player 1',
                    team2: p2user?.auroryPlayerName || p2user?.displayName || 'Player 2'
                };
                teamBanners = { team1: null, team2: null };

                if (p1uid && !permissions[p1uid]) permissions[p1uid] = 'spectator';
                if (p2uid && !permissions[p2uid]) permissions[p2uid] = 'spectator';
            }

            const timerMs = 5 * 60 * 1000; // 5 minutes default

            const tournamentData = {
                title: draftTitle,
                description: matchup.description || '',
                prizePool: 'Tournament Match',
                draftType: draftType,
                timerDuration: timerMs,
                manualTimerStart: !is1v1,
                timerStarted: false,
                teamA: [],
                teamB: [],
                currentPhase: 0,
                currentTeam: 'A',
                picksInPhase: 0,
                timerStartA: null,
                timerStartB: null,
                status: is1v1 && preAssignedTeams.team1.leader && preAssignedTeams.team2.leader ? 'coinFlip' : 'waiting',
                permissions: permissions,
                preAssignedTeams: preAssignedTeams,
                pendingInvites: {},
                teamNames: teamNames,
                teamBanners: teamBanners,
                lockedPhases: [],
                awaitingLockConfirmation: false,
                activeViewers: {},
                createdAt: serverTimestamp(),
                createdBy: user.uid,
                creatorDisplayName: profile?.auroryPlayerName || user.displayName || user.email || 'Admin',
                poolAmount: 0,
                entryFee: 0,
                isFriendly: true,
                joinable: false,
                entryPaid: {},
                // Matchup linkage
                matchupId: matchupId,
                matchRoundIndex: roundIndex,
                matchMatchIndex: matchIndex
            };

            if (is1v1) {
                tournamentData.privateCode = Math.floor(10000 + Math.random() * 90000).toString();
                if (preAssignedTeams.team1.leader && preAssignedTeams.team2.leader) {
                    tournamentData.coinFlip = {
                        phase: 'rolling',
                        team1Locked: false,
                        team2Locked: false,
                        result: null,
                        winner: null,
                        winnerTurnChoice: null
                    };
                }
            }

            await setDoc(draftRef, tournamentData);

            // Update matchup structure with draftId
            const newStructure = JSON.parse(JSON.stringify(structure));
            newStructure[roundIndex].matches[matchIndex].draftId = tournamentId;

            const matchupRef = doc(db, 'matchups', matchupId);
            await updateDoc(matchupRef, {
                matchupStructure: newStructure
            });

            navigate(`/tournament/${tournamentId}`);
        } catch (err) {
            console.error('Error creating draft from match:', err);
            alert('Failed to create draft: ' + err.message);
        }
    };

    const handleAddMock = async () => {
        if (!isAdmin || !matchup) return;

        try {
            const matchupRef = doc(db, 'matchups', matchupId);
            const mockId = `mock-${Math.random().toString(36).substr(2, 5)}`;

            if (matchup.format === 'teams') {
                const teamName = `Mock Team ${matchup.participants.length + 1}`;
                const mockTeam = {
                    teamName,
                    leader: mockId,
                    members: [`${mockId}-1`, `${mockId}-2`],
                    banner: `https://api.dicebear.com/7.x/identicon/svg?seed=${teamName}`,
                    isMock: true
                };

                await updateDoc(matchupRef, {
                    participants: arrayUnion(mockTeam),
                    participantUids: arrayUnion(mockId, `${mockId}-1`, `${mockId}-2`)
                });
            } else {
                const mockUser = {
                    uid: mockId,
                    displayName: `Mock Player ${matchup.participants.length + 1}`,
                    photoURL: `https://api.dicebear.com/7.x/avataaars/svg?seed=${mockId}`,
                    auroryPlayerName: `MockPlayer_${matchup.participants.length + 1}`,
                    isMock: true
                };

                await updateDoc(matchupRef, {
                    participants: arrayUnion(mockUser),
                    participantUids: arrayUnion(mockId)
                });
            }
        } catch (err) {
            console.error('Error adding mock participant:', err);
        }
    };



    const getUserById = (id) => {
        if (!id) return null;
        if (typeof id === 'object') return id;
        const realUser = participants.find(u => u.uid === id);
        if (realUser) return realUser;
        const matchupPart = matchup.participants.find(p =>
            (typeof p === 'object' && (p.uid === id || p.leader === id))
        );
        if (matchupPart) return matchupPart;
        return { uid: id, displayName: id.startsWith('mock-') ? 'Mock Player' : 'Unknown' };
    };



    if (loading) return (
        <div className="tournament-page">
            <div className="matchup-page-loading">
                <div className="loading-spinner"></div>
                <span>Loading Matchup...</span>
            </div>
        </div>
    );

    if (!matchup) return (
        <div className="tournament-page">
            <div className="matchup-page-error">
                <h2>🔍 Tournament Not Found</h2>
                <p>The tournament you're looking for doesn't exist or has been deleted.</p>
                <button onClick={() => navigate('/')} className="back-btn">← Back Home</button>
            </div>
        </div>
    );

    const isJoined = matchup.participants.some(p =>
        typeof p === 'string' ? p === user?.uid : (p.leader === user?.uid || p.members?.includes(user?.uid))
    );
    const canJoin = user && profile?.auroryPlayerId && !isJoined && matchup.participants.length < matchup.maxParticipants && matchup.status === 'waiting';
    const isFull = matchup.participants.length >= matchup.maxParticipants;

    const sortedTeams = matchup.format === 'teams' ? [...(matchup.participants || [])]
        .sort((a, b) => calculateTeamScore(b) - calculateTeamScore(a)) : [];

    const allIndividualUids = [];
    if (matchup.format === 'teams') {
        matchup.participants.forEach(team => {
            if (typeof team === 'object') {
                allIndividualUids.push(team.leader, ...(team.members || []));
            }
        });
    } else {
        allIndividualUids.push(...(matchup.participantUids || []));
    }

    const sortedPlayers = [...new Set(allIndividualUids)]
        .map(uid => ({ uid, score: matchup.playerScores?.[uid] || 0 }))
        .sort((a, b) => b.score - a.score);

    // Helper: toggle round accordion
    const toggleRound = (roundId) => {
        setExpandedRounds(prev => ({ ...prev, [roundId]: !prev[roundId] }));
    };

    // Helper: determine which rounds should auto-expand (first one with unresolved matches)
    const getAutoExpandedRounds = () => {
        if (!matchup?.matchupStructure) return {};
        const expanded = {};
        let foundActive = false;
        matchup.matchupStructure.forEach((round) => {
            const hasUnresolved = round.matches.some(m => !m.winner);
            if (hasUnresolved && !foundActive) {
                expanded[round.id] = true;
                foundActive = true;
            }
        });
        // If all rounds are done, expand last round
        if (!foundActive && matchup.matchupStructure.length > 0) {
            expanded[matchup.matchupStructure[matchup.matchupStructure.length - 1].id] = true;
        }
        return expanded;
    };

    // Use auto-expand if user hasn't manually toggled anything
    const effectiveExpanded = Object.keys(expandedRounds).length > 0
        ? expandedRounds
        : getAutoExpandedRounds();

    // Check if round is expanded
    const isRoundExpanded = (roundId) => effectiveExpanded[roundId] || false;

    // Helper: count resolved in a round
    const roundStats = (round) => {
        const total = round.matches.length;
        const resolved = round.matches.filter(m => m.winner).length;
        return { total, resolved };
    };

    return (
        <div className="tournament-page matchup-details-page">
            <header className="tournament-header">
                <div className="header-brand">
                    <img
                        src="/AsgardDuels logos/Triad_logo.png"
                        alt="Triad Logo"
                        className="triad-logo-header"
                    />
                    <div className="header-title">
                        <h1>{matchup.title}</h1>
                        <div className="header-meta-row">
                            <span className="tournament-subtitle">Asgard Duels Tourney</span>
                            <span
                                className="header-draft-id"
                                onClick={() => copyToClipboard(matchupId, 'Matchup ID')}
                                title="Click to copy Matchup ID"
                            >
                                🆔 {matchupId.slice(0, 8)}... <span className="copy-icon">📋</span>
                            </span>
                            <span className={`status-badge ${matchup.status}`}>
                                {matchup.status === 'waiting' ? '● Waiting' : '● Active'}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="header-info">
                    {user && (
                        <span className={`user-role ${isAdmin ? 'super-admin' : ''}`}>
                            {isAdmin ? '👑 Admin' : `👤 ${profile?.auroryPlayerName || user.displayName || 'Player'}`}
                        </span>
                    )}
                    <button onClick={() => navigate('/')} className="back-btn">← Home</button>
                </div>
            </header>

            {/* ═══ Tab Bar (only when active) ═══ */}
            {matchup.status === 'active' && (
                <div className="matchup-tab-bar">
                    <button
                        className={`matchup-tab ${activeTab === 'matches' ? 'active' : ''}`}
                        onClick={() => setActiveTab('matches')}
                    >
                        ⚔️ Matches
                    </button>
                    <button
                        className={`matchup-tab ${activeTab === 'standings' ? 'active' : ''}`}
                        onClick={() => setActiveTab('standings')}
                    >
                        📊 Standings
                    </button>
                    <button
                        className={`matchup-tab ${activeTab === 'info' ? 'active' : ''}`}
                        onClick={() => setActiveTab('info')}
                    >
                        ℹ️ Info
                    </button>
                </div>
            )}

            <main className="matchup-content">

                {/* ═══════════════════════════════════════════
                    WAITING STATE — Show info + participants as before
                    ═══════════════════════════════════════════ */}
                {matchup.status === 'waiting' && (
                    <>
                        <div className="matchup-grid">
                            <div className="matchup-main">
                                <section className="detail-section glass-panel">
                                    <div className="section-header">
                                        <h3>📋 Tournament Details</h3>
                                        <div className="format-pills">
                                            <span className="pill">{matchup.format === 'teams' ? '3v3 Triad' : '1v1 Dual'}</span>
                                            <span className="pill">{matchup.draftType?.replace('mode', 'Mode ')}</span>
                                        </div>
                                    </div>

                                    <div className="details-grid">
                                        <div className="detail-card">
                                            <span className="label">Prize Pool</span>
                                            <span className="value prize">💎 {matchup.poolPrize} AURY</span>
                                        </div>
                                        <div className="detail-card">
                                            <span className="label">Start Time</span>
                                            <span className="value">
                                                📅 {matchup.startDate?.toDate ? matchup.startDate.toDate().toLocaleString() : new Date(matchup.startDate).toLocaleString()}
                                            </span>
                                        </div>
                                        <div className="detail-card">
                                            <span className="label">Draft Type</span>
                                            <span className="value">
                                                {matchup.draftType === 'mode1' ? 'Triad Swiss (3-6-3)' :
                                                    matchup.draftType === 'mode2' ? 'Triad Swiss (1-2-1)' :
                                                        matchup.draftType === 'mode3' ? '1v1 Deathmatch' : '1v1 Ban Draft'}
                                            </span>
                                        </div>
                                        <div className="detail-card">
                                            <span className="label">Availability</span>
                                            <span className="value">
                                                👥 {matchup.participants.length} / {matchup.maxParticipants} Slots
                                            </span>
                                        </div>
                                    </div>

                                    {matchup.description && (
                                        <div className="description-area">
                                            <label>Description</label>
                                            <p>{matchup.description}</p>
                                        </div>
                                    )}
                                </section>

                                <section className="action-panel glass-panel">
                                    <div className="action-row">
                                        {canJoin && <button className="btn-join-hero" onClick={handleJoin}>Join Matchup</button>}
                                        {isJoined && matchup.status === 'waiting' && <button className="btn-leave-hero" onClick={handleLeave}>Leave Matchup</button>}
                                        {isAdmin && matchup.status === 'waiting' && (
                                            <button
                                                className={`btn-start-hero ${matchup.participants.length < 2 ? 'disabled' : ''}`}
                                                onClick={handleStart}
                                                disabled={matchup.participants.length < 2}
                                            >
                                                {matchup.participants.length < 2 ? 'Need 2+ Players' : '🚀 Start Matchup'}
                                            </button>
                                        )}
                                        {isAdmin && (
                                            <div className="admin-actions">
                                                {matchup.status === 'waiting' && !isFull && <button className="btn-mock-hero" onClick={handleAddMock}>🧪 Add Mock</button>}
                                                <button className="btn-delete-hero" onClick={handleDelete}>🗑️ Delete</button>
                                            </div>
                                        )}
                                    </div>
                                </section>
                            </div>

                            <aside className="matchup-sidebar">
                                <section className="participants-panel glass-panel">
                                    <div className="panel-header">
                                        <h3>👥 Participants</h3>
                                        <span className="count-badge">{matchup.participants.length}/{matchup.maxParticipants}</span>
                                    </div>
                                    <div className="participants-list">
                                        {matchup.participants.length > 0 ? matchup.participants.map((p, index) => {
                                            if (matchup.format === 'teams' && typeof p === 'object') {
                                                const leaderUser = getUserById(p.leader);
                                                const isMyTeam = p.leader === user?.uid || p.members?.includes(user?.uid);
                                                return (
                                                    <div key={index} className={`team-participant-row ${isMyTeam ? 'is-me' : ''}`}>
                                                        <div className="team-row-header">
                                                            <div className="team-banner-mini">
                                                                {p.banner ? <img src={p.banner} alt={p.teamName} /> : <div className="banner-placeholder-mini">🛡️</div>}
                                                            </div>
                                                            <div className="team-main-info">
                                                                <span className="team-name">{p.teamName}</span>
                                                                <span className="team-leader-name">👑 {leaderUser?.auroryPlayerName || leaderUser?.displayName || 'Unknown'}</span>
                                                            </div>
                                                        </div>
                                                        <div className="team-roster-mini">
                                                            {p.members.map(mid => {
                                                                const mUser = getUserById(mid);
                                                                return (
                                                                    <div key={mid} className="roster-item-mini" title={mUser?.auroryPlayerName || mUser?.displayName}>
                                                                        <img src={mUser?.auroryProfilePicture || mUser?.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png'} alt="" />
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                );
                                            }
                                            const pUser = participants.find(u => u.uid === (p.uid || p));
                                            if (!pUser && typeof p === 'string') return null;
                                            const targetUser = pUser || (typeof p === 'object' ? p : { uid: p, displayName: 'Unknown' });
                                            return (
                                                <div key={targetUser.uid} className={`participant-row ${targetUser.uid === user?.uid ? 'is-me' : ''} ${targetUser.isMock ? 'is-mock' : ''}`}>
                                                    <div className="p-rank">{index + 1}</div>
                                                    <div className="p-avatar-wrapper">
                                                        <img src={targetUser?.auroryProfilePicture || targetUser?.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png'} alt={targetUser?.displayName} className="p-avatar" />
                                                        {targetUser?.isAurorian && <span className="p-aurorian-logo" title="Aurorian NFT Holder">🛡️</span>}
                                                    </div>
                                                    <div className="p-info">
                                                        <span className="p-name">{targetUser?.auroryPlayerName || targetUser?.displayName || 'Guest'}</span>
                                                    </div>
                                                </div>
                                            );
                                        }) : <div className="empty-state">No participants yet</div>}
                                    </div>
                                </section>
                            </aside>
                        </div>
                    </>
                )}

                {/* ═══════════════════════════════════════════
                    ACTIVE STATE — TAB: MATCHES
                    ═══════════════════════════════════════════ */}
                {matchup.status === 'active' && activeTab === 'matches' && matchup.matchupStructure && (
                    <div className="tab-content-panel">
                        <div className="tab-content-header">
                            <h3>{matchup.tournamentType === 'single_elimination' ? '🏆 Bracket' : '🔄 Round Robin Fixtures'}</h3>
                        </div>

                        {matchup.tournamentType === 'single_elimination' ? (
                            /* ── Single Elimination: Stacked Round Cards ── */
                            <div className="rr-accordion se-bracket-accordion">
                                {matchup.matchupStructure.map((round, rIndex) => {
                                    const stats = roundStats(round);
                                    const expanded = isRoundExpanded(round.id);
                                    const isFinalRound = rIndex === matchup.matchupStructure.length - 1;

                                    // Determine round status for visual indicators
                                    const isCompleted = stats.resolved === stats.total;
                                    const hasUnresolved = stats.resolved < stats.total;
                                    const isPreviousComplete = rIndex === 0 || (() => {
                                        const prevStats = roundStats(matchup.matchupStructure[rIndex - 1]);
                                        return prevStats.resolved === prevStats.total;
                                    })();
                                    const isActive = hasUnresolved && isPreviousComplete;

                                    return (
                                        <div key={round.id} className={`rr-round-accordion se-round ${expanded ? 'expanded' : ''} ${isFinalRound ? 'se-finals' : ''} ${isActive ? 'se-active' : ''} ${isCompleted ? 'se-completed' : ''}`}>
                                            <button className="rr-round-header se-round-header" onClick={() => toggleRound(round.id)}>
                                                <div className="rr-round-title-group">
                                                    <span className="rr-round-chevron">{expanded ? '▾' : '▸'}</span>
                                                    <span className="se-round-icon">{isFinalRound ? '🏆' : isCompleted ? '✅' : isActive ? '⚔️' : '⏳'}</span>
                                                    <span className="rr-round-label">{round.title}</span>
                                                </div>
                                                <span className={`rr-round-badge ${isCompleted ? 'complete' : ''}`}>
                                                    {stats.resolved}/{stats.total}
                                                </span>
                                            </button>

                                            {expanded && (
                                                <div className="rr-round-body se-round-body">
                                                    {round.matches.map((match, mIndex) => {
                                                        const p1 = matchup.format === 'teams' ? match.player1 : getUserById(match.player1);
                                                        const p2 = matchup.format === 'teams' ? match.player2 : getUserById(match.player2);
                                                        const winner = match.winner;

                                                        const getName = (p) => {
                                                            if (!p) return 'TBD';
                                                            if (matchup.format === 'teams') return p.teamName;
                                                            return p.auroryPlayerName || p.displayName || 'Unknown';
                                                        };
                                                        const getAvatar = (p) => {
                                                            if (!p) return 'https://cdn.discordapp.com/embed/avatars/0.png';
                                                            if (matchup.format === 'teams') {
                                                                const leader = getUserById(p.leader);
                                                                return p.banner || leader?.auroryProfilePicture || 'https://cdn.discordapp.com/embed/avatars/0.png';
                                                            }
                                                            return p.auroryProfilePicture || p.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png';
                                                        };
                                                        const getUID = (p) => {
                                                            if (!p) return null;
                                                            return matchup.format === 'teams' ? p.leader : (p.uid || p);
                                                        };

                                                        return (
                                                            <div key={match.id} className={`rr-compact-row se-match-row ${winner ? 'resolved' : ''} ${match.isBye ? 'is-bye' : ''}`}>
                                                                <span className="rr-row-id">M{mIndex + 1}</span>

                                                                <div className={`rr-row-player ${winner && winner === getUID(p1) ? 'winner' : ''} ${winner && winner !== getUID(p1) ? 'loser' : ''}`}>
                                                                    <img className="rr-row-avatar" src={getAvatar(p1)} alt="" />
                                                                    <span className="rr-row-name">{getName(p1)}</span>
                                                                    {isAdmin && p1 && !winner && (
                                                                        <button className="rr-row-win-btn" onClick={() => handleReportWinner(rIndex, mIndex, getUID(p1))} title="Report as winner">✓</button>
                                                                    )}
                                                                </div>

                                                                <span className="rr-row-vs">vs</span>

                                                                <div className={`rr-row-player ${winner && winner === getUID(p2) ? 'winner' : ''} ${winner && winner !== getUID(p2) ? 'loser' : ''}`}>
                                                                    <img className="rr-row-avatar" src={getAvatar(p2)} alt="" />
                                                                    <span className="rr-row-name">{getName(p2)}</span>
                                                                    {isAdmin && p2 && !winner && (
                                                                        <button className="rr-row-win-btn" onClick={() => handleReportWinner(rIndex, mIndex, getUID(p2))} title="Report as winner">✓</button>
                                                                    )}
                                                                </div>

                                                                <div className="rr-row-actions">
                                                                    {p1 && p2 && !winner && !match.draftId && isAdmin && (
                                                                        <button className="rr-row-draft-btn create" onClick={() => handleCreateDraftFromMatch(rIndex, mIndex)} title="Create Draft">⚔️</button>
                                                                    )}
                                                                    {match.draftId && (
                                                                        <button className="rr-row-draft-btn view" onClick={() => navigate(`/tournament/${match.draftId}`)} title={winner ? 'View Draft' : 'Open Draft'}>
                                                                            {winner ? '📋' : '🎮'}
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            /* ── Round Robin: Collapsible Rounds with Compact Rows ── */
                            <div className="rr-accordion">
                                {matchup.matchupStructure.map((round, rIndex) => {
                                    let matchCounter = 0;
                                    for (let i = 0; i < rIndex; i++) {
                                        matchCounter += matchup.matchupStructure[i].matches.length;
                                    }
                                    const stats = roundStats(round);
                                    const expanded = isRoundExpanded(round.id);

                                    return (
                                        <div key={round.id} className={`rr-round-accordion ${expanded ? 'expanded' : ''}`}>
                                            <button className="rr-round-header" onClick={() => toggleRound(round.id)}>
                                                <div className="rr-round-title-group">
                                                    <span className="rr-round-chevron">{expanded ? '▾' : '▸'}</span>
                                                    <span className="rr-round-label">{round.title}</span>
                                                </div>
                                                <span className={`rr-round-badge ${stats.resolved === stats.total ? 'complete' : ''}`}>
                                                    {stats.resolved}/{stats.total}
                                                </span>
                                            </button>

                                            {expanded && (
                                                <div className="rr-round-body">
                                                    {round.matches.map((match, mIndex) => {
                                                        const matchId = `A${matchCounter + mIndex + 1}`;
                                                        const p1 = matchup.format === 'teams' ? match.player1 : getUserById(match.player1);
                                                        const p2 = matchup.format === 'teams' ? match.player2 : getUserById(match.player2);
                                                        const winner = match.winner;

                                                        const getName = (p) => {
                                                            if (!p) return 'TBD';
                                                            if (matchup.format === 'teams') return p.teamName;
                                                            return p.auroryPlayerName || p.displayName || 'Unknown';
                                                        };
                                                        const getAvatar = (p) => {
                                                            if (!p) return 'https://cdn.discordapp.com/embed/avatars/0.png';
                                                            if (matchup.format === 'teams') {
                                                                const leader = getUserById(p.leader);
                                                                return p.banner || leader?.auroryProfilePicture || 'https://cdn.discordapp.com/embed/avatars/0.png';
                                                            }
                                                            return p.auroryProfilePicture || p.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png';
                                                        };
                                                        const getUID = (p) => {
                                                            if (!p) return null;
                                                            return matchup.format === 'teams' ? p.leader : (p.uid || p);
                                                        };

                                                        return (
                                                            <div key={match.id} className={`rr-compact-row ${winner ? 'resolved' : ''}`}>
                                                                <span className="rr-row-id">{matchId}</span>

                                                                <div className={`rr-row-player ${winner && winner === getUID(p1) ? 'winner' : ''} ${winner && winner !== getUID(p1) ? 'loser' : ''}`}>
                                                                    <img className="rr-row-avatar" src={getAvatar(p1)} alt="" />
                                                                    <span className="rr-row-name">{getName(p1)}</span>
                                                                    {isAdmin && p1 && !winner && (
                                                                        <button className="rr-row-win-btn" onClick={() => handleReportWinner(rIndex, mIndex, getUID(p1))} title="Report as winner">✓</button>
                                                                    )}
                                                                </div>

                                                                <span className="rr-row-vs">vs</span>

                                                                <div className={`rr-row-player ${winner && winner === getUID(p2) ? 'winner' : ''} ${winner && winner !== getUID(p2) ? 'loser' : ''}`}>
                                                                    <img className="rr-row-avatar" src={getAvatar(p2)} alt="" />
                                                                    <span className="rr-row-name">{getName(p2)}</span>
                                                                    {isAdmin && p2 && !winner && (
                                                                        <button className="rr-row-win-btn" onClick={() => handleReportWinner(rIndex, mIndex, getUID(p2))} title="Report as winner">✓</button>
                                                                    )}
                                                                </div>

                                                                <div className="rr-row-actions">
                                                                    {p1 && p2 && !winner && !match.draftId && isAdmin && (
                                                                        <button className="rr-row-draft-btn create" onClick={() => handleCreateDraftFromMatch(rIndex, mIndex)} title="Create Draft">⚔️</button>
                                                                    )}
                                                                    {match.draftId && (
                                                                        <button className="rr-row-draft-btn view" onClick={() => navigate(`/tournament/${match.draftId}`)} title={winner ? 'View Draft' : 'Open Draft'}>
                                                                            {winner ? '📋' : '🎮'}
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {/* ═══════════════════════════════════════════
                    ACTIVE STATE — TAB: STANDINGS
                    ═══════════════════════════════════════════ */}
                {matchup.status === 'active' && activeTab === 'standings' && (
                    <div className="tab-content-panel">
                        {/* Team Scoreboard (for teams format) */}
                        {matchup.format === 'teams' && (
                            <section className="standings-section">
                                <h3 className="standings-heading">🛡️ Team Scoreboard</h3>
                                <div className="scoreboard-grid">
                                    {matchup.participants.map((team, tIdx) => (
                                        <div key={tIdx} className="team-score-card">
                                            <div className="score-card-header">
                                                <div className="team-banner-small">
                                                    {team.banner ? <img src={team.banner} alt="" /> : <span>🛡️</span>}
                                                </div>
                                                <div className="team-score-info">
                                                    <span className="team-score-name">{team.teamName}</span>
                                                    <span className="team-score-total">Total: {calculateTeamScore(team)} pts</span>
                                                </div>
                                            </div>
                                            <div className="player-scores-list">
                                                {[team.leader, ...(team.members || [])].map(uid => {
                                                    const pUser = getUserById(uid);
                                                    return (
                                                        <div key={uid} className="player-score-row">
                                                            <div className="p-score-avatar">
                                                                <img src={pUser?.auroryProfilePicture || pUser?.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png'} alt="" />
                                                            </div>
                                                            <span className="p-score-name">{pUser?.auroryPlayerName || pUser?.displayName || 'Unknown'}</span>
                                                            <div className="p-score-input-wrapper">
                                                                {isAdmin ? (
                                                                    <input
                                                                        type="number"
                                                                        className="score-input"
                                                                        value={matchup.playerScores?.[uid] || 0}
                                                                        onChange={(e) => handleScoreUpdate(uid, e.target.value)}
                                                                        min="0"
                                                                    />
                                                                ) : (
                                                                    <span className="score-display">{matchup.playerScores?.[uid] || 0} pts</span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        )}

                        {/* Leaderboard */}
                        <section className="standings-section">
                            <h3 className="standings-heading">🏆 Leaderboard</h3>
                            <div className="leaderboard-columns">
                                {matchup.format === 'teams' && (
                                    <div className="leaderboard-col">
                                        <div className="col-header">🛡️ Team Rankings</div>
                                        <div className="leaderboard-list">
                                            {sortedTeams.map((team, index) => (
                                                <div key={index} className={`leader-row rank-${index + 1}`}>
                                                    <div className="rank-badge">{index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : index + 1}</div>
                                                    <div className="leader-info">
                                                        <span className="leader-name">{team.teamName}</span>
                                                    </div>
                                                    <div className="leader-score">{calculateTeamScore(team)} <small>pts</small></div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                <div className="leaderboard-col">
                                    <div className="col-header">👤 Player Rankings</div>
                                    <div className="leaderboard-list">
                                        {sortedPlayers.map((item, index) => {
                                            const pUser = getUserById(item.uid);
                                            return (
                                                <div key={item.uid} className={`leader-row rank-${index + 1}`}>
                                                    <div className="rank-badge">{index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : index + 1}</div>
                                                    <div className="leader-avatar">
                                                        <img src={pUser?.auroryProfilePicture || pUser?.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png'} alt="" />
                                                    </div>
                                                    <div className="leader-info">
                                                        <span className="leader-name">{pUser?.auroryPlayerName || pUser?.displayName || 'Unknown'}</span>
                                                    </div>
                                                    <div className="leader-score">{item.score} <small>pts</small></div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        </section>
                    </div>
                )}

                {/* ═══════════════════════════════════════════
                    ACTIVE STATE — TAB: INFO
                    ═══════════════════════════════════════════ */}
                {matchup.status === 'active' && activeTab === 'info' && (
                    <div className="tab-content-panel">
                        <div className="info-tab-grid">
                            <section className="detail-section glass-panel">
                                <div className="section-header">
                                    <h3>📋 Tournament Details</h3>
                                    <div className="format-pills">
                                        <span className="pill">{matchup.format === 'teams' ? '3v3 Triad' : '1v1 Dual'}</span>
                                        <span className="pill">{matchup.draftType?.replace('mode', 'Mode ')}</span>
                                    </div>
                                </div>

                                <div className="details-grid">
                                    <div className="detail-card">
                                        <span className="label">Prize Pool</span>
                                        <span className="value prize">💎 {matchup.poolPrize} AURY</span>
                                    </div>
                                    <div className="detail-card">
                                        <span className="label">Start Time</span>
                                        <span className="value">
                                            📅 {matchup.startDate?.toDate ? matchup.startDate.toDate().toLocaleString() : new Date(matchup.startDate).toLocaleString()}
                                        </span>
                                    </div>
                                    <div className="detail-card">
                                        <span className="label">Draft Type</span>
                                        <span className="value">
                                            {matchup.draftType === 'mode1' ? 'Triad Swiss (3-6-3)' :
                                                matchup.draftType === 'mode2' ? 'Triad Swiss (1-2-1)' :
                                                    matchup.draftType === 'mode3' ? '1v1 Deathmatch' : '1v1 Ban Draft'}
                                        </span>
                                    </div>
                                    <div className="detail-card">
                                        <span className="label">Type</span>
                                        <span className="value">
                                            {matchup.tournamentType === 'single_elimination' ? '🏆 Single Elimination' : '🔄 Round Robin'}
                                        </span>
                                    </div>
                                </div>

                                {matchup.description && (
                                    <div className="description-area">
                                        <label>Description</label>
                                        <p>{matchup.description}</p>
                                    </div>
                                )}

                                {isAdmin && (
                                    <div className="info-admin-actions">
                                        <button className="btn-delete-hero" onClick={handleDelete}>🗑️ Delete Matchup</button>
                                    </div>
                                )}
                            </section>

                            <section className="participants-panel glass-panel">
                                <div className="panel-header">
                                    <h3>👥 Participants</h3>
                                    <span className="count-badge">{matchup.participants.length}/{matchup.maxParticipants}</span>
                                </div>
                                <div className="participants-list">
                                    {matchup.participants.length > 0 ? matchup.participants.map((p, index) => {
                                        if (matchup.format === 'teams' && typeof p === 'object') {
                                            const leaderUser = getUserById(p.leader);
                                            const isMyTeam = p.leader === user?.uid || p.members?.includes(user?.uid);
                                            return (
                                                <div key={index} className={`team-participant-row ${isMyTeam ? 'is-me' : ''}`}>
                                                    <div className="team-row-header">
                                                        <div className="team-banner-mini">
                                                            {p.banner ? <img src={p.banner} alt={p.teamName} /> : <div className="banner-placeholder-mini">🛡️</div>}
                                                        </div>
                                                        <div className="team-main-info">
                                                            <span className="team-name">{p.teamName}</span>
                                                            <span className="team-leader-name">👑 {leaderUser?.auroryPlayerName || leaderUser?.displayName || 'Unknown'}</span>
                                                        </div>
                                                    </div>
                                                    <div className="team-roster-mini">
                                                        {p.members.map(mid => {
                                                            const mUser = getUserById(mid);
                                                            return (
                                                                <div key={mid} className="roster-item-mini" title={mUser?.auroryPlayerName || mUser?.displayName}>
                                                                    <img src={mUser?.auroryProfilePicture || mUser?.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png'} alt="" />
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            );
                                        }
                                        const pUser = participants.find(u => u.uid === (p.uid || p));
                                        if (!pUser && typeof p === 'string') return null;
                                        const targetUser = pUser || (typeof p === 'object' ? p : { uid: p, displayName: 'Unknown' });
                                        return (
                                            <div key={targetUser.uid} className={`participant-row ${targetUser.uid === user?.uid ? 'is-me' : ''} ${targetUser.isMock ? 'is-mock' : ''}`}>
                                                <div className="p-rank">{index + 1}</div>
                                                <div className="p-avatar-wrapper">
                                                    <img src={targetUser?.auroryProfilePicture || targetUser?.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png'} alt={targetUser?.displayName} className="p-avatar" />
                                                    {targetUser?.isAurorian && <span className="p-aurorian-logo" title="Aurorian NFT Holder">🛡️</span>}
                                                </div>
                                                <div className="p-info">
                                                    <span className="p-name">{targetUser?.auroryPlayerName || targetUser?.displayName || 'Guest'}</span>
                                                </div>
                                            </div>
                                        );
                                    }) : <div className="empty-state">No participants yet</div>}
                                </div>
                            </section>
                        </div>
                    </div>
                )}
            </main>

            {matchup.format === 'teams' && (
                <JoinTeamModal
                    isOpen={showJoinTeamModal}
                    onClose={() => setShowJoinTeamModal(false)}
                    onJoin={handleJoinTeam}
                    registeredUsers={registeredUsers}
                    currentUser={user}
                />
            )}
        </div>
    );
};

export default MatchupPage;
