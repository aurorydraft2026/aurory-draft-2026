import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db, auth } from '../firebase';
import { doc, onSnapshot, updateDoc, arrayUnion, arrayRemove, deleteDoc, collection, getDocs, query, where, documentId } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { isUserSuperAdmin } from '../config/admins';
import JoinTeamModal from '../components/JoinTeamModal';
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

    useEffect(() => {
        const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
            if (currentUser) {
                // Check if user is admin
                const userRef = doc(db, 'users', currentUser.uid);
                onSnapshot(userRef, (docSnap) => {
                    if (docSnap.exists()) {
                        const userData = docSnap.data();
                        setProfile(userData);
                        const isStaff = isUserSuperAdmin(currentUser) || userData.role === 'admin' || userData.role === 'superadmin';
                        console.log('Admin check for', currentUser.email, ':', {
                            isSuperAdmin: isUserSuperAdmin(currentUser),
                            dbRole: userData.role,
                            finalIsAdmin: isStaff
                        });
                        setIsAdmin(isStaff);
                    } else {
                        // Even if doc doesn't exist, check if super admin by email/UID
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

    // Fetch all users for team selection if it's a team matchup
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
                    // Extract all UIDs
                    let uids = [];
                    if (matchup.format === 'teams') {
                        matchup.participants.forEach(p => {
                            if (typeof p === 'object') {
                                if (p.leader) uids.push(p.leader);
                                if (p.members) uids.push(...p.members);
                            } else {
                                uids.push(p); // Fallback for mixed data
                            }
                        });
                    } else {
                        uids = matchup.participants;
                    }

                    // Remove duplicates
                    uids = [...new Set(uids)].filter(Boolean);

                    if (uids.length === 0) {
                        setParticipants([]);
                        return;
                    }

                    const usersRef = collection(db, 'users');
                    // Chunk uids for "in" query if there are many (Firestore limit 10/30)
                    const chunks = [];
                    for (let i = 0; i < uids.length; i += 30) {
                        chunks.push(uids.slice(i, i + 30));
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
    }, [matchup?.participants, matchup?.format]);

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
            // Handle both individual and team leaving
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
        try {
            const matchupRef = doc(db, 'matchups', matchupId);
            await updateDoc(matchupRef, {
                status: 'active'
            });
        } catch (err) {
            console.error('Error starting matchup:', err);
        }
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
        // Simple alert for feedback
        alert(`${label} copied to clipboard!`);
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
                <h2>🔍 Matchup Not Found</h2>
                <p>The matchup you're looking for doesn't exist or has been deleted.</p>
                <button onClick={() => navigate('/')} className="back-btn">← Back Home</button>
            </div>
        </div>
    );

    const isJoined = matchup.participants.some(p =>
        typeof p === 'string' ? p === user?.uid : (p.leader === user?.uid || p.members?.includes(user?.uid))
    );
    const canJoin = user && profile?.auroryPlayerId && !isJoined && matchup.participants.length < matchup.maxParticipants && matchup.status === 'waiting';
    const isFull = matchup.participants.length >= matchup.maxParticipants;

    const getUserById = (id) => participants.find(u => u.uid === id);

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
                            <span className="tournament-subtitle">Asgard Duels Matchup</span>
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

                    <div className="header-admin-actions">
                        {/* Admin actions moved to main panel as per user request */}
                    </div>

                    <button onClick={() => navigate('/')} className="back-btn">
                        ← Home
                    </button>
                </div>
            </header>

            <main className="matchup-content">
                <div className="matchup-grid">
                    <div className="matchup-main">
                        <section className="detail-section glass-panel">
                            <div className="section-header">
                                <h3>📋 Matchup Details</h3>
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
                                {canJoin && (
                                    <button className="btn-join-hero" onClick={handleJoin}>Join Matchup</button>
                                )}

                                {isJoined && matchup.status === 'waiting' && (
                                    <button className="btn-leave-hero" onClick={handleLeave}>Leave Matchup</button>
                                )}

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
                                    <button className="btn-delete-hero" onClick={handleDelete}>
                                        🗑️ Delete Matchup
                                    </button>
                                )}
                            </div>

                            {!user ? (
                                <div className="join-cta">
                                    <p>Log in to participate in this matchup.</p>
                                    <button className="btn-join-hero" onClick={() => navigate('/')}>Login with Discord</button>
                                </div>
                            ) : user && !profile?.auroryPlayerId && !isJoined && !isFull ? (
                                <div className="join-cta locked">
                                    <p>⚠️ You must link an Aurory account to join this matchup.</p>
                                    <button className="btn-join-hero disabled" disabled>Link Required</button>
                                </div>
                            ) : null}

                            {isFull && !isJoined && !isAdmin && (
                                <div className="join-cta locked">
                                    <p>This matchup is currently full.</p>
                                    <button className="btn-join-hero disabled" disabled>Matchup Full</button>
                                </div>
                            )}
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
                                                        {p.banner ? (
                                                            <img src={p.banner} alt={p.teamName} />
                                                        ) : (
                                                            <div className="banner-placeholder-mini">🛡️</div>
                                                        )}
                                                    </div>
                                                    <div className="team-main-info">
                                                        <span className="team-name">{p.teamName}</span>
                                                        <span className="team-leader-name">👑 {leaderUser?.auroryPlayerName || leaderUser?.displayName || 'Unknown'}</span>
                                                    </div>
                                                    <div className="team-index">#{index + 1}</div>
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

                                    // Individual format
                                    const pUser = participants.find(u => u.uid === p);
                                    if (!pUser && typeof p === 'string') return null;
                                    const targetUser = pUser || { uid: p, displayName: 'Unknown' };

                                    return (
                                        <div key={targetUser.uid} className={`participant-row ${targetUser.uid === user?.uid ? 'is-me' : ''}`}>
                                            <div className="p-rank">{index + 1}</div>
                                            <div className="p-avatar-wrapper">
                                                <img
                                                    src={targetUser?.auroryProfilePicture || targetUser?.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png'}
                                                    alt={targetUser?.displayName}
                                                    className="p-avatar"
                                                />
                                                {targetUser?.isAurorian && <span className="p-aurorian-logo" title="Aurorian NFT Holder">🛡️</span>}
                                            </div>
                                            <div className="p-info">
                                                <span className="p-name">{targetUser?.auroryPlayerName || targetUser?.displayName || 'Guest'}</span>
                                                <div className="p-tags">
                                                    {targetUser?.uid === matchup.createdBy && <span className="p-tag leader">Host</span>}
                                                    {targetUser?.uid === user?.uid && <span className="p-tag self">You</span>}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                }) : (
                                    <div className="empty-state">
                                        <div className="empty-icon">👥</div>
                                        <p>No participants yet</p>
                                    </div>
                                )}
                            </div>

                            {isFull && <div className="full-warning">This matchup is locked (Full)</div>}
                        </section>
                    </aside>
                </div>
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
