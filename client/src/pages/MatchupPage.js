import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db, auth } from '../firebase';
import { doc, onSnapshot, updateDoc, setDoc, arrayUnion, arrayRemove, deleteDoc, collection, getDocs, query, where, documentId, serverTimestamp, runTransaction } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { isUserSuperAdmin } from '../config/admins';
import JoinTeamModal from '../components/JoinTeamModal';
import InsufficientBalanceModal from '../components/InsufficientBalanceModal';
import LeaveConfirmationModal from '../components/LeaveConfirmationModal';
import AuroryAccountLink from '../components/AuroryAccountLink';
import {
    generateSingleElimination,
    generateRoundRobin,
    generateRealmRoundRobin,
    generateFinalsSingleElimination,
    calculateRoundRobinStandings,
    calculateFinalsStandings
} from '../utils/tournamentUtils';
import { resolveDisplayName, resolveAvatar } from '../utils/userUtils';
import { useAuth } from '../hooks/useAuth';
import './MatchupPage.css';


const MatchupPage = () => {
    const { matchupId } = useParams();
    const navigate = useNavigate();
    
    const { 
        showLoginModal, 
        setShowLoginModal, 
        renderLoginModalContent 
    } = useAuth(navigate);

    const [matchup, setMatchup] = useState(null);
    const [participants, setParticipants] = useState([]);
    const [loading, setLoading] = useState(true);
    const [user, setUser] = useState(null);
    const [profile, setProfile] = useState(null);
    const [isAdmin, setIsAdmin] = useState(false);
    const [showJoinTeamModal, setShowJoinTeamModal] = useState(false);
    const [showLeaveModal, setShowLeaveModal] = useState(false);
    const [registeredUsers, setRegisteredUsers] = useState([]);
    const [activeTab, setActiveTab] = useState('matches');
    const [expandedRounds, setExpandedRounds] = useState({});
    const [creatingDrafts, setCreatingDrafts] = useState({}); // { matchKey: true }
    const [walletBalance, setWalletBalance] = useState(0);
    const [showBalanceModal, setShowBalanceModal] = useState(false);
    
    // Edit Modal State
    const [showEditModal, setShowEditModal] = useState(false);
    const [editFormData, setEditFormData] = useState({});
    const [isSavingEdit, setIsSavingEdit] = useState(false);
    const [showLinkModal, setShowLinkModal] = useState(false);
    const [zoomLevel, setZoomLevel] = useState(1);
    
    const ENTRY_FEE = matchup?.requiresEntryFee ? (matchup?.entryFeeAmount || 0) : 0;

    const getUserById = useCallback((id) => {
        if (!id) return null;
        if (typeof id === 'object') return id;
        const realUser = participants.find(u => u.uid === id);
        if (realUser) return realUser;
        const matchupPart = matchup?.participants?.find(p =>
            (typeof p === 'object' && (p.uid === id || p.leader === id))
        );
        if (matchupPart) return matchupPart;
        return { uid: id, displayName: id.startsWith('mock-') ? 'Mock Player' : 'Unknown' };
    }, [participants, matchup?.participants]);

    const getName = useCallback((p) => {
        if (!p) return 'TBD';
        return matchup?.format === 'teams' ? p.teamName : resolveDisplayName(p);
    }, [matchup?.format]);

    const getAvatar = useCallback((p) => {
        if (!p) return 'https://cdn.discordapp.com/embed/avatars/0.png';
        if (matchup?.format === 'teams') {
            const leader = getUserById(p.leader);
            return p.banner || resolveAvatar(leader);
        }
        return resolveAvatar(p);
    }, [matchup?.format, getUserById]);

    const getUID = useCallback((p) => {
        if (!p) return null;
        return matchup?.format === 'teams' ? p.leader : (p.uid || p);
    }, [matchup?.format]);

    useEffect(() => {
        if (!user) { setWalletBalance(0); return; }
        const walletRef = doc(db, 'wallets', user.uid);
        const unsubscribeWallet = onSnapshot(walletRef, (snap) => {
            setWalletBalance(snap.exists() ? (snap.data().balance || 0) : 0);
        }, () => setWalletBalance(0));

        return () => unsubscribeWallet();
    }, [user]);

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
        if (!isAdmin || !matchup || matchup.phase === 'completed') return;

        const syncState = async () => {
            const updateData = {};
            const matchupRef = doc(db, 'matchups', matchupId);

            if (matchup.phase === 'groups' && matchup.groupStructure) {
                const allFrostDone = matchup.groupStructure.frost.every(r => r.matches.every(m => m.winner));
                const allFireDone = matchup.groupStructure.fire.every(r => r.matches.every(m => m.winner));

                if (allFrostDone && allFireDone) {
                    const frostStandings = calculateRoundRobinStandings(matchup.realms.frost, matchup.groupStructure.frost, matchup.format, matchup.playerScores);
                    const fireStandings = calculateRoundRobinStandings(matchup.realms.fire, matchup.groupStructure.fire, matchup.format, matchup.playerScores);
                    const top2Frost = frostStandings.slice(0, 2).map(s => s.team);
                    const top2Fire = fireStandings.slice(0, 2).map(s => s.team);
                    const finalsTeams = [top2Frost[0], top2Frost[1], top2Fire[0], top2Fire[1]];
                    const finalsStructure = generateFinalsSingleElimination(finalsTeams);

                    updateData.phase = 'finals';
                    updateData.finalsStructure = finalsStructure;
                    updateData.finalsParticipants = finalsTeams;
                    updateData.groupStandings = {
                        frost: frostStandings.map(s => ({ teamId: s.teamId, points: s.points, wins: s.wins, draws: s.draws, losses: s.losses })),
                        fire: fireStandings.map(s => ({ teamId: s.teamId, points: s.points, wins: s.wins, draws: s.draws, losses: s.losses }))
                    };
                }
            } else if (matchup.phase === 'finals' && matchup.finalsStructure) {
                let structureChanged = false;
                const newFinalsStructure = JSON.parse(JSON.stringify(matchup.finalsStructure));

                const sfRound = newFinalsStructure[0];
                const finalRound = newFinalsStructure[1];
                if (sfRound && finalRound) {
                    sfRound.matches.forEach((match, mIdx) => {
                        if (match.winner) {
                            const winnerPart = (getUID(match.player1) === match.winner) ? match.player1 : match.player2;
                            const loserPart = (getUID(match.player1) === match.winner) ? match.player2 : match.player1;

                            const grandFinal = finalRound.matches[0];
                            const thirdPlace = finalRound.matches[1];

                            if (mIdx === 0) { // SF1
                                if (!grandFinal.player1 || getUID(grandFinal.player1) !== getUID(winnerPart)) {
                                    grandFinal.player1 = winnerPart;
                                    structureChanged = true;
                                }
                                if (!thirdPlace.player1 || getUID(thirdPlace.player1) !== getUID(loserPart)) {
                                    thirdPlace.player1 = loserPart;
                                    structureChanged = true;
                                }
                            } else { // SF2
                                if (!grandFinal.player2 || getUID(grandFinal.player2) !== getUID(winnerPart)) {
                                    grandFinal.player2 = winnerPart;
                                    structureChanged = true;
                                }
                                if (!thirdPlace.player2 || getUID(thirdPlace.player2) !== getUID(loserPart)) {
                                    thirdPlace.player2 = loserPart;
                                    structureChanged = true;
                                }
                            }
                        }
                    });
                }

                if (structureChanged) updateData.finalsStructure = newFinalsStructure;

                const allDone = newFinalsStructure.every(r => r.matches.every(m => m.winner));
                if (allDone) {
                    updateData.phase = 'completed';
                    updateData.finalStandings = calculateFinalsStandings(newFinalsStructure);
                }
            }

            if (Object.keys(updateData).length > 0) {
                await updateDoc(matchupRef, updateData);
            }
        };
        syncState();
    }, [matchup, isAdmin, matchupId, getUID]);

    useEffect(() => {
        if (!isAdmin || !matchup || matchup.phase === 'completed' || loading) return;

        const verifyDrafts = async () => {
            const draftIds = new Set();

            // Collect all draft IDs from structures
            if (matchup.matchupStructure) {
                matchup.matchupStructure.forEach(round => {
                    round.matches.forEach(m => { if (m.draftId) draftIds.add(m.draftId); });
                });
            }
            if (matchup.groupStructure) {
                ['frost', 'fire'].forEach(realm => {
                    matchup.groupStructure[realm]?.forEach(round => {
                        round.matches.forEach(m => { if (m.draftId) draftIds.add(m.draftId); });
                    });
                });
            }
            if (matchup.finalsStructure) {
                matchup.finalsStructure.forEach(round => {
                    round.matches.forEach(m => { if (m.draftId) draftIds.add(m.draftId); });
                });
            }

            if (draftIds.size === 0) return;

            try {
                const idsArray = Array.from(draftIds);
                const results = new Set();

                for (let i = 0; i < idsArray.length; i += 30) {
                    const chunk = idsArray.slice(i, i + 30);
                    const q = query(collection(db, 'drafts'), where(documentId(), 'in', chunk));
                    const snap = await getDocs(q);
                    snap.docs.forEach(doc => results.add(doc.id));
                }

                const missingIds = idsArray.filter(id => !results.has(id));
                if (missingIds.length === 0) return;

                console.warn('Detected missing drafts in bracket, cleaning up:', missingIds);
                const updates = {};
                let changedOverall = false;

                if (matchup.matchupStructure) {
                    const next = JSON.parse(JSON.stringify(matchup.matchupStructure));
                    let changed = false;
                    next.forEach(r => r.matches.forEach(m => {
                        if (m.draftId && missingIds.includes(m.draftId)) {
                            m.draftId = null;
                            changed = true;
                        }
                    }));
                    if (changed) { updates.matchupStructure = next; changedOverall = true; }
                }

                if (matchup.groupStructure) {
                    const nextGroup = JSON.parse(JSON.stringify(matchup.groupStructure));
                    let changed = false;
                    ['frost', 'fire'].forEach(realm => {
                        nextGroup[realm]?.forEach(r => r.matches.forEach(m => {
                            if (m.draftId && missingIds.includes(m.draftId)) {
                                m.draftId = null;
                                changed = true;
                            }
                        }));
                    });
                    if (changed) { updates.groupStructure = nextGroup; changedOverall = true; }
                }

                if (matchup.finalsStructure) {
                    const next = JSON.parse(JSON.stringify(matchup.finalsStructure));
                    let changed = false;
                    next.forEach(r => r.matches.forEach(m => {
                        if (m.draftId && missingIds.includes(m.draftId)) {
                            m.draftId = null;
                            changed = true;
                        }
                    }));
                    if (changed) { updates.finalsStructure = next; changedOverall = true; }
                }

                if (changedOverall) {
                    await updateDoc(doc(db, 'matchups', matchupId), updates);
                }
            } catch (err) {
                console.error('Error verifying draft existence:', err);
            }
        };

        // Debounce slightly to avoid rapid updates
        const timer = setTimeout(verifyDrafts, 1000);
        return () => clearTimeout(timer);
    }, [matchup, isAdmin, matchupId, loading]);

    const performMatchReset = async (roundIndex, matchIndex, realmKey) => {
        if (!matchup) return;
        let structure, structureFieldPath;
        if (matchup.tournamentType === 'realm_round_robin') {
            if (matchup.phase === 'groups' && realmKey) {
                structure = matchup.groupStructure?.[realmKey];
                structureFieldPath = `groupStructure.${realmKey}`;
            } else if (matchup.phase === 'finals') {
                structure = matchup.finalsStructure;
                structureFieldPath = 'finalsStructure';
            }
        } else {
            structure = matchup.matchupStructure;
            structureFieldPath = 'matchupStructure';
        }
        if (!structure) return;

        try {
            const next = JSON.parse(JSON.stringify(structure));
            if (next[roundIndex]?.matches[matchIndex]) {
                next[roundIndex].matches[matchIndex].draftId = null;
                await updateDoc(doc(db, 'matchups', matchupId), { [structureFieldPath]: next });
            }
        } catch (err) {
            console.error('Error resetting match:', err);
        }
    };

    const handleEnterDraftSafe = async (draftId, rIndex, mIndex, realmKey) => {
        if (!draftId) return;
        try {
            const q = query(collection(db, 'drafts'), where(documentId(), '==', draftId));
            const snap = await getDocs(q);
            if (snap.empty) {
                alert("This draft has been deleted. Re-enabling match creation...");
                await performMatchReset(rIndex, mIndex, realmKey);
            } else {
                navigate(`/tournament/${draftId}`);
            }
        } catch (err) {
            console.error('Error entering draft:', err);
            navigate(`/tournament/${draftId}`); // Fallback
        }
    };

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

    // Derived: Unique participants for display (filters out individuals already in teams)
    const displayParticipants = useMemo(() => {
        if (!matchup?.participants) return [];
        if (matchup.format !== 'teams') return matchup.participants;

        // Collect all UIDs that are part of any team
        const teamMemberUids = new Set();
        matchup.participants.forEach(p => {
            if (typeof p === 'object' && !p.uid) { // It's a team object
                teamMemberUids.add(p.leader);
                (p.members || []).forEach(m => teamMemberUids.add(m));
            }
        });

        // Filter: Keep team objects and individuals NOT in any team
        return matchup.participants.filter(p => {
            // If it's a team object (has teamName or leader/members but NO uid), keep it
            if (typeof p === 'object' && !p.uid) return true;

            // If it's a string (UID) or individual user object (with uid)
            const uid = typeof p === 'string' ? p : p.uid;
            return !teamMemberUids.has(uid);
        });
    }, [matchup?.participants, matchup?.format]);

    const handleJoin = async () => {
        if (!user) return;

        // Anti-duplicate check
        const isAlreadyIn = (matchup.participantUids || []).includes(user.uid);
        if (isAlreadyIn) {
            alert("This participant is already registered in this tournament!");
            return;
        }

        if (matchup.participants.length >= matchup.maxParticipants) return;

        if (matchup.format === 'teams') {
            setShowJoinTeamModal(true);
            return;
        }

        try {
            await runTransaction(db, async (transaction) => {
                // Wallet check only if entry fee required
                if (ENTRY_FEE > 0) {
                    const walletRef = doc(db, 'wallets', user.uid);
                    const walletSnap = await transaction.get(walletRef);
                    const balance = walletSnap.exists() ? (walletSnap.data().balance || 0) : 0;

                    if (balance < ENTRY_FEE) {
                        setShowBalanceModal(true);
                        throw new Error(`Insufficient balance. You need ${(ENTRY_FEE / 1e9).toFixed(2)} AURY to join.`);
                    }
                    transaction.update(walletRef, { balance: balance - ENTRY_FEE });
                }

                const matchupRef = doc(db, 'matchups', matchupId);
                const matchupSnap = await transaction.get(matchupRef);
                if (!matchupSnap.exists()) throw new Error("Matchup does not exist!");

                const mData = matchupSnap.data();
                if (mData.participants.length >= mData.maxParticipants) {
                    throw new Error("Matchup is already full!");
                }

                transaction.update(matchupRef, {
                    participants: arrayUnion(user.uid),
                    participantUids: arrayUnion(user.uid)
                });
            });
            alert(ENTRY_FEE > 0 ? `Tournament joined successfully! ${(ENTRY_FEE / 1e9).toFixed(2)} AURY deducted.` : 'Tournament joined successfully!');
        } catch (err) {
            console.error('Error joining matchup:', err);
            if (!err.message.includes('Insufficient balance')) {
                alert(err.message);
            }
        }
    };

    const handleJoinTeam = async (teamData) => {
        try {
            const uidsToAdd = [teamData.leader, ...teamData.members];

            // Anti-duplicate check for any team member
            const existingUids = matchup.participantUids || [];
            const duplicates = uidsToAdd.filter(uid => existingUids.includes(uid));

            if (duplicates.length > 0) {
                const userSnaps = await Promise.all(duplicates.map(uid => getDocs(query(collection(db, 'users'), where(documentId(), '==', uid)))));
                const duplicateNames = duplicates.map((uid, idx) => {
                    const snap = userSnaps[idx];
                    const d = !snap.empty ? snap.docs[0].data() : null;
                    return resolveDisplayName(d) || uid;
                });
                if (duplicates.length === 1) {
                    alert(`${duplicateNames[0]} is already on a different team or registered in this tournament.`);
                } else {
                    alert(`Multiple participants are already registered or in different teams: ${duplicateNames.join(', ')}`);
                }
                return;
            }

            await runTransaction(db, async (transaction) => {
                // Wallet checks only if entry fee required
                if (ENTRY_FEE > 0) {
                    const walletSnaps = await Promise.all(uidsToAdd.map(uid => transaction.get(doc(db, 'wallets', uid))));
                    const insufficient = [];

                    walletSnaps.forEach((snap, idx) => {
                        const balance = snap.exists() ? (snap.data().balance || 0) : 0;
                        if (balance < ENTRY_FEE) {
                            const uid = uidsToAdd[idx];
                            insufficient.push(uid);
                        }
                    });

                    if (insufficient.length > 0) {
                        const userSnaps = await Promise.all(insufficient.map(uid => transaction.get(doc(db, 'users', uid))));
                        const names = insufficient.map((uid, idx) => {
                            const s = userSnaps[idx];
                            const d = s.exists() ? s.data() : null;
                            return d?.auroryPlayerName || d?.displayName || uid;
                        });
                        throw new Error(`Insufficient balance for: ${names.join(', ')}. Each member needs ${(ENTRY_FEE / 1e9).toFixed(2)} AURY.`);
                    }

                    // Deduct from all
                    uidsToAdd.forEach((uid, idx) => {
                        const snap = walletSnaps[idx];
                        transaction.update(doc(db, 'wallets', uid), {
                            balance: (snap.data()?.balance || 0) - ENTRY_FEE
                        });
                    });
                }

                // Double check matchup capacity
                const matchupRef = doc(db, 'matchups', matchupId);
                const matchupSnap = await transaction.get(matchupRef);
                const mData = matchupSnap.data();
                if (mData.participants.length >= mData.maxParticipants) {
                    throw new Error("Matchup is already full!");
                }

                transaction.update(matchupRef, {
                    participants: arrayUnion(teamData),
                    participantUids: arrayUnion(...uidsToAdd)
                });
            });
            alert(ENTRY_FEE > 0 ? `Team joined tournament successfully! ${(ENTRY_FEE / 1e9).toFixed(2)} AURY deducted from each member.` : 'Team joined tournament successfully!');
        } catch (err) {
            console.error('Error joining as team:', err);
            if (err.message.includes('Insufficient balance')) {
                setShowBalanceModal(true);
            } else {
                alert(err.message || 'Failed to join as team.');
            }
        }
    };

    const handleLeave = () => {
        if (!user) return;
        setShowLeaveModal(true);
    };

    const confirmLeave = async () => {
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
            setShowLeaveModal(false);
        } catch (err) {
            console.error('Error leaving matchup:', err);
        }
    };

    const handleStart = async () => {
        if (!isAdmin) return;
        if (matchup.participants.length < 2) return;

        try {
            const matchupRef = doc(db, 'matchups', matchupId);

            if (matchup.tournamentType === 'realm_round_robin') {
                // Realm Round Robin: split into Frost/Fire, generate group fixtures
                if (matchup.participants.length < 4) {
                    alert('Realm Round Robin requires at least 4 teams.');
                    return;
                }
                const { realms, groupStructure } = generateRealmRoundRobin(matchup.participants);
                await updateDoc(matchupRef, {
                    status: 'active',
                    phase: 'groups',
                    realms,
                    groupStructure,
                    groupScores: {},
                    playerScores: {},
                    startedAt: new Date()
                });
            } else {
                let structure = [];
                let totalSlots = null;
                if (matchup.tournamentType === 'single_elimination') {
                    const result = generateSingleElimination(matchup.participants);
                    structure = result.rounds;
                    totalSlots = result.totalSlots;
                } else if (matchup.tournamentType === 'round_robin') {
                    structure = generateRoundRobin(matchup.participants);
                }
                await updateDoc(matchupRef, {
                    status: 'active',
                    matchupStructure: structure,
                    bracketTotalSlots: totalSlots,
                    startedAt: new Date()
                });
            }
        } catch (err) {
            console.error('Error starting matchup:', err);
        }
    };

    const handleReportWinner = async (roundIndex, matchIndex, winnerId, realmKey = null) => {
        if (!isAdmin || !winnerId) return;
        try {
            const matchupRef = doc(db, 'matchups', matchupId);

            if (matchup.tournamentType === 'realm_round_robin') {
                // Realm round robin: determine which structure to update
                await handleRealmWinnerReport(roundIndex, matchIndex, winnerId, realmKey);
                return;
            }

            const newStructure = JSON.parse(JSON.stringify(matchup.matchupStructure));
            const currentMatch = newStructure[roundIndex].matches[matchIndex];
            currentMatch.winner = winnerId;

            const winnerParticipant = (getUID(currentMatch.player1) === winnerId) ? currentMatch.player1 : currentMatch.player2;
            const loserParticipant = (getUID(currentMatch.player1) === winnerId) ? currentMatch.player2 : currentMatch.player1;

            if (matchup.tournamentType === 'single_elimination') {
                // Propagate Winner Upward
                if (currentMatch.parentMatchId) {
                    const nextRound = newStructure[roundIndex + 1];
                    if (nextRound) {
                        const parentMatch = nextRound.matches.find(m => m.id === currentMatch.parentMatchId);
                        if (parentMatch) {
                            parentMatch[currentMatch.parentSide] = winnerParticipant || null;
                        }
                    }
                }

                // Propagate Loser to 3rd Place Match
                if (currentMatch.thirdPlaceParentId) {
                    const finalRound = newStructure[newStructure.length - 1];
                    if (finalRound) {
                        const thirdPlaceMatch = finalRound.matches.find(m => m.id === currentMatch.thirdPlaceParentId);
                        if (thirdPlaceMatch) {
                            thirdPlaceMatch[currentMatch.thirdPlaceParentSide] = loserParticipant || null;
                        }
                    }
                }
            }

            await updateDoc(matchupRef, {
                matchupStructure: newStructure
            });
        } catch (err) {
            console.error('Error reporting winner:', err);
        }
    };

    /**
     * Handle winner reporting for realm round robin matches.
     * Updates the correct structure (groupStructure.frost/fire or finalsStructure)
     * and checks for phase advancement.
     */
    const handleRealmWinnerReport = async (roundIndex, matchIndex, winnerId, realmKey = null) => {
        const matchupRef = doc(db, 'matchups', matchupId);
        const phase = matchup.phase;

        if (phase === 'groups') {
            const realm = realmKey;
            if (!realm) return;

            let newGroupStructure = JSON.parse(JSON.stringify(matchup.groupStructure));
            const match = newGroupStructure[realm][roundIndex]?.matches?.[matchIndex];

            if (match && !match.winner) {
                match.winner = winnerId;
            } else {
                return;
            }

            if (!realm) return;

            const updateData = { groupStructure: newGroupStructure };

            // Check if ALL group matches are complete → advance to finals
            const allFrostDone = newGroupStructure.frost.every(r => r.matches.every(m => m.winner));
            const allFireDone = newGroupStructure.fire.every(r => r.matches.every(m => m.winner));

            if (allFrostDone && allFireDone) {
                // Calculate standings and advance top 2 from each realm
                const frostStandings = calculateRoundRobinStandings(
                    matchup.realms.frost, newGroupStructure.frost, matchup.format, matchup.playerScores
                );
                const fireStandings = calculateRoundRobinStandings(
                    matchup.realms.fire, newGroupStructure.fire, matchup.format, matchup.playerScores
                );

                const top2Frost = frostStandings.slice(0, 2).map(s => s.team);
                const top2Fire = fireStandings.slice(0, 2).map(s => s.team);
                const finalsTeams = [...top2Frost, ...top2Fire]; // [Frost#1, Frost#2, Fire#1, Fire#2]

                // Advance to Single Elimination Finals (Visual Bracket)
                const finalsStructure = generateFinalsSingleElimination(finalsTeams);

                updateData.phase = 'finals';
                updateData.finalsStructure = finalsStructure;
                updateData.finalsParticipants = finalsTeams;
                updateData.groupStandings = {
                    frost: frostStandings.map(s => ({ teamId: s.teamId, points: s.points, wins: s.wins, draws: s.draws, losses: s.losses })),
                    fire: fireStandings.map(s => ({ teamId: s.teamId, points: s.points, wins: s.wins, draws: s.draws, losses: s.losses }))
                };
            }

            await updateDoc(matchupRef, updateData);

        } else if (phase === 'finals') {
            const newFinalsStructure = JSON.parse(JSON.stringify(matchup.finalsStructure));
            const round = newFinalsStructure[roundIndex];
            const match = round?.matches?.[matchIndex];
            if (!match || match.winner) return;

            match.winner = winnerId;
            const loserParticipant = (getUID(match.player1) === winnerId) ? match.player2 : match.player1;
            const winnerParticipant = (getUID(match.player1) === winnerId) ? match.player1 : match.player2;

            // PROPAGATE TO NEXT ROUND (SE 4-team bracket)
            if (roundIndex === 0 && winnerParticipant && loserParticipant) {
                const nextRound = newFinalsStructure[1];
                if (nextRound) {
                    const grandFinal = nextRound.matches[0];
                    const thirdPlace = nextRound.matches[1];

                    if (matchIndex === 0) { // SF1
                        grandFinal.player1 = winnerParticipant;
                        thirdPlace.player1 = loserParticipant;
                    } else { // SF2
                        grandFinal.player2 = winnerParticipant;
                        thirdPlace.player2 = loserParticipant;
                    }
                }
            }

            const updateData = { finalsStructure: newFinalsStructure };

            // Check if all finals matches are complete
            const allDone = newFinalsStructure.every(r => r.matches.every(m => m.winner));
            if (allDone) {
                // Use SE calculator for standings
                const standings = calculateFinalsStandings(newFinalsStructure);
                updateData.phase = 'completed';
                updateData.finalStandings = standings;
            }

            await updateDoc(matchupRef, updateData);
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

    const handleZoomIn = () => setZoomLevel(prev => Math.min(prev + 0.1, 2));
    const handleZoomOut = () => setZoomLevel(prev => Math.max(prev - 0.1, 0.5));
    const handleZoomReset = () => setZoomLevel(1);

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

    const handleOpenEdit = () => {
        setEditFormData({
            description: matchup.description || '',
            poolPrize: matchup.poolPrize || '',
            maxParticipants: matchup.maxParticipants || 16,
            startDate: matchup.startDate 
                ? new Date(matchup.startDate.seconds ? matchup.startDate.toMillis() : matchup.startDate).toISOString().slice(0, 16)
                : '',
            prize1: matchup.prize1 || '',
            prize2: matchup.prize2 || '',
            prize3: matchup.prize3 || '',
            allowedRarities: matchup.allowedRarities || ''
        });
        setShowEditModal(true);
    };

    const handleEditChange = (e) => {
        const { name, value } = e.target;
        setEditFormData(prev => ({
            ...prev,
            [name]: value
        }));
    };

    const handleSaveEdit = async () => {
        if (!isAdmin) return;
        try {
            setIsSavingEdit(true);
            const mRef = doc(db, 'matchups', matchupId);
            
            const sDate = editFormData.startDate ? new Date(editFormData.startDate) : null;
            
            const updateConfig = {
                description: editFormData.description,
                poolPrize: editFormData.poolPrize,
                maxParticipants: parseInt(editFormData.maxParticipants, 10) || 16,
                prize1: parseFloat(editFormData.prize1) || 0,
                prize2: parseFloat(editFormData.prize2) || 0,
                prize3: parseFloat(editFormData.prize3) || 0,
                allowedRarities: editFormData.allowedRarities || ''
            };
            if (sDate) {
                updateConfig.startDate = sDate;
            }
            
            await updateDoc(mRef, updateConfig);
            setShowEditModal(false);
        } catch (error) {
            console.error("Error updating matchup:", error);
            alert("Failed to update matchup");
        } finally {
            setIsSavingEdit(false);
        }
    };

    const copyToClipboard = (text, label) => {
        navigator.clipboard.writeText(text);
        alert(`${label} copied to clipboard!`);
    };

    const handleCreateAllDraftsForRound = async (roundIndex, realmKey = null) => {
        if (!isAdmin || !matchup) return;

        let structure, structureFieldPath;
        if (matchup.tournamentType === 'realm_round_robin') {
            const phase = matchup.phase === 'completed' ? 'finals' : matchup.phase;
            if (phase === 'groups' && realmKey) {
                structure = matchup.groupStructure?.[realmKey] || [];
                structureFieldPath = `groupStructure.${realmKey}`;
            } else {
                structure = matchup.finalsStructure || [];
                structureFieldPath = 'finalsStructure';
            }
        } else {
            structure = matchup.matchupStructure || [];
            structureFieldPath = 'matchupStructure';
        }

        const round = structure[roundIndex];
        if (!round) return;

        const matchesToCreate = round.matches.filter(m => !m.draftId && !m.winner && m.player1 && m.player2);
        if (matchesToCreate.length === 0) {
            alert('No eligible matches in this round to create drafts for.');
            return;
        }

        if (!window.confirm(`Create drafts for all ${matchesToCreate.length} active matches in this round?`)) return;

        const roundKey = realmKey ? `round_${realmKey}_${roundIndex}` : `round_${roundIndex}`;
        if (creatingDrafts[roundKey]) return;

        try {
            setCreatingDrafts(prev => ({ ...prev, [roundKey]: true }));
            const newStructure = JSON.parse(JSON.stringify(structure));
            const roundLabel = realmKey ? (realmKey === 'frost' ? '❄️ Frost' : '🔥 Fire') : (round.title || `Round ${roundIndex + 1}`);

            for (let i = 0; i < round.matches.length; i++) {
                const match = round.matches[i];
                if (match.draftId || match.winner || !match.player1 || !match.player2) continue;

                // Basic draft creation logic (simplified version of handleCreateDraftFromMatch without navigate)
                const tournamentId = `tournament_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                const draftTitle = `${matchup.title} — ${roundLabel} M${i + 1}`;
                const draftType = matchup.draftType || 'mode3';
                const is1v1 = draftType === 'mode3' || draftType === 'mode4';
                const permissions = {};
                permissions[user.uid] = 'admin';

                let preAssignedTeams, teamNames, teamBanners;
                if (matchup.format === 'teams') {
                    const t1 = match.player1;
                    const t2 = match.player2;
                    preAssignedTeams = {
                        team1: { leader: t1.leader || null, member1: t1.members?.[0] || null, member2: t1.members?.[1] || null },
                        team2: { leader: t2.leader || null, member1: t2.members?.[0] || null, member2: t2.members?.[1] || null }
                    };
                    teamNames = { team1: t1.teamName || 'Team 1', team2: t2.teamName || 'Team 2' };
                    teamBanners = { team1: t1.banner || null, team2: t2.banner || null };
                    [t1.leader, ...(t1.members || []), t2.leader, ...(t2.members || [])].forEach(uid => {
                        if (uid && !permissions[uid]) permissions[uid] = 'spectator';
                    });
                } else {
                    const p1uid = typeof match.player1 === 'object' ? match.player1.uid : match.player1;
                    const p2uid = typeof match.player2 === 'object' ? match.player2.uid : match.player2;
                    preAssignedTeams = {
                        team1: { leader: p1uid || null, member1: null, member2: null },
                        team2: { leader: p2uid || null, member1: null, member2: null }
                    };
                    const p1user = getUserById(p1uid);
                    const p2user = getUserById(p2uid);
                    teamNames = {
                        team1: p1user?.auroryPlayerName || p1user?.displayName || 'Player 1',
                        team2: p2user?.auroryPlayerName || p2user?.displayName || 'Player 2'
                    };
                    teamBanners = { team1: null, team2: null };
                    if (p1uid && !permissions[p1uid]) permissions[p1uid] = 'spectator';
                    if (p2uid && !permissions[p2uid]) permissions[p2uid] = 'spectator';
                }

                await setDoc(doc(db, 'drafts', tournamentId), {
                    title: draftTitle,
                    description: matchup.description || '',
                    prizePool: 'Tournament Match',
                    draftType,
                    timerDuration: 5 * 60 * 1000,
                    manualTimerStart: !is1v1,
                    timerStarted: false,
                    teamA: [],
                    teamB: [],
                    currentPhase: 0,
                    currentTeam: 'A',
                    picksInPhase: 0,
                    status: is1v1 && preAssignedTeams.team1.leader && preAssignedTeams.team2.leader ? 'coinFlip' : 'waiting',
                    permissions,
                    preAssignedTeams,
                    teamNames,
                    teamBanners,
                    createdAt: serverTimestamp(),
                    createdBy: user.uid,
                    matchupId,
                    matchRoundIndex: roundIndex,
                    matchMatchIndex: i,
                    realmPhase: matchup.tournamentType === 'realm_round_robin' ? (realmKey ? 'groups' : 'finals') : null,
                    realmName: realmKey || null,
                    isFriendly: true
                });

                newStructure[roundIndex].matches[i].draftId = tournamentId;
            }

            const matchupRef = doc(db, 'matchups', matchupId);
            await updateDoc(matchupRef, { [structureFieldPath]: newStructure });
            alert(`Successfully created ${matchesToCreate.length} drafts.`);
        } catch (err) {
            console.error('Bulk creation failed:', err);
            alert('Failed to create all drafts: ' + err.message);
        } finally {
            setCreatingDrafts(prev => {
                const newState = { ...prev };
                delete newState[roundKey];
                return newState;
            });
        }
    };

    const handleCreateDraftFromMatch = async (roundIndex, matchIndex, realmKey) => {
        if (!isAdmin || !matchup) return;

        // Resolve the correct structure and match based on tournament type
        let structure, match, structureFieldPath, roundLabel;

        if (matchup.tournamentType === 'realm_round_robin') {
            if (matchup.phase === 'groups' && realmKey) {
                structure = matchup.groupStructure?.[realmKey] || [];
                match = structure[roundIndex]?.matches?.[matchIndex];
                structureFieldPath = `groupStructure.${realmKey}`;
                const realmLabel = realmKey === 'frost' ? '❄️ Frost' : '🔥 Fire';
                roundLabel = `${realmLabel} R${roundIndex + 1}`;
            } else if (matchup.phase === 'finals') {
                structure = matchup.finalsStructure || [];
                match = structure[roundIndex]?.matches?.[matchIndex];
                structureFieldPath = 'finalsStructure';
                roundLabel = `👑 Valhalla R${roundIndex + 1}`;
            }
        } else {
            structure = matchup.matchupStructure;
            match = structure?.[roundIndex]?.matches?.[matchIndex];
            structureFieldPath = 'matchupStructure';
            roundLabel = structure?.[roundIndex]?.title || `Round ${roundIndex + 1}`;
        }

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

        const matchKey = realmKey ? `match_${realmKey}_${roundIndex}_${matchIndex}` : `match_${roundIndex}_${matchIndex}`;
        if (creatingDrafts[matchKey]) return;

        const draftTitle = `${matchup.title} — ${roundLabel} M${matchIndex + 1}`;
        const draftType = matchup.draftType || 'mode3';
        const is1v1 = draftType === 'mode3' || draftType === 'mode4';

        try {
            setCreatingDrafts(prev => ({ ...prev, [matchKey]: true }));
            const tournamentId = `tournament_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const draftRef = doc(db, 'drafts', tournamentId);

            const permissions = {};
            permissions[user.uid] = 'admin';

            let preAssignedTeams, teamNames, teamBanners;

            if (matchup.format === 'teams') {
                const t1 = match.player1;
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

                [t1.leader, ...(t1.members || []), t2.leader, ...(t2.members || [])].forEach(uid => {
                    if (uid && !permissions[uid]) permissions[uid] = 'spectator';
                });
            } else {
                const p1uid = typeof match.player1 === 'object' ? match.player1.uid : match.player1;
                const p2uid = typeof match.player2 === 'object' ? match.player2.uid : match.player2;
                const p1user = getUserById(p1uid);
                const p2user = getUserById(p2uid);

                preAssignedTeams = {
                    team1: { leader: p1uid || null, member1: null, member2: null },
                    team2: { leader: p2uid || null, member1: null, member2: null }
                };
                teamNames = {
                    team1: resolveDisplayName(p1user),
                    team2: resolveDisplayName(p2user)
                };
                teamBanners = { team1: null, team2: null };

                if (p1uid && !permissions[p1uid]) permissions[p1uid] = 'spectator';
                if (p2uid && !permissions[p2uid]) permissions[p2uid] = 'spectator';
            }

            const timerMs = 5 * 60 * 1000;

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
                creatorDisplayName: resolveDisplayName(profile || user) || 'Admin',
                poolAmount: 0,
                entryFee: 0,
                isFriendly: true,
                joinable: false,
                entryPaid: {},
                matchupId: matchupId,
                matchRoundIndex: roundIndex,
                matchMatchIndex: matchIndex,
                realmPhase: matchup.tournamentType === 'realm_round_robin' ? matchup.phase : null,
                realmName: realmKey || null
            };

            if (is1v1) {
                tournamentData.privateCode = Math.floor(100000 + Math.random() * 900000).toString();
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

            // Update the correct matchup structure with draftId
            const newStructure = JSON.parse(JSON.stringify(structure));
            newStructure[roundIndex].matches[matchIndex].draftId = tournamentId;

            const matchupRef = doc(db, 'matchups', matchupId);
            await updateDoc(matchupRef, {
                [structureFieldPath]: newStructure
            });

            navigate(`/tournament/${tournamentId}`);
        } catch (err) {
            console.error('Error creating draft from match:', err);
            alert('Failed to create draft: ' + err.message);
        } finally {
            setCreatingDrafts(prev => {
                const newState = { ...prev };
                delete newState[matchKey];
                return newState;
            });
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
    const canJoin = user && !user.isAnonymous && profile?.auroryPlayerId && !isJoined && matchup.participants.length < matchup.maxParticipants && matchup.status === 'waiting';
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
                            {isAdmin ? '👑 Admin' : `👤 ${resolveDisplayName(profile || user)}`}
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
                                        <div className="detail-card prize-card-featured">
                                            <span className="label">Tournament Prize Pool</span>
                                            <div className="prize-main-value">
                                                <span className="value prize">💎 {matchup.poolPrize} AURY Pool</span>
                                            </div>
                                            <div className="prize-tiers-details">
                                                {matchup.prize1 > 0 && <span className="tier-p">🥇 1st: {matchup.prize1} AURY</span>}
                                                {matchup.prize2 > 0 && <span className="tier-p">🥈 2nd: {matchup.prize2} AURY</span>}
                                                {matchup.prize3 > 0 && <span className="tier-p">🥉 3rd: {matchup.prize3} AURY</span>}
                                            </div>
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
                                        <div className="detail-card">
                                            <span className="label">Entry Fee</span>
                                            <span className="value">
                                                {ENTRY_FEE > 0 ? `💰 ${(ENTRY_FEE / 1e9).toFixed(2)} AURY` : '🆓 Free Entry'}
                                            </span>
                                        </div>
                                        {matchup.allowedRarities && (
                                            <div className="detail-card">
                                                <span className="label">Allowed Rarities</span>
                                                <span className="value">✨ {matchup.allowedRarities}</span>
                                            </div>
                                        )}
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
                                        {canJoin && <button className="btn-join-hero" onClick={handleJoin}>Join Tournament</button>}
                                        
                                        {/* Guest User -> Show Log In */}
                                        {(!user || user.isAnonymous) && matchup.status === 'waiting' && !isFull && (
                                            <div className="unlinked-join-container">
                                                <p className="unlinked-warning">🔑 Log in to participate in the tournament</p>
                                                <button className="btn-join-hero" onClick={() => setShowLoginModal(true)}>
                                                    🔑 Log In to Join
                                                </button>
                                            </div>
                                        )}

                                        {/* Logged User but Unlinked -> Show Link Account */}
                                        {user && !user.isAnonymous && !profile?.auroryPlayerId && !isJoined && matchup.status === 'waiting' && !isFull && (
                                            <div className="unlinked-join-container">
                                                <p className="unlinked-warning">⚠️ Link your Aurory account to participate</p>
                                                <button className="btn-link-hero" onClick={() => setShowLinkModal(true)}>
                                                    🔗 Link Account to Join
                                                </button>
                                            </div>
                                        )}

                                        {isJoined && matchup.status === 'waiting' && <button className="btn-leave-hero" onClick={handleLeave}>Leave Tournament</button>}
                                        {isAdmin && matchup.status === 'waiting' && (
                                            <button
                                                className={`btn-start-hero ${matchup.participants.length < 2 ? 'disabled' : ''}`}
                                                onClick={handleStart}
                                                disabled={matchup.participants.length < 2}
                                            >
                                                {matchup.participants.length < 2 ? 'Need 2+ Players' : '🚀 Start Tournament'}
                                            </button>
                                        )}
                                        {isAdmin && (
                                            <div className="admin-actions">
                                                {matchup.status === 'waiting' && !isFull && <button className="btn-mock-hero" onClick={handleAddMock}>🧪 Add Mock</button>}
                                                <button className="btn-edit-hero" onClick={handleOpenEdit} style={{ padding: '10px 24px', fontSize: '0.85rem' }}>✏️ Edit</button>
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
                                        <span className="count-badge">{displayParticipants.length}/{matchup.maxParticipants}</span>
                                    </div>
                                    <div className="participants-list">
                                        {displayParticipants.length > 0 ? displayParticipants.map((p, index) => {
                                            if (matchup.format === 'teams' && typeof p === 'object' && !p.uid) {

                                                const isMyTeam = p.leader === user?.uid || p.members?.includes(user?.uid);
                                                return (
                                                    <div key={index} className={`team-participant-card ${isMyTeam ? 'is-me' : ''}`}>
                                                        {p.banner && (
                                                            <div className="team-card-bg">
                                                                <img src={p.banner} alt="" />
                                                            </div>
                                                        )}
                                                        <div className="team-card-overlay">
                                                            <div className="team-card-header">
                                                                <span className="team-name">{p.teamName}</span>
                                                            </div>
                                                            <div className="team-roster-horizontal">
                                                                {[p.leader, ...(p.members || []).filter(m => m !== p.leader)].map(mid => {
                                                                    const mUser = getUserById(mid);
                                                                    const isLeader = mid === p.leader;
                                                                    return (
                                                                        <div key={mid} className="roster-avatar-wrapper" title={mUser?.auroryPlayerName || mUser?.displayName}>
                                                                            <div className="avatar-container">
                                                                                <img
                                                                                    src={mUser?.auroryProfilePicture || mUser?.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png'}
                                                                                    className="roster-avatar-mini"
                                                                                    alt=""
                                                                                />
                                                                                {isLeader && <div className="leader-crown-badge">👑</div>}
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
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
                            <h3>{matchup.tournamentType === 'single_elimination' ? '🏆 Tournament Bracket' : '🔄 Round Robin Fixtures'}</h3>
                        </div>

                        {matchup.tournamentType === 'single_elimination' ? (
                            /* ── Visual Bracket Structure (Binary Tree Aligned) ── */
                            <div className="visual-bracket-wrapper">
                                <div className="bracket-zoom-controls">
                                    <button onClick={handleZoomOut} className="zoom-btn" title="Zoom Out">-</button>
                                    <span className="zoom-percentage">{Math.round(zoomLevel * 100)}%</span>
                                    <button onClick={handleZoomIn} className="zoom-btn" title="Zoom In">+</button>
                                    <button onClick={handleZoomReset} className="zoom-btn reset" title="Reset Zoom">Reset</button>
                                </div>
                                <div className="visual-bracket-scroll-container">
                                    <div style={{ 
                                        width: 'fit-content',
                                        height: 'fit-content',
                                        minWidth: `${matchup.matchupStructure.length * 340 * zoomLevel}px`,
                                        minHeight: `${(matchup.bracketTotalSlots || 4) * 100 * zoomLevel}px`
                                    }}>
                                        <div
                                            className="visual-bracket-grid"
                                            style={{
                                                gridTemplateColumns: `repeat(${matchup.matchupStructure.length}, 340px)`,
                                                height: `${(matchup.bracketTotalSlots || 4) * 100}px`,
                                                position: 'relative',
                                                transform: `scale(${zoomLevel})`,
                                                transformOrigin: '0 0'
                                            }}
                                        >
                                        {matchup.matchupStructure.map((round, rIndex) => {
                                            const totalSlots = matchup.bracketTotalSlots || Math.pow(2, matchup.matchupStructure.length);

                                            return (
                                                <div key={round.id} className={`bracket-column round-${rIndex + 1} ${rIndex === matchup.matchupStructure.length - 1 ? 'is-finals-column' : ''}`}>
                                                    <div className="round-header-visual">
                                                        <span className="round-title-visual">{round.title}</span>
                                                        <span className="round-count-visual">{round.matches.filter(m => m.winner).length}/{round.matches.length}</span>
                                                    </div>
                                                    <div className="bracket-matches-container-v3">
                                                        {round.matches.map((match, mIndex) => {
                                                            const p1 = matchup.format === 'teams' ? match.player1 : getUserById(match.player1);
                                                            const p2 = matchup.format === 'teams' ? match.player2 : getUserById(match.player2);
                                                            const winnerId = match.winner;
                                                            const isGrandFinal = !match.isThirdPlaceMatch && rIndex === matchup.matchupStructure.length - 1;

                                                            // Absolute Vertical Position
                                                            const topPos = (match.y / totalSlots) * 100;

                                                            // Connector bridge height (to its parent)
                                                            const hasParent = match.parentMatchId && !match.isThirdPlaceMatch;
                                                            const bridgeSlots = hasParent ? Math.abs(match.y - (match.parentY || match.y)) : 0;
                                                            const bridgePx = bridgeSlots * 100;

                                                            return (
                                                                <div
                                                                    key={match.id}
                                                                    className={`bracket-match-card-v3 
                                                                        ${winnerId ? 'resolved' : ''} 
                                                                        ${match.isThirdPlaceMatch ? 'is-third-place' : ''}
                                                                        ${isGrandFinal ? 'is-grand-final' : ''}
                                                                    `}
                                                                    style={{ top: `${topPos}%` }}
                                                                >
                                                                    {match.isThirdPlaceMatch && <div className="match-type-overlay">3rd Place Match</div>}
                                                                    {isGrandFinal && <div className="match-type-overlay-final">🏆 Grand Final</div>}

                                                                    <div className="match-card-body">
                                                                        {/* Team 1 */}
                                                                        <div className={`match-team-row ${winnerId && winnerId === getUID(p1) ? 'winner' : winnerId ? 'loser' : ''}`}>
                                                                            <div className="team-info-visual">
                                                                                <img src={getAvatar(p1)} alt="" className="team-avatar-visual" />
                                                                                <span className="team-name-visual">{getName(p1)}</span>
                                                                            </div>
                                                                            {isAdmin && p1 && !winnerId && !match.isBye && (
                                                                                <button className="win-btn-visual" onClick={() => handleReportWinner(rIndex, mIndex, getUID(p1))}>✓</button>
                                                                            )}
                                                                            {isGrandFinal && winnerId && winnerId === getUID(p1) && <span className="winner-crown">👑</span>}
                                                                        </div>
                                                                        <div className="match-divider-visual">vs</div>
                                                                        {/* Team 2 */}
                                                                        <div className={`match-team-row ${winnerId && winnerId === getUID(p2) ? 'winner' : winnerId ? 'loser' : ''}`}>
                                                                            <div className="team-info-visual">
                                                                                <img src={getAvatar(p2)} alt="" className="team-avatar-visual" />
                                                                                <span className="team-name-visual">{getName(p2)}</span>
                                                                            </div>
                                                                            {isAdmin && p2 && !winnerId && !match.isBye && (
                                                                                <button className="win-btn-visual" onClick={() => handleReportWinner(rIndex, mIndex, getUID(p2))}>✓</button>
                                                                            )}
                                                                            {isGrandFinal && winnerId && winnerId === getUID(p2) && <span className="winner-crown">👑</span>}
                                                                        </div>
                                                                    </div>

                                                                    <div className="match-card-footer">
                                                                        <span className="match-id-visual">MATCH #{match.id.split('-m')[1]}</span>
                                                                        {match.draftId ? (
                                                                            <button className="btn-draft-visual view" onClick={() => handleEnterDraftSafe(match.draftId, rIndex, mIndex)}>
                                                                                {winnerId ? 'VIEW RESULTS' : 'ENTER DRAFT'}
                                                                            </button>
                                                                        ) : (isAdmin && p1 && p2 && !winnerId && !match.isBye && (
                                                                            <button className="btn-draft-visual create" onClick={() => handleCreateDraftFromMatch(rIndex, mIndex)}>
                                                                                CREATE ⚔️
                                                                            </button>
                                                                        ))}
                                                                    </div>

                                                                    {/* Accurate Tree Connectors */}
                                                                    {hasParent && (
                                                                        <>
                                                                            <div className="connector-horizontal-out">
                                                                                <div className="connector-joint"></div>
                                                                            </div>
                                                                            <div
                                                                                className={`connector-vertical-bridge ${match.y < match.parentY ? 'down' : 'up'}`}
                                                                                style={{ height: `${bridgePx}px` }}
                                                                            ></div>
                                                                        </>
                                                                    )}
                                                                    {rIndex > 0 && !match.isThirdPlaceMatch && match.prevMatches?.length > 0 && (
                                                                        <div className="connector-horizontal-in">
                                                                            <div className="connector-joint"></div>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                        </div>
                                    </div>
                                </div>
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
                                            <div className="rr-round-header" onClick={() => toggleRound(round.id)}>
                                                <div className="rr-round-title-group">
                                                    <span className="rr-round-chevron">{expanded ? '▾' : '▸'}</span>
                                                    <span className="rr-round-label">{round.title}</span>
                                                </div>
                                                <div className="rr-round-header-actions">
                                                    {isAdmin && stats.resolved < stats.total && (
                                                        <button
                                                            className="btn-create-all-drafts"
                                                            onClick={(e) => { e.stopPropagation(); handleCreateAllDraftsForRound(rIndex); }}
                                                            title="Create drafts for all matches in this round"
                                                            disabled={creatingDrafts[`round_${rIndex}`]}
                                                        >
                                                            {creatingDrafts[`round_${rIndex}`] ? 'Creating...' : 'Bulk Create ⚔️'}
                                                        </button>
                                                    )}
                                                    <span className={`rr-round-badge ${stats.resolved === stats.total ? 'complete' : ''}`}>
                                                        {stats.resolved}/{stats.total}
                                                    </span>
                                                </div>
                                            </div>

                                            {expanded && (
                                                <div className="rr-round-body">
                                                    {round.matches.map((match, mIndex) => {
                                                        const matchId = `A${matchCounter + mIndex + 1}`;
                                                        const p1 = matchup.format === 'teams' ? match.player1 : getUserById(match.player1);
                                                        const p2 = matchup.format === 'teams' ? match.player2 : getUserById(match.player2);
                                                        const winner = match.winner;

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
                    ACTIVE STATE — TAB: MATCHES (REALM ROUND ROBIN)
                    ═══════════════════════════════════════════ */}
                {matchup.status === 'active' && activeTab === 'matches' && matchup.tournamentType === 'realm_round_robin' && (
                    <div className="tab-content-panel realm-tab-panel">
                        {/* Phase Banner */}
                        <div className={`realm-phase-banner phase-${matchup.phase}`}>
                            {matchup.phase === 'groups' && (
                                <>
                                    <span className="phase-icon">⚔️</span>
                                    <span className="phase-label">Group Stage</span>
                                    <span className="phase-sub">Realm of Frost ❄️ vs Realm of Fire 🔥</span>
                                </>
                            )}
                            {matchup.phase === 'finals' && (
                                <>
                                    <span className="phase-icon">👑</span>
                                    <span className="phase-label">The Throne of Valhalla</span>
                                    <span className="phase-sub">Top 4 teams compete for the crown</span>
                                </>
                            )}
                            {matchup.phase === 'completed' && (
                                <>
                                    <span className="phase-icon">🏆</span>
                                    <span className="phase-label">Tournament Complete</span>
                                    <span className="phase-sub">Final standings decided</span>
                                </>
                            )}
                        </div>

                        {/* Group Phase: Side-by-side Realms */}
                        {(matchup.phase === 'groups' || matchup.groupStructure) && (
                            <div className="realm-groups-container">
                                {['frost', 'fire'].map(realmKey => {
                                    const realmRounds = matchup.groupStructure?.[realmKey] || [];
                                    const realmTeams = matchup.realms?.[realmKey] || [];
                                    const realmLabel = realmKey === 'frost' ? '❄️ Realm of Frost' : '🔥 Realm of Fire';
                                    const realmStandings = realmTeams.length > 0
                                        ? calculateRoundRobinStandings(realmTeams, realmRounds, matchup.format, matchup.playerScores)
                                        : [];

                                    return (
                                        <div key={realmKey} className={`realm-group-panel realm-${realmKey}`}>
                                            <div className="realm-group-header">
                                                <h4>{realmLabel}</h4>
                                                <span className="realm-team-count">{realmTeams.length} teams</span>
                                            </div>

                                            {/* Mini Standings Table */}
                                            <div className="realm-mini-standings">
                                                <table>
                                                    <thead>
                                                        <tr>
                                                            <th>#</th>
                                                            <th>Team</th>
                                                            <th>P</th>
                                                            <th>W</th>
                                                            <th>D</th>
                                                            <th>L</th>
                                                            <th>Pts</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {realmStandings.map((s, idx) => {
                                                            return (
                                                                <tr key={s.teamId} className={`${idx < 2 ? 'advancing' : 'eliminated'} ${matchup.phase !== 'groups' && idx < 2 ? 'advanced' : ''}`}>
                                                                    <td className="rank">{idx + 1}</td>
                                                                    <td className="team-name-cell">
                                                                        {s.team?.teamName || 'Unknown'}
                                                                        {idx < 2 && matchup.phase !== 'groups' && <span className="advance-badge">▲</span>}
                                                                    </td>
                                                                    <td>{s.played}</td>
                                                                    <td>{s.wins}</td>
                                                                    <td>{s.draws}</td>
                                                                    <td>{s.losses}</td>
                                                                    <td className="pts-cell"><strong>{s.points}</strong></td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>

                                            {/* Realm Fixtures */}
                                            <div className="realm-fixtures">
                                                {realmRounds.map((round, rIndex) => {
                                                    const stats = roundStats(round);
                                                    const expanded = isRoundExpanded(round.id);

                                                    return (
                                                        <div key={round.id} className={`rr-round-accordion realm-round ${expanded ? 'expanded' : ''}`}>
                                                            <div className="rr-round-header" onClick={() => toggleRound(round.id)}>
                                                                <div className="rr-round-title-group">
                                                                    <span className="rr-round-chevron">{expanded ? '▾' : '▸'}</span>
                                                                    <span className="rr-round-label">{round.title}</span>
                                                                </div>
                                                                <div className="rr-round-header-actions">
                                                                    {isAdmin && stats.resolved < stats.total && (
                                                                        <button
                                                                            className="btn-create-all-drafts"
                                                                            onClick={(e) => { e.stopPropagation(); handleCreateAllDraftsForRound(rIndex, realmKey); }}
                                                                            title="Create drafts for all matches in this round"
                                                                            disabled={creatingDrafts[`round_${realmKey}_${rIndex}`]}
                                                                        >
                                                                            {creatingDrafts[`round_${realmKey}_${rIndex}`] ? '...' : 'Bulk ⚔️'}
                                                                        </button>
                                                                    )}
                                                                    <span className={`rr-round-badge ${stats.resolved === stats.total ? 'complete' : ''}`}>
                                                                        {stats.resolved}/{stats.total}
                                                                    </span>
                                                                </div>
                                                            </div>

                                                            {expanded && (
                                                                <div className="rr-round-body">
                                                                    {round.matches.map((match, mIndex) => {
                                                                        const prefix = realmKey === 'frost' ? 'Fr' : 'Fi';
                                                                        const matchId = `${prefix}${mIndex + 1}`;
                                                                        const p1 = match.player1;
                                                                        const p2 = match.player2;
                                                                        const winner = match.winner;

                                                                        return (
                                                                            <div key={match.id} className={`rr-compact-row ${winner ? 'resolved' : ''}`}>
                                                                                <span className="rr-row-id">{matchId}</span>
                                                                                <div className={`rr-row-player ${winner && winner === getUID(p1) ? 'winner' : ''} ${winner && winner !== getUID(p1) ? 'loser' : ''}`}>
                                                                                    <img className="rr-row-avatar" src={getAvatar(p1)} alt="" />
                                                                                    <span className="rr-row-name">{getName(p1)}</span>
                                                                                    {isAdmin && p1 && !winner && (
                                                                                        <button className="rr-row-win-btn" onClick={() => handleReportWinner(rIndex, mIndex, getUID(p1), realmKey)} title="Report as winner">✓</button>
                                                                                    )}
                                                                                </div>

                                                                                <span className="rr-row-vs">vs</span>

                                                                                <div className={`rr-row-player ${winner && winner === getUID(p2) ? 'winner' : ''} ${winner && winner !== getUID(p2) ? 'loser' : ''}`}>
                                                                                    <img className="rr-row-avatar" src={getAvatar(p2)} alt="" />
                                                                                    <span className="rr-row-name">{getName(p2)}</span>
                                                                                    {isAdmin && p2 && !winner && (
                                                                                        <button className="rr-row-win-btn" onClick={() => handleReportWinner(rIndex, mIndex, getUID(p2), realmKey)} title="Report as winner">✓</button>
                                                                                    )}
                                                                                </div>

                                                                                <div className="rr-row-actions">
                                                                                    {p1 && p2 && !winner && !match.draftId && isAdmin && (
                                                                                        <button
                                                                                            className="rr-row-draft-btn create"
                                                                                            onClick={() => handleCreateDraftFromMatch(rIndex, mIndex, realmKey)}
                                                                                            title="Create Draft"
                                                                                            disabled={creatingDrafts[`match_${realmKey}_${rIndex}_${mIndex}`]}
                                                                                        >
                                                                                            {creatingDrafts[`match_${realmKey}_${rIndex}_${mIndex}`] ? '⏳' : '⚔️'}
                                                                                        </button>
                                                                                    )}
                                                                                    {match.draftId && (
                                                                                        <button className="rr-row-draft-btn view" onClick={() => handleEnterDraftSafe(match.draftId, rIndex, mIndex, realmKey)} title={winner ? 'View Draft' : 'Open Draft'}>
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
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* Finals Phase: Throne of Valhalla */}
                        {(matchup.phase === 'finals' || matchup.phase === 'completed') && matchup.finalsStructure && (
                            <div className="realm-finals-container">
                                <div className="realm-finals-header">
                                    <h4>👑 The Throne of Valhalla — Finals</h4>
                                </div>

                                <div className="visual-bracket-wrapper finals-bracket">
                                    <div className="bracket-zoom-controls">
                                        <button onClick={handleZoomOut} className="zoom-btn" title="Zoom Out">-</button>
                                        <span className="zoom-percentage">{Math.round(zoomLevel * 100)}%</span>
                                        <button onClick={handleZoomIn} className="zoom-btn" title="Zoom In">+</button>
                                        <button onClick={handleZoomReset} className="zoom-btn reset" title="Reset Zoom">Reset</button>
                                    </div>
                                    <div className="visual-bracket-scroll-container">
                                        <div style={{ 
                                            width: 'fit-content',
                                            height: 'fit-content',
                                            minWidth: `${matchup.finalsStructure.length * 340 * zoomLevel}px`,
                                            minHeight: `${Math.max(4, Math.pow(2, matchup.finalsStructure.length)) * 150 * zoomLevel}px`
                                        }}>
                                            <div
                                                className="visual-bracket-grid"
                                                style={{
                                                    gridTemplateColumns: `repeat(${matchup.finalsStructure.length}, 340px)`,
                                                    height: `${Math.max(4, Math.pow(2, matchup.finalsStructure.length)) * 150}px`,
                                                    position: 'relative',
                                                    transform: `scale(${zoomLevel})`,
                                                    transformOrigin: '0 0'
                                                }}
                                            >
                                            {matchup.finalsStructure.map((round, rIndex) => {
                                                const totalSlots = Math.max(4, Math.pow(2, matchup.finalsStructure.length));

                                                return (
                                                    <div key={round.id} className={`bracket-column round-${rIndex + 1} ${rIndex === matchup.finalsStructure.length - 1 ? 'is-finals-column' : ''}`}>
                                                        <div className="round-header-visual">
                                                            <span className="round-title-visual">{round.title}</span>
                                                            <span className="round-count-visual">{round.matches.filter(m => m.winner).length}/{round.matches.length}</span>
                                                        </div>
                                                        <div className="bracket-matches-container-v3">
                                                            {round.matches.map((match, mIndex) => {
                                                                const p1 = match.player1;
                                                                const p2 = match.player2;
                                                                const winnerId = match.winner;
                                                                const isGrandFinal = !match.isThirdPlaceMatch && rIndex === matchup.finalsStructure.length - 1;

                                                                // Logical Y coordinate fallback for existing data
                                                                let y = match.y;
                                                                if (y === undefined) {
                                                                    if (rIndex === 0) { // Semifinals
                                                                        y = (mIndex === 0) ? 1.0 : 3.0;
                                                                    } else { // Finals
                                                                        y = match.isThirdPlaceMatch ? 3.2 : 2.0;
                                                                    }
                                                                }

                                                                // Parent Y coordinate fallback
                                                                let parentY = match.parentY;
                                                                if (parentY === undefined) {
                                                                    if (rIndex === 0 && !match.isThirdPlaceMatch) {
                                                                        parentY = 2.0; // SFs always lead to GF at 2.0
                                                                    }
                                                                }

                                                                // Absolute Vertical Position
                                                                const topPos = (y / totalSlots) * 100;

                                                                // Connector bridge height (to its parent)
                                                                const hasParent = (match.parentMatchId || (rIndex === 0)) && !match.isThirdPlaceMatch;
                                                                const bridgeSlots = hasParent ? Math.abs(y - (parentY || y)) : 0;
                                                                const bridgePx = bridgeSlots * 150;
                                                                const bridgeDirection = y < (parentY || y) ? 'down' : 'up';

                                                                return (
                                                                    <div
                                                                        key={match.id}
                                                                        className={`bracket-match-card-v3 
                                                                            ${winnerId ? 'resolved' : ''} 
                                                                            ${match.isThirdPlaceMatch ? 'is-third-place' : ''}
                                                                            ${isGrandFinal ? 'is-grand-final' : ''}
                                                                        `}
                                                                        style={{ top: `${topPos}%` }}
                                                                    >
                                                                        {match.isThirdPlaceMatch && <div className="match-type-overlay">3rd Place Match</div>}
                                                                        {isGrandFinal && <div className="match-type-overlay-final">🏆 Grand Final</div>}

                                                                        <div className="match-card-body">
                                                                            {/* Team 1 */}
                                                                            <div className={`match-team-row ${winnerId && winnerId === getUID(p1) ? 'winner' : winnerId ? 'loser' : ''}`}>
                                                                                <div className="team-info-visual">
                                                                                    <img src={getAvatar(p1)} alt="" className="team-avatar-visual" />
                                                                                    <span className="team-name-visual">{getName(p1)}</span>
                                                                                </div>
                                                                                {isAdmin && p1 && !winnerId && (
                                                                                    <button className="win-btn-visual" onClick={() => handleReportWinner(rIndex, mIndex, getUID(p1))}>✓</button>
                                                                                )}
                                                                                {isGrandFinal && winnerId && winnerId === getUID(p1) && <span className="winner-crown">👑</span>}
                                                                            </div>
                                                                            <div className="match-divider-visual">vs</div>
                                                                            {/* Team 2 */}
                                                                            <div className={`match-team-row ${winnerId && winnerId === getUID(p2) ? 'winner' : winnerId ? 'loser' : ''}`}>
                                                                                <div className="team-info-visual">
                                                                                    <img src={getAvatar(p2)} alt="" className="team-avatar-visual" />
                                                                                    <span className="team-name-visual">{getName(p2)}</span>
                                                                                </div>
                                                                                {isAdmin && p2 && !winnerId && (
                                                                                    <button className="win-btn-visual" onClick={() => handleReportWinner(rIndex, mIndex, getUID(p2))}>✓</button>
                                                                                )}
                                                                                {isGrandFinal && winnerId && winnerId === getUID(p2) && <span className="winner-crown">👑</span>}
                                                                            </div>
                                                                        </div>

                                                                        <div className="match-card-footer">
                                                                            <span className="match-id-visual">MATCH #{match.id.split('-m')[1]}</span>
                                                                            {match.draftId ? (
                                                                                <button className="btn-draft-visual view" onClick={() => handleEnterDraftSafe(match.draftId, rIndex, mIndex)}>
                                                                                    {winnerId ? 'VIEW RESULTS' : 'ENTER DRAFT'}
                                                                                </button>
                                                                            ) : (isAdmin && p1 && p2 && !winnerId && (
                                                                                <button className="btn-draft-visual create" onClick={() => handleCreateDraftFromMatch(rIndex, mIndex)}>
                                                                                    CREATE ⚔️
                                                                                </button>
                                                                            ))}
                                                                        </div>

                                                                        {/* Accurate Tree Connectors */}
                                                                        {hasParent && (
                                                                            <>
                                                                                <div className="connector-horizontal-out">
                                                                                    <div className="connector-joint"></div>
                                                                                </div>
                                                                                <div
                                                                                    className={`connector-vertical-bridge ${bridgeDirection}`}
                                                                                    style={{ height: `${bridgePx}px` }}
                                                                                ></div>
                                                                            </>
                                                                        )}
                                                                        {rIndex > 0 && !match.isThirdPlaceMatch && match.prevMatches?.length > 0 && (
                                                                            <div className="connector-horizontal-in">
                                                                                <div className="connector-joint"></div>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            </div>

                                {/* Final Podium */}
                                {matchup.phase === 'completed' && matchup.finalStandings && (
                                    <div className="realm-podium">
                                        <h4 className="podium-title">🏆 Final Standings</h4>
                                        <div className="podium-grid">
                                            {matchup.finalStandings.map((standing, idx) => {
                                                const medals = ['🥇', '🥈', '🥉', '4️⃣'];
                                                const rankClass = ['gold', 'silver', 'bronze', 'fourth'];
                                                const customTitles = [
                                                    "Valhalla's Champions",
                                                    "The Honored Warriors",
                                                    "The Fallen",
                                                    "The Fallen"
                                                ];
                                                return (
                                                    <div key={standing.teamId} className={`podium-card rank-${rankClass[idx]}`}>
                                                        <div className="podium-rank-badge">{customTitles[idx]}</div>
                                                        <span className="podium-medal">{medals[idx]}</span>
                                                        <span className="podium-team">{standing.team?.teamName || 'Unknown'}</span>
                                                        {(idx === 0 && matchup.prize1 > 0) && <span className="podium-prize-win">💰 {matchup.prize1} AURY</span>}
                                                        {(idx === 1 && matchup.prize2 > 0) && <span className="podium-prize-win">💰 {matchup.prize2} AURY</span>}
                                                        {(idx === 2 && matchup.prize3 > 0) && <span className="podium-prize-win">💰 {matchup.prize3} AURY</span>}
                                                        {standing.points !== undefined && <span className="podium-pts">{standing.points} pts</span>}
                                                        {standing.wins !== undefined && <span className="podium-record">{standing.wins}W {standing.draws}D {standing.losses}L</span>}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
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
                                                                <img src={resolveAvatar(pUser)} alt="" />
                                                            </div>
                                                            <span className="p-score-name">{resolveDisplayName(pUser)}</span>
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
                                                        <img src={resolveAvatar(pUser)} alt="" />
                                                    </div>
                                                    <div className="leader-info">
                                                        <span className="leader-name">{resolveDisplayName(pUser)}</span>
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
                                    <div className="detail-card prize-card-featured">
                                        <span className="label">Tournament Prize Pool</span>
                                        <div className="prize-main-value">
                                            <span className="value prize">💎 {matchup.poolPrize} AURY Pool</span>
                                        </div>
                                        <div className="prize-tiers-details">
                                            {matchup.prize1 > 0 && <span className="tier-p">🥇 1st: {matchup.prize1} AURY</span>}
                                            {matchup.prize2 > 0 && <span className="tier-p">🥈 2nd: {matchup.prize2} AURY</span>}
                                            {matchup.prize3 > 0 && <span className="tier-p">🥉 3rd: {matchup.prize3} AURY</span>}
                                        </div>
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
                                    {matchup.allowedRarities && (
                                        <div className="detail-card">
                                            <span className="label">Allowed Rarities</span>
                                            <span className="value">✨ {matchup.allowedRarities}</span>
                                        </div>
                                    )}
                                </div>

                                {matchup.description && (
                                    <div className="description-area">
                                        <label>Description</label>
                                        <p>{matchup.description}</p>
                                    </div>
                                )}

                                {isAdmin && (
                                    <div className="info-admin-actions">
                                        <button className="btn-edit-hero" onClick={handleOpenEdit}>✏️ Edit Matchup</button>
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
                                                            <span className="team-leader-name">👑 {resolveDisplayName(leaderUser)}</span>
                                                        </div>
                                                    </div>
                                                    <div className="team-roster-mini">
                                                        {p.members.map(mid => {
                                                            const mUser = getUserById(mid);
                                                            return (
                                                                <div key={mid} className="roster-item-mini" title={resolveDisplayName(mUser)}>
                                                                    <img src={resolveAvatar(mUser)} alt="" />
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
                                                    <img src={resolveAvatar(targetUser)} alt={resolveDisplayName(targetUser)} className="p-avatar" />
                                                    {targetUser?.isAurorian && <span className="p-aurorian-logo" title="Aurorian NFT Holder">🛡️</span>}
                                                </div>
                                                <div className="p-info">
                                                    <span className="p-name">{resolveDisplayName(targetUser)}</span>
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

            <InsufficientBalanceModal
                isOpen={showBalanceModal}
                onClose={() => setShowBalanceModal(false)}
                requiredAmount={ENTRY_FEE}
                currentBalance={walletBalance}
                onDeposit={() => navigate('/')}
            />

            <LeaveConfirmationModal
                isOpen={showLeaveModal}
                onClose={() => setShowLeaveModal(false)}
                onConfirm={confirmLeave}
            />

            <AuroryAccountLink 
                user={user}
                isOpen={showLinkModal}
                onClose={() => setShowLinkModal(false)}
            />

            {showLoginModal && renderLoginModalContent()}

            {/* Edit Matchup Modal */}
            {showEditModal && (
                <div className="modal-overlay">
                    <div className="edit-matchup-modal">
                        <div className="modal-header">
                            <h3>✏️ Edit Matchup</h3>
                            <button className="close-btn" onClick={() => setShowEditModal(false)}>✕</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label>Start Time</label>
                                <input 
                                    type="datetime-local" 
                                    name="startDate"
                                    value={editFormData.startDate} 
                                    onChange={handleEditChange} 
                                    className="form-input"
                                />
                            </div>
                            <div className="form-group">
                                <label>Prize Pool (Total)</label>
                                <input 
                                    type="text" 
                                    name="poolPrize"
                                    value={editFormData.poolPrize} 
                                    onChange={handleEditChange}
                                    className="form-input" 
                                />
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label>1st Place Prize</label>
                                    <input 
                                        type="number" 
                                        name="prize1"
                                        value={editFormData.prize1} 
                                        onChange={handleEditChange}
                                        step="0.01"
                                        className="form-input" 
                                    />
                                </div>
                                <div className="form-group">
                                    <label>2nd Place Prize</label>
                                    <input 
                                        type="number" 
                                        name="prize2"
                                        value={editFormData.prize2} 
                                        onChange={handleEditChange}
                                        step="0.01"
                                        className="form-input" 
                                    />
                                </div>
                                <div className="form-group">
                                    <label>3rd Place Prize</label>
                                    <input 
                                        type="number" 
                                        name="prize3"
                                        value={editFormData.prize3} 
                                        onChange={handleEditChange}
                                        step="0.01"
                                        className="form-input" 
                                    />
                                </div>
                            </div>
                            <div className="form-group">
                                <label>Max Participants</label>
                                <input 
                                    type="number" 
                                    name="maxParticipants"
                                    value={editFormData.maxParticipants} 
                                    onChange={handleEditChange} 
                                    className="form-input"
                                />
                            </div>
                            <div className="form-group">
                                <label>Allowed Rarities</label>
                                <input 
                                    type="text" 
                                    name="allowedRarities"
                                    value={editFormData.allowedRarities} 
                                    onChange={handleEditChange} 
                                    placeholder="e.g. Common, Rare, Epic"
                                    className="form-input"
                                />
                            </div>
                            <div className="form-group">
                                <label>Description</label>
                                <textarea 
                                    name="description"
                                    value={editFormData.description} 
                                    onChange={handleEditChange} 
                                    className="form-input"
                                    rows="4"
                                />
                            </div>
                        </div>
                        <div className="modal-actions">
                            <button className="btn-cancel" onClick={() => setShowEditModal(false)}>Cancel</button>
                            <button className="btn-save" onClick={handleSaveEdit} disabled={isSavingEdit}>
                                {isSavingEdit ? 'Saving...' : 'Save Changes'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MatchupPage;
