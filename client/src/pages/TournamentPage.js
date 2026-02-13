import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { auth, db } from '../firebase';
import {
  collection,
  doc,
  setDoc,
  onSnapshot,
  updateDoc,
  serverTimestamp,
  getDocs,
  deleteDoc,
  addDoc,
  query,
  orderBy,
  limit,
  runTransaction,
  deleteField,
  arrayUnion,
  increment,
  where,
  documentId,
  startAt,
  endAt
} from 'firebase/firestore';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { AMIKOS, getPICK_ORDER, ELEMENTS } from '../data/amikos';
import { ElementBadge, RankStars } from '../components/AmikoEnhancements';
import { isSuperAdmin } from '../config/admins';
import { useSounds } from '../hooks/useSounds';
import { createNotification } from '../services/notifications';
import Mode1Draft from '../components/drafts/Mode1Draft';
import Mode2Draft from '../components/drafts/Mode2Draft';
import Mode3Draft from '../components/drafts/Mode3Draft';
import Mode4Draft from '../components/drafts/Mode4Draft';
import '../components/drafts/Mode4Draft.css';
import { verifyDraftBattles, saveVerificationResults } from '../services/matchVerificationService';
import { logActivity } from '../services/activityService';
import LoadingScreen from '../components/LoadingScreen';
import './TournamentPage.css';

// Helper function to get user email
const getUserEmail = (user) => {
  if (!user) return null;
  if (user.email) return user.email;
  if (user.providerData && user.providerData.length > 0) {
    return user.providerData[0].email;
  }
  return null;
};

// Helper function to get user display name
const getUserDisplayName = (user) => {
  if (!user) return 'Unknown';
  if (user.auroryPlayerName) return user.auroryPlayerName; // Priority 1: Linked Aurory Name
  if (user.displayName) return user.displayName; // Priority 2: Firebase Display Name
  if (user.providerData && user.providerData.length > 0) {
    const provider = user.providerData[0];
    return provider.displayName || provider.uid || getUserEmail(user)?.split('@')[0] || 'Discord User';
  }
  return getUserEmail(user)?.split('@')[0] || 'Unknown';
};

// Helper function to get user profile picture (Aurory > Discord > default)
const DEFAULT_AVATAR = 'https://cdn.discordapp.com/embed/avatars/0.png';
const getUserProfilePicture = (user) => {
  if (!user) return DEFAULT_AVATAR;
  return user.auroryProfilePicture || (user.photoURL && user.photoURL !== '' ? user.photoURL : DEFAULT_AVATAR);
};

function TournamentPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { tournamentId } = useParams();
  const DRAFT_ID = tournamentId; // Use tournament ID from URL
  const autoStartTriggered = useRef(false);

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tournamentExists, setTournamentExists] = useState(true);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [registeredUsers, setRegisteredUsers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');

  const [hoveredCard, setHoveredCard] = useState(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  const chatContainerRef = useRef(null); // Add this line with other useRef declarations
  const registeredUsersRef = useRef(registeredUsers);


  // Participants selection state
  const [selectedParticipants, setSelectedParticipants] = useState([]);

  // Roulette animation state
  const [showRoulette, setShowRoulette] = useState(false);
  const [roulettePhase, setRoulettePhase] = useState('idle'); // 'idle', 'scrambling', 'revealing', 'done'
  const [teamAssignments, setTeamAssignments] = useState([]);

  // Edit tournament modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editTournament, setEditTournament] = useState({
    title: '',
    description: '',
    prizePool: '',
    draftType: 'mode1',
    timerDays: 0,
    timerHours: 24,
    timerMinutes: 0,
    timerSeconds: 0,
    manualTimerStart: false
  });

  // Lock confirmation modal state
  const [showLockConfirmation, setShowLockConfirmation] = useState(false);

  // App modal state (for alerts and confirmations)
  const [appModal, setAppModal] = useState({
    show: false,
    type: 'alert', // 'alert' or 'confirm'
    title: '',
    message: '',
    onConfirm: null
  });

  // Spectator count state
  const [spectatorCount, setSpectatorCount] = useState(0);

  const [showLineupPreview, setShowLineupPreview] = useState(false);
  const [userVote, setUserVote] = useState(null); // 'A', 'B', or null
  const [isCoinFlipHidden, setIsCoinFlipHidden] = useState(false);



  // Preparation phase state (1.5-second delay between turns)
  const [showPreparation, setShowPreparation] = useState(false);
  const [preparationCountdown, setPreparationCountdown] = useState(1.5);
  const [nextTeamAfterPrep, setNextTeamAfterPrep] = useState(null);

  // Team chat state
  const [chatMessages, setChatMessages] = useState([]);
  const [freeForAllMessages, setFreeForAllMessages] = useState([]);
  const [spectatorMessages, setSpectatorMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [chatTab, setChatTab] = useState('team'); // 'team', 'freeforall', or 'spectator'
  const [adminChatTeam, setAdminChatTeam] = useState('A'); // For admins to toggle between Team A and B
  const chatEndRef = useRef(null);

  const chatInputRef = useRef(null);

  // Chat reactions state
  const [activeReactionPicker, setActiveReactionPicker] = useState(null); // messageId or null
  const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢'];

  // Typing indicator state
  const [typingUsers, setTypingUsers] = useState({}); // { team: { uid: { name, timestamp } } }
  const typingTimeoutRef = useRef(null);
  const lastTypingUpdateRef = useRef(0);
  const isPickingRef = useRef(false);

  // Verification state
  const [isVerifying, setIsVerifying] = useState(false);

  // Optimistic pick state (to prevent flickering)
  const [tempPick, setTempPick] = useState(null); // { id: 'amiko1', team: 'A' }

  // Shuffle animation state for 1v1 pools
  const [shuffleHighlights, setShuffleHighlights] = useState([]);

  // Wallet balance for join/payout
  const [walletBalance, setWalletBalance] = useState(0);

  // Join flow state
  const [isJoining, setIsJoining] = useState(false);

  // Fetch wallet balance (live)
  useEffect(() => {
    if (!user) { setWalletBalance(0); return; }
    const walletRef = doc(db, 'wallets', user.uid);
    const unsub = onSnapshot(walletRef, (snap) => {
      setWalletBalance(snap.exists() ? (snap.data().balance || 0) : 0);
    }, () => setWalletBalance(0));
    return () => unsub();
  }, [user]);

  // Sound effects hook
  const {
    playPickSound,
    playRemoveSound,
    playLockSound,
    checkTimerTick
  } = useSounds();



  // Copy text to clipboard
  const copyToClipboard = (text, type = 'Text') => {
    navigator.clipboard.writeText(text)
      .then(() => {
        showAlert('Copied!', `${type} copied to clipboard.`);
      })
      .catch(err => {
        console.error('Failed to copy text: ', err);
      });
  };

  // Show alert modal
  const showAlert = useCallback((title, message) => {
    setAppModal({
      show: true,
      type: 'alert',
      title,
      message,
      onConfirm: null
    });
  }, []);

  // Show confirm modal
  const showConfirm = useCallback((title, message, onConfirm) => {
    setAppModal({
      show: true,
      type: 'confirm',
      title,
      message,
      onConfirm
    });
  }, []);

  // Close app modal
  const closeAppModal = useCallback(() => {
    setAppModal(prev => ({ ...prev, show: false }));
  }, []);

  // Handle confirm action
  const handleAppModalConfirm = () => {
    if (appModal.onConfirm) {
      appModal.onConfirm();
    }
    closeAppModal();
  };

  // Draft state
  const [draftState, setDraftState] = useState({
    teamA: [],
    teamB: [],
    currentPhase: 0,
    currentTeam: 'A',
    picksInPhase: 0,
    timerStartA: null,
    timerStartB: null,
    status: 'waiting',
    permissions: {},
    // NEW: Track locked phases - once a phase is locked, those picks cannot be edited
    lockedPhases: [],
    // NEW: Track if we're waiting for lock confirmation
    awaitingLockConfirmation: false,
    // Tournament settings
    title: '',
    description: '',
    prizePool: '',
    draftType: 'mode1', // NEW: Add this line
    timerDuration: 30 * 1000, // Default 30 seconds in ms
    // Active viewers tracking
    activeViewers: {},
    // Manual timer control
    manualTimerStart: false,
    timerStarted: false,
    // Coin flip state (Blue/Red Roll system)
    coinFlip: {
      phase: 'waiting', // waiting | rolling | spinning | result | turnChoice | done
      team1Locked: false, // Has Team 1 (Blue) leader clicked Roll?
      team2Locked: false, // Has Team 2 (Red) leader clicked Roll?
      result: null, // 'blue' | 'red' (pre-determined before spin animation)
      winner: null, // 1 | 2 (which pre-assigned team won)
      winnerTurnChoice: null // 'first' | 'second' (1st pick or 2nd pick)
    }
  });

  const [userPermission, setUserPermission] = useState(null);

  // Helper: Build initial permissions from assignments
  const getInitialPermissions = useCallback((existingPermissions, assignments) => {
    const permissions = { ...existingPermissions };
    permissions[user.uid] = 'admin'; // Ensure admin has access
    assignments.forEach(assignment => {
      permissions[assignment.participant.uid || assignment.participant.id] = assignment.team;
    });
    return permissions;
  }, [user]);

  // Helper: Initialize mode-specific data (pools, battle codes)
  const initializeModeSpecificData = (draftType, timerMs, manualTimer, existingDraft) => {
    const data = {};

    if (draftType === 'mode3') {
      const shuffledAmikos = [...AMIKOS].sort(() => Math.random() - 0.5);
      data.playerAPool = shuffledAmikos.slice(0, 8).map(a => a.id);
      data.playerBPool = shuffledAmikos.slice(8, 16).map(a => a.id);
      data.simultaneousPicking = true;
      data.currentTeam = 'AB';
      data.sharedTimer = manualTimer ? null : Date.now();
      data.timerMs = timerMs;
      data.status = 'poolShuffle';
      if (!existingDraft?.privateCode) {
        data.privateCode = Math.floor(10000 + Math.random() * 90000).toString();
      }
    } else if (draftType === 'mode4') {
      data.teamABans = [];
      data.teamBBans = [];
      data.bannedAmikos = [];
      if (!existingDraft?.privateCode) {
        data.privateCode = Math.floor(10000 + Math.random() * 90000).toString();
      }
    } else if (draftType === 'mode1' || draftType === 'mode2') {
      if (!existingDraft?.privateCodes) {
        const generatedCodes = [];
        while (generatedCodes.length < 3) {
          const code = Math.floor(10000 + Math.random() * 90000).toString();
          if (!generatedCodes.includes(code)) generatedCodes.push(code);
        }
        data.privateCodes = generatedCodes;
      }
    }
    return data;
  };

  // Helper: Send match start notifications to participants
  const sendMatchStartNotifications = useCallback(async (existingDraft, assignments) => {
    const tournamentTitle = existingDraft?.title || 'Tournament';
    const tournamentLink = `/tournament/${DRAFT_ID}`;

    try {
      assignments.forEach(a => {
        const p = a.participant;
        if (p) {
          createNotification(p.uid || p.id, {
            title: tournamentTitle,
            message: `Match Found! Head to the draft to begin.`,
            type: 'invite',
            link: tournamentLink
          });
        }
      });
    } catch (err) {
      console.error('Failed to send start notifications:', err);
    }
  }, [DRAFT_ID]);

  // Helper: Send battle code notifications once draft is complete
  const sendBattleCodeNotifications = useCallback(async (draft) => {
    const tournamentTitle = draft?.title || 'Tournament';
    const tournamentLink = `/tournament/${DRAFT_ID}`;
    const draftType = draft?.draftType;
    const players = draft?.matchPlayers || [];

    try {
      if (draftType === 'mode3' || draftType === 'mode4') {
        const p1 = players.find(p => p.team === 'A');
        const p2 = players.find(p => p.team === 'B');
        const code = draft.privateCode;
        if (p1) createNotification(p1.uid, { title: tournamentTitle, message: `Draft Complete! Your battle code: ${code}`, type: 'invite', link: tournamentLink });
        if (p2) createNotification(p2.uid, { title: tournamentTitle, message: `Draft Complete! Your battle code: ${code}`, type: 'invite', link: tournamentLink });
      } else if (draftType === 'mode1' || draftType === 'mode2') {
        const codes = draft.privateCodes || [];
        const teamA = players.filter(p => p.team === 'A');
        const teamB = players.filter(p => p.team === 'B');
        [0, 1, 2].forEach(i => {
          [teamA[i], teamB[i]].filter(Boolean).forEach(p =>
            createNotification(p.uid, { title: `${tournamentTitle} (Match ${i + 1})`, message: `Draft Complete! Your battle code: ${codes[i]}`, type: 'invite', link: tournamentLink })
          );
        });
      }
    } catch (err) {
      console.error('Failed to send battle code notifications:', err);
    }
  }, [DRAFT_ID]);

  // Helper: Reconstruct matchPlayers from permissions (for legacy drafts)
  const reconstructMatchPlayers = (draftState) => {
    const permissions = draftState.permissions || {};
    const teamALeader = draftState.teamALeader;
    const teamBLeader = draftState.teamBLeader;

    if (!teamALeader || !teamBLeader) return null;

    const teamAUids = Object.entries(permissions).filter(([, p]) => p === 'A').map(([uid]) => uid);
    const teamBUids = Object.entries(permissions).filter(([, p]) => p === 'B').map(([uid]) => uid);

    if (teamAUids.length === 0 || teamBUids.length === 0) return null;

    const sortedA = [teamALeader, ...teamAUids.filter(uid => uid !== teamALeader)];
    const sortedB = [teamBLeader, ...teamBUids.filter(uid => uid !== teamBLeader)];

    const reconstructed = [];
    const mapPlayer = (uid, team) => {
      const u = registeredUsers.find(user => user.uid === uid || user.id === uid);
      if (!u) return null;
      return {
        team,
        uid,
        displayName: u.displayName || u.username || null,
        auroryPlayerId: u.auroryPlayerId || null,
        auroryPlayerName: u.auroryPlayerName || null
      };
    };

    sortedA.forEach(uid => {
      const p = mapPlayer(uid, 'A');
      if (p) reconstructed.push(p);
    });
    sortedB.forEach(uid => {
      const p = mapPlayer(uid, 'B');
      if (p) reconstructed.push(p);
    });

    return reconstructed.length > 0 ? reconstructed : null;
  };



  // Finalize draft after roulette
  const finalizeDraft = useCallback(async (timerMs, assignments, leaders = {}) => {
    const draftRef = doc(db, 'drafts', DRAFT_ID);

    try {
      const result = await runTransaction(db, async (transaction) => {
        const docSnap = await transaction.get(draftRef);
        if (!docSnap.exists()) return { error: 'Draft not found' };

        const currentData = docSnap.data();
        // IDEMPOTENCY CHECK: If already active or completed, don't re-initialize
        if (currentData.status !== 'waiting') {
          return { alreadyProcessed: true };
        }

        // 1. Build permissions
        const permissions = getInitialPermissions(currentData.permissions, assignments);

        // 2. Configure team metadata
        const is1v1Mode = currentData.draftType === 'mode3' || currentData.draftType === 'mode4';
        const manualTimer = is1v1Mode ? false : (currentData.manualTimerStart || false);

        const teamALeaderUser = registeredUsers.find(u => u.uid === leaders.teamALeader || u.id === leaders.teamALeader);
        const teamBLeaderUser = registeredUsers.find(u => u.uid === leaders.teamBLeader || u.id === leaders.teamBLeader);

        const updatedLeaderNames = {
          ...(currentData.leaderNames || {}),
          teamA: teamALeaderUser?.username || teamALeaderUser?.displayName || 'Team A Captain',
          teamB: teamBLeaderUser?.username || teamBLeaderUser?.displayName || 'Team B Captain'
        };

        const teamColors = {
          teamA: leaders.teamAIsOriginalTeam1 === false ? 'red' : 'blue',
          teamB: leaders.teamAIsOriginalTeam1 === false ? 'blue' : 'red'
        };

        // 3. Base update data
        let updateData = {
          teamA: [],
          teamB: [],
          currentPhase: 0,
          currentTeam: 'A',
          picksInPhase: 0,
          timerStartA: manualTimer ? null : Date.now(),
          timerStartB: null,
          timerStarted: !manualTimer,
          status: 'active',
          permissions: permissions,
          lockedPhases: [],
          awaitingLockConfirmation: false,
          timerDuration: timerMs,
          teamALeader: leaders.teamALeader || null,
          teamBLeader: leaders.teamBLeader || null,
          leaderNames: updatedLeaderNames,
          teamNames: currentData.teamNames || { team1: 'Team 1', team2: 'Team 2' },
          teamBanners: currentData.teamBanners || { team1: null, team2: null },
          teamColors: teamColors,
          matchPlayers: assignments.map(a => ({
            team: a.team,
            uid: a.participant.uid || a.participant.id,
            displayName: a.participant.displayName || a.participant.username || null,
            auroryPlayerId: a.participant.auroryPlayerId || null,
            auroryPlayerName: a.participant.auroryPlayerName || null
          })),
          finalAssignments: deleteField(),
          assignmentLeaders: deleteField()
        };

        // 4. Mode-specific logic
        const modeData = initializeModeSpecificData(currentData.draftType, timerMs, manualTimer, currentData);
        updateData = { ...updateData, ...modeData };

        // 5. Update Firestore inside the transaction
        transaction.update(draftRef, updateData);

        return { success: true, snapshot: currentData };
      });

      if (result?.success) {
        // 6. Send start notifications ONLY for the winner of the race
        await sendMatchStartNotifications(result.snapshot, assignments);
      }

      setShowRoulette(false);
      setSelectedParticipants([]);
    } catch (err) {
      console.error('Failed to finalize draft:', err);
      showAlert('Error', 'Failed to start match. Please try again.');
    }
  }, [registeredUsers, DRAFT_ID, getInitialPermissions, sendMatchStartNotifications, showAlert]);


  // Handle Match Verification via Battle Code
  // ============================================================================
  // MATCH VERIFICATION (Auto + Manual)
  // ============================================================================

  // PRODUCTION VERSION of handleVerifyMatch (no debug logging)
  // This ensures matchPlayers is ordered correctly: [Leader, Member1, Member2]

  const handleVerifyMatch = async () => {
    let draftDataForVerification = draftState;

    // If no matchPlayers or finalAssignments, reconstruct from permissions
    if (!draftState.finalAssignments && !draftState.matchPlayers) {
      const reconstructed = reconstructMatchPlayers(draftState);

      if (!reconstructed) {
        showAlert('Not Ready', 'Draft metadata not found or incomplete. Cannot verify.');
        return;
      }

      // Save reconstructed matchPlayers to Firestore
      const draftRef = doc(db, 'drafts', DRAFT_ID);
      await updateDoc(draftRef, { matchPlayers: reconstructed });

      draftDataForVerification = { ...draftState, matchPlayers: reconstructed };
    }


    setIsVerifying(true);
    try {
      const verificationData = await verifyDraftBattles(draftDataForVerification, registeredUsers);

      if (verificationData.error) {
        showAlert('Verification Error', verificationData.error);
        return;
      }

      // Save to Firestore
      await saveVerificationResults(DRAFT_ID, verificationData);

      logActivity({
        user,
        type: 'ADMIN',
        action: 'verify_match',
        metadata: {
          draftId: DRAFT_ID,
          allVerified: verificationData.allVerified,
          winner: verificationData.overallWinner
        }
      });

      if (verificationData.allVerified) {
        const winnerLabel = verificationData.overallWinner === 'A'
          ? getTeamDisplayName('A')
          : verificationData.overallWinner === 'B'
            ? getTeamDisplayName('B')
            : 'Draw';
        showAlert('✅ Matches Verified!', `All battles verified. Winner: ${winnerLabel}`);
      } else {
        const verified = verificationData.results.filter(r => r.status !== 'not_found' && r.status !== 'error').length;
        const total = verificationData.results.length;
        showAlert('Partial Verification', `${verified}/${total} battles verified. Waiting for remaining matches to be played.`);
      }
    } catch (error) {
      console.error('Verification error:', error);
      showAlert('Error', 'An unexpected error occurred during verification.');
    } finally {
      setIsVerifying(false);
    }
  };

  // ─── AUTO-VERIFICATION ───
  // Handled server-side by Cloud Function (verifyMatches) every 2 minutes.
  // Manual verification via handleVerifyMatch button is still available.

  // Initialize draft - now starts coin flip phase for pre-assigned teams
  const initializeDraft = async () => {
    if (!user) return;

    // Get participants from permissions (exclude admins)
    const participants = Object.entries(draftState.permissions || {})
      .filter(([uid, perm]) => perm === 'spectator' || perm === 'A' || perm === 'B')
      .filter(([uid, perm]) => {
        const userObj = registeredUsers.find(u => u.id === uid || u.uid === uid);
        return userObj && !isSuperAdmin(userObj.email);
      })
      .map(([uid]) => uid);

    // Validate at least 2 participants
    if (participants.length < 2) {
      showAlert('Not Enough Participants', 'Please add at least 2 participants in Edit Tournament before starting the draft.');
      return;
    }

    // Use timer from draftState (set when tournament was created/edited)
    const timerMs = draftState.timerDuration || 30 * 1000;

    if (timerMs <= 0) {
      showAlert('Invalid Timer', 'Please set a timer duration greater than 0 in Edit Tournament.');
      return;
    }

    // Close admin panel
    setShowAdminPanel(false);

    // MODE 3: 1v1 Single Draft - GO TO READINESS CONFIRMATION
    if (draftState.draftType === 'mode3') {
      const draftRef = doc(db, 'drafts', DRAFT_ID);
      await updateDoc(draftRef, {
        status: 'coinFlip',
        coinFlip: {
          phase: 'rolling', // Players confirm readiness here
          team1Locked: false,
          team2Locked: false,
          result: null,
          winner: null,
          winnerTurnChoice: null
        }
      });
      return;
    }

    // If pre-assigned teams exist, start coin flip phase
    if (draftState.preAssignedTeams && draftState.preAssignedTeams.team1 && draftState.preAssignedTeams.team2) {
      const draftRef = doc(db, 'drafts', DRAFT_ID);
      await updateDoc(draftRef, {
        status: 'coinFlip',
        coinFlip: {
          phase: 'rolling', // Leaders can now lock their roll
          team1Locked: false,
          team2Locked: false,
          result: null,
          winner: null,
          winnerTurnChoice: null
        }
      });
    } else {
      // No pre-assigned teams - go directly to roulette
      startRouletteAnimation(timerMs, participants);
    }
  };

  // Format AURY amount from smallest unit
  const formatAuryAmount = (amount) => {
    if (!amount) return '0';
    return (amount / 1e9).toFixed(2);
  };

  // Leader locks their roll (Blue/Red coin system)
  const lockRoll = async () => {
    if (!user || !draftState.preAssignedTeams) return;

    const { team1, team2 } = draftState.preAssignedTeams;
    const isTeam1Leader = user.uid === team1.leader;
    const isTeam2Leader = user.uid === team2.leader;

    if (!isTeam1Leader && !isTeam2Leader) return;

    // Check if this player needs to pay entry fee (not friendly, not yet paid)
    const is1v1 = draftState.draftType === 'mode3' || draftState.draftType === 'mode4';
    const entryFee = draftState.entryFee || 0;
    const alreadyPaid = draftState.entryPaid?.[user.uid] > 0;
    const needsPayment = is1v1 && !draftState.isFriendly && entryFee > 0 && !alreadyPaid;

    if (needsPayment) {
      if (walletBalance < entryFee) {
        showAlert('Insufficient Balance', `You need ${formatAuryAmount(entryFee)} AURY to enter this match. Your balance: ${formatAuryAmount(walletBalance)} AURY`);
        return;
      }
    }

    const draftRef = doc(db, 'drafts', DRAFT_ID);

    try {
      // If payment needed, do it atomically with the lock
      if (needsPayment) {
        await runTransaction(db, async (transaction) => {
          const walletRef = doc(db, 'wallets', user.uid);
          const walletSnap = await transaction.get(walletRef);
          const balance = walletSnap.exists() ? (walletSnap.data().balance || 0) : 0;
          if (balance < entryFee) throw new Error('Insufficient balance');

          transaction.update(walletRef, {
            balance: balance - entryFee,
            updatedAt: serverTimestamp()
          });
          const txRef = doc(collection(db, 'wallets', user.uid, 'transactions'));
          transaction.set(txRef, {
            type: 'entry_fee',
            amount: entryFee,
            draftId: DRAFT_ID,
            draftTitle: draftState.title || 'Untitled Match',
            timestamp: serverTimestamp()
          });

          // Also record payment on draft
          transaction.update(draftRef, {
            [`entryPaid.${user.uid}`]: entryFee
          });
        });
      }

      // Now proceed with the lock
      const coinFlip = { ...draftState.coinFlip };

      // Lock the appropriate team
      if (isTeam1Leader && !coinFlip.team1Locked) {
        coinFlip.team1Locked = true;
      } else if (isTeam2Leader && !coinFlip.team2Locked) {
        coinFlip.team2Locked = true;
      }

      // Check if both are now locked
      if (coinFlip.team1Locked && coinFlip.team2Locked) {
        if (draftState.draftType === 'mode3') {
          // MODE 3: Start draft immediately after both are ready
          const timerMs = draftState.timerDuration || 30 * 1000;
          const teamAUsers = [team1?.leader].filter(Boolean).map(uid => registeredUsers.find(u => u.uid === uid || u.id === uid)).filter(Boolean);
          const teamBUsers = [team2?.leader].filter(Boolean).map(uid => registeredUsers.find(u => u.uid === uid || u.id === uid)).filter(Boolean);

          const finalAssignments = [
            ...teamAUsers.map(u => ({ participant: u, team: 'A' })),
            ...teamBUsers.map(u => ({ participant: u, team: 'B' }))
          ];

          await finalizeDraft(timerMs, finalAssignments, {
            teamALeader: team1?.leader,
            teamBLeader: team2?.leader,
            teamAIsOriginalTeam1: true
          });
        } else {
          // Normal mode: Start coin flip animation
          const result = Math.random() < 0.5 ? 'blue' : 'red';
          const winner = result === 'blue' ? 1 : 2; // Team 1 = Blue, Team 2 = Red

          coinFlip.phase = 'spinning';
          coinFlip.result = result;
          coinFlip.winner = winner;
          coinFlip.phaseChangedAt = Date.now();

          await updateDoc(draftRef, { coinFlip });
          // Animation will be handled by UI based on phase change
        }
      } else {
        await updateDoc(draftRef, { coinFlip });
      }
    } catch (error) {
      console.error('Error in lockRoll:', error);
      if (error.message === 'Insufficient balance') {
        showAlert('Insufficient Balance', `You need ${formatAuryAmount(draftState.entryFee)} AURY to confirm.`);
      } else {
        showAlert('Error', 'Failed to confirm. Please try again.');
      }
    }
  };

  // Admin closes/cancels the coin flip
  const closeCoinFlip = async () => {
    if (userPermission !== 'admin' && !isSuperAdmin(getUserEmail(user))) return;

    const draftRef = doc(db, 'drafts', DRAFT_ID);
    await updateDoc(draftRef, {
      status: 'waiting',
      coinFlip: {
        phase: 'waiting',
        team1Locked: false,
        team2Locked: false,
        result: null,
        winner: null,
        winnerTurnChoice: null
      }
    });
    setIsCoinFlipHidden(false);
  };

  // ─── 1v1 JOIN FLOW ───

  // Check if current user can join this draft
  const canJoinDraft = () => {
    if (!user || !draftState.joinable || draftState.status !== 'waiting') return false;
    const is1v1 = draftState.draftType === 'mode3' || draftState.draftType === 'mode4';
    if (!is1v1) return false;
    // Already a participant?
    const teams = draftState.preAssignedTeams;
    if (!teams) return false;
    if (teams.team1?.leader === user.uid || teams.team2?.leader === user.uid) return false;
    // Must have at least one open slot
    return !teams.team1?.leader || !teams.team2?.leader;
  };

  // Handle joining a 1v1 draft
  const handleJoinDraft = async () => {
    if (!user || isJoining) return;
    if (!canJoinDraft()) {
      showAlert('Cannot Join', 'This match is not available for joining.');
      return;
    }

    const entryFee = draftState.entryFee || 0;
    const isFriendly = draftState.isFriendly;

    // Wallet balance check (non-friendly only)
    if (!isFriendly && entryFee > 0) {
      if (walletBalance < entryFee) {
        showAlert('Insufficient Balance', `You need ${formatAuryAmount(entryFee)} AURY to join. Your balance: ${formatAuryAmount(walletBalance)} AURY`);
        return;
      }
    }

    // Show confirmation
    const feeText = isFriendly ? 'Free (Friendly Match)' : `${formatAuryAmount(entryFee)} AURY`;
    showConfirm(
      '⚔️ Join Match',
      `Entry Fee: ${feeText}\n\nAre you sure you want to join this match?${!isFriendly && entryFee > 0 ? `\n\n${formatAuryAmount(entryFee)} AURY will be deducted from your wallet.` : ''}`,
      async () => {
        setIsJoining(true);
        try {
          const draftRef = doc(db, 'drafts', DRAFT_ID);

          await runTransaction(db, async (transaction) => {
            const draftSnap = await transaction.get(draftRef);
            if (!draftSnap.exists()) throw new Error('Draft not found');

            logActivity({
              user,
              type: 'DRAFT',
              action: 'join_draft',
              metadata: {
                draftId: DRAFT_ID,
                entryFee: entryFee
              }
            });

            const data = draftSnap.data();
            if (!data.joinable || data.status !== 'waiting') throw new Error('Match is no longer joinable');

            const teams = data.preAssignedTeams || { team1: {}, team2: {} };

            // Check slot availability again inside transaction
            let slot = null;
            if (!teams.team1?.leader) slot = 'team1';
            else if (!teams.team2?.leader) slot = 'team2';
            if (!slot) throw new Error('No open slots');

            // Check not already joined
            if (teams.team1?.leader === user.uid || teams.team2?.leader === user.uid) {
              throw new Error('Already joined');
            }

            // Deduct entry fee
            if (!data.isFriendly && (data.entryFee || 0) > 0) {
              const walletRef = doc(db, 'wallets', user.uid);
              const walletSnap = await transaction.get(walletRef);
              const balance = walletSnap.exists() ? (walletSnap.data().balance || 0) : 0;
              if (balance < data.entryFee) throw new Error('Insufficient balance');

              transaction.update(walletRef, {
                balance: balance - data.entryFee,
                updatedAt: serverTimestamp()
              });
              // Record transaction
              const txRef = doc(collection(db, 'wallets', user.uid, 'transactions'));
              transaction.set(txRef, {
                type: 'entry_fee',
                amount: data.entryFee,
                draftId: DRAFT_ID,
                draftTitle: data.title || 'Untitled Match',
                timestamp: serverTimestamp()
              });
            }

            // Assign to slot
            const updatedTeams = { ...teams };
            updatedTeams[slot] = { ...updatedTeams[slot], leader: user.uid };

            // Check if both slots now filled
            const bothFilled = updatedTeams.team1?.leader && updatedTeams.team2?.leader;

            // Build display names
            const joinerUser = registeredUsers.find(u => u.uid === user.uid || u.id === user.uid);
            const joinerName = joinerUser?.username || joinerUser?.displayName || user.displayName || 'Player';

            const updateData = {
              preAssignedTeams: updatedTeams,
              [`permissions.${user.uid}`]: 'spectator', // Will be set to A/B when draft starts
              // Update team name for the slot
              [`teamNames.${slot}`]: joinerName,
              // Record entry paid
              [`entryPaid.${user.uid}`]: data.isFriendly ? 0 : (data.entryFee || 0)
            };

            if (bothFilled) {
              // Both players in → transition to coinFlip for confirmation
              updateData.joinable = false;
              updateData.status = 'coinFlip';
              updateData.coinFlip = {
                phase: 'rolling',
                team1Locked: false,
                team2Locked: false,
                result: null,
                winner: null,
                winnerTurnChoice: null
              };
            }

            transaction.update(draftRef, updateData);
          });

          showAlert('🎮 Joined!', 'You have joined the match. Waiting for confirmation...');
        } catch (error) {
          console.error('Join error:', error);
          if (error.message === 'Insufficient balance') {
            showAlert('Insufficient Balance', `You need ${formatAuryAmount(entryFee)} AURY to join.`);
          } else if (error.message === 'Already joined') {
            showAlert('Already Joined', 'You are already in this match.');
          } else {
            showAlert('Error', error.message || 'Failed to join. Please try again.');
          }
        } finally {
          setIsJoining(false);
        }
      }
    );
  };

  // Called after spin animation completes (3s) to move to result phase
  const showCoinResult = async () => {
    const draftRef = doc(db, 'drafts', DRAFT_ID);
    await updateDoc(draftRef, {
      'coinFlip.phase': 'result',
      'coinFlip.phaseChangedAt': Date.now()
    });

    // After 2 seconds showing result, move to turn choice
    setTimeout(async () => {
      await updateDoc(draftRef, {
        'coinFlip.phase': 'turnChoice',
        'coinFlip.phaseChangedAt': Date.now()
      });
    }, 2000);
  };

  // Winner selects turn order (1st pick or 2nd pick)
  const selectTurnOrder = async (turnChoice) => {
    if (!user || !draftState.preAssignedTeams || !draftState.coinFlip) return;

    const { team1, team2 } = draftState.preAssignedTeams;
    const winningTeam = draftState.coinFlip.winner;

    // Only the winning team's leader can select
    const winnerLeaderUid = winningTeam === 1 ? team1.leader : team2.leader;
    if (user.uid !== winnerLeaderUid) return;

    const draftRef = doc(db, 'drafts', DRAFT_ID);
    await updateDoc(draftRef, {
      'coinFlip.winnerTurnChoice': turnChoice,
      'coinFlip.phase': 'done',
      'coinFlip.phaseChangedAt': Date.now()
    });

    // Continue to draft after a delay to show the summary
    setTimeout(() => continueDraftAfterCoinFlip(winningTeam, turnChoice), 2000);
  };

  // Continue draft after coin flip is complete
  const continueDraftAfterCoinFlip = async (passedWinner, passedChoice) => {
    if (!draftState.preAssignedTeams || !draftState.coinFlip) return;

    const { team1, team2 } = draftState.preAssignedTeams;
    const winnerTurnChoice = passedChoice || draftState.coinFlip.winnerTurnChoice;
    const winner = passedWinner || draftState.coinFlip.winner;

    // Determine turn order based on winner's choice
    // Team 1 = Blue, Team 2 = Red
    // Winner picks 'first' = they go first, 'second' = they go second
    let firstPickTeam, secondPickTeam;
    let teamAIsOriginalTeam1; // Track which original team becomes Team A

    if (winner === 1) {
      // Team 1 (Blue) won
      if (winnerTurnChoice === 'first') {
        firstPickTeam = team1;
        secondPickTeam = team2;
        teamAIsOriginalTeam1 = true;
      } else {
        firstPickTeam = team2;
        secondPickTeam = team1;
        teamAIsOriginalTeam1 = false;
      }
    } else {
      // Team 2 (Red) won
      if (winnerTurnChoice === 'first') {
        firstPickTeam = team2;
        secondPickTeam = team1;
        teamAIsOriginalTeam1 = false;
      } else {
        firstPickTeam = team1;
        secondPickTeam = team2;
        teamAIsOriginalTeam1 = true;
      }
    }

    // First pick team becomes Team A (picks first), Second pick becomes Team B
    const teamASource = firstPickTeam;
    const teamBSource = secondPickTeam;

    // Get user objects
    const teamAUsers = [teamASource.leader, teamASource.member1, teamASource.member2]
      .filter(Boolean)
      .map(uid => registeredUsers.find(u => u.uid === uid || u.id === uid))
      .filter(Boolean);

    const teamBUsers = [teamBSource.leader, teamBSource.member1, teamBSource.member2]
      .filter(Boolean)
      .map(uid => registeredUsers.find(u => u.uid === uid || u.id === uid))
      .filter(Boolean);

    // Create final assignments
    const finalAssignments = [
      ...teamAUsers.map(u => ({ participant: u, team: 'A' })),
      ...teamBUsers.map(u => ({ participant: u, team: 'B' }))
    ];

    // Instead of showing roulette locally, update Firestore to trigger it for everyone
    const draftRef = doc(db, 'drafts', DRAFT_ID);
    await updateDoc(draftRef, {
      status: 'assignment',
      assignmentStartedAt: Date.now(),
      finalAssignments: finalAssignments,
      assignmentLeaders: {
        teamALeader: teamASource.leader,
        teamBLeader: teamBSource.leader,
        teamAIsOriginalTeam1: teamAIsOriginalTeam1
      }
    });
  };


  // Start the roulette animation
  const startRouletteAnimation = async (timerMs, participants) => {
    // If we have pre-assigned teams, coin flip should handle this instead
    // This function is only for non-pre-assigned team scenarios (e.g., random assignment in other modes)
    if (draftState.preAssignedTeams && draftState.preAssignedTeams.team1 && draftState.preAssignedTeams.team2) {
      // Pre-assigned teams should use coin flip flow, not this function
      // This is a fallback safety check - initializeDraft should redirect to coin flip
      console.log('Pre-assigned teams detected - should use coin flip flow');
      return;
    }

    // Fallback: Assignment behavior (if no pre-assigned teams)
    let participantUsers = [];
    const teamAUsers = [];
    const teamBUsers = [];

    if (draftState.draftType === 'mode3' || draftState.draftType === 'mode4') {
      // MODE 3/4: 1v1 Modes - Auto-select FIRST 2 registered users
      // We assume registeredUsers matches the display order (registration order)
      // Filter to find valid participants (those who have permission or are in the list)
      const validParticipants = registeredUsers.filter(u => participants.includes(u.uid || u.id));

      // Take the first 2
      participantUsers = validParticipants.slice(0, 2);

      if (participantUsers.length > 0) teamAUsers.push(participantUsers[0]);
      if (participantUsers.length > 1) teamBUsers.push(participantUsers[1]);

    } else {
      // MODE 1/2: Random shuffle of ALL participants
      const shuffled = [...participants].sort(() => Math.random() - 0.5);
      participantUsers = shuffled.map(uid => registeredUsers.find(u => u.uid === uid)).filter(Boolean);

      // Balanced team assignment - split evenly
      participantUsers.forEach((user, index) => {
        if (index % 2 === 0) {
          teamAUsers.push(user);
        } else {
          teamBUsers.push(user);
        }
      });
    }

    // Create final assignments
    const finalAssignments = [
      ...teamAUsers.map(u => ({ participant: u, team: 'A' })),
      ...teamBUsers.map(u => ({ participant: u, team: 'B' }))
    ];

    // For fallback random assignment, first user in each team becomes leader
    const fallbackLeaders = {
      teamALeader: teamAUsers.length > 0 ? (teamAUsers[0].uid || teamAUsers[0].id) : null,
      teamBLeader: teamBUsers.length > 0 ? (teamBUsers[0].uid || teamBUsers[0].id) : null
    };

    // Instead of showing roulette locally, update Firestore to trigger it for everyone
    const draftRef = doc(db, 'drafts', DRAFT_ID);
    await updateDoc(draftRef, {
      status: 'assignment',
      assignmentStartedAt: Date.now(),
      finalAssignments: finalAssignments,
      assignmentLeaders: fallbackLeaders
    });
  };

  // Clear temp pick when it appears in official state
  useEffect(() => {
    if (tempPick) {
      const teamPicks = tempPick.team === 'A' ? draftState.teamA : draftState.teamB;
      const teamBans = tempPick.team === 'A' ? (draftState.teamABans || []) : (draftState.teamBBans || []);
      if (teamPicks.includes(tempPick.id) || teamBans.includes(tempPick.id)) {
        setTempPick(null);
      }
    }
  }, [draftState.teamA, draftState.teamB, draftState.teamABans, draftState.teamBBans, tempPick]);

  // Derived state including temp pick (for flicker-free rendering)
  const displayTeamA = [...draftState.teamA];
  if (tempPick && tempPick.team === 'A' && !displayTeamA.includes(tempPick.id)) {
    displayTeamA.push(tempPick.id);
  }

  const displayTeamB = [...draftState.teamB];
  if (tempPick && tempPick.team === 'B' && !displayTeamB.includes(tempPick.id)) {
    displayTeamB.push(tempPick.id);
  }

  // Mode4: Derived ban display including temp pick during ban phases
  const displayTeamABans = [...(draftState.teamABans || [])];
  const displayTeamBBans = [...(draftState.teamBBans || [])];
  if (tempPick && draftState.draftType === 'mode4') {
    const currentPhaseConfig = getPICK_ORDER('mode4')[draftState.currentPhase || 0];
    if (currentPhaseConfig?.isBan) {
      if (tempPick.team === 'A' && !displayTeamABans.includes(tempPick.id)) {
        displayTeamABans.push(tempPick.id);
      }
      if (tempPick.team === 'B' && !displayTeamBBans.includes(tempPick.id)) {
        displayTeamBBans.push(tempPick.id);
      }
    }
  }

  // Helper: can this user see private battle codes?
  const isParticipantOrAdmin = userPermission === 'A' || userPermission === 'B' || userPermission === 'admin' || isSuperAdmin(getUserEmail(user));

  // Listen to auth state
  // Listen for authentication state changes and user Firestore data
  useEffect(() => {
    let unsubscribeUserDoc = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser(currentUser);

        // Listen for user's Firestore document (for auroraPlayerName)
        const userRef = doc(db, 'users', currentUser.uid);
        unsubscribeUserDoc = onSnapshot(userRef, (docSnap) => {
          if (docSnap.exists()) {
            const firestoreData = docSnap.data();
            setUser(prev => ({
              ...prev,
              ...firestoreData,
              // Prioritize Aurory name for local display
              displayName: firestoreData.auroryPlayerName || firestoreData.displayName || prev?.displayName || currentUser.displayName
            }));
          }
        }, (error) => {
          console.warn('User doc listener error:', error.code);
        });
      } else {
        setUser(null);
        if (unsubscribeUserDoc) unsubscribeUserDoc();
      }
      setLoading(false);
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeUserDoc) unsubscribeUserDoc();
    };
  }, []);

  // Listen to draft state from Firestore
  useEffect(() => {
    const draftRef = doc(db, 'drafts', DRAFT_ID);

    const unsubscribe = onSnapshot(draftRef, async (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();

        // Helper to convert Firestore Timestamp or number to milliseconds
        const toMillis = (val) => {
          if (!val) return null;
          if (typeof val === 'number') return val;
          if (val?.toMillis) return val.toMillis();
          if (val?.seconds) return val.seconds * 1000;
          return val;
        };

        // Ensure fields exist (for backward compatibility)
        const normalizedData = {
          ...data,
          lockedPhases: data.lockedPhases || [],
          awaitingLockConfirmation: data.awaitingLockConfirmation || false,
          title: data.title || '',
          description: data.description || '',
          prizePool: data.prizePool || '',
          draftType: data.draftType || 'mode1',
          timerDuration: data.timerDuration || 30 * 1000,
          activeViewers: data.activeViewers || {},
          manualTimerStart: data.manualTimerStart || false,
          timerStarted: data.timerStarted || false,
          timerStartA: toMillis(data.timerStartA),
          timerStartB: toMillis(data.timerStartB),
          votes: data.votes || { A: {}, B: {} },
          inPreparation: data.inPreparation || false,
          preAssignedTeams: data.preAssignedTeams || null,
          teamALeader: data.teamALeader || null,
          teamBLeader: data.teamBLeader || null,
          // Coin flip state (Blue/Red Roll system)
          coinFlip: data.coinFlip || {
            phase: 'waiting',
            team1Locked: false,
            team2Locked: false,
            result: null,
            winner: null,
            winnerTurnChoice: null
          },
          // Team names and banners
          teamNames: data.teamNames || { team1: 'Team 1', team2: 'Team 2' },
          teamBanners: data.teamBanners || { team1: null, team2: null },
          // Team colors (blue/red) - default: Team A = blue, Team B = red
          teamColors: data.teamColors || { teamA: 'blue', teamB: 'red' },
          finalAssignments: data.finalAssignments || null,
          assignmentLeaders: data.assignmentLeaders || null,
          // Match verification results
          matchResults: data.matchResults || null,
          verificationStatus: data.verificationStatus || null,
          overallWinner: data.overallWinner || null,
          lastVerificationCheck: data.lastVerificationCheck || null,
          matchPlayers: data.matchPlayers || null,
          // Mode 4 - Ban Draft fields
          teamABans: data.teamABans || [],
          teamBBans: data.teamBBans || [],
          bannedAmikos: data.bannedAmikos || [],
          // 1v1 join/pool fields
          joinable: data.joinable || false,
          isFriendly: data.isFriendly || false,
          poolAmount: data.poolAmount || 0,
          entryFee: data.entryFee || 0,
          entryPaid: data.entryPaid || {},
          createdBy: data.createdBy || null,
          payoutComplete: data.payoutComplete || false
        };

        setDraftState(normalizedData);

        // Check if user/viewer has already voted (works for both logged in and anonymous)
        if (normalizedData.votes) {
          // Get voter ID (user.uid if logged in, or anonymous ID from localStorage)
          const voterId = user ? user.uid : localStorage.getItem('aurory_voter_id');

          if (voterId && normalizedData.votes.A && normalizedData.votes.A[voterId]) {
            setUserVote('A');
          } else if (voterId && normalizedData.votes.B && normalizedData.votes.B[voterId]) {
            setUserVote('B');
          } else {
            setUserVote(null);
          }
        }

        // Show lock confirmation modal ONLY if user is the team LEADER (not all team members)
        if (normalizedData.awaitingLockConfirmation && user) {
          const currentTeam = normalizedData.currentTeam;
          const isTeamLeader = (currentTeam === 'A' && user.uid === normalizedData.teamALeader) ||
            (currentTeam === 'B' && user.uid === normalizedData.teamBLeader);
          if (isTeamLeader) {
            setShowLockConfirmation(true);
          } else {
            setShowLockConfirmation(false);
          }
        } else {
          setShowLockConfirmation(false);
        }

        // Set user permissions
        if (user) {
          const userEmail = getUserEmail(user);
          if (isSuperAdmin(userEmail)) {
            const currentPermission = data.permissions?.[user.uid];

            if (currentPermission !== 'admin') {
              await updateDoc(draftRef, {
                [`permissions.${user.uid}`]: 'admin'
              });
            }
            setUserPermission('admin');
          } else if (data.permissions) {
            setUserPermission(data.permissions[user.uid] || 'spectator');
          } else {
            setUserPermission('spectator');
          }
        } else {
          // Non-logged in users are spectators
          setUserPermission('spectator');
        }
        setTournamentExists(true);
      } else {
        // Tournament doesn't exist
        setTournamentExists(false);
        setUserPermission('spectator');
      }
    }, (error) => {
      console.error('Draft listener error:', error.code || error.message);
      // Don't crash - just mark as not existing
      if (error.code === 'permission-denied') {
        setUserPermission('spectator');
      }
    });

    return () => unsubscribe();
  }, [user, DRAFT_ID]);

  // Listen to team chat messages
  useEffect(() => {
    const isAdmin = userPermission === 'admin' || isSuperAdmin(getUserEmail(user));
    const effectiveTeam = isAdmin ? adminChatTeam : userPermission;

    // Only listen if user is on a team (A or B) or is an admin
    if (!user || (!isAdmin && (userPermission !== 'A' && userPermission !== 'B'))) {
      setChatMessages([]);
      return;
    }

    const chatRef = collection(db, 'drafts', DRAFT_ID, `chat${effectiveTeam}`);
    const chatQuery = query(chatRef, orderBy('timestamp', 'asc'), limit(100));

    const unsubscribe = onSnapshot(chatQuery, (snapshot) => {
      const messages = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp?.toMillis?.() || doc.data().timestamp
      }));
      setChatMessages(messages);
    }, (error) => {
      // Silently handle permission errors to prevent Firestore assertion crashes
      if (error.code !== 'permission-denied') {
        console.warn('Team chat listener error:', error.code);
      }
      setChatMessages([]);
    });

    return () => unsubscribe();
  }, [user, userPermission, adminChatTeam, DRAFT_ID]);

  // Listen to participant chat messages (Team A, Team B, and Admins)
  useEffect(() => {
    const isAdmin = userPermission === 'admin' || isSuperAdmin(getUserEmail(user));
    const isParticipant = userPermission === 'A' || userPermission === 'B';

    // Only listen if participant or admin
    if (!isAdmin && !isParticipant) {
      setFreeForAllMessages([]);
      return;
    }

    const chatRef = collection(db, 'drafts', DRAFT_ID, 'chatAll');
    const chatQuery = query(chatRef, orderBy('timestamp', 'asc'), limit(100));

    const unsubscribe = onSnapshot(chatQuery, (snapshot) => {
      const messages = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp?.toMillis?.() || doc.data().timestamp
      }));
      setFreeForAllMessages(messages);
    }, (error) => {
      if (error.code !== 'permission-denied') {
        console.warn('All chat listener error:', error.code);
      }
      setFreeForAllMessages([]);
    });

    return () => unsubscribe();
  }, [DRAFT_ID, userPermission, user]);

  // Listen to spectator chat messages (Viewers and Admins)
  useEffect(() => {
    const isAdmin = userPermission === 'admin' || isSuperAdmin(getUserEmail(user));
    const isSpectator = userPermission === 'spectator';

    // Only listen if spectator or admin
    if (!isAdmin && !isSpectator) {
      setSpectatorMessages([]);
      return;
    }

    const chatRef = collection(db, 'drafts', DRAFT_ID, 'chatSpectators');
    const chatQuery = query(chatRef, orderBy('timestamp', 'asc'), limit(100));

    const unsubscribe = onSnapshot(chatQuery, (snapshot) => {
      const messages = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp?.toMillis?.() || doc.data().timestamp
      }));
      setSpectatorMessages(messages);
    }, (error) => {
      if (error.code !== 'permission-denied') {
        console.warn('Spectator chat listener error:', error.code);
      }
      setSpectatorMessages([]);
    });

    return () => unsubscribe();
  }, [DRAFT_ID, userPermission, user]);

  // Auto-scroll chat to bottom when new messages arrive
  useEffect(() => {
    if (chatEndRef.current && isChatOpen) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, freeForAllMessages, spectatorMessages, isChatOpen, chatTab]);

  // Set default chat tab
  useEffect(() => {
    const isAdmin = userPermission === 'admin' || isSuperAdmin(getUserEmail(user));
    if (userPermission === 'spectator') {
      setChatTab('spectator');
    } else if (draftState.draftType === 'mode3' || draftState.draftType === 'mode4') {
      setChatTab('freeforall');
    } else if (isAdmin) {
      setChatTab('freeforall'); // Admins likely want to see the participants chat by default
    } else {
      setChatTab('team');
    }
  }, [userPermission, draftState.draftType, user]);

  // Listen to typing indicators
  useEffect(() => {
    const isAdmin = userPermission === 'admin' || isSuperAdmin(getUserEmail(user));
    if (!user || !userPermission || (!isAdmin && userPermission !== 'A' && userPermission !== 'B' && userPermission !== 'spectator')) {
      setTypingUsers({});
      return;
    }

    let typingCollection;
    if (chatTab === 'team') {
      const targetTeam = isAdmin ? adminChatTeam : userPermission;
      typingCollection = `typing${targetTeam}`;
    } else if (chatTab === 'freeforall') {
      typingCollection = 'typingAll';
    } else {
      typingCollection = 'typingSpectators';
    }
    const typingRef = collection(db, 'drafts', DRAFT_ID, typingCollection);

    const unsubscribe = onSnapshot(typingRef, (snapshot) => {
      const now = Date.now();
      const typers = {};
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        // Only show typers from last 5 seconds (in case cleanup failed)
        if (data.timestamp && (now - data.timestamp) < 5000 && doc.id !== user?.uid) {
          typers[doc.id] = { name: data.name, timestamp: data.timestamp };
        }
      });
      setTypingUsers(typers);
    }, (error) => {
      // Silently handle permission errors
      if (error.code !== 'permission-denied') {
        console.warn('Typing listener error:', error.code);
      }
      setTypingUsers({});
    });

    return () => unsubscribe();
  }, [user, userPermission, chatTab, adminChatTeam, DRAFT_ID]);

  // Clean up typing status on unmount
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

  // Keep ref in sync with state (avoids stale closure without causing re-renders)
  registeredUsersRef.current = registeredUsers;

  // Fetch specific users by UID (batching support)
  const fetchSpecificUsers = useCallback(async (uidsToFetch) => {
    if (!uidsToFetch || uidsToFetch.length === 0) return;

    // Filter out users we already have (use ref to avoid dependency loop)
    const missingUids = uidsToFetch.filter(uid =>
      !registeredUsersRef.current.some(u => u.uid === uid || u.id === uid)
    );

    if (missingUids.length === 0) return;

    try {
      // Create chunks of 10 for batching (Firestore 'in' limit is 10)
      const chunkSize = 10;
      const chunks = [];
      for (let i = 0; i < missingUids.length; i += chunkSize) {
        chunks.push(missingUids.slice(i, i + chunkSize));
      }

      const newUsers = [];

      for (const chunk of chunks) {
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where(documentId(), 'in', chunk));
        const snapshot = await getDocs(q);

        snapshot.docs.forEach(doc => {
          newUsers.push({
            uid: doc.id,
            id: doc.id, // Ensure both ID formats exist
            ...doc.data()
          });
        });
      }

      if (newUsers.length > 0) {
        setRegisteredUsers(prev => {
          // Merge and deduplicate
          const combined = [...prev, ...newUsers];
          const unique = Array.from(new Map(combined.map(item => [item.uid, item])).values());
          return unique;
        });
      }
    } catch (error) {
      console.error('Error fetching specific users:', error);
    }
  }, []); // No dependency on registeredUsers - uses ref instead

  // Search users for Admin Panel (replaces bulk fetch)
  const searchUsers = useCallback(async (searchTerm) => {
    if (!searchTerm || searchTerm.trim().length < 2) return;

    try {
      const usersRef = collection(db, 'users');
      // Simple prefix search on displayName
      // Note: This requires an index on displayName
      const startText = searchTerm;
      const endText = searchTerm + '\uf8ff';

      const q = query(
        usersRef,
        orderBy('displayName'),
        startAt(startText),
        endAt(endText),
        limit(20)
      );

      const snapshot = await getDocs(q);
      const foundUsers = snapshot.docs.map(doc => ({
        uid: doc.id,
        id: doc.id,
        ...doc.data()
      })).filter(user => user.email); // Only real users

      if (foundUsers.length > 0) {
        setRegisteredUsers(prev => {
          const combined = [...prev, ...foundUsers];
          const unique = Array.from(new Map(combined.map(item => [item.uid, item])).values());
          return unique;
        });
      }
    } catch (error) {
      console.error('Error searching users:', error);
    }
  }, []);

  // AUTOMATICALLY SYNC USERS IN TOURNAMENT
  // This replaces the initial bulk fetch
  // Destructure properties to avoid running effect on every timer tick
  const {
    permissions: draftPermissions,
    teamALeader: draftTeamALeader,
    teamBLeader: draftTeamBLeader,
    assignmentLeaders: draftAssignmentLeaders,
    finalAssignments: draftFinalAssignments,
    preAssignedTeams: draftPreAssignedTeams
  } = draftState || {};

  useEffect(() => {
    const uidsToLoad = new Set();

    // 1. Add people with permissions (participants/spectators)
    if (draftPermissions) {
      Object.keys(draftPermissions).forEach(uid => uidsToLoad.add(uid));
    }

    // 2. Add Leaders
    if (draftTeamALeader) uidsToLoad.add(draftTeamALeader);
    if (draftTeamBLeader) uidsToLoad.add(draftTeamBLeader);
    if (draftAssignmentLeaders) {
      if (draftAssignmentLeaders.teamALeader) uidsToLoad.add(draftAssignmentLeaders.teamALeader);
      if (draftAssignmentLeaders.teamBLeader) uidsToLoad.add(draftAssignmentLeaders.teamBLeader);
    }

    // 3. Add pre-assigned team leaders (for 1v1 waiting/join phase)
    if (draftPreAssignedTeams) {
      if (draftPreAssignedTeams.team1?.leader) uidsToLoad.add(draftPreAssignedTeams.team1.leader);
      if (draftPreAssignedTeams.team2?.leader) uidsToLoad.add(draftPreAssignedTeams.team2.leader);
    }

    // 4. Add anyone in finalAssignments
    if (draftFinalAssignments) {
      draftFinalAssignments.forEach(assignment => {
        if (assignment.participant && (assignment.participant.uid || assignment.participant.id)) {
          uidsToLoad.add(assignment.participant.uid || assignment.participant.id);
        }
      });
    }

    const uidArray = Array.from(uidsToLoad);
    if (uidArray.length > 0) {
      fetchSpecificUsers(uidArray);
    }
  }, [
    draftPermissions,
    draftTeamALeader,
    draftTeamBLeader,
    draftAssignmentLeaders,
    draftFinalAssignments,
    draftPreAssignedTeams,
    fetchSpecificUsers
  ]);

  // Save user info (only once per session to avoid loop with serverTimestamp)
  const userInfoSavedRef = useRef(false);

  const saveUserInfo = useCallback(async () => {
    if (!user) return;
    if (userInfoSavedRef.current) return; // Already saved this session

    try {
      userInfoSavedRef.current = true;
      const userEmail = getUserEmail(user);
      const displayName = getUserDisplayName(user);

      const userRef = doc(db, 'users', user.uid);
      await setDoc(userRef, {
        displayName: displayName,
        photoURL: user.photoURL || '',
        email: userEmail || '',
        lastLogin: serverTimestamp()
      }, { merge: true });
    } catch (error) {
      console.error('Error saving user info:', error);
      userInfoSavedRef.current = false; // Allow retry on error
    }
  }, [user]);

  useEffect(() => {
    if (user && !userInfoSavedRef.current) {
      saveUserInfo();
    }
  }, [user, saveUserInfo]);

  // Auto-start draft if navigated with autoStart flag
  useEffect(() => {
    // Only trigger once
    if (autoStartTriggered.current) return;

    // Check if autoStart was passed via navigation state
    if (!location.state?.autoStart) return;

    // Wait for data to be ready
    if (loading) return;
    if (!user) return;
    if (!tournamentExists) return;
    if (draftState.status !== 'waiting') return;
    if (registeredUsers.length === 0) return;

    // Check if user is admin
    const userEmail = getUserEmail(user);
    const isAdmin = draftState.permissions?.[user.uid] === 'admin' || isSuperAdmin(userEmail);
    if (!isAdmin) return;

    // Get participants from permissions
    const participants = Object.entries(draftState.permissions || {})
      .filter(([uid, perm]) => perm === 'spectator' || perm === 'A' || perm === 'B')
      .filter(([uid]) => {
        const userObj = registeredUsers.find(u => u.id === uid || u.uid === uid);
        return userObj && !isSuperAdmin(userObj.email);
      })
      .map(([uid]) => uid);

    // Need at least 2 participants
    if (participants.length < 2) return;

    // Mark as triggered and start the draft
    autoStartTriggered.current = true;

    const timerMs = draftState.timerDuration || 30 * 1000;
    startRouletteAnimation(timerMs, participants);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, loading, user, tournamentExists, draftState, registeredUsers]);

  // Spectator/viewer tracking - presence updates (only for logged-in users)
  useEffect(() => {
    // Only track presence for logged-in users to avoid permission errors
    if (!user) return;

    const viewerId = user.uid;

    const draftRef = doc(db, 'drafts', DRAFT_ID);
    let isActive = true;

    // Add/update viewer in the activeViewers map
    const updatePresence = async () => {
      if (!isActive) return;
      try {
        await updateDoc(draftRef, {
          [`activeViewers.${viewerId}`]: {
            lastActive: Date.now(),
            displayName: getUserDisplayName(user),
            isAnonymous: false
          }
        });
      } catch (error) {
        // Draft might not exist yet or permission denied, that's okay
        if (error.code !== 'not-found' && error.code !== 'permission-denied') {
          console.log('Presence update skipped:', error.code);
        }
      }
    };

    // Initial presence after short delay to ensure draft exists
    const initialTimeout = setTimeout(updatePresence, 1000);

    // Update presence every 30 seconds
    const heartbeatInterval = setInterval(updatePresence, 30000);

    // Cleanup on unmount
    return () => {
      isActive = false;
      clearTimeout(initialTimeout);
      clearInterval(heartbeatInterval);
      // Note: We don't remove the viewer entry - it will naturally expire
      // after 90 seconds of inactivity when other clients calculate the count
    };
  }, [user, DRAFT_ID]);

  // Calculate spectator count from activeViewers
  useEffect(() => {
    if (!draftState.activeViewers || Object.keys(draftState.activeViewers).length === 0) {
      setSpectatorCount(1); // At least current user
      return;
    }

    const calculateCount = () => {
      const now = Date.now();
      const activeCount = Object.values(draftState.activeViewers).filter(viewer => {
        return viewer && viewer.lastActive && (now - viewer.lastActive) < 90000;
      }).length;
      setSpectatorCount(Math.max(1, activeCount));
    };

    calculateCount();

    // Recalculate every 15 seconds
    const countInterval = setInterval(calculateCount, 15000);

    return () => clearInterval(countInterval);
  }, [draftState.activeViewers]);

  // Sync team assignment animation for all viewers
  useEffect(() => {
    if (draftState.status === 'assignment' && draftState.finalAssignments) {
      // Local animation trigger
      const runSyncedRoulette = async () => {
        // Only run if not already showing
        if (showRoulette) return;

        setShowRoulette(true);
        setRoulettePhase('scrambling');
        setTeamAssignments([]);

        // Get participants list for scrambling animation
        const participants = draftState.finalAssignments.map(a => a.participant);

        // Scramble animation - show shuffling for 2 seconds
        const scrambleDuration = 2000;
        const scrambleInterval = 150;
        let scrambleCount = 0;

        await new Promise(resolve => {
          const scrambler = setInterval(() => {
            const displayOrder = [...participants].sort(() => Math.random() - 0.5);
            setTeamAssignments(displayOrder.map((u, i) => ({
              participant: u,
              team: i % 2 === 0 ? (scrambleCount % 2 === 0 ? 'A' : 'B') : (scrambleCount % 2 === 0 ? 'B' : 'A')
            })));
            scrambleCount++;

            if (scrambleCount * scrambleInterval >= scrambleDuration) {
              clearInterval(scrambler);
              resolve();
            }
          }, scrambleInterval);
        });

        // Reveal final assignments from Firestore
        setRoulettePhase('revealing');
        setTeamAssignments(draftState.finalAssignments);

        // Wait 3 seconds to show final results
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Start the draft
        setRoulettePhase('done');
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Finalize draft: admin, super admin, or Team A leader can trigger this
        // This ensures the draft starts even if the admin is not viewing
        // finalizeDraft reads current Firestore state first, so duplicate calls are safe
        const userEmail = getUserEmail(user);
        const isAdmin = userPermission === 'admin' || isSuperAdmin(userEmail);
        const isTeamALeader = user.uid === draftState.assignmentLeaders?.teamALeader;
        const isTeamBLeader = user.uid === draftState.assignmentLeaders?.teamBLeader;

        if (isAdmin || isTeamALeader || isTeamBLeader) {
          const timerMs = draftState.timerDuration || 30 * 1000;
          await finalizeDraft(timerMs, draftState.finalAssignments, draftState.assignmentLeaders);
        }
      };

      runSyncedRoulette();
    } else if (draftState.status !== 'assignment' && draftState.status !== 'waiting' && draftState.status !== 'coinFlip') {
      // Reset local state if status is no longer assignment (except for waiting/coinFlip phases)
      setShowRoulette(false);
      setRoulettePhase('idle');
      setTeamAssignments([]);
    }
  }, [draftState.status, draftState.finalAssignments, draftState.assignmentLeaders, draftState.timerDuration, user, userPermission, showRoulette, finalizeDraft]);

  // NEW: Amiko Pool Shuffle Animation for Mode 3
  useEffect(() => {
    if (draftState.status === 'poolShuffle' && draftState.draftType === 'mode3') {
      // Start local animation
      const shuffleInterval = setInterval(() => {
        // Pick 8 random amikos and assign them to Team A or Team B for coloring
        const randomHighlights = [];
        for (let i = 0; i < 8; i++) {
          const randomIndex = Math.floor(Math.random() * AMIKOS.length);
          randomHighlights.push({
            id: AMIKOS[randomIndex].id,
            team: Math.random() < 0.5 ? 'A' : 'B'
          });
        }
        setShuffleHighlights(randomHighlights);
      }, 250); // Slower interval (was 100ms)

      // Transition to active after 4 seconds (was 3s)
      // Any participant can trigger this (not just admin)
      const userEmail = getUserEmail(user);
      const isAdmin = userPermission === 'admin' || isSuperAdmin(userEmail);
      const isParticipant = userPermission === 'A' || userPermission === 'B';

      const timer = setTimeout(async () => {
        if (isAdmin || isParticipant) {
          const draftRef = doc(db, 'drafts', DRAFT_ID);
          try {
            await updateDoc(draftRef, {
              status: 'active'
            });
          } catch (err) {
            console.log('poolShuffle transition handled by another client');
          }
        }
      }, 4000); // 4 seconds total shuffle

      return () => {
        clearInterval(shuffleInterval);
        clearTimeout(timer);
        setShuffleHighlights([]);
      };
    }
  }, [draftState.status, draftState.draftType, user, userPermission, DRAFT_ID]);


  // Timer tick sound effect for last 10 seconds
  useEffect(() => {
    if (draftState.status !== 'active') return;

    // Calculate remaining time based on current team's timer
    const timerStart = draftState.currentTeam === 'A'
      ? draftState.timerStartA
      : draftState.timerStartB;
    const timerDuration = draftState.timerMs || 0;

    if (!timerStart || !timerDuration) return;

    // Set up interval to check remaining time
    const tickInterval = setInterval(() => {
      const elapsed = Date.now() - timerStart;
      const remaining = timerDuration - elapsed;

      // Check and play tick sound for last 10 seconds
      checkTimerTick(remaining);
    }, 200); // Check frequently to catch each second

    return () => clearInterval(tickInterval);
  }, [draftState.status, draftState.currentTeam, draftState.timerStartA, draftState.timerStartB, draftState.timerMs, checkTimerTick]);

  // Coin flip spin animation timing - after 3s, show result
  useEffect(() => {
    if (draftState.status === 'coinFlip' && draftState.coinFlip?.phase === 'spinning') {
      const spinTimer = setTimeout(() => {
        showCoinResult();
      }, 3000);
      return () => clearTimeout(spinTimer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftState.status, draftState.coinFlip?.phase]);



  // Helper function to check if a specific pick index is locked
  const isPickLocked = (team, pickIndex) => {
    if (!draftState.lockedPhases || draftState.lockedPhases.length === 0) {
      if (draftState.draftType !== 'mode3' && draftState.draftType !== 'mode4') return false;
    }

    // Mode 3 Logic - 1v1 Single Draft
    if (draftState.draftType === 'mode3') {
      return isTeamLocked(team);
    }

    // Mode 4 Logic - Ban Draft pick phase mapping
    if (draftState.draftType === 'mode4') {
      // Pick phases: B-1(ph4), A-2(ph5), B-2(ph6), A-1(ph7)
      if (team === 'A') {
        // Team A: indices 0-1 → phase 5, index 2 → phase 7
        if (pickIndex <= 1) return draftState.lockedPhases.includes(5);
        return draftState.lockedPhases.includes(7);
      } else {
        // Team B: index 0 → phase 4, indices 1-2 → phase 6
        if (pickIndex === 0) return draftState.lockedPhases.includes(4);
        return draftState.lockedPhases.includes(6);
      }
    }

    // MODE 1 Logic - Map pick indices to phases
    if (draftState.draftType === 'mode1') {
      if (team === 'A') {
        if (pickIndex < 3) {
          return draftState.lockedPhases.includes(0);
        } else {
          return draftState.lockedPhases.includes(2);
        }
      } else { // Team B
        if (pickIndex < 6) {
          return draftState.lockedPhases.includes(1);
        } else {
          return draftState.lockedPhases.includes(3);
        }
      }
    }

    // MODE 2 Logic - Map pick indices to phases
    if (draftState.draftType === 'mode2') {
      if (team === 'A') {
        // Team A: pickIndex 0→P0, 1-2→P2, 3-4→P4, 5-6→P6, 7-8→P8
        const phaseMap = {
          0: 0, 1: 2, 2: 2, 3: 4, 4: 4,
          5: 6, 6: 6, 7: 8, 8: 8
        };
        return draftState.lockedPhases.includes(phaseMap[pickIndex]);
      } else { // Team B
        // Team B: pickIndex 0-1→P1, 2-3→P3, 4-5→P5, 6-7→P7, 8→P9
        const phaseMap = {
          0: 1, 1: 1, 2: 3, 3: 3, 4: 5,
          5: 5, 6: 7, 7: 7, 8: 9
        };
        return draftState.lockedPhases.includes(phaseMap[pickIndex]);
      }
    }

    return false;
  };

  // Helper function to check if a pick should be visible to the current user
  // Picks are hidden from opponents until locked
  const isPickVisibleToUser = (team, pickIndex) => {
    // Draft not active or completed - show all picks
    if (draftState.status !== 'active') {
      return true;
    }

    // Mode 3: Blind picks (hidden from opponent and spectators) until completion
    if (draftState.draftType === 'mode3') {
      return userPermission === team;
    }

    // Mode 4: NOT blind — all picks visible to everyone
    if (draftState.draftType === 'mode4') {
      return true;
    }

    // Admins and owners can see their own team's picks
    if (userPermission === 'admin' || isSuperAdmin(getUserEmail(user)) || userPermission === team) {
      return true;
    }

    // For opponent's picks, only show if locked
    return isPickLocked(team, pickIndex);
  };

  // Helper to check if a specific amiko's pick should be visible in the grid
  const isAmikoPickVisible = (amikoId) => {
    // Check if amiko is in Team A
    const teamAIndex = draftState.teamA.indexOf(amikoId);
    if (teamAIndex !== -1) {
      return isPickVisibleToUser('A', teamAIndex);
    }

    // Check if amiko is in Team B
    const teamBIndex = draftState.teamB.indexOf(amikoId);
    if (teamBIndex !== -1) {
      return isPickVisibleToUser('B', teamBIndex);
    }

    // Not picked
    return false;
  };

  // Execute the pick — fast write using arrayUnion + increment (no transaction needed)
  const executePick = useCallback(async (amikoId) => {
    const draftRef = doc(db, 'drafts', DRAFT_ID);
    const teamKey = draftState.currentTeam === 'A' ? 'teamA' : 'teamB';

    // Client-side duplicate check
    // Mode4: only check own team (opponent CAN pick same amiko)
    // Other modes: check both teams (exclusive picks)
    if (draftState.draftType === 'mode4') {
      const myPicks = draftState[teamKey] || [];
      if (myPicks.includes(amikoId)) {
        showAlert('Already Picked', 'You have already picked this Amiko!');
        return;
      }
    } else {
      const allPicked = [...(draftState.teamA || []), ...(draftState.teamB || [])];
      if (allPicked.includes(amikoId)) {
        showAlert('Already Picked', 'This Amiko has already been picked!');
        return;
      }
    }

    const currentPhaseConfig = getPICK_ORDER(draftState.draftType || 'mode1')[draftState.currentPhase || 0];
    const newPicksInPhase = (draftState.picksInPhase || 0) + 1;

    const updateData = {
      [teamKey]: arrayUnion(amikoId),
      picksInPhase: increment(1)
    };

    // If this pick completes the phase, set awaitingLockConfirmation
    if (newPicksInPhase >= currentPhaseConfig.count) {
      updateData.awaitingLockConfirmation = true;
    }

    try {
      await updateDoc(draftRef, updateData);

      logActivity({
        user,
        type: 'DRAFT',
        action: 'pick_amiko',
        metadata: {
          draftId: DRAFT_ID,
          amikoId: amikoId,
          team: draftState.currentTeam
        }
      });
    } catch (error) {
      console.error('Error executing pick:', error);
      showAlert('Error', 'Failed to pick Amiko. Please try again.');
    }
  }, [DRAFT_ID, draftState, showAlert, user]);

  // Send a chat message
  const sendChatMessage = async (e) => {
    e.preventDefault();

    if (!chatInput.trim() || !user || isSendingMessage) return;

    const isAdmin = userPermission === 'admin' || isSuperAdmin(getUserEmail(user));

    // For team chat, only team members (A or B) can send
    if (chatTab === 'team' && !isAdmin && userPermission !== 'A' && userPermission !== 'B') return;

    // For Participants chat (chatAll / freeforall tab), only team members can send
    if (chatTab === 'freeforall' && !isAdmin && userPermission !== 'A' && userPermission !== 'B') return;

    // For Free For All chat (chatSpectators / spectator tab), only REAL users (not anonymous) and admins can send
    if (chatTab === 'spectator' && !isAdmin && (user.isAnonymous || userPermission !== 'spectator')) return;

    setIsSendingMessage(true);

    try {
      // Determine which chat collection to use
      let chatCollection;
      if (chatTab === 'team') {
        const targetTeam = isAdmin ? adminChatTeam : userPermission;
        chatCollection = `chat${targetTeam}`;
      } else if (chatTab === 'freeforall') {
        chatCollection = 'chatAll';
      } else {
        chatCollection = 'chatSpectators';
      }

      const chatRef = collection(db, 'drafts', DRAFT_ID, chatCollection);

      await addDoc(chatRef, {
        text: chatInput.trim(),
        senderUid: user.uid,
        senderName: getUserDisplayName(user) || 'Anonymous',
        senderPhoto: user.photoURL || null,
        senderAuroryPhoto: user.auroryProfilePicture || null,
        senderIsAurorian: user.isAurorian || false,
        senderTeam: isAdmin ? 'Admin' : userPermission, // Track sender role
        timestamp: serverTimestamp()
      });

      setChatInput('');

      // ✅ KEEP CURSOR IN INPUT
      requestAnimationFrame(() => {
        chatInputRef.current?.focus();
      });
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      setIsSendingMessage(false);
    }
  };

  // Toggle a reaction on a message
  const toggleReaction = async (messageId, emoji, chatCollection) => {
    if (!user) return;

    const messageRef = doc(db, 'drafts', DRAFT_ID, chatCollection, messageId);

    try {
      await runTransaction(db, async (transaction) => {
        const messageDoc = await transaction.get(messageRef);
        if (!messageDoc.exists()) return;

        const data = messageDoc.data();
        const reactions = data.reactions || {};
        const emojiReactions = reactions[emoji] || [];

        if (emojiReactions.includes(user.uid)) {
          // Remove reaction
          reactions[emoji] = emojiReactions.filter(uid => uid !== user.uid);
          if (reactions[emoji].length === 0) {
            delete reactions[emoji];
          }
        } else {
          // Add reaction
          reactions[emoji] = [...emojiReactions, user.uid];
        }

        transaction.update(messageRef, { reactions });
      });
    } catch (error) {
      console.error('Error toggling reaction:', error);
    }

    setActiveReactionPicker(null);
  };

  // Handle typing indicator - update Firestore when user types
  const handleTypingInput = (e) => {
    setChatInput(e.target.value);

    const isAdmin = userPermission === 'admin' || isSuperAdmin(getUserEmail(user));
    if (!user || !userPermission || (!isAdmin && userPermission !== 'A' && userPermission !== 'B' && userPermission !== 'spectator')) return;

    // Only allow spectators to type in their tab if they are not anonymous
    if (userPermission === 'spectator' && (chatTab !== 'spectator' || user.isAnonymous)) return;

    const now = Date.now();
    // Debounce: update Firestore at most every 2 seconds
    if (now - lastTypingUpdateRef.current > 2000) {
      lastTypingUpdateRef.current = now;
      updateTypingStatus(true);
    }

    // Clear typing status after 3 seconds of inactivity
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = setTimeout(() => {
      updateTypingStatus(false);
    }, 3000);
  };

  // Update typing status in Firestore
  const updateTypingStatus = async (isCurrentlyTyping) => {
    const isAdmin = userPermission === 'admin' || isSuperAdmin(getUserEmail(user));
    if (!user || !userPermission || (!isAdmin && userPermission !== 'A' && userPermission !== 'B' && userPermission !== 'spectator')) return;

    let typingCollection;
    if (chatTab === 'team') {
      const targetTeam = isAdmin ? adminChatTeam : userPermission;
      typingCollection = `typing${targetTeam}`;
    } else if (chatTab === 'freeforall') {
      typingCollection = 'typingAll';
    } else {
      typingCollection = 'typingSpectators';
    }
    const typingRef = doc(db, 'drafts', DRAFT_ID, typingCollection, user.uid);

    try {
      if (isCurrentlyTyping) {
        await setDoc(typingRef, {
          name: getUserDisplayName(user),
          isAurorian: user.isAurorian || false,
          timestamp: Date.now()
        });
      } else {
        await deleteDoc(typingRef);
      }
    } catch (error) {
      // Silently fail - typing indicator is not critical
    }
  };

  // Clean up typing status on unmount or when sending message
  const clearTypingStatus = () => {
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    updateTypingStatus(false);
  };

  // Confirm and lock picks, then advance to next phase
  const confirmLockPicks = async () => {
    // Play lock confirmation sound
    playLockSound();

    const draftRef = doc(db, 'drafts', DRAFT_ID);

    let nextPhase = draftState.currentPhase + 1;
    let nextTeam = draftState.currentTeam;
    let newStatus = draftState.status;
    let updates = {};

    // Add current phase to locked phases
    const newLockedPhases = [...(draftState.lockedPhases || []), draftState.currentPhase];

    if (nextPhase >= getPICK_ORDER(draftState.draftType).length) {
      // Draft completed - no preparation needed
      newStatus = 'completed';
      updates = {
        status: newStatus,
        awaitingLockConfirmation: false,
        lockedPhases: newLockedPhases
      };
      await updateDoc(draftRef, updates);
      setShowLockConfirmation(false);

      // Send battle codes now that draft is completed
      await sendBattleCodeNotifications(draftState);

      logActivity({
        user,
        type: 'DRAFT',
        action: 'lock_picks',
        metadata: {
          draftId: DRAFT_ID,
          phase: draftState.currentPhase,
          status: newStatus
        }
      });
    } else {
      // Advance to next phase - but don't start timer yet
      nextTeam = getPICK_ORDER(draftState.draftType)[nextPhase].team;

      updates = {
        currentPhase: nextPhase,
        currentTeam: nextTeam,
        picksInPhase: 0,
        awaitingLockConfirmation: false,
        lockedPhases: newLockedPhases,
        // Set a flag indicating we're in preparation phase
        inPreparation: true,
        preparationStartedAt: Date.now()
      };

      await updateDoc(draftRef, updates);
      setShowLockConfirmation(false);

      // Start the 1.5-second preparation countdown
      setNextTeamAfterPrep(nextTeam);
      setPreparationCountdown(1.5);
      setShowPreparation(true);
    }
  };

  // Handle preparation countdown completion - start the timer
  const startNextTurnAfterPreparation = useCallback(async () => {
    const draftRef = doc(db, 'drafts', DRAFT_ID);

    const updates = {
      inPreparation: false
    };

    // Start timer for the current team
    if (draftState.currentTeam === 'A') {
      updates.timerStartA = Date.now();
    } else {
      updates.timerStartB = Date.now();
    }

    await updateDoc(draftRef, updates);
    setShowPreparation(false);
    setNextTeamAfterPrep(null);
  }, [DRAFT_ID, draftState.currentTeam]);

  // Preparation countdown effect
  useEffect(() => {
    if (!showPreparation) return;

    if (preparationCountdown <= 0) {
      startNextTurnAfterPreparation();
      return;
    }

    const timer = setTimeout(() => {
      setPreparationCountdown(prev => prev - 0.5);
    }, 500);

    return () => clearTimeout(timer);
  }, [showPreparation, preparationCountdown, startNextTurnAfterPreparation]);

  // Cancel lock confirmation - allow user to change picks
  const cancelLockConfirmation = async () => {
    const draftRef = doc(db, 'drafts', DRAFT_ID);

    // Just set awaitingLockConfirmation to false
    // User must remove a pick first before selecting a new one
    await updateDoc(draftRef, {
      awaitingLockConfirmation: false
    });

    setShowLockConfirmation(false);
  };

  // Trigger lock confirmation modal (when user is ready after editing)
  const triggerLockConfirmation = async () => {
    const draftRef = doc(db, 'drafts', DRAFT_ID);

    await updateDoc(draftRef, {
      awaitingLockConfirmation: true
    });
  };

  // ─── TIMER EXPIRY & AUTO-PICK ───
  // Handled server-side by Cloud Function (checkTimers).
  // The server checks every ~15s for expired timers, auto-picks, and advances phases.
  // Client only displays the countdown (see getCurrentTimer below).


  // Toggle participant selection
  const toggleParticipant = (userId) => {
    if (draftState.status !== 'waiting') return;

    setSelectedParticipants(prev => {
      if (prev.includes(userId)) {
        return prev.filter(id => id !== userId);
      } else {
        return [...prev, userId];
      }
    });
  };





  // Execute a pick in 1v1 mode
  const execute1v1Pick = useCallback(async (amikoId, team) => {
    const draftRef = doc(db, 'drafts', DRAFT_ID);
    const teamKey = team === 'A' ? 'teamA' : 'teamB';
    const currentPicks = [...(draftState[teamKey] || [])];

    currentPicks.push(amikoId);

    const updateData = {
      [teamKey]: currentPicks
    };

    // REMOVED AUTO-COMPLETION LOGIC: 1v1 mode must be manually locked
    await updateDoc(draftRef, updateData);

    logActivity({
      user,
      type: 'DRAFT',
      action: 'pick_1v1_amiko',
      metadata: {
        draftId: DRAFT_ID,
        amikoId: amikoId,
        team: team
      }
    });
  }, [DRAFT_ID, draftState, user]);

  // Lock picks in 1v1 mode
  const isTeamLocked = useCallback((team) => {
    return draftState.lockedTeams?.includes(team);
  }, [draftState.lockedTeams]);

  const lock1v1Picks = useCallback(async (team) => {
    if (draftState.status !== 'active') return;

    const draftRef = doc(db, 'drafts', DRAFT_ID);
    const lockedTeams = draftState.lockedTeams || [];

    if (lockedTeams.includes(team)) return;

    const newLockedTeams = [...lockedTeams, team];
    const updateData = {
      lockedTeams: newLockedTeams
    };

    // If both teams have locked, complete the draft
    if (newLockedTeams.includes('A') && newLockedTeams.includes('B')) {
      updateData.status = 'completed';
    }

    await updateDoc(draftRef, updateData);

    logActivity({
      user,
      type: 'DRAFT',
      action: 'lock_1v1_picks',
      metadata: {
        draftId: DRAFT_ID,
        team: team
      }
    });

    playLockSound();
  }, [DRAFT_ID, draftState, playLockSound, user]);

  // ─── MODE 4: BAN DRAFT FUNCTIONS ───

  // Check if a ban is locked (mode4 ban phase mapping)
  const isBanLocked = useCallback((team, banIndex) => {
    if (!draftState.lockedPhases || draftState.lockedPhases.length === 0) return false;
    // Ban phases: A-1(ph0), B-2(ph1), A-2(ph2), B-1(ph3)
    if (team === 'A') {
      // Team A: index 0 → phase 0, indices 1-2 → phase 2
      if (banIndex === 0) return draftState.lockedPhases.includes(0);
      return draftState.lockedPhases.includes(2);
    } else {
      // Team B: indices 0-1 → phase 1, index 2 → phase 3
      if (banIndex <= 1) return draftState.lockedPhases.includes(1);
      return draftState.lockedPhases.includes(3);
    }
  }, [draftState.lockedPhases]);

  // Execute a ban (mode4 ban phases) — same pattern as executePick but writes to ban arrays
  const executeBan = useCallback(async (amikoId) => {
    const draftRef = doc(db, 'drafts', DRAFT_ID);
    const teamKey = draftState.currentTeam === 'A' ? 'teamABans' : 'teamBBans';

    const currentPhaseConfig = getPICK_ORDER(draftState.draftType || 'mode4')[draftState.currentPhase || 0];
    const newPicksInPhase = (draftState.picksInPhase || 0) + 1;

    const updateData = {
      [teamKey]: arrayUnion(amikoId),
      bannedAmikos: arrayUnion(amikoId),
      picksInPhase: increment(1)
    };

    if (newPicksInPhase >= currentPhaseConfig.count) {
      updateData.awaitingLockConfirmation = true;
    }

    try {
      await updateDoc(draftRef, updateData);

      logActivity({
        user,
        type: 'DRAFT',
        action: 'ban_amiko',
        metadata: {
          draftId: DRAFT_ID,
          amikoId: amikoId,
          team: draftState.currentTeam
        }
      });
    } catch (error) {
      console.error('Error executing ban:', error);
      showAlert('Error', 'Failed to ban Amiko. Please try again.');
    }
  }, [DRAFT_ID, draftState, showAlert, user]);

  // Remove a ban (mode4 ban phases)
  const removeBan = useCallback(async (team, index) => {
    if (!user || draftState.status !== 'active') return;
    if (isBanLocked(team, index)) {
      showAlert('Ban Locked', 'This ban is locked and cannot be changed!');
      return;
    }

    const isAdmin = userPermission === 'admin' || isSuperAdmin(getUserEmail(user));
    if (userPermission !== team && !isAdmin) return;

    const isTeamLeader = (team === 'A' && user.uid === draftState.teamALeader) ||
      (team === 'B' && user.uid === draftState.teamBLeader);
    if (!isTeamLeader && !isAdmin) return;

    const draftRef = doc(db, 'drafts', DRAFT_ID);
    const banKey = team === 'A' ? 'teamABans' : 'teamBBans';
    const currentBans = [...(draftState[banKey] || [])];
    const removedId = currentBans[index];
    currentBans.splice(index, 1);

    // Also remove from bannedAmikos
    const currentBanned = [...(draftState.bannedAmikos || [])];
    const bannedIdx = currentBanned.indexOf(removedId);
    if (bannedIdx !== -1) currentBanned.splice(bannedIdx, 1);

    const newPicksInPhase = Math.max(0, draftState.picksInPhase - 1);

    await updateDoc(draftRef, {
      [banKey]: currentBans,
      bannedAmikos: currentBanned,
      picksInPhase: newPicksInPhase,
      awaitingLockConfirmation: false
    });

    setShowLockConfirmation(false);
    playRemoveSound();
  }, [DRAFT_ID, draftState, user, userPermission, playRemoveSound, showAlert, isBanLocked]);

  // Mode 4: Ban Draft Selection logic
  const handleMode4Selection = useCallback(async (amikoId, userTeam, isAdmin) => {
    if (!userTeam && !isAdmin) {
      showAlert('Not a Participant', 'Only the two draft participants can pick!');
      return;
    }

    // LEADER-ONLY check
    const isTeamLeader = (userTeam === 'A' && user.uid === draftState.teamALeader) ||
      (userTeam === 'B' && user.uid === draftState.teamBLeader);
    if (!isTeamLeader && !isAdmin) {
      showAlert('Captain Only', 'Only the team captain can make selections.');
      return;
    }

    // Check if it's this team's turn
    if (userTeam !== draftState.currentTeam && !isAdmin) {
      showAlert('Not Your Turn', `It's ${draftState.currentTeam === 'A' ? 'Player 1' : 'Player 2'}'s turn!`);
      return;
    }

    const currentPhaseConfig = getPICK_ORDER('mode4')[draftState.currentPhase || 0];
    const isBanPhase = currentPhaseConfig?.isBan;

    if (isBanPhase) {
      // BAN PHASE — check against banned amikos
      const bannedAmikos = draftState.bannedAmikos || [];
      if (bannedAmikos.includes(amikoId)) {
        showAlert('Already Banned', 'This Amiko has already been banned!');
        return;
      }

      // Element diversity constraint — each player's 3 bans must be different elements
      const myBans = userTeam === 'A' ? (draftState.teamABans || []) : (draftState.teamBBans || []);
      const banAmiko = AMIKOS.find(a => a.id === amikoId);
      if (banAmiko?.element) {
        const myBannedElements = myBans.map(banId => {
          const a = AMIKOS.find(x => x.id === banId);
          return a?.element;
        }).filter(Boolean);
        if (myBannedElements.includes(banAmiko.element)) {
          showAlert('Same Element', `You already banned a ${banAmiko.element} type! Your 3 bans must be different elements.`);
          return;
        }
      }

      if (isPickingRef.current) return;
      isPickingRef.current = true;

      setTempPick({ id: amikoId, team: userTeam });
      playPickSound();

      try {
        await executeBan(amikoId);
      } catch (error) {
        setTempPick(null);
        console.log('Ban failed:', error);
      } finally {
        isPickingRef.current = false;
      }
    } else {
      // PICK PHASE — check against banned + already picked by OWN team
      const bannedAmikos = draftState.bannedAmikos || [];
      if (bannedAmikos.includes(amikoId)) {
        showAlert('Banned', 'This Amiko has been banned and cannot be picked!');
        return;
      }

      // Only check own team — opponent CAN pick the same amiko
      const myPicks = userTeam === 'A' ? (draftState.teamA || []) : (draftState.teamB || []);
      if (myPicks.includes(amikoId)) {
        showAlert('Already Picked', 'You have already picked this Amiko!');
        return;
      }

      if (isPickingRef.current) return;
      isPickingRef.current = true;

      setTempPick({ id: amikoId, team: userTeam });
      playPickSound();

      try {
        await executePick(amikoId);
      } catch (error) {
        setTempPick(null);
        console.log('Pick failed:', error);
      } finally {
        isPickingRef.current = false;
      }
    }
  }, [user, draftState, executeBan, executePick, playPickSound, showAlert]);

  // Mode 3: Simultaneous Picking logic
  const handleMode3Selection = useCallback(async (amikoId, userTeam, isAdmin) => {
    // In 1v1 mode, check if user is a participant
    if (!userTeam && !isAdmin) {
      showAlert('Not a Participant', 'Only the two draft participants can pick!');
      return;
    }

    // Check if team is locked
    if (isTeamLocked(userTeam)) {
      showAlert('Picks Locked', 'You have already locked your picks!');
      return;
    }

    // Get the user's pool and their current picks
    const myPool = userTeam === 'A' ? draftState.playerAPool : draftState.playerBPool;
    const myPicks = userTeam === 'A' ? draftState.teamA : draftState.teamB;

    // Check if user is trying to pick from their own pool
    if (!myPool?.includes(amikoId) && !isAdmin) {
      showAlert('Not Your Amiko', 'You can only pick from your assigned Amikos!');
      return;
    }

    // Check if user has already picked 3
    if (myPicks?.length >= 3) {
      showAlert('Picks Complete', 'You have already selected your 3 Amikos!');
      return;
    }

    // Check if already picked by this user
    if (myPicks?.includes(amikoId)) {
      showAlert('Already Picked', 'You have already picked this Amiko!');
      return;
    }

    // Prevent rapid-fire picks
    if (isPickingRef.current) return;
    isPickingRef.current = true;

    // OPTIMISTIC UI for 1v1
    setTempPick({ id: amikoId, team: userTeam });
    playPickSound();

    try {
      await execute1v1Pick(amikoId, userTeam);
    } catch (error) {
      setTempPick(null);
      console.log('Pick failed:', error);
    } finally {
      isPickingRef.current = false;
    }
  }, [draftState, execute1v1Pick, isTeamLocked, playPickSound, showAlert]);

  // Standard Turn-based Selection logic (Mode 1 & 2)
  const handleStandardSelection = useCallback(async (amikoId, isAdmin) => {
    // Check if phase picks are already complete (user needs to remove a pick first)
    const currentPhaseConfig = getPICK_ORDER(draftState.draftType)[draftState.currentPhase];
    if (draftState.picksInPhase >= currentPhaseConfig.count) {
      showAlert('Phase Complete', 'You have already completed your picks for this phase. Remove a pick first if you want to change.');
      return;
    }

    // Check if it's the current team's turn
    if (userPermission !== draftState.currentTeam && !isAdmin) {
      showAlert('Not Your Turn', `Only Team ${draftState.currentTeam} members can pick now!`);
      return;
    }

    // LEADER-ONLY: Check if user is the team leader
    const isTeamLeader = (draftState.currentTeam === 'A' && user.uid === draftState.teamALeader) ||
      (draftState.currentTeam === 'B' && user.uid === draftState.teamBLeader);

    if (!isTeamLeader && !isAdmin) {
      showAlert('Captain Only', 'Only the team captain can make picks. Suggest picks in team chat!');
      return;
    }

    const allPicked = [...draftState.teamA, ...draftState.teamB];
    if (allPicked.includes(amikoId)) {
      showAlert('Already Picked', 'This Amiko has already been picked!');
      return;
    }

    // Prevent rapid-fire picks
    if (isPickingRef.current) return;
    isPickingRef.current = true;

    // OPTIMISTIC UI: Set temp pick to show immediately
    setTempPick({ id: amikoId, team: draftState.currentTeam });

    // Play pick sound effect
    playPickSound();

    try {
      await executePick(amikoId);
    } catch (error) {
      setTempPick(null);
      console.log('Pick failed:', error);
    } finally {
      isPickingRef.current = false;
    }
  }, [user, draftState, userPermission, executePick, playPickSound, showAlert]);

  // Pick an Amiko
  const pickAmiko = useCallback(async (amikoId) => {
    if (!user) {
      showAlert('Login Required', 'Please log in with Discord to pick Amikos!');
      return;
    }

    // STRICT SYNC: Prevent picking if previous pick hasn't confirmed yet
    if (tempPick) {
      console.log('Pick throttled: waiting for previous pick sync');
      return;
    }

    if (draftState.status !== 'active') {
      showAlert('Draft Not Active', 'The draft is not active yet.');
      return;
    }

    // Don't allow picks while waiting for lock confirmation
    if (draftState.awaitingLockConfirmation) {
      showAlert('Confirm Picks', 'Please confirm your picks before continuing!');
      return;
    }

    const isAdmin = userPermission === 'admin' || isSuperAdmin(getUserEmail(user));
    const userTeam = userPermission === 'A' ? 'A' : userPermission === 'B' ? 'B' : null;

    // Route to appropriate handler based on draft type
    if (draftState.draftType === 'mode4') {
      await handleMode4Selection(amikoId, userTeam, isAdmin);
    } else if (draftState.simultaneousPicking || draftState.draftType === 'mode3') {
      await handleMode3Selection(amikoId, userTeam, isAdmin);
    } else {
      await handleStandardSelection(amikoId, isAdmin);
    }
  }, [user, draftState, userPermission, handleMode4Selection, handleMode3Selection, handleStandardSelection, showAlert, tempPick]);



  // Remove an Amiko
  const removeAmiko = async (team, index) => {
    if (!user || draftState.status !== 'active') return;

    // Check if this pick is locked
    if (isPickLocked(team, index)) {
      showAlert('Pick Locked', 'This pick is locked and cannot be changed!');
      return;
    }

    const isAdmin = userPermission === 'admin' || isSuperAdmin(getUserEmail(user));
    if (userPermission !== team && !isAdmin) return;

    // LEADER-ONLY: Check if user is the team leader
    const isTeamLeader = (team === 'A' && user.uid === draftState.teamALeader) ||
      (team === 'B' && user.uid === draftState.teamBLeader);

    if (!isTeamLeader && !isAdmin) {
      showAlert('Captain Only', 'Only the team captain can modify picks.');
      return;
    }

    const draftRef = doc(db, 'drafts', DRAFT_ID);
    const teamKey = team === 'A' ? 'teamA' : 'teamB';
    const currentTeamPicks = [...draftState[teamKey]];

    currentTeamPicks.splice(index, 1);

    // Decrement picksInPhase and clear awaitingLockConfirmation so user can re-pick
    const newPicksInPhase = Math.max(0, draftState.picksInPhase - 1);

    await updateDoc(draftRef, {
      [teamKey]: currentTeamPicks,
      picksInPhase: newPicksInPhase,
      awaitingLockConfirmation: false
    });

    setShowLockConfirmation(false);

    // Play remove sound effect
    playRemoveSound();
  };

  // Reset draft
  const resetDraft = () => {
    if (userPermission !== 'admin' && !isSuperAdmin(getUserEmail(user))) return;

    setShowAdminPanel(false);

    showConfirm(
      'Reset Tournament',
      'Are you sure you want to reset the tournament? This will clear all picks and reset team assignments.',
      async () => {
        const draftRef = doc(db, 'drafts', DRAFT_ID);

        const newPermissions = { ...draftState.permissions };
        Object.keys(newPermissions).forEach(uid => {
          if (newPermissions[uid] !== 'admin') {
            newPermissions[uid] = 'spectator';
          }
        });

        // Clear all chats and typing indicators
        const collectionsToClear = [
          'chatA', 'chatB', 'chatAll', 'chatSpectators',
          'typingA', 'typingB', 'typingAll', 'typingSpectators'
        ];

        try {
          await Promise.all(collectionsToClear.map(async (collectionName) => {
            const colRef = collection(db, 'drafts', DRAFT_ID, collectionName);
            const snapshot = await getDocs(colRef);
            return Promise.all(snapshot.docs.map(doc => deleteDoc(doc.ref)));
          }));
        } catch (error) {
          console.error('Error clearing chats/typing indicators:', error);
        }

        await updateDoc(draftRef, {
          teamA: [],
          teamB: [],
          currentPhase: 0,
          currentTeam: 'A',
          picksInPhase: 0,
          timerStartA: null,
          timerStartB: null,
          status: 'waiting',
          permissions: newPermissions,
          lockedPhases: [],
          awaitingLockConfirmation: false,
          timerStarted: false,
          votes: { A: {}, B: {} },
          // 1v1 Mode state cleanup
          lockedTeams: [],
          playerAPool: [],
          playerBPool: [],
          simultaneousPicking: false,
          sharedTimer: null,
          // Mode4 ban state cleanup
          teamABans: [],
          teamBBans: [],
          bannedAmikos: []
        });

        // Reset participant selection
        setSelectedParticipants([]);

        setSearchQuery('');
      }
    );
  };

  // Start timer manually
  const startTimer = async () => {
    if (userPermission !== 'admin' && !isSuperAdmin(getUserEmail(user))) return;
    if (draftState.status !== 'active') return;
    if (draftState.timerStarted) return;

    const draftRef = doc(db, 'drafts', DRAFT_ID);
    const now = Date.now();

    // Always set the timer for the current team when starting
    const updates = {
      timerStarted: true,
      timerStartA: draftState.currentTeam === 'A' ? now : (draftState.timerStartA || null),
      timerStartB: draftState.currentTeam === 'B' ? now : (draftState.timerStartB || null)
    };

    await updateDoc(draftRef, updates);
    setShowAdminPanel(false);
  };

  // Delete tournament
  const deleteTournament = () => {
    if (userPermission !== 'admin' && !isSuperAdmin(getUserEmail(user))) return;

    setShowAdminPanel(false);

    showConfirm(
      'Delete Tournament',
      'Are you sure you want to delete this tournament? This action cannot be undone.',
      async () => {
        const draftRef = doc(db, 'drafts', DRAFT_ID);

        // Delete Team A chat messages
        try {
          const chatARef = collection(db, 'drafts', DRAFT_ID, 'chatA');
          const chatASnapshot = await getDocs(chatARef);
          const deleteAPromises = chatASnapshot.docs.map(doc => deleteDoc(doc.ref));
          await Promise.all(deleteAPromises);
        } catch (error) {
          console.error('Error deleting Team A chat:', error);
        }

        // Delete Team B chat messages
        try {
          const chatBRef = collection(db, 'drafts', DRAFT_ID, 'chatB');
          const chatBSnapshot = await getDocs(chatBRef);
          const deleteBPromises = chatBSnapshot.docs.map(doc => deleteDoc(doc.ref));
          await Promise.all(deleteBPromises);
        } catch (error) {
          console.error('Error deleting Team B chat:', error);
        }

        // Delete Free For All chat messages
        try {
          const chatAllRef = collection(db, 'drafts', DRAFT_ID, 'chatAll');
          const chatAllSnapshot = await getDocs(chatAllRef);
          const deleteAllPromises = chatAllSnapshot.docs.map(doc => deleteDoc(doc.ref));
          await Promise.all(deleteAllPromises);
        } catch (error) {
          console.error('Error deleting Free For All chat:', error);
        }

        // Delete typing indicators
        try {
          const typingCollections = ['typingA', 'typingB', 'typingAll'];
          for (const colName of typingCollections) {
            const colRef = collection(db, 'drafts', DRAFT_ID, colName);
            const snapshot = await getDocs(colRef);
            const deletePromises = snapshot.docs.map(doc => deleteDoc(doc.ref));
            await Promise.all(deletePromises);
          }
        } catch (error) {
          console.error('Error deleting typing indicators:', error);
        }

        // Delete the tournament document
        await deleteDoc(draftRef);
        navigate('/');
      }
    );
  };



  // Vote for a team (no login required - uses anonymous auth)
  const voteForTeam = async (team) => {
    try {
      let voterId;

      // If user is logged in, use their uid
      if (user) {
        voterId = user.uid;
      } else {
        // Sign in anonymously to get write permission
        const anonUser = await signInAnonymously(auth);
        voterId = anonUser.user.uid;
        // Store the anonymous uid in localStorage to track their vote
        localStorage.setItem('aurory_voter_id', voterId);
      }

      const draftRef = doc(db, 'drafts', DRAFT_ID);
      const votes = draftState.votes || { A: {}, B: {} };

      // Remove existing vote if any
      const newVotes = {
        A: { ...votes.A },
        B: { ...votes.B }
      };

      // Remove voter from both teams first
      delete newVotes.A[voterId];
      delete newVotes.B[voterId];

      // If clicking the same team they already voted for, just remove vote (toggle off)
      if (userVote !== team) {
        // Add vote for the selected team
        newVotes[team][voterId] = {
          name: user?.displayName || 'Anonymous Viewer',
          isAurorian: user?.isAurorian || false,
          timestamp: Date.now()
        };
      }

      await updateDoc(draftRef, { votes: newVotes });
    } catch (error) {
      console.error('Error voting:', error);
      showAlert('Vote Error', 'Unable to submit your vote. Please try again.');
    }
  };

  // Get vote count for a team
  const getVoteCount = (team) => {
    const votes = draftState.votes || { A: {}, B: {} };
    return Object.keys(votes[team] || {}).length;
  };

  // Open edit tournament modal
  const openEditModal = () => {
    // Convert timerDuration to days/hours/minutes/seconds
    const totalMs = draftState.timerDuration || 30 * 1000;
    const totalSeconds = Math.floor(totalMs / 1000);
    const days = Math.floor(totalSeconds / (24 * 3600));
    const hours = Math.floor((totalSeconds % (24 * 3600)) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    setEditTournament({
      title: draftState.title || '',
      description: draftState.description || '',
      prizePool: draftState.prizePool || '',
      draftType: draftState.draftType || 'mode1',
      timerDays: days,
      timerHours: hours,
      timerMinutes: minutes,
      timerSeconds: seconds,
      manualTimerStart: draftState.manualTimerStart || false
    });

    // Pre-select current participants
    const currentParticipants = Object.entries(draftState.permissions || {})
      .filter(([uid, perm]) => perm === 'spectator' || perm === 'A' || perm === 'B')
      .filter(([uid, perm]) => {
        const userObj = registeredUsers.find(u => u.id === uid || u.uid === uid);
        return userObj && !isSuperAdmin(userObj.email);
      })
      .map(([uid]) => uid);
    setSelectedParticipants(currentParticipants);

    setShowEditModal(true);
  };

  // Save edited tournament
  const saveEditTournament = async () => {
    if (!editTournament.title.trim()) {
      showAlert('Error', 'Please enter a tournament title');
      return;
    }

    const timerMs = (
      (editTournament.timerDays * 24 * 60 * 60 * 1000) +
      (editTournament.timerHours * 60 * 60 * 1000) +
      (editTournament.timerMinutes * 60 * 1000) +
      (editTournament.timerSeconds * 1000)
    );

    if (timerMs <= 0) {
      showAlert('Error', 'Please set a timer duration greater than 0');
      return;
    }

    const draftRef = doc(db, 'drafts', DRAFT_ID);

    // Build updated permissions
    const newPermissions = { ...draftState.permissions };

    // Remove participants who are no longer selected (except admins)
    Object.keys(newPermissions).forEach(uid => {
      if (newPermissions[uid] !== 'admin' && !selectedParticipants.includes(uid)) {
        delete newPermissions[uid];
      }
    });

    // Add newly selected participants
    selectedParticipants.forEach(uid => {
      if (!newPermissions[uid]) {
        newPermissions[uid] = 'spectator';
      }
    });

    await updateDoc(draftRef, {
      title: editTournament.title.trim(),
      description: editTournament.description.trim(),
      prizePool: editTournament.prizePool.trim(),
      draftType: editTournament.draftType,
      timerDuration: timerMs,
      manualTimerStart: editTournament.manualTimerStart,
      permissions: newPermissions
    });

    setShowEditModal(false);
    showAlert('Success', 'Tournament settings updated successfully!');
  };




























  // Track when Firestore updates come in
  const previousDraftState = useRef(null);

  useEffect(() => {
    if (!previousDraftState.current) {
      previousDraftState.current = draftState;
      return;
    }

    const prev = previousDraftState.current;

    console.log('═══════════════════════════════════════');
    console.log('🔄 FIRESTORE UPDATE RECEIVED');
    console.log('═══════════════════════════════════════');
    console.log('⏱️ Timestamp:', new Date().toISOString());
    console.log('👤 Current User:', user?.displayName || 'Not logged in');
    console.log('───────────────────────────────────────');

    // Track what changed
    if (prev.currentPhase !== draftState.currentPhase) {
      console.log('📍 Phase changed:', prev.currentPhase, '→', draftState.currentPhase);
    }

    if (prev.currentTeam !== draftState.currentTeam) {
      console.log('🔄 Team changed:', prev.currentTeam, '→', draftState.currentTeam);
    }

    if (prev.picksInPhase !== draftState.picksInPhase) {
      console.log('📊 Picks in phase:', prev.picksInPhase, '→', draftState.picksInPhase);
    }

    if (prev.teamA.length !== draftState.teamA.length) {
      console.log('🔵 Team A picks:', prev.teamA.length, '→', draftState.teamA.length);
      console.log('   Added:', draftState.teamA.filter(a => !prev.teamA.includes(a)));
      console.log('   Removed:', prev.teamA.filter(a => !draftState.teamA.includes(a)));
    }

    if (prev.teamB.length !== draftState.teamB.length) {
      console.log('🔴 Team B picks:', prev.teamB.length, '→', draftState.teamB.length);
      console.log('   Added:', draftState.teamB.filter(b => !prev.teamB.includes(b)));
      console.log('   Removed:', prev.teamB.filter(b => !draftState.teamB.includes(b)));
    }

    if (prev.awaitingLockConfirmation !== draftState.awaitingLockConfirmation) {
      console.log('🔒 Lock confirmation:', prev.awaitingLockConfirmation, '→', draftState.awaitingLockConfirmation);
    }

    if (prev.lockedPhases.length !== draftState.lockedPhases.length) {
      console.log('🔐 Locked phases:', prev.lockedPhases, '→', draftState.lockedPhases);
    }

    console.log('═══════════════════════════════════════\n');

    previousDraftState.current = draftState;
  }, [draftState, user]);







  // NEW: Click outside handler for chat
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isChatOpen && chatContainerRef.current && !chatContainerRef.current.contains(event.target)) {
        setIsChatOpen(false);
      }
    };

    // Add event listener
    document.addEventListener('mousedown', handleClickOutside);

    // Cleanup
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isChatOpen]);




































  // Format timer (HH:MM:SS)
  const formatTime = (milliseconds) => {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const getCurrentTimer = useCallback(() => {
    const timerDuration = draftState.timerDuration || 30 * 1000;

    if (draftState.status !== 'active') return formatTime(timerDuration);

    // If in preparation phase, show starting message
    if (draftState.inPreparation || showPreparation) {
      return '⏳ Starting...';
    }

    // If manual timer start is enabled but timer hasn't started
    if (draftState.manualTimerStart && !draftState.timerStarted) {
      return '⏸️ Waiting';
    }

    const now = Date.now();
    let remaining = timerDuration;

    if (draftState.draftType === 'mode3' && draftState.sharedTimer) {
      const elapsed = now - draftState.sharedTimer;
      remaining = Math.max(0, timerDuration - elapsed);
    } else if (draftState.currentTeam === 'A' && draftState.timerStartA) {
      const elapsed = now - draftState.timerStartA;
      remaining = Math.max(0, timerDuration - elapsed);
    } else if (draftState.currentTeam === 'B' && draftState.timerStartB) {
      const elapsed = now - draftState.timerStartB;
      remaining = Math.max(0, timerDuration - elapsed);
    }

    return formatTime(remaining);
  }, [draftState.status, draftState.currentTeam, draftState.timerStartA, draftState.timerStartB, draftState.timerDuration, draftState.manualTimerStart, draftState.timerStarted, draftState.inPreparation, showPreparation, draftState.draftType, draftState.sharedTimer]);

  const [currentTimerDisplay, setCurrentTimerDisplay] = useState('24:00:00');

  useEffect(() => {
    const timerDuration = draftState.timerDuration || 30 * 1000;

    if (draftState.status !== 'active') {
      setCurrentTimerDisplay(formatTime(timerDuration));
      return;
    }

    setCurrentTimerDisplay(getCurrentTimer());

    const interval = setInterval(() => {
      setCurrentTimerDisplay(getCurrentTimer());
    }, 1000);

    return () => clearInterval(interval);
  }, [draftState.status, draftState.timerDuration, getCurrentTimer]);

  const isAmikoPicked = (amikoId) => {
    return [...draftState.teamA, ...draftState.teamB].includes(amikoId);
  };


  // Get team leader (first user assigned to the team)
  const getTeamLeader = (team) => {
    // First, check if we have a stored leader UID
    const leaderUid = team === 'A' ? draftState.teamALeader : draftState.teamBLeader;

    if (leaderUid) {
      // Find the user by UID
      const leader = registeredUsers.find(u => u.uid === leaderUid || u.id === leaderUid);
      if (leader) return leader;
    }

    // Fallback: return first team member (for backwards compatibility)
    const teamMembers = registeredUsers.filter(u =>
      draftState.permissions[u.uid] === team
    );
    return teamMembers.length > 0 ? teamMembers[0] : null;
  };

  const getTeamMembers = (team) => {
    const teamMembers = registeredUsers.filter(u =>
      draftState.permissions[u.uid] === team
    );
    return teamMembers;
  };

  // Helper to get consistent team display name based on identity mapping
  const getTeamDisplayName = (team) => {
    if (draftState.draftType === 'mode3' || draftState.draftType === 'mode4') {
      return getTeamLeader(team)?.displayName || (team === 'A' ? 'Player 1' : 'Player 2');
    }
    const color = team === 'A' ? draftState.teamColors?.teamA : draftState.teamColors?.teamB;
    if (color === 'blue') return draftState.teamNames?.team1 || 'Team 1';
    if (color === 'red') return draftState.teamNames?.team2 || 'Team 2';
    return team === 'A' ? 'Team A' : 'Team B';
  };

  // Debounce search effect
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery && searchQuery.trim().length >= 2) {
        searchUsers(searchQuery);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [searchQuery, searchUsers]);

  const filteredUsers = registeredUsers.filter(u => {
    // Exclude super admin from participants list
    if (isSuperAdmin(u.email)) return false;

    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    const name = (u.displayName || '').toLowerCase();
    const email = (u.email || '').toLowerCase();
    return name.includes(query) || email.includes(query);
  });

  const getCurrentPickNumber = () => {
    const currentTeamPicks = draftState.currentTeam === 'A' ? draftState.teamA.length : draftState.teamB.length;
    return currentTeamPicks + 1;
  };

  const getOrdinalSuffix = (num) => {
    const j = num % 10;
    const k = num % 100;
    if (j === 1 && k !== 11) return num + 'st';
    if (j === 2 && k !== 12) return num + 'nd';
    if (j === 3 && k !== 13) return num + 'rd';
    return num + 'th';
  };

  // Get current phase picks for the lock confirmation modal
  const getCurrentPhasePicks = () => {
    const currentPhaseConfig = getPICK_ORDER(draftState.draftType)[draftState.currentPhase];
    const team = currentPhaseConfig.team;

    // Mode4 ban phases: pull from ban arrays instead of team arrays
    const isBan = currentPhaseConfig.isBan;
    const teamPicks = isBan
      ? (team === 'A' ? (draftState.teamABans || []) : (draftState.teamBBans || []))
      : (team === 'A' ? draftState.teamA : draftState.teamB);

    // Calculate how many items were made before this phase by this team (same type only)
    const pickOrder = getPICK_ORDER(draftState.draftType);
    let picksBefore = 0;

    for (let i = 0; i < draftState.currentPhase; i++) {
      if (pickOrder[i].team === team && !!pickOrder[i].isBan === !!isBan) {
        picksBefore += pickOrder[i].count;
      }
    }

    // Return only the picks/bans made in the current phase
    const picksInCurrentPhase = currentPhaseConfig.count;
    return teamPicks.slice(picksBefore, picksBefore + picksInCurrentPhase);
  };

  if (loading) {
    return <LoadingScreen fullScreen message="Entering Draft..." />;
  }

  if (!tournamentExists) {
    return (
      <div className="tournament-page">
        <div className="tournament-not-found">
          <h2>🔍 Tournament Not Found</h2>
          <p>The tournament you're looking for doesn't exist or has been deleted.</p>
          <button onClick={() => navigate('/')} className="back-home-btn">
            ← Back to Home
          </button>
        </div>
      </div>
    );
  }

  const handleCardMouseMove = (e, amikoId) => {
    const card = e.currentTarget;
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    setHoveredCard(amikoId);
    setMousePosition({
      x: ((x - centerX) / centerX) * 100,
      y: ((y - centerY) / centerY) * 100
    });
  };

  const handleCardMouseLeave = () => {
    setHoveredCard(null);
    setMousePosition({ x: 0, y: 0 });
  };

  const getCardTransform = (amikoId) => {
    if (hoveredCard !== amikoId) return {};

    const maxRotate = 10;
    const rotateX = (mousePosition.y / 100) * maxRotate * -1;
    const rotateY = (mousePosition.x / 100) * maxRotate;
    return {
      transform: `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.08)`,
      transition: 'transform 0.1s ease-out'
    };
  };

  const draftHandlers = {
    showAlert,
    showConfirm,
    isVerifying,
    handleVerifyMatch,
    removeAmiko,
    isPickLocked,
    isPickVisibleToUser,
    isAmikoPicked,
    isAmikoPickVisible,
    pickAmiko,
    handleCardMouseMove,
    handleCardMouseLeave,
    getCardTransform,
    hoveredCard,
    showPreparation,
    nextTeamAfterPrep,
    setShowLineupPreview,
    isTeamLocked,
    lock1v1Picks,
    isSuperAdmin,
    getUserEmail,
    getPICK_ORDER,
    shuffleHighlights,
    // Mode4 ban handlers
    removeBan,
    isBanLocked
  };

  const draftUtils = {
    getTeamDisplayName,
    getTeamLeader,
    getTeamMembers,
    copyToClipboard,
    ElementBadge,
    RankStars,
    getUserProfilePicture,
    DEFAULT_AVATAR
  };

  return (
    <>
      <div className="tournament-page">
        <header className="tournament-header">
          <div className="header-title">
            <h1>{draftState.title || 'Aurory Draft'}</h1>
            {draftState.title && <span className="tournament-subtitle">Aurory Draft Tournament</span>}
          </div>
          <div className="header-controls">
            <div className="spectator-count" title="People watching">
              👁️ {spectatorCount} watching
            </div>
          </div>
          <div className="header-info">
            {user ? (
              <>
                <span className={`user-role ${isSuperAdmin(getUserEmail(user)) ? 'super-admin' :
                  userPermission === 'admin' ? '' :
                    userPermission === 'A' ? `team-${draftState.teamColors?.teamA || 'blue'}` :
                      userPermission === 'B' ? `team-${draftState.teamColors?.teamB || 'red'}` : ''}`}>
                  {isSuperAdmin(getUserEmail(user)) ? '⭐ Super Admin' :
                    userPermission === 'admin' ? '👑 Admin' :
                      userPermission === 'A' ? `${draftState.teamColors?.teamA === 'blue' ? '🔵' : '🔴'} ${getUserDisplayName(user)}` :
                        userPermission === 'B' ? `${draftState.teamColors?.teamB === 'blue' ? '🔵' : '🔴'} ${getUserDisplayName(user)}` : '👁️ Viewer'}
                  {user.isAurorian && <span className="aurorian-badge" title="Aurorian NFT Holder" style={{ marginLeft: '4px' }}>🛡️</span>}
                </span>
                {(userPermission === 'admin' || isSuperAdmin(getUserEmail(user))) && (
                  <button onClick={() => setShowAdminPanel(!showAdminPanel)} className="admin-panel-btn">
                    ⚙️ Tournament Settings
                  </button>
                )}
              </>
            ) : (
              <span className="user-role">👁️ Viewer</span>
            )}
            <button onClick={() => navigate('/')} className="back-btn">
              ← Home
            </button>
          </div>
        </header>

        {/* Lock Confirmation Modal */}
        {
          showLockConfirmation && (
            <div className="modal-overlay">
              <div className="lock-confirmation-modal">
                <h3>{getPICK_ORDER(draftState.draftType)[draftState.currentPhase]?.isBan ? '🚫 Confirm Your Bans' : '🔒 Confirm Your Picks'}</h3>
                <p>You have completed your {getPICK_ORDER(draftState.draftType)[draftState.currentPhase]?.isBan ? 'bans' : 'picks'} for this phase. Please review and confirm to lock them.</p>

                <div className={`modal-timer ${currentTimerDisplay === '00:00:00' ? 'expired' : ''}`}>
                  ⏱️ Time remaining: <strong>{currentTimerDisplay === '00:00:00' ? 'EXPIRED' : currentTimerDisplay}</strong>
                </div>

                {currentTimerDisplay === '00:00:00' && (
                  <div className="timer-expired-notice">
                    ⚡ Time's up! Auto-locking picks...
                  </div>
                )}

                <div className="phase-picks-preview">
                  <h4>Your {getPICK_ORDER(draftState.draftType)[draftState.currentPhase]?.isBan ? 'bans' : 'picks'} for {getPICK_ORDER(draftState.draftType)[draftState.currentPhase]?.label}:</h4>
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
                  <>
                    <div className="modal-warning">
                      ⚠️ Once locked, these selections <strong>cannot be changed</strong>.
                    </div>

                    <div className="modal-auto-lock-notice">
                      🔄 Selections will auto-lock when timer expires
                    </div>
                  </>
                )}

                <div className="modal-actions">
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
                    ← Go Back & Change {getPICK_ORDER(draftState.draftType)[draftState.currentPhase]?.isBan ? 'Bans' : 'Picks'}
                  </button>
                </div>
              </div>
            </div>
          )
        }

        {/* App Modal (Alerts & Confirmations) */}
        {
          appModal.show && (
            <div className="modal-overlay" onClick={appModal.type === 'alert' ? closeAppModal : undefined}>
              <div className="app-modal" onClick={e => e.stopPropagation()}>
                <h3>{appModal.title}</h3>
                <p>{appModal.message}</p>
                <div className="app-modal-actions">
                  {appModal.type === 'confirm' ? (
                    <>
                      <button onClick={handleAppModalConfirm} className="app-modal-btn confirm">
                        Yes, Continue
                      </button>
                      <button onClick={closeAppModal} className="app-modal-btn cancel">
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button onClick={closeAppModal} className="app-modal-btn ok">
                      OK
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        }

        {/* Coin Flip Modal - Blue/Red Roll System */}
        {
          draftState.status === 'coinFlip' && draftState.coinFlip && (
            <div className={`modal-overlay coin-flip-overlay ${isCoinFlipHidden ? 'hidden-minimized' : ''}`}>
              {isCoinFlipHidden ? (
                <button className="show-flip-btn" onClick={() => setIsCoinFlipHidden(false)}>
                  🪙 Show Flip
                </button>
              ) : (
                <div className="coin-flip-modal">
                  <div className="modal-header-actions">
                    <h2>{draftState.draftType === 'mode3' ? '✅ Please Confirm' : '🪙 Flip Coin'}</h2>
                    <div className="modal-header-actions-group">
                      {(userPermission === 'admin' || isSuperAdmin(getUserEmail(user))) && (
                        <button className="close-modal-btn" onClick={closeCoinFlip} title="Cancel Coin Flip">Close</button>
                      )}
                      <button className="hide-modal-btn" onClick={() => setIsCoinFlipHidden(true)}>Hide</button>
                    </div>
                  </div>

                  {/* 3D Coin Display - Hidden for mode3 as it's just a readiness check */}
                  {draftState.draftType !== 'mode3' && (
                    <div className="coin-display">
                      <div className={`coin-3d ${draftState.coinFlip.phase === 'spinning' ? 'spinning-fast' : 'spinning-slow'} ${draftState.coinFlip.phase === 'result' || draftState.coinFlip.phase === 'turnChoice' || draftState.coinFlip.phase === 'done' ? 'stopped' : ''}`}
                        data-result={draftState.coinFlip.result}>
                        <div className={`coin-face-3d blue-face ${draftState.teamBanners?.team1 ? 'has-banner' : ''}`}>
                          {draftState.teamBanners?.team1 ? (
                            <img src={draftState.teamBanners.team1} alt={draftState.teamNames?.team1 || 'Team 1'} className="coin-banner-img" />
                          ) : (
                            <span className="coin-team-name">{draftState.teamNames?.team1 || 'Team 1'}</span>
                          )}
                        </div>

                        {/* 3D Thickness Layers - Strictly between the two faces (6px and -6px) */}
                        {[...Array(12)].map((_, i) => (
                          <div key={i} className="coin-thickness" style={{ transform: `translateZ(${5.5 - i}px)` }}></div>
                        ))}

                        <div className={`coin-face-3d red-face ${draftState.teamBanners?.team2 ? 'has-banner' : ''}`}>
                          {draftState.teamBanners?.team2 ? (
                            <img src={draftState.teamBanners.team2} alt={draftState.teamNames?.team2 || 'Team 2'} className="coin-banner-img" />
                          ) : (
                            <span className="coin-team-name">{draftState.teamNames?.team2 || 'Team 2'}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Rolling Phase - Leaders confirm their participation */}
                  {draftState.coinFlip.phase === 'rolling' && (
                    <div className="roll-section">
                      <p className="roll-instruction">
                        {draftState.draftType === 'mode3' ? 'Confirm if you are ready to start the draft.' : 'Please confirm.'}
                      </p>

                      {/* Roll Status */}
                      <div className="roll-status">
                        <div className={`roll-status-item ${draftState.coinFlip.team1Locked ? 'locked' : ''}`}>
                          <span className="team-color blue">
                            🔵 {draftState.teamNames?.team1 || 'Team 1'}
                          </span>
                          <span className={`lock-status ${draftState.coinFlip.team1Locked ? 'locked' : 'waiting'}`}>
                            {draftState.coinFlip.team1Locked ? '✓ Ready' : 'Waiting...'}
                          </span>
                        </div>
                        <div className={`roll-status-item ${draftState.coinFlip.team2Locked ? 'locked' : ''}`}>
                          <span className="team-color red">
                            🔴 {draftState.teamNames?.team2 || 'Team 2'}
                          </span>
                          <span className={`lock-status ${draftState.coinFlip.team2Locked ? 'locked' : 'waiting'}`}>
                            {draftState.coinFlip.team2Locked ? '✓ Ready' : 'Waiting...'}
                          </span>
                        </div>
                      </div>

                      {/* Entry fee notice for players who haven't paid */}
                      {user && draftState.preAssignedTeams && !draftState.isFriendly && (draftState.entryFee || 0) > 0 && !draftState.entryPaid?.[user.uid] && (
                        (user.uid === draftState.preAssignedTeams.team1?.leader || user.uid === draftState.preAssignedTeams.team2?.leader)
                      ) && (
                          <div className="entry-fee-notice">
                            <p>💰 Entry Fee: <strong>{formatAuryAmount(draftState.entryFee)} AURY</strong></p>
                            <p className="fee-balance">Your Balance: {formatAuryAmount(walletBalance)} AURY</p>
                            {walletBalance < draftState.entryFee && (
                              <p className="fee-insufficient">⚠️ Insufficient balance to confirm</p>
                            )}
                          </div>
                        )}

                      {/* Confirm Button for leaders */}
                      {user && draftState.preAssignedTeams && (
                        (user.uid === draftState.preAssignedTeams.team1?.leader && !draftState.coinFlip.team1Locked) ||
                        (user.uid === draftState.preAssignedTeams.team2?.leader && !draftState.coinFlip.team2Locked)
                      ) && (
                          <button className="roll-btn" onClick={lockRoll}
                            disabled={!draftState.isFriendly && (draftState.entryFee || 0) > 0 && !draftState.entryPaid?.[user.uid] && walletBalance < draftState.entryFee}
                          >
                            {draftState.draftType === 'mode3' ? "I'm Ready" : 'Confirm'}
                          </button>
                        )}

                      {/* Already confirmed message */}
                      {user && draftState.preAssignedTeams && (
                        (user.uid === draftState.preAssignedTeams.team1?.leader && draftState.coinFlip.team1Locked) ||
                        (user.uid === draftState.preAssignedTeams.team2?.leader && draftState.coinFlip.team2Locked)
                      ) && (
                          <p className="locked-message">
                            {draftState.draftType === 'mode3' ? '✓ You are ready! Waiting for opponent...' : '✓ Confirmed! Waiting for other leader...'}
                          </p>
                        )}

                      {/* Non-leaders see waiting message */}
                      {user && draftState.preAssignedTeams &&
                        user.uid !== draftState.preAssignedTeams.team1?.leader &&
                        user.uid !== draftState.preAssignedTeams.team2?.leader && (
                          <p className="waiting-message">Waiting for team leaders to confirm...</p>
                        )}
                    </div>
                  )}

                  {/* Spinning Phase - Fast spin animation */}
                  {draftState.coinFlip.phase === 'spinning' && (
                    <div className="spinning-section">
                      <p className="spin-text">Flipping...</p>
                    </div>
                  )}

                  {/* Result Phase - Show winner */}
                  {draftState.coinFlip.phase === 'result' && (
                    <div className="coin-result">
                      <p className="result-text">
                        {draftState.coinFlip.result === 'blue'
                          ? `🔵 ${draftState.teamNames?.team1 || 'Team 1'}`
                          : `🔴 ${draftState.teamNames?.team2 || 'Team 2'}`}!
                      </p>
                      <p className={`winner-text ${draftState.coinFlip.result}`}>
                        🎉 {draftState.coinFlip.winner === 1
                          ? draftState.teamNames?.team1 || 'Team 1'
                          : draftState.teamNames?.team2 || 'Team 2'} wins!
                      </p>
                    </div>
                  )}

                  {/* Turn Choice Phase - Winner picks 1st or 2nd */}
                  {draftState.coinFlip.phase === 'turnChoice' && (
                    <div className="turn-choice">
                      <p className={`winner-banner ${draftState.coinFlip.result}`}>
                        🏆 {draftState.coinFlip.winner === 1
                          ? draftState.teamNames?.team1 || 'Team 1'
                          : draftState.teamNames?.team2 || 'Team 2'} won the coin flip!
                      </p>

                      <p className="choice-text">
                        {user && draftState.preAssignedTeams && (
                          (draftState.coinFlip.winner === 1 && user.uid === draftState.preAssignedTeams.team1?.leader) ||
                          (draftState.coinFlip.winner === 2 && user.uid === draftState.preAssignedTeams.team2?.leader)
                        ) ? (
                          <>Choose your turn order:</>
                        ) : (
                          <>Waiting for winner to choose turn order...</>
                        )}
                      </p>

                      {/* Show turn choice buttons only to winner */}
                      {user && draftState.preAssignedTeams && (
                        (draftState.coinFlip.winner === 1 && user.uid === draftState.preAssignedTeams.team1?.leader) ||
                        (draftState.coinFlip.winner === 2 && user.uid === draftState.preAssignedTeams.team2?.leader)
                      ) && (
                          <div className="turn-choice-buttons">
                            <button
                              className="turn-choice-btn first-pick"
                              onClick={() => selectTurnOrder('first')}
                            >
                              {draftState.draftType === 'mode4' ? '1️⃣ 1st Ban' : '1️⃣ 1st Pick'}
                            </button>
                            <button
                              className="turn-choice-btn second-pick"
                              onClick={() => selectTurnOrder('second')}
                            >
                              {draftState.draftType === 'mode4' ? '2️⃣ 1st Pick' : '2️⃣ 2nd Pick'}
                            </button>
                          </div>
                        )}
                    </div>
                  )}

                  {/* Done Phase - We show nothing here now, as roulette modal takes over immediately */}
                  {draftState.coinFlip.phase === 'done' && (
                    <div className="coin-done-simple">
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        }

        {/* Roulette Animation Modal */}
        {
          showRoulette && (
            <div className="modal-overlay roulette-overlay">
              <div className="roulette-modal">
                <h2>🪙 Team Assignment</h2>

                {roulettePhase === 'scrambling' && (
                  <p className="scramble-text">Shuffling teams...</p>
                )}

                {roulettePhase === 'revealing' && !draftState.coinFlip && (
                  <p className="reveal-text">🎉 Teams Assigned!</p>
                )}

                {/* Coin Flip Winner Summary (Shown in Roulette Modal) */}
                {showRoulette && draftState.coinFlip?.phase === 'done' && (
                  <div className="coin-done-detailed in-roulette">
                    <div className="winner-summary">
                      {(() => {
                        const winner = draftState.coinFlip.winner;
                        const winnerName = winner === 1 ? (draftState.teamNames?.team1 || 'Team 1') : (draftState.teamNames?.team2 || 'Team 2');
                        const winnerBanner = winner === 1 ? draftState.teamBanners?.team1 : draftState.teamBanners?.team2;
                        const choice = draftState.draftType === 'mode4'
                          ? (draftState.coinFlip.winnerTurnChoice === 'first' ? '1st Ban' : '1st Pick')
                          : (draftState.coinFlip.winnerTurnChoice === 'first' ? '1st Pick' : '2nd Pick');

                        return (
                          <>
                            {winnerBanner && (
                              <div className="summary-banner">
                                <img src={winnerBanner} alt={winnerName} />
                              </div>
                            )}
                            <h3>{winnerName}</h3>
                            <p className="choice-summary">chooses {choice}</p>
                          </>
                        );
                      })()}
                    </div>
                    <p className="starting-text-summary">Draft starting...</p>
                  </div>
                )}

                {/* Hide assignments-grid if showing coin flip summary */}
                {teamAssignments.length > 0 && draftState.coinFlip?.phase !== 'done' && (
                  <div className={`roulette-assignments ${roulettePhase === 'scrambling' ? 'scrambling' : ''}`}>
                    <div className="assignments-grid">
                      <div className={`assignment-column team-${draftState.teamColors?.teamA || 'blue'}`}>
                        <h5>{getTeamDisplayName('A')}</h5>
                        {teamAssignments.filter(a => a.team === 'A').map((a, i) => (
                          <div key={a.participant.uid} className="assigned-user">
                            <img
                              src={getUserProfilePicture(a.participant)}
                              alt=""
                              onError={(e) => { e.target.onerror = null; e.target.src = DEFAULT_AVATAR; }}
                            />
                            <span>{a.participant.displayName}{a.participant.isAurorian && <span className="aurorian-badge" title="Aurorian NFT Holder">🛡️</span>}</span>
                          </div>
                        ))}
                      </div>
                      <div className={`assignment-column team-${draftState.teamColors?.teamB || 'red'}`}>
                        <h5>{getTeamDisplayName('B')}</h5>
                        {teamAssignments.filter(a => a.team === 'B').map((a, i) => (
                          <div key={a.participant.uid} className="assigned-user">
                            <img
                              src={getUserProfilePicture(a.participant)}
                              alt=""
                              onError={(e) => { e.target.onerror = null; e.target.src = DEFAULT_AVATAR; }}
                            />
                            <span>{a.participant.displayName}{a.participant.isAurorian && <span className="aurorian-badge" title="Aurorian NFT Holder">🛡️</span>}</span>
                          </div>
                        ))}
                      </div>
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
          )
        }

        {/* Admin Panel Modal */}
        {
          (userPermission === 'admin' || isSuperAdmin(getUserEmail(user))) && showAdminPanel && (
            <div className="modal-overlay" onClick={() => setShowAdminPanel(false)}>
              <div className="admin-panel-modal" onClick={e => e.stopPropagation()}>
                <div className="admin-panel-header">
                  <h3>⚙️ Tournament Settings</h3>
                  <button onClick={() => setShowAdminPanel(false)} className="close-modal">✕</button>
                </div>

                <div className="admin-panel-body">
                  <div className="admin-actions">
                    {/* Start Timer - Only show when draft is active and manual timer is enabled */}
                    {draftState.status === 'active' && draftState.manualTimerStart && (
                      <button
                        onClick={startTimer}
                        className={`action-btn start-timer ${draftState.timerStarted ? 'disabled' : ''}`}
                        disabled={draftState.timerStarted}
                      >
                        {draftState.timerStarted ? '✅ Timer Running' : '⏱️ Start Timer'}
                      </button>
                    )}

                    {/* Start Draft - Only show when waiting, and only for 3v3 modes (1v1 auto-starts) */}
                    {draftState.status === 'waiting' && draftState.draftType !== 'mode3' && draftState.draftType !== 'mode4' && (
                      <button onClick={initializeDraft} className="action-btn start">
                        🚀 Start Draft
                      </button>
                    )}

                    {/* Edit Tournament */}
                    <button onClick={openEditModal} className="action-btn edit">
                      ✏️ Edit Tournament
                    </button>

                    {/* Reset Tournament */}
                    <button onClick={resetDraft} className="action-btn reset">
                      🔄 Reset Tournament
                    </button>

                    {/* Delete Tournament */}
                    <button onClick={deleteTournament} className="action-btn delete">
                      🗑️ Delete Tournament
                    </button>

                    {/* Admin can force confirm if needed */}
                    {draftState.awaitingLockConfirmation && (
                      <button onClick={confirmLockPicks} className="action-btn confirm">
                        🔒 Force Confirm Picks
                      </button>
                    )}


                  </div>
                </div>
              </div>
            </div>
          )
        }

        {/* Tournament Info */}
        {
          (draftState.status === 'active' || draftState.status === 'completed') && (draftState.description || draftState.prizePool || draftState.draftType) && (
            <div className="tournament-info">
              {draftState.draftType && (
                <div className="tournament-draft-type">
                  <span className="info-label">🎮 Draft Type:</span>
                  <span className="info-value">
                    {draftState.draftType === 'mode2' ? 'Triad Swiss Draft 2' : 'Triad Swiss Draft 1'}
                  </span>
                </div>
              )}
              {draftState.description && (
                <div className="tournament-prize">
                  <span className="info-label">🏆 Prize Pool:</span>
                  <span className="info-value prize">{draftState.prizePool}</span>
                </div>
              )}
            </div>
          )
        }

        {/* Draft Status */}
        <div className="draft-status">
          {!user && !(draftState.status === 'waiting' && (draftState.draftType === 'mode3' || draftState.draftType === 'mode4')) && (
            <p className="login-prompt">
              👋 <a href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>Log in with Discord</a> to participate in the draft (or watch the draft)
            </p>
          )}
          {draftState.status === 'waiting' && (() => {
            const is1v1 = draftState.draftType === 'mode3' || draftState.draftType === 'mode4';
            if (is1v1) {
              const teams = draftState.preAssignedTeams || {};
              const p1Uid = teams.team1?.leader;
              const p2Uid = teams.team2?.leader;
              const p1 = p1Uid ? registeredUsers.find(u => u.uid === p1Uid || u.id === p1Uid) : null;
              const p2 = p2Uid ? registeredUsers.find(u => u.uid === p2Uid || u.id === p2Uid) : null;
              const isPlayer = user && (p1Uid === user.uid || p2Uid === user.uid);
              const entryFeeDisplay = draftState.isFriendly ? 'Free' : `${formatAuryAmount(draftState.entryFee)} AURY`;

              return (
                <div className="waiting-1v1-section">
                  <div className="match-info-banner">
                    <span className={`mode-tag mode-${draftState.draftType}`}>
                      {draftState.draftType === 'mode4' ? '⚔️ Ban Draft 3-3' : '⚔️ Deathmatch 3-3'}
                    </span>
                    <span className={`pool-tag ${draftState.isFriendly ? 'friendly' : 'pool'}`}>
                      {draftState.isFriendly ? '🤝 Friendly Match' : `💰 Pool: ${formatAuryAmount(draftState.poolAmount)} AURY`}
                    </span>
                    {!draftState.isFriendly && (
                      <span className="fee-tag">Entry: {entryFeeDisplay}</span>
                    )}
                  </div>

                  <div className="match-slots">
                    <div className={`match-slot ${p1 ? 'filled' : 'open'}`}>
                      {p1 ? (
                        <div className="slot-player">
                          <img
                            src={p1.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png'}
                            alt="" className="slot-avatar"
                            onError={(e) => { e.target.onerror = null; e.target.src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }}
                          />
                          <span className="slot-name">{p1.displayName || p1.username || 'Player 1'}</span>
                          {p1Uid === draftState.createdBy && <span className="creator-badge">Creator</span>}
                          {draftState.entryPaid?.[p1Uid] > 0 && <span className="paid-badge">✓ Paid</span>}
                        </div>
                      ) : (
                        <div className="slot-empty">
                          <span className="slot-empty-icon">👤</span>
                          <span className="slot-empty-text">Waiting for Player 1</span>
                        </div>
                      )}
                    </div>

                    <div className="match-vs">VS</div>

                    <div className={`match-slot ${p2 ? 'filled' : 'open'}`}>
                      {p2 ? (
                        <div className="slot-player">
                          <img
                            src={p2.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png'}
                            alt="" className="slot-avatar"
                            onError={(e) => { e.target.onerror = null; e.target.src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }}
                          />
                          <span className="slot-name">{p2.displayName || p2.username || 'Player 2'}</span>
                          {p2Uid === draftState.createdBy && <span className="creator-badge">Creator</span>}
                          {draftState.entryPaid?.[p2Uid] > 0 && <span className="paid-badge">✓ Paid</span>}
                        </div>
                      ) : (
                        <div className="slot-empty">
                          <span className="slot-empty-icon">👤</span>
                          <span className="slot-empty-text">Waiting for Player 2</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Join button for non-participants when there's an open slot */}
                  {canJoinDraft() && (
                    <div className="join-section">
                      {!draftState.isFriendly && draftState.entryFee > 0 && (
                        <p className="join-fee-notice">
                          Entry Fee: <strong>{entryFeeDisplay}</strong>
                          <span className="join-balance">Your Balance: {formatAuryAmount(walletBalance)} AURY</span>
                          {walletBalance < draftState.entryFee && <span className="insufficient-warning">⚠️ Insufficient balance</span>}
                        </p>
                      )}
                      <button
                        className="join-match-btn"
                        onClick={handleJoinDraft}
                        disabled={isJoining || (!draftState.isFriendly && walletBalance < draftState.entryFee)}
                      >
                        {isJoining ? '⏳ Joining...' : '⚔️ Join Match'}
                      </button>
                    </div>
                  )}

                  {/* Info for participants already in */}
                  {isPlayer && (!p1 || !p2) && (
                    <p className="waiting-notice">Waiting for your opponent to join...</p>
                  )}
                  {isPlayer && p1 && p2 && (
                    <p className="waiting-notice">Both players ready! Preparing confirmation...</p>
                  )}

                  {/* Info for spectators */}
                  {!user && (
                    <p className="login-join-notice">👋 Log in to join this match!</p>
                  )}
                  {user && !isPlayer && !canJoinDraft() && !draftState.joinable && (
                    <p className="waiting-notice">Waiting for both players to confirm...</p>
                  )}
                </div>
              );
            }
            return <p>Waiting for admin to start the draft...</p>;
          })()}
          {draftState.status === 'active' && (
            <>
              <div className={`timer-display team-${draftState.teamColors?.[draftState.currentTeam === 'A' ? 'teamA' : 'teamB'] || (draftState.currentTeam === 'A' ? 'blue' : 'red')}-timer ${user && userPermission === draftState.currentTeam ? 'your-turn' : ''}`}>
                {user && userPermission === draftState.currentTeam && (
                  <div className="your-turn-badge">🎯 YOUR TURN!</div>
                )}
                {draftState.draftType !== 'mode3' && (
                  <div className="timer-team-indicator">
                    {draftState.teamColors?.[draftState.currentTeam === 'A' ? 'teamA' : 'teamB'] === 'blue' ? '🔵' : '🔴'} {getTeamDisplayName(draftState.currentTeam)}'s Turn
                  </div>
                )}
                <div className="timer-countdown">
                  {currentTimerDisplay}
                </div>
                <div className="timer-phase">
                  {getPICK_ORDER(draftState.draftType)[draftState.currentPhase]?.label || 'Draft in progress'}
                </div>
              </div>

              {draftState.awaitingLockConfirmation ? (
                <p className="lock-pending">
                  🔒 {getTeamDisplayName(draftState.currentTeam)} is confirming their {getPICK_ORDER(draftState.draftType)[draftState.currentPhase]?.isBan ? 'bans' : 'picks'}...
                </p>
              ) : (
                <>
                  {(() => {
                    const currentPhaseConfig = getPICK_ORDER(draftState.draftType)[draftState.currentPhase];
                    const phaseComplete = currentPhaseConfig && draftState.picksInPhase >= currentPhaseConfig.count;

                    if (phaseComplete && user && userPermission === draftState.currentTeam) {
                      const isBan = currentPhaseConfig?.isBan;
                      return (
                        <>
                          <p className="edit-picks-message">
                            ✏️ Remove a {isBan ? 'ban' : 'pick'} to make changes, or confirm when ready
                          </p>
                          <p className="auto-lock-warning">
                            🔄 Selections will auto-lock when timer expires
                          </p>
                          <button onClick={triggerLockConfirmation} className="ready-to-lock-btn">
                            {isBan ? '🚫 Ready to Lock Bans' : '🔒 Ready to Lock Picks'}
                          </button>
                        </>
                      );
                    }

                    return (
                      <>
                        {user && userPermission === draftState.currentTeam && (
                          <p className="pick-instruction">
                            👉 {currentPhaseConfig?.isBan ? 'Ban' : 'Select'} your {getOrdinalSuffix(getCurrentPickNumber())} Amiko
                          </p>
                        )}

                        {user && userPermission && userPermission !== draftState.currentTeam && userPermission !== 'admin' && userPermission !== 'spectator' && (
                          <p className="waiting-message">
                            ⏳ Waiting for {getTeamDisplayName(draftState.currentTeam)} to finish {currentPhaseConfig?.isBan ? 'banning' : 'picking'}...
                          </p>
                        )}
                      </>
                    );
                  })()}
                </>
              )}
            </>
          )}
          {draftState.status === 'completed' && (
            <p className="completed">✅ Draft Completed!</p>
          )}

          {/* Match Verification Results */}
          {draftState.status === 'completed' && (draftState.privateCode || draftState.privateCodes) && (
            <div className="match-verification-section">
              <div className="verification-header">
                <h3>⚔️ Match Results</h3>
                {(userPermission === 'admin' || isSuperAdmin(getUserEmail(user))) && (
                  <button
                    className="verify-btn"
                    onClick={handleVerifyMatch}
                    disabled={isVerifying}
                  >
                    {isVerifying ? '⏳ Verifying...' : '🔄 Verify Now'}
                  </button>
                )}
              </div>

              {/* Overall Winner Banner */}
              {draftState.overallWinner && draftState.overallWinner !== 'draw' && (
                <div className={`winner-announcement team-${draftState.overallWinner === 'A' ? (draftState.teamColors?.teamA || 'blue') : (draftState.teamColors?.teamB || 'red')}`}>
                  <span className="trophy">🏆</span>
                  <span className="winner-text">
                    {draftState.overallWinner === 'A' ? getTeamDisplayName('A') : getTeamDisplayName('B')} Wins!
                  </span>
                </div>
              )}
              {draftState.overallWinner === 'draw' && (
                <div className="winner-announcement draw">
                  <span className="trophy">🤝</span>
                  <span className="winner-text">Draw!</span>
                </div>
              )}

              {/* Individual Battle Results */}
              {draftState.matchResults ? (
                <div className="battle-results-list">
                  {draftState.matchResults.map((result, idx) => (
                    <div key={idx} className={`battle-result-card ${result.status}`}>
                      <div className="battle-result-header">
                        <span className="battle-label">
                          {(draftState.draftType === 'mode3' || draftState.draftType === 'mode4') ? 'Match' : `Battle ${idx + 1}`}
                        </span>
                        {isParticipantOrAdmin && (
                          <span className="battle-code">Code: {result.battleCode}</span>
                        )}
                        <span className={`battle-status status-${result.status}`}>
                          {result.status === 'verified' && '✅ Verified'}
                          {result.status === 'disqualified_A' && '⛔ DQ'}
                          {result.status === 'disqualified_B' && '⛔ DQ'}
                          {result.status === 'both_disqualified' && '⛔ Both DQ'}
                          {result.status === 'not_found' && '⏳ Pending'}
                          {result.status === 'error' && '❌ Error'}
                          {result.status === 'player_mismatch' && '⛔ Wrong Player'}
                          {result.status === 'wrong_players' && '⛔ Wrong Players'}
                        </span>
                      </div>

                      {(result.status === 'verified' || result.status === 'disqualified_A' || result.status === 'disqualified_B') && (
                        <div className="battle-result-body">
                          <div className={`battle-player ${result.winner === 'A' ? 'winner' : 'loser'}`}>
                            <span className="player-outcome">{result.winner === 'A' ? '🏆' : '💀'}</span>
                            <span className="player-name">{result.playerA?.displayName || 'Player A'}</span>
                            {!result.playerA?.lineupValid && <span className="dq-badge">DQ</span>}
                            <div className="battle-amikos">
                              {(result.playerA?.usedAmikos || []).map((amikoId, i) => {
                                const amiko = AMIKOS.find(a => a.id === amikoId);
                                return amiko ? (
                                  <img key={i} src={amiko.image} alt={amiko.name} title={amiko.name} className="battle-amiko-img" />
                                ) : <span key={i} className="unknown-amiko">{amikoId}</span>;
                              })}
                            </div>
                          </div>
                          <span className="vs-divider">VS</span>
                          <div className={`battle-player ${result.winner === 'B' ? 'winner' : 'loser'}`}>
                            <span className="player-outcome">{result.winner === 'B' ? '🏆' : '💀'}</span>
                            <span className="player-name">{result.playerB?.displayName || 'Player B'}</span>
                            {!result.playerB?.lineupValid && <span className="dq-badge">DQ</span>}
                            <div className="battle-amikos">
                              {(result.playerB?.usedAmikos || []).map((amikoId, i) => {
                                const amiko = AMIKOS.find(a => a.id === amikoId);
                                return amiko ? (
                                  <img key={i} src={amiko.image} alt={amiko.name} title={amiko.name} className="battle-amiko-img" />
                                ) : <span key={i} className="unknown-amiko">{amikoId}</span>;
                              })}
                            </div>
                          </div>
                        </div>
                      )}

                      {result.disqualificationReason && (
                        <div className="dq-reason">⚠️ {result.disqualificationReason}</div>
                      )}

                      {result.status === 'not_found' && (
                        <div className="pending-message">Waiting for match to be played in-game...</div>
                      )}

                      {result.error && result.status === 'error' && (
                        <div className="error-message">{result.error}</div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="verification-pending">
                  <p>⏳ Waiting for matches to be played in-game...</p>
                  <p className="verification-hint">Matches are checked automatically every 60 seconds.</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Main Draft Area */}
        <div className="draft-container">
          {draftState.draftType === 'mode4' ? (
            <Mode4Draft
              draftState={draftState}
              user={user}
              userPermission={userPermission}
              displayTeamA={displayTeamA}
              displayTeamB={displayTeamB}
              displayTeamABans={displayTeamABans}
              displayTeamBBans={displayTeamBBans}
              tempPick={tempPick}
              handlers={draftHandlers}
              utils={draftUtils}
            />
          ) : draftState.draftType === 'mode3' ? (
            <Mode3Draft
              draftState={draftState}
              user={user}
              userPermission={userPermission}
              displayTeamA={displayTeamA}
              displayTeamB={displayTeamB}
              tempPick={tempPick}
              handlers={draftHandlers}
              utils={draftUtils}
            />
          ) : draftState.draftType === 'mode2' ? (
            <Mode2Draft
              draftState={draftState}
              user={user}
              userPermission={userPermission}
              displayTeamA={displayTeamA}
              displayTeamB={displayTeamB}
              tempPick={tempPick}
              handlers={draftHandlers}
              utils={draftUtils}
            />
          ) : (
            <Mode1Draft
              draftState={draftState}
              user={user}
              userPermission={userPermission}
              displayTeamA={displayTeamA}
              displayTeamB={displayTeamB}
              tempPick={tempPick}
              handlers={draftHandlers}
              utils={draftUtils}
            />
          )}

        </div>


        {/* Chat System - Team Chat for members, Free For All visible to everyone */}
        {
          draftState.status !== 'waiting' && (
            <div
              ref={chatContainerRef}
              className={`team-chat-container ${isChatOpen ? 'open' : 'closed'}`}>
              <button
                className={`chat-toggle-btn ${userPermission === 'A' || userPermission === 'B'
                  ? `team-${draftState.teamColors?.[`team${userPermission}`] || (userPermission === 'A' ? 'blue' : 'red')}`
                  : 'viewer'
                  }`}
                onClick={() => setIsChatOpen(!isChatOpen)}
              >
                <span className="chat-icon">💬</span>
                <span className="chat-label">
                  {chatTab === 'team'
                    ? `${getTeamDisplayName((userPermission === 'admin' || isSuperAdmin(getUserEmail(user))) ? adminChatTeam : userPermission)} Chat`
                    : chatTab === 'freeforall'
                      ? 'Participants Chat'
                      : 'Free For All Chat'}
                </span>
                {!isChatOpen && (chatTab === 'team' ? chatMessages.length : freeForAllMessages.length) > 0 && (
                  <span className="chat-badge">{chatTab === 'team' ? chatMessages.length : freeForAllMessages.length}</span>
                )}
                <span className="toggle-icon">{isChatOpen ? '▼' : '▲'}</span>
              </button>

              {isChatOpen && (
                <div className="chat-panel">
                  {/* Chat Tabs */}
                  <div className="chat-tabs">
                    {(userPermission === 'A' || userPermission === 'B' || userPermission === 'admin') && (!['mode3', 'mode4'].includes(draftState.draftType)) && (
                      <button
                        className={`chat-tab ${chatTab === 'team' ? 'active' : ''}`}
                        onClick={() => setChatTab('team')}
                      >
                        🔒 {(userPermission === 'admin' || isSuperAdmin(getUserEmail(user))) ? 'Team Chat' : `${getTeamDisplayName(userPermission)} Chat`}
                        {chatMessages.length > 0 && <span className="tab-badge">{chatMessages.length}</span>}
                      </button>
                    )}
                    {(userPermission === 'A' || userPermission === 'B' || userPermission === 'admin') && (
                      <button
                        className={`chat-tab ${chatTab === 'freeforall' ? 'active' : ''}`}
                        onClick={() => setChatTab('freeforall')}
                      >
                        👥 Participants
                        {freeForAllMessages.length > 0 && <span className="tab-badge">{freeForAllMessages.length}</span>}
                      </button>
                    )}
                    {(userPermission === 'spectator' || userPermission === 'admin') && (
                      <button
                        className={`chat-tab ${chatTab === 'spectator' ? 'active' : ''}`}
                        onClick={() => setChatTab('spectator')}
                      >
                        🌐 Free For All
                        {spectatorMessages.length > 0 && <span className="tab-badge">{spectatorMessages.length}</span>}
                      </button>
                    )}
                  </div>

                  {/* Admin Team Chat Toggle */}
                  {chatTab === 'team' && (userPermission === 'admin' || isSuperAdmin(getUserEmail(user))) && (
                    <div className="admin-chat-toggle">
                      <button
                        className={`team-toggle-btn team-${draftState.teamColors?.teamA || 'blue'} ${adminChatTeam === 'A' ? 'active' : ''}`}
                        onClick={() => setAdminChatTeam('A')}
                      >
                        {getTeamDisplayName('A')}
                      </button>
                      <button
                        className={`team-toggle-btn team-${draftState.teamColors?.teamB || 'red'} ${adminChatTeam === 'B' ? 'active' : ''}`}
                        onClick={() => setAdminChatTeam('B')}
                      >
                        {getTeamDisplayName('B')}
                      </button>
                    </div>
                  )}

                  <div className={`chat-messages team-${chatTab === 'team'
                    ? ((userPermission === 'admin' || isSuperAdmin(getUserEmail(user)))
                      ? (draftState.teamColors?.[`team${adminChatTeam}`] || 'blue')
                      : (draftState.teamColors?.[`team${userPermission}`] || 'blue')
                    )
                    : ''
                    }`}>
                    {chatTab === 'team' ? (
                      // Team Chat Messages
                      chatMessages.length === 0 ? (
                        <div className="chat-empty">
                          <p>No messages yet.</p>
                          <p className="chat-hint">Start planning with your team!</p>
                        </div>
                      ) : (
                        chatMessages.map((msg) => (
                          <div
                            key={msg.id}
                            className={`chat-message ${msg.senderUid === user?.uid ? 'own' : ''}`}
                          >
                            <img
                              src={msg.senderAuroryPhoto || msg.senderPhoto || 'https://cdn.discordapp.com/embed/avatars/0.png'}
                              alt=""
                              className="chat-avatar"
                              onError={(e) => { e.target.onerror = null; e.target.src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }}
                            />
                            <div className="chat-content">
                              <div className="chat-header">
                                <span className="chat-sender">
                                  {msg.senderName}
                                  {msg.senderIsAurorian && <span className="aurorian-badge" title="Aurorian NFT Holder">🛡️</span>}
                                </span>
                                <span className="chat-time">
                                  {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '...'}
                                </span>
                              </div>
                              <p className="chat-text">{msg.text}</p>

                              {/* Message Reactions Display */}
                              {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                                <div className="message-reactions">
                                  {Object.entries(msg.reactions).map(([emoji, uids]) => (
                                    <button
                                      key={emoji}
                                      className={`reaction-bubble ${uids.includes(user?.uid) ? 'reacted' : ''}`}
                                      onClick={() => toggleReaction(msg.id, emoji, `chat${userPermission}`)}
                                    >
                                      <span className="reaction-emoji">{emoji}</span>
                                      <span className="reaction-count">{uids.length}</span>
                                    </button>
                                  ))}
                                </div>
                              )}

                              {/* Reaction Picker */}
                              <div className="message-actions">
                                <button
                                  className="add-reaction-btn"
                                  onClick={() => setActiveReactionPicker(activeReactionPicker === msg.id ? null : msg.id)}
                                >
                                  😊+
                                </button>
                                {activeReactionPicker === msg.id && (
                                  <div className="reaction-picker">
                                    {REACTION_EMOJIS.map(emoji => (
                                      <button
                                        key={emoji}
                                        className="reaction-option"
                                        onClick={() => toggleReaction(msg.id, emoji, `chat${userPermission}`)}
                                      >
                                        {emoji}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        ))
                      )
                    ) : chatTab === 'freeforall' ? (
                      // Participants Messages
                      freeForAllMessages.length === 0 ? (
                        <div className="chat-empty">
                          <p>No messages yet.</p>
                          <p className="chat-hint">
                            Chat with all participants!
                          </p>
                        </div>
                      ) : (
                        freeForAllMessages.map((msg) => (
                          <div
                            key={msg.id}
                            className={`chat-message ${msg.senderUid === user?.uid ? 'own' : ''} team-${(msg.senderTeam === 'A' ? draftState.teamColors?.teamA : msg.senderTeam === 'B' ? draftState.teamColors?.teamB : msg.senderTeam)?.toLowerCase() || 'unknown'}`}
                          >
                            <img
                              src={msg.senderAuroryPhoto || msg.senderPhoto || 'https://cdn.discordapp.com/embed/avatars/0.png'}
                              alt=""
                              className="chat-avatar"
                              onError={(e) => { e.target.onerror = null; e.target.src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }}
                            />
                            <div className="chat-content">
                              <div className="chat-header">
                                <span className={`chat-sender team-${(msg.senderTeam === 'A' ? draftState.teamColors?.teamA : msg.senderTeam === 'B' ? draftState.teamColors?.teamB : msg.senderTeam)?.toLowerCase() || 'unknown'}`}>
                                  {msg.senderName}
                                  {msg.senderIsAurorian && <span className="aurorian-badge" title="Aurorian NFT Holder">🛡️</span>}
                                  {(msg.senderTeam === 'A' || msg.senderTeam === 'B') && <span className="team-tag">Team {msg.senderTeam}</span>}
                                </span>
                                <span className="chat-time">
                                  {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '...'}
                                </span>
                              </div>
                              <p className="chat-text">{msg.text}</p>

                              {/* Message Reactions Display */}
                              {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                                <div className="message-reactions">
                                  {Object.entries(msg.reactions).map(([emoji, uids]) => (
                                    <button
                                      key={emoji}
                                      className={`reaction-bubble ${uids.includes(user?.uid) ? 'reacted' : ''}`}
                                      onClick={() => toggleReaction(msg.id, emoji, 'chatAll')}
                                    >
                                      <span className="reaction-emoji">{emoji}</span>
                                      <span className="reaction-count">{uids.length}</span>
                                    </button>
                                  ))}
                                </div>
                              )}

                              {/* Reaction Picker - only for team members or admins */}
                              {(userPermission === 'A' || userPermission === 'B' || userPermission === 'admin') && (
                                <div className="message-actions">
                                  <button
                                    className="add-reaction-btn"
                                    onClick={() => setActiveReactionPicker(activeReactionPicker === msg.id ? null : msg.id)}
                                  >
                                    😊+
                                  </button>
                                  {activeReactionPicker === msg.id && (
                                    <div className="reaction-picker">
                                      {REACTION_EMOJIS.map(emoji => (
                                        <button
                                          key={emoji}
                                          className="reaction-option"
                                          onClick={() => toggleReaction(msg.id, emoji, 'chatAll')}
                                        >
                                          {emoji}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        ))
                      )
                    ) : (
                      // Spectator Messages
                      spectatorMessages.length === 0 ? (
                        <div className="chat-empty">
                          <p>No messages yet.</p>
                          <p className="chat-hint">
                            {user && !user.isAnonymous ? 'Chat with other spectators!' : 'Log in to participate in the chat!'}
                          </p>
                        </div>
                      ) : (
                        spectatorMessages.map((msg) => (
                          <div
                            key={msg.id}
                            className={`chat-message ${msg.senderUid === user?.uid ? 'own' : ''}`}
                          >
                            <img
                              src={msg.senderAuroryPhoto || msg.senderPhoto || 'https://cdn.discordapp.com/embed/avatars/0.png'}
                              alt=""
                              className="chat-avatar"
                              onError={(e) => { e.target.onerror = null; e.target.src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }}
                            />
                            <div className="chat-content">
                              <div className="chat-header">
                                <span className="chat-sender">
                                  {msg.senderName}
                                  {msg.senderIsAurorian && <span className="aurorian-badge" title="Aurorian NFT Holder">🛡️</span>}
                                </span>
                                <span className="chat-time">
                                  {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '...'}
                                </span>
                              </div>
                              <p className="chat-text">{msg.text}</p>

                              {/* Message Reactions Display */}
                              {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                                <div className="message-reactions">
                                  {Object.entries(msg.reactions).map(([emoji, uids]) => (
                                    <button
                                      key={emoji}
                                      className={`reaction-bubble ${uids.includes(user?.uid) ? 'reacted' : ''}`}
                                      onClick={() => toggleReaction(msg.id, emoji, 'chatSpectators')}
                                    >
                                      <span className="reaction-emoji">{emoji}</span>
                                      <span className="reaction-count">{uids.length}</span>
                                    </button>
                                  ))}
                                </div>
                              )}

                              {/* Reaction Picker - logged in spectators or admins */}
                              {(userPermission === 'admin' || (userPermission === 'spectator' && user && !user.isAnonymous)) && (
                                <div className="message-actions">
                                  <button
                                    className="add-reaction-btn"
                                    onClick={() => setActiveReactionPicker(activeReactionPicker === msg.id ? null : msg.id)}
                                  >
                                    😊+
                                  </button>
                                  {activeReactionPicker === msg.id && (
                                    <div className="reaction-picker">
                                      {REACTION_EMOJIS.map(emoji => (
                                        <button
                                          key={emoji}
                                          className="reaction-option"
                                          onClick={() => toggleReaction(msg.id, emoji, 'chatSpectators')}
                                        >
                                          {emoji}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        ))
                      )
                    )}
                    <div ref={chatEndRef} />
                  </div>

                  {/* Input form - show for team members, or logged-in spectators in the FFA tab, or admins */}
                  {(userPermission === 'A' || userPermission === 'B' || userPermission === 'admin' || (userPermission === 'spectator' && chatTab === 'spectator' && user && !user.isAnonymous)) ? (
                    <>
                      {/* Typing Indicator */}
                      {Object.keys(typingUsers).length > 0 && (
                        <div className="typing-indicator">
                          <span className="typing-dots">
                            <span>•</span><span>•</span><span>•</span>
                          </span>
                          <span className="typing-text">
                            {Object.values(typingUsers).length === 1
                              ? `${Object.values(typingUsers)[0].name} is typing...`
                              : Object.values(typingUsers).length === 2
                                ? `${Object.values(typingUsers).map(t => t.name).join(' and ')} are typing...`
                                : `${Object.values(typingUsers).length} people are typing...`
                            }
                          </span>
                        </div>
                      )}
                      <form className="chat-input-form" onSubmit={(e) => { clearTypingStatus(); sendChatMessage(e); }}>
                        <input
                          ref={chatInputRef}
                          type="text"
                          placeholder={
                            chatTab === 'team' ? 'Message your team...' :
                              chatTab === 'freeforall' ? 'Message participants...' :
                                'Chat in Free For All...'
                          }
                          value={chatInput}
                          onChange={handleTypingInput}
                          disabled={isSendingMessage}
                          maxLength={500}
                        />
                        <button
                          type="submit"
                          disabled={!chatInput.trim() || isSendingMessage}
                          className="send-btn"
                        >
                          {isSendingMessage ? '...' : '➤'}
                        </button>
                      </form>
                    </>
                  ) : (
                    <div className="chat-viewer-notice">
                      {user && !user.isAnonymous
                        ? (chatTab === 'spectator' ? '👁️ You are viewing' : '🚫 Participants chat is restricted')
                        : '👋 Log in to join the chat!'}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        }

        {/* Edit Tournament Modal */}
        {
          showEditModal && (
            <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
              <div className="edit-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                  <h3>✏️ Edit Tournament</h3>
                  <button className="close-modal" onClick={() => setShowEditModal(false)}>✕</button>
                </div>

                <div className="modal-body">
                  <div className="form-group">
                    <label>Tournament Title *</label>
                    <input
                      type="text"
                      placeholder="Enter tournament title..."
                      value={editTournament.title}
                      onChange={(e) => setEditTournament({ ...editTournament, title: e.target.value })}
                      className="form-input"
                    />
                  </div>

                  <div className="form-group">
                    <label>Description</label>
                    <textarea
                      placeholder="Enter tournament description..."
                      value={editTournament.description}
                      onChange={(e) => setEditTournament({ ...editTournament, description: e.target.value })}
                      className="form-textarea"
                      rows={3}
                    />
                  </div>

                  <div className="form-group">
                    <label>Prize Pool</label>
                    <input
                      type="text"
                      placeholder="e.g. $1,000 or 10,000 AURY"
                      value={editTournament.prizePool}
                      onChange={(e) => setEditTournament({ ...editTournament, prizePool: e.target.value })}
                      className="form-input"
                    />
                  </div>

                  {/* Draft Type Dropdown */}
                  <div className="form-group">
                    <label>Draft Type</label>
                    <select
                      value={editTournament.draftType}
                      onChange={(e) => setEditTournament({ ...editTournament, draftType: e.target.value })}
                      className="form-input"
                      disabled={draftState.status !== 'waiting'}
                    >
                      <option value="mode1">Triad Swiss Draft 1</option>
                      <option value="mode2">Triad Swiss Draft 2</option>
                    </select>
                    {draftState.status !== 'waiting' && (
                      <span className="input-hint warning">
                        ⚠️ Cannot change draft type once tournament has started
                      </span>
                    )}
                  </div>

                  <div className="form-group">
                    <label>Timer Duration (per turn)</label>
                    <div className="timer-inputs">
                      <div className="timer-input-group">
                        <input
                          type="number"
                          min="0"
                          max="30"
                          value={editTournament.timerDays}
                          onChange={(e) => setEditTournament({ ...editTournament, timerDays: parseInt(e.target.value) || 0 })}
                          className="timer-input"
                        />
                        <span>Days</span>
                      </div>
                      <div className="timer-input-group">
                        <input
                          type="number"
                          min="0"
                          max="23"
                          value={editTournament.timerHours}
                          onChange={(e) => setEditTournament({ ...editTournament, timerHours: parseInt(e.target.value) || 0 })}
                          className="timer-input"
                        />
                        <span>Hours</span>
                      </div>
                      <div className="timer-input-group">
                        <input
                          type="number"
                          min="0"
                          max="59"
                          value={editTournament.timerMinutes}
                          onChange={(e) => setEditTournament({ ...editTournament, timerMinutes: parseInt(e.target.value) || 0 })}
                          className="timer-input"
                        />
                        <span>Min</span>
                      </div>
                      <div className="timer-input-group">
                        <input
                          type="number"
                          min="0"
                          max="59"
                          value={editTournament.timerSeconds}
                          onChange={(e) => setEditTournament({ ...editTournament, timerSeconds: parseInt(e.target.value) || 0 })}
                          className="timer-input"
                        />
                        <span>Sec</span>
                      </div>
                    </div>

                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={editTournament.manualTimerStart}
                        onChange={(e) => setEditTournament({ ...editTournament, manualTimerStart: e.target.checked })}
                      />
                      <span>Start timer manually</span>
                    </label>
                  </div>

                  {/* Participants Selection in Edit Modal */}
                  <div className="form-group participants-section">
                    <label>Participants ({selectedParticipants.length} selected)</label>
                    <input
                      type="text"
                      placeholder="Search users..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="form-input search-input"
                    />
                    <div className="participants-list">
                      {filteredUsers.length === 0 ? (
                        <p className="no-users">No users found</p>
                      ) : (
                        filteredUsers.map(u => {
                          const isSelected = selectedParticipants.includes(u.uid);
                          return (
                            <div
                              key={u.uid}
                              className={`participant-item ${isSelected ? 'selected' : ''}`}
                              onClick={() => toggleParticipant(u.uid)}
                            >
                              <img
                                src={u.auroryProfilePicture || (u.photoURL && u.photoURL !== '' ? u.photoURL : 'https://cdn.discordapp.com/embed/avatars/0.png')}
                                alt={u.displayName}
                                className="participant-avatar"
                                onError={(e) => { e.target.onerror = null; e.target.src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }}
                              />
                              <div className="participant-info">
                                <span className="participant-name">{u.displayName || 'Unknown'}{u.isAurorian && <span className="aurorian-badge" title="Aurorian NFT Holder">🛡️</span>}</span>
                              </div>
                              <span className="participant-check">
                                {isSelected ? '✓' : ''}
                              </span>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>

                <div className="modal-footer">
                  <button className="cancel-btn" onClick={() => setShowEditModal(false)}>
                    Cancel
                  </button>
                  <button className="save-btn" onClick={saveEditTournament}>
                    💾 Save Changes
                  </button>
                </div>
              </div>
            </div>
          )
        }

        {/* Lineup Preview Modal */}
        {
          showLineupPreview && (
            <div className="modal-overlay" onClick={() => setShowLineupPreview(false)}>
              <div className="lineup-preview-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                  <h3>⚔️ Final Lineup</h3>
                  <button className="close-modal" onClick={() => setShowLineupPreview(false)}>✕</button>
                </div>

                <div className="lineup-content-v2">
                  {/* Top VS Section */}
                  <div className="lineup-top-header">
                    <div className="vs-badge">VS</div>
                    {(draftState.draftType === 'mode3' || draftState.draftType === 'mode4') && draftState.privateCode && isParticipantOrAdmin && (
                      <div
                        className="private-code-top copyable"
                        onClick={() => copyToClipboard(draftState.privateCode, 'Private Code')}
                        title="Click to copy Private Code"
                      >
                        <span className="code-label">Private Code</span>
                        <span className="code-value">{draftState.privateCode}</span>
                        <span className="copy-hint">📋 Click to copy</span>
                      </div>
                    )}
                  </div>

                  {/* Team Column Headers */}
                  <div className="lineup-team-headers">
                    <div className={`team-header team-${draftState.teamColors?.teamA || 'blue'}`}>
                      {(draftState.draftType === 'mode3' || draftState.draftType === 'mode4')
                        ? <>{getTeamLeader('A')?.displayName || 'Player 1'}{getTeamLeader('A')?.isAurorian && <span className="aurorian-badge" title="Aurorian NFT Holder">🛡️</span>}</>
                        : (draftState.teamColors?.teamA === 'blue' ? (draftState.teamNames?.team1 || 'Team 1') : (draftState.teamNames?.team2 || 'Team 2'))}
                    </div>
                    <div className="spacer"></div>
                    <div className={`team-header team-${draftState.teamColors?.teamB || 'red'}`}>
                      {(draftState.draftType === 'mode3' || draftState.draftType === 'mode4')
                        ? <>{getTeamLeader('B')?.displayName || 'Player 2'}{getTeamLeader('B')?.isAurorian && <span className="aurorian-badge" title="Aurorian NFT Holder">🛡️</span>}</>
                        : (draftState.teamColors?.teamB === 'blue' ? (draftState.teamNames?.team1 || 'Team 1') : (draftState.teamNames?.team2 || 'Team 2'))}
                    </div>
                  </div>

                  {/* Player Rows with Aligned Codes */}
                  <div className="lineup-rows-container">
                    {((draftState.draftType === 'mode3' || draftState.draftType === 'mode4') ? [0] : [0, 1, 2]).map(playerIndex => (
                      <div key={`row-${playerIndex}`} className="lineup-match-row">
                        {/* Team A Player */}
                        <div className="lineup-player-column">
                          <div className="lineup-player">
                            {draftState.draftType !== 'mode3' && draftState.draftType !== 'mode4' && <span className="player-number">P{playerIndex + 1}</span>}
                            <div className="player-amikos">
                              {draftState.teamA.slice(playerIndex * 3, playerIndex * 3 + 3).map((amikoId, idx) => {
                                const amiko = AMIKOS.find(a => a.id === amikoId);
                                return amiko ? (
                                  <div key={idx} className="lineup-amiko">
                                    {amiko.element && (
                                      <span className="lineup-element-icon" title={amiko.element}>
                                        {ELEMENTS[amiko.element]?.icon}
                                      </span>
                                    )}
                                    <img src={amiko.image} alt={amiko.name} />
                                    <span>{amiko.name}</span>
                                  </div>
                                ) : null;
                              })}
                            </div>
                          </div>
                        </div>

                        {/* Centered Code (for 3v3) */}
                        <div className="lineup-code-column">
                          {(draftState.draftType === 'mode1' || draftState.draftType === 'mode2') && draftState.privateCodes && draftState.privateCodes[playerIndex] && isParticipantOrAdmin && (
                            <div
                              className="private-code-display row-aligned copyable"
                              onClick={() => copyToClipboard(draftState.privateCodes[playerIndex], `Battle Code ${playerIndex + 1}`)}
                              title={`Click to copy Battle Code ${playerIndex + 1}`}
                            >
                              <span className="code-label">BATTLE {playerIndex + 1}</span>
                              <span className="code-value">{draftState.privateCodes[playerIndex]}</span>
                              <span className="copy-icon-row">📋</span>
                            </div>
                          )}
                          {(draftState.draftType !== 'mode1' && draftState.draftType !== 'mode2') && <div className="row-divider-line"></div>}
                        </div>

                        {/* Team B Player */}
                        <div className="lineup-player-column">
                          <div className="lineup-player">
                            {draftState.draftType !== 'mode3' && draftState.draftType !== 'mode4' && <span className="player-number">P{playerIndex + 1}</span>}
                            <div className="player-amikos">
                              {draftState.teamB.slice(playerIndex * 3, playerIndex * 3 + 3).map((amikoId, idx) => {
                                const amiko = AMIKOS.find(a => a.id === amikoId);
                                return amiko ? (
                                  <div key={idx} className="lineup-amiko">
                                    {amiko.element && (
                                      <span className="lineup-element-icon" title={amiko.element}>
                                        {ELEMENTS[amiko.element]?.icon}
                                      </span>
                                    )}
                                    <img src={amiko.image} alt={amiko.name} />
                                    <span>{amiko.name}</span>
                                  </div>
                                ) : null;
                              })}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Vote Actions Footer */}
                  <div className="lineup-footer-actions">
                    <button
                      className={`vote-btn vote-team-${draftState.teamColors?.teamA || 'blue'} ${userVote === 'A' ? 'voted' : ''}`}
                      onClick={() => voteForTeam('A')}
                    >
                      <span className="vote-icon">{userVote === 'A' ? '❤️' : '🤍'}</span>
                      <span className="vote-count">{getVoteCount('A')}</span>
                      <span className="vote-label">Vote {draftState.teamColors?.teamA === 'blue' ? (draftState.teamNames?.team1 || 'Team 1') : (draftState.teamNames?.team2 || 'Team 2')}</span>
                    </button>
                    <div className="spacer"></div>
                    <button
                      className={`vote-btn vote-team-${draftState.teamColors?.teamB || 'red'} ${userVote === 'B' ? 'voted' : ''}`}
                      onClick={() => voteForTeam('B')}
                    >
                      <span className="vote-icon">{userVote === 'B' ? '❤️' : '🤍'}</span>
                      <span className="vote-count">{getVoteCount('B')}</span>
                      <span className="vote-label">Vote {draftState.teamColors?.teamB === 'blue' ? (draftState.teamNames?.team1 || 'Team 1') : (draftState.teamNames?.team2 || 'Team 2')}</span>
                    </button>
                  </div>
                </div>

                <div className="modal-footer">
                  <button className="close-lineup-btn" onClick={() => setShowLineupPreview(false)}>
                    Close Preview
                  </button>
                </div>
              </div>
            </div>
          )
        }
      </div > {/* End of tournament-page */}
    </>
  );
}

export default TournamentPage;