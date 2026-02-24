import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db, auth } from '../firebase';
import { doc, onSnapshot, updateDoc, arrayUnion, arrayRemove, deleteDoc, collection, getDocs, query, where, documentId } from 'firebase/firestore';
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
    const [zoom, setZoom] = useState(1);
    const [showJoinTeamModal, setShowJoinTeamModal] = useState(false);
    const [registeredUsers, setRegisteredUsers] = useState([]);
    const viewportRef = useRef(null);
    const [isDragging, setIsDragging] = useState(false);
    const [startX, setStartX] = useState(0);
    const [startY, setStartY] = useState(0);
    const [scrollLeft, setScrollLeft] = useState(0);
    const [scrollTop, setScrollTop] = useState(0);

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

    const handleZoom = (direction) => {
        setZoom(prev => {
            if (direction === 'in') return Math.min(prev + 0.1, 1.5);
            if (direction === 'out') return Math.max(prev - 0.1, 0.5);
            return 1;
        });
    };

    const handleMouseDown = (e) => {
        if (!viewportRef.current) return;
        setIsDragging(true);
        setStartX(e.pageX - viewportRef.current.offsetLeft);
        setStartY(e.pageY - viewportRef.current.offsetTop);
        setScrollLeft(viewportRef.current.scrollLeft);
        setScrollTop(viewportRef.current.scrollTop);
    };

    const handleMouseLeave = () => {
        setIsDragging(false);
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    const handleMouseMove = (e) => {
        if (!isDragging || !viewportRef.current) return;
        e.preventDefault();
        const x = e.pageX - viewportRef.current.offsetLeft;
        const y = e.pageY - viewportRef.current.offsetTop;
        const walkX = (x - startX) * 2;
        const walkY = (y - startY) * 2;
        viewportRef.current.scrollLeft = scrollLeft - walkX;
        viewportRef.current.scrollTop = scrollTop - walkY;
    };

    // Touch handlers for mobile bracket panning
    const handleTouchStart = (e) => {
        if (!viewportRef.current) return;
        const touch = e.touches[0];
        setIsDragging(true);
        setStartX(touch.pageX - viewportRef.current.offsetLeft);
        setStartY(touch.pageY - viewportRef.current.offsetTop);
        setScrollLeft(viewportRef.current.scrollLeft);
        setScrollTop(viewportRef.current.scrollTop);
    };

    const handleTouchMove = (e) => {
        if (!isDragging || !viewportRef.current) return;
        const touch = e.touches[0];
        const x = touch.pageX - viewportRef.current.offsetLeft;
        const y = touch.pageY - viewportRef.current.offsetTop;
        const walkX = (x - startX) * 1.5;
        const walkY = (y - startY) * 1.5;
        viewportRef.current.scrollLeft = scrollLeft - walkX;
        viewportRef.current.scrollTop = scrollTop - walkY;
    };

    const handleTouchEnd = () => {
        setIsDragging(false);
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

    const renderMatch = (match, rIndex, mIndex, isFinalRound) => {
        const p1 = matchup.format === 'teams' ? match.player1 : getUserById(match.player1);
        const p2 = matchup.format === 'teams' ? match.player2 : getUserById(match.player2);
        const winner = match.winner;

        const getDisplayName = (p) => {
            if (!p) return 'TBD';
            if (matchup.format === 'teams') return p.teamName;
            return p.auroryPlayerName || p.displayName;
        };

        const getUID = (p) => {
            if (!p) return null;
            return matchup.format === 'teams' ? p.leader : (p.uid || p);
        };

        return (
            <div key={match.id} className={`bracket-match ${match.isBye ? 'is-bye' : ''} ${isFinalRound ? 'finals' : ''}`}>
                {isFinalRound && <div className="trophy-icon-mini">🏆</div>}
                <div className={`match-player top ${winner && winner === getUID(p1) ? 'winner' : ''}`}>
                    <div className="player-info">
                        <span className="player-name">{getDisplayName(p1)}</span>
                    </div>
                    {isAdmin && p1 && !winner && (
                        <button className="win-btn" onClick={() => handleReportWinner(rIndex, mIndex, getUID(p1))}>W</button>
                    )}
                </div>
                <div className="vs-label">VS</div>
                <div className={`match-player bottom ${winner && winner === getUID(p2) ? 'winner' : ''}`}>
                    <div className="player-info">
                        <span className="player-name">{getDisplayName(p2)}</span>
                    </div>
                    {isAdmin && p2 && !winner && (
                        <button className="win-btn" onClick={() => handleReportWinner(rIndex, mIndex, getUID(p2))}>W</button>
                    )}
                </div>
            </div>
        );
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

            <main className="matchup-content">
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

                {matchup.status === 'active' && matchup.matchupStructure && (
                    <div className="final-matchups-section glass-panel">
                        <div className="section-header">
                            <div className="section-title-group">
                                <h3>🏆 Final Matchups</h3>
                                <span className="type-badge">{matchup.tournamentType === 'single_elimination' ? 'Single Elimination Bracket' : 'Round Robin Fixtures'}</span>
                            </div>
                            {matchup.tournamentType === 'single_elimination' && (
                                <div className="zoom-controls">
                                    <button className="control-btn" onClick={() => handleZoom('out')}>-</button>
                                    <span className="zoom-value">{Math.round(zoom * 100)}%</span>
                                    <button className="control-btn" onClick={() => handleZoom('in')}>+</button>
                                    <button className="control-btn reset" onClick={() => handleZoom('reset')}>Reset</button>
                                </div>
                            )}
                        </div>

                        {matchup.tournamentType === 'single_elimination' ? (
                            <div
                                className={`bracket-viewport ${isDragging ? 'dragging' : ''}`}
                                ref={viewportRef}
                                onMouseDown={handleMouseDown}
                                onMouseLeave={handleMouseLeave}
                                onMouseUp={handleMouseUp}
                                onMouseMove={handleMouseMove}
                                onTouchStart={handleTouchStart}
                                onTouchMove={handleTouchMove}
                                onTouchEnd={handleTouchEnd}
                            >
                                <div className="bracket-container" style={{ transform: `scale(${zoom})`, transformOrigin: 'left top' }}>
                                    {matchup.matchupStructure.map((round, rIndex) => (
                                        <div key={round.id} className="bracket-round">
                                            <div className="round-title">{round.title}</div>
                                            <div className="round-matches">
                                                {(() => {
                                                    const matches = round.matches;
                                                    const isFinalRound = rIndex === matchup.matchupStructure.length - 1;
                                                    if (isFinalRound) return matches.map((match, mIndex) => renderMatch(match, rIndex, mIndex, true));

                                                    const pairs = [];
                                                    for (let i = 0; i < matches.length; i += 2) {
                                                        pairs.push(matches.slice(i, i + 2));
                                                    }
                                                    return pairs.map((pair, pIndex) => (
                                                        <div key={`pair-${rIndex}-${pIndex}`} className="match-pair-group">
                                                            {pair.map((match, mInPairIndex) => {
                                                                const mIndex = pIndex * 2 + mInPairIndex;
                                                                return renderMatch(match, rIndex, mIndex, false);
                                                            })}
                                                        </div>
                                                    ));
                                                })()}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div className="round-robin-container">
                                {matchup.matchupStructure.map((round, rIndex) => {
                                    // Calculate global match starting index for this round
                                    let matchCounter = 0;
                                    for (let i = 0; i < rIndex; i++) {
                                        matchCounter += matchup.matchupStructure[i].matches.length;
                                    }

                                    return (
                                        <div key={round.id} className="rr-round">
                                            <div className="round-title">{round.title}</div>
                                            <div className="rr-matches-grid">
                                                {round.matches.map((match, mIndex) => {
                                                    const matchId = `A${matchCounter + mIndex + 1}`;
                                                    const p1 = matchup.format === 'teams' ? match.player1 : getUserById(match.player1);
                                                    const p2 = matchup.format === 'teams' ? match.player2 : getUserById(match.player2);
                                                    const winner = match.winner;

                                                    const getInfo = (p) => {
                                                        if (!p) return { name: 'TBD', sub: '-', avatar: 'https://cdn.discordapp.com/embed/avatars/0.png' };
                                                        if (matchup.format === 'teams') {
                                                            const leader = getUserById(p.leader);
                                                            return {
                                                                name: p.teamName,
                                                                sub: leader?.auroryPlayerName || leader?.displayName || 'Team Leader',
                                                                avatar: p.banner || 'https://cdn.discordapp.com/embed/avatars/0.png'
                                                            };
                                                        }
                                                        return {
                                                            name: p.auroryPlayerName || p.displayName,
                                                            sub: p.isMock ? 'Mock Participant' : 'Aurory Duelist',
                                                            avatar: p.auroryProfilePicture || p.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png'
                                                        };
                                                    };

                                                    const getUID = (p) => {
                                                        if (!p) return null;
                                                        return matchup.format === 'teams' ? p.leader : (p.uid || p);
                                                    };

                                                    const info1 = getInfo(p1);
                                                    const info2 = getInfo(p2);

                                                    return (
                                                        <div key={match.id} className="rr-match-card">
                                                            <div className="rr-match-id">{matchId}</div>
                                                            <div className="rr-players-stack">
                                                                <div className={`rr-player-row ${winner && winner === getUID(p1) ? 'winner' : ''}`}>
                                                                    <div className="rr-avatar">
                                                                        <img src={info1.avatar} alt="" />
                                                                    </div>
                                                                    <div className="rr-info">
                                                                        <span className="rr-name">{info1.name}</span>
                                                                        <span className="rr-sub">{info1.sub}</span>
                                                                    </div>
                                                                    {isAdmin && p1 && !winner && <button className="win-btn-rr" onClick={() => handleReportWinner(rIndex, mIndex, getUID(p1))}>✓</button>}
                                                                </div>
                                                                <div className={`rr-player-row ${winner && winner === getUID(p2) ? 'winner' : ''}`}>
                                                                    <div className="rr-avatar">
                                                                        <img src={info2.avatar} alt="" />
                                                                    </div>
                                                                    <div className="rr-info">
                                                                        <span className="rr-name">{info2.name}</span>
                                                                        <span className="rr-sub">{info2.sub}</span>
                                                                    </div>
                                                                    {isAdmin && p2 && !winner && <button className="win-btn-rr" onClick={() => handleReportWinner(rIndex, mIndex, getUID(p2))}>✓</button>}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}
                {matchup.status === 'active' && matchup.format === 'teams' && (
                    <section className="scoreboard-section glass-panel">
                        <div className="section-header">
                            <h3>📊 Team Scoreboard</h3>
                        </div>
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

                {matchup.status === 'active' && (
                    <section className="leaderboard-section glass-panel">
                        <div className="section-header">
                            <h3>🏆 Tournament Leaderboard</h3>
                        </div>
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
