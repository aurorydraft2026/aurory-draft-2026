import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import {
    doc, setDoc, serverTimestamp, runTransaction, collection
} from 'firebase/firestore';
import { isSuperAdmin } from '../config/admins';
import { createNotification } from '../services/notifications';
import { logActivity } from '../services/activityService';

const getUserEmail = (user) => {
    if (!user) return null;
    if (user.email) return user.email;
    if (user.providerData && user.providerData.length > 0) {
        return user.providerData[0].email;
    }
    return null;
};

export const useTournamentCreation = (user, walletBalance, registeredUsers, setShowCreateModal) => {
    const navigate = useNavigate();
    const [isCreatingDraft, setIsCreatingDraft] = useState(false);
    const [participantSearchQuery, setParticipantSearchQuery] = useState('');

    // Team assignment state (3 players per team)
    const [team1, setTeam1] = useState({ leader: null, member1: null, member2: null });
    const [team2, setTeam2] = useState({ leader: null, member1: null, member2: null });
    const [assigningSlot, setAssigningSlot] = useState(null);

    // Team names and banners
    const [team1Name, setTeam1Name] = useState('');
    const [team2Name, setTeam2Name] = useState('');
    const [team1Banner, setTeam1Banner] = useState(null);
    const [team2Banner, setTeam2Banner] = useState(null);

    const [newTournament, setNewTournament] = useState({
        title: '',
        description: '',
        prizePool: '',
        draftType: 'mode1',
        timerDays: 0,
        timerHours: 0,
        timerMinutes: 1,
        timerSeconds: 0,
        manualTimerStart: false,
        poolAmount: '',
        isFriendly: false,
        requiresEntryFee: true
    });

    const isAdminUser = user && (isSuperAdmin(getUserEmail(user)) || user.role === 'admin');

    // Sync default draft type on modal open (if needed via prop or effect outside)
    // But we can just handle it in the hook's initial state or an effect if we pass showCreateModal
    // In HomePage.js line 1064, there's an effect for this.

    // Get user info by ID
    const getUserById = (userId) => {
        return registeredUsers.find(u => u.id === userId);
    };

    // Get all assigned participant IDs
    const getAssignedParticipants = () => {
        const assigned = [];
        if (team1.leader) assigned.push(team1.leader);
        if (team1.member1) assigned.push(team1.member1);
        if (team1.member2) assigned.push(team1.member2);
        if (team2.leader) assigned.push(team2.leader);
        if (team2.member1) assigned.push(team2.member1);
        if (team2.member2) assigned.push(team2.member2);
        return assigned;
    };

    // Check if both teams are complete
    const areTeamsComplete = () => {
        if (newTournament.draftType === 'mode3' || newTournament.draftType === 'mode4') {
            return team1.leader && team2.leader;
        }
        return team1.leader && team1.member1 && team1.member2 &&
            team2.leader && team2.member1 && team2.member2;
    };

    const getAssignedCount = () => {
        return getAssignedParticipants().length;
    };

    const assignParticipant = (userId) => {
        if (!assigningSlot) return;

        const { team, roles, sessionRoles } = assigningSlot;
        const currentRole = roles[0];

        const targetUser = getUserById(userId);
        if (!targetUser?.auroryPlayerId) {
            alert('This user has not linked an Aurory account and cannot participate in the draft.');
            return;
        }

        if (team === 1) {
            setTeam1(prev => ({ ...prev, [currentRole]: userId }));
        } else {
            setTeam2(prev => ({ ...prev, [currentRole]: userId }));
        }

        const remainingRoles = roles.slice(1);
        if (remainingRoles.length > 0) {
            setAssigningSlot({ team, roles: remainingRoles, sessionRoles });
        } else {
            setAssigningSlot(null);
        }
        setParticipantSearchQuery('');
    };

    const handleDeselectDuringFlow = (role) => {
        if (!assigningSlot) return;
        const { team, roles, sessionRoles } = assigningSlot;

        if (team === 1) {
            setTeam1(prev => ({ ...prev, [role]: null }));
        } else {
            setTeam2(prev => ({ ...prev, [role]: null }));
        }

        if (sessionRoles.includes(role) && !roles.includes(role)) {
            setAssigningSlot({
                team,
                roles: [role, ...roles],
                sessionRoles
            });
        }
    };

    const removeFromSlot = (team, role) => {
        if (team === 1) {
            setTeam1(prev => ({ ...prev, [role]: null }));
        } else {
            setTeam2(prev => ({ ...prev, [role]: null }));
        }
    };

    const handleBannerUpload = (teamNumber, event) => {
        const file = event.target.files?.[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            alert('Please select an image file');
            return;
        }

        if (file.size > 2 * 1024 * 1024) {
            alert('Image must be smaller than 2MB');
            return;
        }

        const reader = new FileReader();
        reader.onloadend = () => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_SIZE = 256;
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > MAX_SIZE) {
                        height = Math.round((height * MAX_SIZE) / width);
                        width = MAX_SIZE;
                    }
                } else {
                    if (height > MAX_SIZE) {
                        width = Math.round((width * MAX_SIZE) / height);
                        height = MAX_SIZE;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                const compressed = canvas.toDataURL('image/jpeg', 0.7);
                if (teamNumber === 1) {
                    setTeam1Banner(compressed);
                } else {
                    setTeam2Banner(compressed);
                }
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    };

    const handleCreateTournament = async () => {
        if (isCreatingDraft) return;

        if (!newTournament.title.trim()) {
            alert('Please enter a draft title');
            return;
        }

        const is1v1 = newTournament.draftType === 'mode3' || newTournament.draftType === 'mode4';

        const timerMs = (
            (newTournament.timerDays * 24 * 60 * 60 * 1000) +
            (newTournament.timerHours * 60 * 60 * 1000) +
            (newTournament.timerMinutes * 60 * 1000) +
            (newTournament.timerSeconds * 1000)
        );

        if (timerMs <= 0) {
            alert('Please set a timer duration greater than 0');
            return;
        }

        if (is1v1 && timerMs < 30 * 1000) {
            alert('1v1 drafts require a minimum timer of 30 seconds so both players have time to prepare.');
            return;
        }

        if (!is1v1 && !newTournament.manualTimerStart && !areTeamsComplete()) {
            alert('Please assign all 6 participants, or check "Start timer manually" to add participants later.');
            return;
        }

        const isFriendly = is1v1 ? newTournament.isFriendly : true;
        const requiresEntryFee = is1v1 && !isFriendly ? (newTournament.requiresEntryFee !== false) : true;
        const poolAmountAury = is1v1 && !isFriendly ? parseFloat(newTournament.poolAmount) || 0 : 0;
        const poolAmountSmallest = Math.floor(poolAmountAury * 1e9);

        const entryFee = requiresEntryFee ? Math.floor(poolAmountSmallest / 2) : 0;

        if (is1v1 && !isFriendly && poolAmountAury <= 0) {
            alert('Please enter a pool amount greater than 0, or check "Friendly Match".');
            return;
        }

        const creatorIsPlayer1 = team1.leader === user.uid;
        const creatorIsPlayer2 = team2.leader === user.uid;
        const creatorIsPlayer = creatorIsPlayer1 || creatorIsPlayer2;

        let creatorDeduction = 0;
        if (is1v1 && !isFriendly) {
            if (!requiresEntryFee) {
                creatorDeduction = poolAmountSmallest;
            } else if (creatorIsPlayer) {
                creatorDeduction = entryFee;
            }
        }

        if (creatorDeduction > 0) {
            if (walletBalance < creatorDeduction) {
                alert(`Insufficient balance to create this match. You need at least ${(creatorDeduction / 1e9).toFixed(2)} AURY.`);
                return;
            }
        }

        try {
            setIsCreatingDraft(true);
            const tournamentId = `tournament_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const draftRef = doc(db, 'drafts', tournamentId);

            if (creatorDeduction > 0) {
                const walletRef = doc(db, 'wallets', user.uid);
                await runTransaction(db, async (transaction) => {
                    const walletDoc = await transaction.get(walletRef);
                    const currentBalance = walletDoc.exists() ? (walletDoc.data().balance || 0) : 0;
                    if (currentBalance < creatorDeduction) {
                        throw new Error('Insufficient balance');
                    }
                    transaction.update(walletRef, {
                        balance: currentBalance - creatorDeduction,
                        updatedAt: serverTimestamp()
                    });
                    const txRef = doc(collection(db, 'wallets', user.uid, 'transactions'));
                    transaction.set(txRef, {
                        type: !requiresEntryFee ? 'sponsored_pool' : 'entry_fee',
                        amount: creatorDeduction,
                        draftId: tournamentId,
                        draftTitle: newTournament.title.trim(),
                        timestamp: serverTimestamp()
                    });
                });
            }

            const permissions = {};
            permissions[user.uid] = 'admin';
            getAssignedParticipants().forEach(uid => {
                if (!permissions[uid]) permissions[uid] = 'spectator';
            });

            const pendingInvites = {};
            const actualPreAssignedTeams = {
                team1: { leader: team1.leader || null, member1: team1.member1 || null, member2: team1.member2 || null },
                team2: { leader: team2.leader || null, member1: team2.member1 || null, member2: team2.member2 || null }
            };

            if (is1v1 && !isFriendly && entryFee > 0) {
                ['team1', 'team2'].forEach(slot => {
                    const leaderUid = slot === 'team1' ? team1.leader : team2.leader;
                    if (leaderUid && leaderUid !== user.uid) {
                        pendingInvites[leaderUid] = slot;
                        actualPreAssignedTeams[slot].leader = null;
                    }
                });
            }

            const preAssignedTeams = actualPreAssignedTeams;

            const team1LeaderUser = getUserById(team1.leader);
            const team2LeaderUser = getUserById(team2.leader);
            const teamNames = {
                team1: team1Name.trim() || team1LeaderUser?.auroryPlayerName || team1LeaderUser?.displayName || team1LeaderUser?.username || 'Player 1',
                team2: team2Name.trim() || team2LeaderUser?.auroryPlayerName || team2LeaderUser?.displayName || team2LeaderUser?.username || 'Player 2',
            };

            const teamBanners = {
                team1: team1Banner || null,
                team2: team2Banner || null,
            };

            const bothPlayersAssigned = is1v1 && preAssignedTeams.team1.leader && preAssignedTeams.team2.leader;
            const hasOpenSlots = is1v1 && (!preAssignedTeams.team1.leader || !preAssignedTeams.team2.leader);

            const tournamentData = {
                title: newTournament.title.trim(),
                description: newTournament.description.trim(),
                prizePool: is1v1 ? (isFriendly ? 'Friendly' : `${poolAmountAury} AURY`) : newTournament.prizePool.trim(),
                draftType: newTournament.draftType,
                timerDuration: timerMs,
                manualTimerStart: is1v1 ? false : newTournament.manualTimerStart,
                timerStarted: false,
                teamA: [],
                teamB: [],
                currentPhase: 0,
                currentTeam: 'A',
                picksInPhase: 0,
                timerStartA: null,
                timerStartB: null,
                status: bothPlayersAssigned ? 'coinFlip' : 'waiting',
                permissions: permissions,
                preAssignedTeams: preAssignedTeams,
                pendingInvites: pendingInvites,
                teamNames: teamNames,
                teamBanners: teamBanners,
                lockedPhases: [],
                awaitingLockConfirmation: false,
                activeViewers: {},
                createdAt: serverTimestamp(),
                createdBy: user.uid,
                creatorDisplayName: user.auroryPlayerName || user.displayName || user.email || 'Unknown',
                poolAmount: poolAmountSmallest,
                entryFee: entryFee,
                isFriendly: isFriendly,
                joinable: hasOpenSlots,
                entryPaid: creatorDeduction > 0 ? { [user.uid]: creatorDeduction } : {}
            };

            if (is1v1) {
                tournamentData.privateCode = Math.floor(10000 + Math.random() * 90000).toString();
            }

            if (bothPlayersAssigned) {
                tournamentData.coinFlip = {
                    phase: 'rolling',
                    team1Locked: false,
                    team2Locked: false,
                    result: null,
                    winner: null,
                    winnerTurnChoice: null
                };
            }

            await setDoc(draftRef, tournamentData);

            logActivity({
                user,
                type: 'DRAFT',
                action: 'create_draft',
                metadata: {
                    draftId: tournamentId,
                    title: tournamentData.title,
                    draftType: tournamentData.draftType,
                    prizePool: tournamentData.prizePool
                }
            });

            setNewTournament({
                title: '',
                description: '',
                prizePool: '',
                draftType: isAdminUser ? 'mode1' : 'mode3',
                timerDays: 0,
                timerHours: 0,
                timerMinutes: 1,
                timerSeconds: 0,
                manualTimerStart: false,
                poolAmount: '',
                isFriendly: false,
                requiresEntryFee: true
            });
            setTeam1({ leader: null, member1: null, member2: null });
            setTeam2({ leader: null, member1: null, member2: null });
            setTeam1Name('');
            setTeam2Name('');
            setTeam1Banner(null);
            setTeam2Banner(null);
            setAssigningSlot(null);
            setParticipantSearchQuery('');
            setIsCreatingDraft(false);
            setShowCreateModal(false);

            const assignedUids = getAssignedParticipants();
            for (const uid of assignedUids) {
                if (uid === user.uid) continue;
                await createNotification(uid, {
                    type: 'invite',
                    title: is1v1 ? '1v1 Challenge!' : 'Draft Invitation',
                    message: is1v1
                        ? `You've been challenged to a 1v1 match: "${newTournament.title.trim()}"${!isFriendly ? ` (Entry: ${(entryFee / 1e9).toFixed(2)} AURY)` : ' (Friendly)'}`
                        : `You have been invited to participate in "${newTournament.title.trim()}".`,
                    link: `/tournament/${tournamentId}`
                });
            }

            navigate(`/tournament/${tournamentId}`, {
                state: { autoStart: !is1v1 && !newTournament.manualTimerStart }
            });
        } catch (error) {
            setIsCreatingDraft(false);
            console.error('Error creating tournament:', error);
            alert('Failed to create draft: ' + error.message);
        }
    };

    return {
        newTournament, setNewTournament,
        team1, setTeam1,
        team2, setTeam2,
        team1Name, setTeam1Name,
        team2Name, setTeam2Name,
        team1Banner, setTeam1Banner,
        team2Banner, setTeam2Banner,
        assigningSlot, setAssigningSlot,
        participantSearchQuery, setParticipantSearchQuery,
        isCreatingDraft,
        handleCreateTournament,
        assignParticipant,
        removeFromSlot,
        handleDeselectDuringFlow,
        handleBannerUpload,
        getAssignedParticipants,
        areTeamsComplete,
        getAssignedCount,
        getUserById
    };
};
