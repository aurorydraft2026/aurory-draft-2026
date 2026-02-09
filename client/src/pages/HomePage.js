import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db, discordProvider } from '../firebase';
import { signInWithPopup, getAdditionalUserInfo, signOut, onAuthStateChanged } from 'firebase/auth';
import {
  collection, onSnapshot, doc, setDoc, serverTimestamp, getDocs,
  addDoc, query, orderBy, limit, runTransaction, writeBatch
} from 'firebase/firestore';
import { isSuperAdmin } from '../config/admins';
import { createNotification } from '../services/notifications';
import { updateDoc } from 'firebase/firestore';
import AuroryAccountLink from '../components/AuroryAccountLink';
import {
  syncAuroryName
} from '../services/auroryProfileService';
import { fetchVerifiedMatches, scanAndVerifyCompletedDrafts } from '../services/matchVerificationService';
import { AMIKOS } from '../data/amikos';
import './HomePage.css';

// Your AURY deposit wallet address (replace with your actual address)
const DEPOSIT_WALLET_ADDRESS = 'Gx8pDnqYwn7pb5bWQMGsmTVbpB1EPrPEBCgKVZJGKqTo';

// Helper function to get user email
const getUserEmail = (user) => {
  if (!user) return null;
  if (user.email) return user.email;
  if (user.providerData && user.providerData.length > 0) {
    return user.providerData[0].email;
  }
  return null;
};

// Generate a unique deposit memo for a user
const generateDepositMemo = (userId) => {
  return `AURY-${userId.slice(0, 8).toUpperCase()}`;
};


function HomePage() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const syncInProgressRef = React.useRef(false); // Guard for infinite sync loops
  const [tournaments, setTournaments] = useState([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [registeredUsers, setRegisteredUsers] = useState([]);
  const [participantSearchQuery, setParticipantSearchQuery] = useState('');

  // Team assignment state (3 players per team)
  const [team1, setTeam1] = useState({ leader: null, member1: null, member2: null });
  const [team2, setTeam2] = useState({ leader: null, member1: null, member2: null });
  const [assigningSlot, setAssigningSlot] = useState(null); // e.g., { team: 1, role: 'leader' }

  // Team names and banners
  const [team1Name, setTeam1Name] = useState('');
  const [team2Name, setTeam2Name] = useState('');
  const [team1Banner, setTeam1Banner] = useState(null); // base64 image data
  const [team2Banner, setTeam2Banner] = useState(null);

  const [announcementSlides, setAnnouncementSlides] = useState([]);
  const [currentSlide, setCurrentSlide] = useState(0); // Banner slide state

  // Rules Carousel State
  const [rulesCurrentSlide, setRulesCurrentSlide] = useState(0);
  const [itemsPerView, setItemsPerView] = useState(4);

  const rules = [
    {
      icon: "📅",
      title: "Match Scheduling",
      color: "teal",
      content: "All official match schedules will be announced in the Triad Tourney Channel. Teams are responsible for monitoring the channel and adhering to all posted schedules. Any updates, adjustments, or clarifications will be communicated by tournament organizers through the same channel."
    },
    {
      icon: "🎓",
      title: "Draft Eligibility & Authority",
      color: "purple",
      content: "Only designated and registered team coaches are authorized to make and finalize draft selections. Players who are not registered as coaches may not make or finalize draft picks during the draft phase. Non-coach players are permitted to communicate and strategize with their team captain or designated coach via the chat feature on the drafting page. All draft selections must be completed through the official draft system."
    },
    {
      icon: "🃏",
      title: "Draft Order & Selection Rules",
      color: "gold",
      content: "The first pick will be determined through a randomization process. Following the first pick, teams will select two (2) Amikos per round, adhering to the established draft order. Mirror Amikos are not allowed. Once an Amiko has been selected by a team, it may not be selected by the opposing team for that match. All selections are locked immediately upon confirmation."
    },
    {
      icon: "⏱️",
      title: "Draft Timer & Enforcement",
      color: "danger",
      content: "Each draft phase will have a strict time limit, which will be announced prior to the draft. Teams must complete their selections within the allotted time. Failure to make a selection before the timer expires will result in a random Amiko being assigned to the team. Randomly assigned selections are final and may not be appealed."
    },
    {
      icon: "✅",
      title: "Draft Stage Completion",
      color: "teal",
      content: "Teams are given a maximum of two (2) days to complete each scheduled draft stage. The draft stage is considered complete once all required Amikos have been successfully selected and locked by both teams. No changes, substitutions, or re-drafts are permitted after draft completion unless explicitly authorized by tournament organizers."
    },
    {
      icon: "⚔️",
      title: "Match Duration & Completion",
      color: "purple",
      content: "Teams are given a maximum of two (2) days to complete each scheduled match. Both teams are expected to coordinate promptly to ensure completion within the assigned timeframe. Failure to complete a match within the allotted period may result in penalties, forfeiture, or organizer intervention."
    },
    {
      icon: "📊",
      title: "Match Reporting",
      color: "gold",
      content: "Upon match completion, an official Amiko.gg tournament link will be generated. This link will be shared in the Triad Tourney Channel and will serve as the official record of the match. Only results submitted through the official tournament link will be recognized as valid."
    },
    {
      icon: "👑",
      title: "Organizer Authority",
      color: "danger",
      content: "Draft organizers reserve the right to interpret and enforce all rules outlined in this section. Any situations not explicitly covered will be resolved at the discretion of the organizers. All organizer decisions are final."
    }
  ];

  const totalRulesPages = Math.ceil(rules.length / itemsPerView);

  const nextRules = () => {
    setRulesCurrentSlide((prev) => (prev + 1) % totalRulesPages);
  };

  const prevRules = () => {
    setRulesCurrentSlide((prev) => (prev - 1 + totalRulesPages) % totalRulesPages);
  };

  // Banner Dragging State
  const [isDraggingBanner, setIsDraggingBanner] = useState(false);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);
  const bannerRef = React.useRef(null);


  const onTouchStart = (e) => {
    setIsDraggingBanner(true);
    setDragStartX(e.targetTouches[0].clientX);
    setDragOffset(0);
  };

  const onTouchMove = (e) => {
    if (!isDraggingBanner) return;
    const currentX = e.targetTouches[0].clientX;
    setDragOffset(currentX - dragStartX);
  };

  const onTouchEnd = () => {
    if (!isDraggingBanner) return;

    const bannerWidth = bannerRef.current?.offsetWidth || 0;
    const threshold = bannerWidth * 0.2;

    if (Math.abs(dragOffset) > threshold) {
      if (dragOffset > 0) {
        // Dragged right -> prev slide
        setCurrentSlide((prev) => (prev - 1 + announcementSlides.length) % announcementSlides.length);
      } else {
        // Dragged left -> next slide
        setCurrentSlide((prev) => (prev + 1) % announcementSlides.length);
      }
    }

    setIsDraggingBanner(false);
    setDragOffset(0);
  };

  // Desktop Mouse Drag Handlers
  const handleMouseDown = (e) => {
    // Prevent dragging on links/buttons
    if (e.target.closest('a') || e.target.closest('button')) return;

    setIsDraggingBanner(true);
    setDragStartX(e.clientX);
    setDragOffset(0);

    // Disable transitions during drag
    const track = bannerRef.current?.querySelector('.banner-track');
    if (track) track.style.transition = 'none';
  };

  const handleMouseMove = (e) => {
    if (!isDraggingBanner) return;
    setDragOffset(e.clientX - dragStartX);
  };

  const handleMouseUp = () => {
    if (!isDraggingBanner) return;

    const bannerWidth = bannerRef.current?.offsetWidth || 0;
    const threshold = bannerWidth * 0.2;

    // Re-enable transitions
    const track = bannerRef.current?.querySelector('.banner-track');
    if (track) track.style.transition = '';

    if (Math.abs(dragOffset) > threshold) {
      if (dragOffset > 0) {
        setCurrentSlide((prev) => (prev - 1 + announcementSlides.length) % announcementSlides.length);
      } else {
        setCurrentSlide((prev) => (prev + 1) % announcementSlides.length);
      }
    }

    setIsDraggingBanner(false);
    setDragOffset(0);
  };

  // Rules Carousel Dragging State
  const [rulesDragOffset, setRulesDragOffset] = useState(0);
  const [isRulesDragging, setIsRulesDragging] = useState(false);
  const [rulesDragStartX, setRulesDragStartX] = useState(0);
  const rulesRef = React.useRef(null);

  const onRulesStart = (clientX) => {
    setRulesDragStartX(clientX);
    setIsRulesDragging(true);
    setRulesDragOffset(0);
  };

  const onRulesMove = (clientX) => {
    if (!isRulesDragging) return;
    setRulesDragOffset(clientX - rulesDragStartX);
  };

  const onRulesEnd = () => {
    if (!isRulesDragging) return;

    const viewportWidth = rulesRef.current?.offsetWidth || 0;
    const threshold = viewportWidth * 0.2;

    if (Math.abs(rulesDragOffset) > threshold) {
      if (rulesDragOffset > 0) {
        prevRules();
      } else {
        nextRules();
      }
    }

    setRulesDragOffset(0);
    setIsRulesDragging(false);
  };



  // Auto-rotate banner slides
  useEffect(() => {
    if (isDraggingBanner) return; // Pause auto-rotate during drag

    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % announcementSlides.length);
    }, 8000);
    return () => clearInterval(timer);
  }, [announcementSlides.length, isDraggingBanner]);

  const [currentTime, setCurrentTime] = useState(Date.now());

  // Wallet state
  const [walletBalance, setWalletBalance] = useState(0);
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [walletTab, setWalletTab] = useState('deposit'); // 'deposit', 'withdraw', 'history'
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawAddress, setWithdrawAddress] = useState('');
  const [transactions, setTransactions] = useState([]);
  const [walletLoading, setWalletLoading] = useState(false);
  const [copySuccess, setCopySuccess] = useState('');

  const [depositTxSignature, setDepositTxSignature] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [depositNote, setDepositNote] = useState('');

  // Notifications State
  const [notifications, setNotifications] = useState([]);
  const [showNotificationPanel, setShowNotificationPanel] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // Aurory Account Link State
  const [showAuroryModal, setShowAuroryModal] = useState(false);

  // Match History state
  const [matchHistory, setMatchHistory] = useState([]);
  const [matchHistoryLoading, setMatchHistoryLoading] = useState(true);
  const [matchHistoryFilter, setMatchHistoryFilter] = useState('all'); // 'all', 'mode1', 'mode2', 'mode3'
  const [expandedMatch, setExpandedMatch] = useState(null); // draftId of expanded match
  const [showUserModal, setShowUserModal] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [tournamentFilter, setTournamentFilter] = useState('active');
  const [draftModeFilter, setDraftModeFilter] = useState('all'); // 'all','mode1','mode2','mode3'
  const [draftsExpanded, setDraftsExpanded] = useState(false);
  const [leaderboardMode, setLeaderboardMode] = useState('individual'); // 'individual' or 'team'
  const DRAFTS_PER_PAGE = 6;

  const [newTournament, setNewTournament] = useState({
    title: '',
    description: '',
    prizePool: '',
    draftType: 'mode1', // NEW: Default to Draft Mode 1
    timerDays: 0,
    timerHours: 24,
    timerMinutes: 0,
    timerSeconds: 0,
    manualTimerStart: false
  });
  const navigate = useNavigate();

  // Listen for authentication state changes and user Firestore data
  useEffect(() => {
    let unsubscribeUserDoc = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      // FIX: Ignore anonymous users - treat them as not logged in
      if (currentUser && currentUser.isAnonymous) {
        setUser(null);
        setLoading(false);
        if (unsubscribeUserDoc) unsubscribeUserDoc();
        return;
      }

      if (currentUser) {
        // First set the auth user
        setUser(currentUser);

        // Then listen to the user's Firestore document for Aurory data
        const userRef = doc(db, 'users', currentUser.uid);
        unsubscribeUserDoc = onSnapshot(userRef, (docSnap) => {
          if (docSnap.exists()) {
            const firestoreData = docSnap.data();
            setUser(prev => ({
              ...prev,
              ...firestoreData,
              // Ensure we keep the core auth properties if they aren't in Firestore
              email: firestoreData.email || prev?.email || currentUser.email,
              displayName: firestoreData.auroryPlayerName || firestoreData.displayName || prev?.displayName || currentUser.displayName
            }));

            // Proactively sync Aurory name if linked and not recently synced
            // FIX: Add check for hasPendingWrites to avoid infinite loop with serverTimestamp()
            if (firestoreData.auroryPlayerId && !firestoreData.auroryLastSync && !docSnap.metadata.hasPendingWrites && !syncInProgressRef.current) {
              syncInProgressRef.current = true;
              syncAuroryName(currentUser.uid, firestoreData.auroryPlayerId)
                .finally(() => {
                  syncInProgressRef.current = false;
                });
            }
          }
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

  // Listen for tournaments
  useEffect(() => {
    const draftsRef = collection(db, 'drafts');

    const unsubscribe = onSnapshot(draftsRef, (snapshot) => {
      const tournamentList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Sort by creation date (newest first)
      tournamentList.sort((a, b) => {
        const dateA = a.createdAt?.toDate?.() || new Date(0);
        const dateB = b.createdAt?.toDate?.() || new Date(0);
        return dateB - dateA;
      });

      setTournaments(tournamentList);
    });

    return () => unsubscribe();
  }, []);

  // Auto-switch to "Completed" filter if no active drafts exist on load
  useEffect(() => {
    if (tournaments.length > 0 && tournamentFilter === 'active') {
      const activeDrafts = tournaments.filter(t =>
        t.status === 'active' || t.status === 'coinFlip' || t.status === 'poolShuffle' || t.status === 'assignment' || t.status === 'waiting'
      );

      if (activeDrafts.length === 0) {
        setTournamentFilter('completed');
      }
    }
  }, [tournaments, tournamentFilter]);

  // Update current time every second for live timer display
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Listen for wallet balance and transactions
  useEffect(() => {
    if (!user) {
      setWalletBalance(0);
      setTransactions([]);
      return;
    }

    // Listen to wallet balance
    const walletRef = doc(db, 'wallets', user.uid);
    const unsubscribeWallet = onSnapshot(walletRef, (doc) => {
      if (doc.exists()) {
        setWalletBalance(doc.data().balance || 0);
      } else {
        // Initialize wallet if doesn't exist
        setDoc(walletRef, {
          balance: 0,
          pendingDeposits: 0,
          createdAt: serverTimestamp(),
          memo: generateDepositMemo(user.uid)
        });
        setWalletBalance(0);
      }
    });

    // Listen to transactions
    const transactionsRef = collection(db, 'wallets', user.uid, 'transactions');
    const transactionsQuery = query(transactionsRef, orderBy('timestamp', 'desc'), limit(50));
    const unsubscribeTransactions = onSnapshot(transactionsQuery, (snapshot) => {
      const txList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setTransactions(txList);
    });

    return () => {
      unsubscribeWallet();
      unsubscribeTransactions();
    };
  }, [user]);

  // Read User Notifications
  useEffect(() => {
    if (!user) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }

    const notificationsRef = collection(db, 'users', user.uid, 'notifications');
    const q = query(notificationsRef, orderBy('createdAt', 'desc'), limit(20));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const activeNotifications = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setNotifications(activeNotifications);
      setUnreadCount(activeNotifications.filter(n => !n.read).length);
    }, (error) => {
      console.error("Error fetching notifications:", error);
    });

    return () => unsubscribe();
  }, [user]);

  // Mark notifications as read
  const markAllAsRead = async () => {
    if (!user || unreadCount === 0) return;

    try {
      // Get all unread notification IDs
      const unread = notifications.filter(n => !n.read);

      // Update them one by one (batch update would be better but this is simpler for 20 items)
      await Promise.all(unread.map(n =>
        updateDoc(doc(db, 'users', user.uid, 'notifications', n.id), { read: true })
      ));

      setUnreadCount(0);
    } catch (error) {
      console.error("Error marking as read:", error);
    }
  };

  // Delete all notifications
  const deleteAllNotifications = async () => {
    if (!user) return;

    if (!window.confirm('Are you sure you want to delete all notifications? This will clear your entire history and cannot be undone.')) {
      return;
    }

    try {
      // Fetch ALL notification documents, not just the ones in state
      const notificationsRef = collection(db, 'users', user.uid, 'notifications');
      const snapshot = await getDocs(notificationsRef);

      if (snapshot.empty) {
        console.log('No notifications to delete');
        return;
      }

      const batch = writeBatch(db);
      snapshot.docs.forEach(notifDoc => {
        batch.delete(notifDoc.ref);
      });

      await batch.commit();
      console.log(`✅ All ${snapshot.size} notifications deleted`);
    } catch (error) {
      console.error("Error deleting notifications:", error);
      alert('Failed to delete notifications. Please try again.');
    }
  };

  // Calculate remaining time for a tournament
  const getTournamentTimer = (tournament) => {
    if (tournament.status !== 'active') return null;
    if (tournament.manualTimerStart && !tournament.timerStarted) return { waiting: true };

    const timerDuration = tournament.timerDuration || 24 * 60 * 60 * 1000;
    const currentTeam = tournament.currentTeam || 'A';
    const timerStart = currentTeam === 'A' ? tournament.timerStartA : tournament.timerStartB;

    if (!timerStart) return null;

    // Handle both number (Date.now()) and Firestore Timestamp
    const timerStartMs = typeof timerStart === 'number'
      ? timerStart
      : (timerStart?.toMillis ? timerStart.toMillis() : (timerStart?.seconds ? timerStart.seconds * 1000 : timerStart));

    const elapsed = currentTime - timerStartMs;
    const remaining = timerDuration - elapsed;

    if (remaining <= 0) {
      return { expired: true, team: currentTeam };
    }

    const totalSeconds = Math.floor(remaining / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return {
      team: currentTeam,
      hours,
      minutes,
      seconds,
      isUrgent: totalSeconds < 300 // Less than 5 minutes
    };
  };

  // Format timer display
  const formatTimer = (timer) => {
    if (!timer) return '';
    if (timer.waiting) return 'Waiting to start';
    if (timer.expired) return 'Time expired!';

    const h = String(timer.hours).padStart(2, '0');
    const m = String(timer.minutes).padStart(2, '0');
    const s = String(timer.seconds).padStart(2, '0');

    return `${h}:${m}:${s}`;
  };

  // Handle Discord Login
  const handleDiscordLogin = async () => {
    try {
      const result = await signInWithPopup(auth, discordProvider);

      // Get Discord profile data
      const additionalInfo = getAdditionalUserInfo(result);
      const discordData = additionalInfo?.profile;

      let userEmail = result.user.email;
      if (!userEmail && result.user.providerData && result.user.providerData.length > 0) {
        userEmail = result.user.providerData[0].email;
      }

      let displayName = result.user.displayName;
      if (!displayName && result.user.providerData && result.user.providerData.length > 0) {
        displayName = result.user.providerData[0].displayName ||
          result.user.providerData[0].uid ||
          userEmail?.split('@')[0];
      }

      const username = discordData?.username || displayName || 'Discord User';

      const enhancedUser = {
        ...result.user,
        email: userEmail || '',
        displayName: displayName || 'Discord User'
      };

      // ✨ CRITICAL: Save user to Firestore IMMEDIATELY
      try {
        await setDoc(doc(db, 'users', result.user.uid), {
          uid: result.user.uid,
          username: username,
          discordUsername: discordData?.username || displayName,
          discordId: discordData?.id || '',
          avatar: discordData?.avatar
            ? `https://cdn.discordapp.com/avatars/${discordData.id}/${discordData.avatar}.png`
            : result.user.photoURL || null,
          discriminator: discordData?.discriminator || '',
          email: userEmail || '',
          displayName: displayName || 'Discord User',
          lastLogin: new Date(),
          createdAt: new Date()
        }, { merge: true });

        console.log('✅ User saved to Firestore on login:', result.user.uid);
      } catch (firestoreError) {
        console.error('❌ Failed to save user to Firestore:', firestoreError);
        // Don't block login if Firestore save fails
      }

      setUser(enhancedUser);
    } catch (error) {
      console.error('Login error:', error);
      alert('Login failed: ' + error.message);
    }
  };

  // Handle Logout
  const handleLogout = async () => {
    try {
      await signOut(auth);
      setUser(null);
    } catch (error) {
      console.error('Logout error:', error.message);
    }
  };

  // Copy text to clipboard
  const copyToClipboard = async (text, type) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopySuccess(type);
      setTimeout(() => setCopySuccess(''), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Format AURY amount (assuming 9 decimals like SOL)
  const formatAuryAmount = (amount) => {
    return (amount / 1e9).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4
    });
  };

  // Submit withdrawal request - IMMEDIATELY DEDUCTS BALANCE
  const submitWithdrawal = async () => {
    if (!user) return;

    const amount = parseFloat(withdrawAmount);
    if (isNaN(amount) || amount <= 0) {
      alert('Please enter a valid amount');
      return;
    }

    // Convert to smallest unit (9 decimals)
    const amountInSmallestUnit = Math.floor(amount * 1e9);

    if (amountInSmallestUnit > walletBalance) {
      alert('Insufficient balance');
      return;
    }

    if (!withdrawAddress || withdrawAddress.length < 32) {
      alert('Please enter a valid Solana wallet address');
      return;
    }

    setWalletLoading(true);
    try {
      const walletRef = doc(db, 'wallets', user.uid);

      // Use transaction to atomically deduct balance and create withdrawal request
      await runTransaction(db, async (transaction) => {
        const walletDoc = await transaction.get(walletRef);

        if (!walletDoc.exists()) {
          throw new Error('Wallet not found');
        }

        const currentBalance = walletDoc.data().balance || 0;

        if (currentBalance < amountInSmallestUnit) {
          throw new Error('Insufficient balance');
        }

        // Deduct balance immediately
        transaction.update(walletRef, {
          balance: currentBalance - amountInSmallestUnit,
          updatedAt: serverTimestamp()
        });

        // Create withdrawal request
        const withdrawalRef = doc(collection(db, 'withdrawals'));
        transaction.set(withdrawalRef, {
          userId: user.uid,
          userEmail: user.email,
          userName: user.displayName,
          amount: amountInSmallestUnit,
          walletAddress: withdrawAddress,
          status: 'pending',
          createdAt: serverTimestamp()
        });
      });

      // Add to user's transaction history (outside transaction for simplicity)
      const txRef = collection(db, 'wallets', user.uid, 'transactions');
      await addDoc(txRef, {
        type: 'withdrawal_pending',
        amount: amountInSmallestUnit,
        walletAddress: withdrawAddress,
        status: 'pending',
        timestamp: serverTimestamp()
      });

      alert('Withdrawal request submitted! Balance deducted. It will be processed within 24 hours.');

      // Notify User
      await createNotification(user.uid, {
        type: 'withdrawal',
        title: 'Withdrawal Requested',
        message: `Your withdrawal for ${amount} AURY has been submitted for approval.`,
        link: '#'
      });

      setWithdrawAmount('');
      setWithdrawAddress('');
      setWalletTab('history');
    } catch (error) {
      console.error('Withdrawal error:', error);
      alert('Failed to submit withdrawal request: ' + error.message);
    }
    setWalletLoading(false);
  };

  // Submit deposit notification to admin
  const submitDepositNotification = async () => {
    if (!user) return;

    const amount = parseFloat(depositAmount);
    if (isNaN(amount) || amount <= 0) {
      alert('Please enter a valid amount');
      return;
    }

    setWalletLoading(true);
    try {
      // Create deposit notification request
      const notificationRef = collection(db, 'depositNotifications');
      await addDoc(notificationRef, {
        userId: user.uid,
        userEmail: user.email,
        userName: user.displayName,
        userMemo: generateDepositMemo(user.uid),
        amount: amount,
        txSignature: depositTxSignature || '',
        note: depositNote || '',
        status: 'pending', // pending, processed
        createdAt: serverTimestamp()
      });

      alert('✅ Admin has been notified! Your deposit will be credited soon.');

      // Notify User
      await createNotification(user.uid, {
        type: 'deposit',
        title: 'Deposit Notified',
        message: `Admin has been notified of your ${amount} AURY deposit. It will be credited soon.`,
        link: '#'
      });

      // Clear the form
      setDepositTxSignature('');
      setDepositAmount('');
      setDepositNote('');

    } catch (error) {
      console.error('Notification error:', error);
      alert('Failed to send notification. Please try again.');
    }
    setWalletLoading(false);
  };

  // Format timestamp
  const formatTransactionTime = (timestamp) => {
    if (!timestamp) return 'Pending';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Fetch registered users for participant selection
  const fetchRegisteredUsers = async () => {
    try {
      const usersCollection = collection(db, 'users');
      const snapshot = await getDocs(usersCollection);
      const users = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }))
        // Filter out users without any identifier (uid is required)
        .filter(user => user.uid);

      setRegisteredUsers(users);
    } catch (error) {
      console.error('Error fetching users:', error);
    }
  };

  // Fetch users on mount (for tournament card participant display)
  // and also refresh when modal opens
  useEffect(() => {
    if (user) {
      fetchRegisteredUsers();
    }
  }, [user]);

  useEffect(() => {
    if (showCreateModal) {
      fetchRegisteredUsers();
    }
  }, [showCreateModal]);

  // Fetch match history (verified matches from all tournaments)
  useEffect(() => {
    const loadMatchHistory = async () => {
      setMatchHistoryLoading(true);
      try {
        const modeParam = matchHistoryFilter === 'all' ? null : matchHistoryFilter;

        // 1. Load existing verified matches immediately
        let matches = await fetchVerifiedMatches(50, modeParam);
        setMatchHistory(matches);
        setMatchHistoryLoading(false);

        // 2. Scan for unverified completed drafts in background
        const newlyVerified = await scanAndVerifyCompletedDrafts();

        // 3. If scan found new results, refetch
        if (newlyVerified > 0) {
          matches = await fetchVerifiedMatches(50, modeParam);
          setMatchHistory(matches);
        }
      } catch (error) {
        console.error('Error loading match history:', error);
        setMatchHistory([]);
        setMatchHistoryLoading(false);
      }
    };

    loadMatchHistory();
  }, [matchHistoryFilter]);

  // Compute top players of the month by wins
  const topPlayers = useMemo(() => {
    if (!matchHistory || matchHistory.length === 0) return [];

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const winCounts = {}; // uid -> { wins, losses, displayName, photoURL }

    matchHistory.forEach(match => {
      // Filter to current month only
      if (match.verifiedAt) {
        const matchDate = new Date(match.verifiedAt);
        if (matchDate.getMonth() !== currentMonth || matchDate.getFullYear() !== currentYear) return;
      }

      if (!match.overallWinner) return;

      if (leaderboardMode === 'team') {
        // --- TEAM MODE: Use overall match winner ---
        // Get players from matchPlayers or permissions
        let players = [];
        if (match.matchPlayers?.length > 0) {
          players = match.matchPlayers;
        } else if (match.permissions) {
          Object.entries(match.permissions).forEach(([uid, perm]) => {
            if (perm === 'A' || perm === 'B') {
              players.push({ uid, team: perm, displayName: uid });
            }
          });
        }

        players.forEach(p => {
          if (p.team !== 'A' && p.team !== 'B') return;
          const uid = p.uid;
          if (!winCounts[uid]) {
            // Try to resolve from registeredUsers
            const userData = registeredUsers.find(u => u.id === uid);
            winCounts[uid] = {
              uid,
              displayName: p.auroryPlayerName || p.displayName || userData?.displayName || userData?.username || 'Player',
              photoURL: userData?.auroryProfilePicture || userData?.photoURL || null,
              wins: 0,
              losses: 0,
            };
          }
          if (p.team === match.overallWinner) {
            winCounts[uid].wins += 1;
          } else {
            winCounts[uid].losses += 1;
          }
        });

      } else {
        // --- INDIVIDUAL MODE: Use individual battle results ---
        // Iterate through each battle result
        (match.matchResults || []).forEach(result => {
          if (!result.winner || !result.playerA || !result.playerB) return;

          // Process Player A
          const uidA = match.matchPlayers?.find(mp => mp.auroryPlayerId === result.playerA.playerId || mp.displayName === result.playerA.displayName)?.uid;
          if (uidA) {
            if (!winCounts[uidA]) {
              const userData = registeredUsers.find(u => u.id === uidA);
              winCounts[uidA] = {
                uid: uidA,
                displayName: result.playerA.displayName || userData?.displayName || 'Player',
                photoURL: userData?.auroryProfilePicture || userData?.photoURL || null,
                wins: 0,
                losses: 0
              };
            }
            if (result.winner === 'A') winCounts[uidA].wins += 1;
            else winCounts[uidA].losses += 1;
          }

          // Process Player B
          const uidB = match.matchPlayers?.find(mp => mp.auroryPlayerId === result.playerB.playerId || mp.displayName === result.playerB.displayName)?.uid;
          if (uidB) {
            if (!winCounts[uidB]) {
              const userData = registeredUsers.find(u => u.id === uidB);
              winCounts[uidB] = {
                uid: uidB,
                displayName: result.playerB.displayName || userData?.displayName || 'Player',
                photoURL: userData?.auroryProfilePicture || userData?.photoURL || null,
                wins: 0,
                losses: 0
              };
            }
            if (result.winner === 'B') winCounts[uidB].wins += 1;
            else winCounts[uidB].losses += 1;
          }
        });
      }
    });

    return Object.values(winCounts)
      .sort((a, b) => b.wins - a.wins || a.losses - b.losses)
      .slice(0, 10);
  }, [matchHistory, registeredUsers, leaderboardMode]); // Added leaderboardMode dependency

  // Filter tournaments based on selected tab + mode
  const filteredTournaments = useMemo(() => {
    let filtered = tournaments;

    // Status/participation filter
    if (tournamentFilter !== 'all') {
      filtered = filtered.filter(t => {
        const myPerm = user ? t.permissions?.[user.uid] : null;
        const isParticipating = myPerm === 'A' || myPerm === 'B';
        switch (tournamentFilter) {
          case 'active':
            return t.status === 'active' || t.status === 'coinFlip' || t.status === 'poolShuffle' || t.status === 'assignment';
          case 'waiting':
            return t.status === 'waiting';
          case 'completed':
            return t.status === 'completed';
          case 'played':
            return t.status === 'completed' && !!t.overallWinner;
          case 'participating':
            return isParticipating;
          case 'myTurn': {
            if (!isParticipating || t.status !== 'active') return false;
            const timer = getTournamentTimer(t);
            return timer && !timer.expired && !timer.waiting && timer.team === myPerm;
          }
          default:
            return true;
        }
      });
    }

    // Draft mode filter
    if (draftModeFilter !== 'all') {
      filtered = filtered.filter(t => t.draftType === draftModeFilter);
    }

    return filtered;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournaments, tournamentFilter, draftModeFilter, user, currentTime]);

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

  // Check if both teams are complete (all 6 slots filled)
  const areTeamsComplete = () => {
    if (newTournament.draftType === 'mode3') {
      return team1.leader && team2.leader;
    }
    return team1.leader && team1.member1 && team1.member2 &&
      team2.leader && team2.member1 && team2.member2;
  };

  // Get count of assigned players
  const getAssignedCount = () => {
    return getAssignedParticipants().length;
  };

  // Assign a participant to a slot
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

  // NEW: Deselect a participant during selection flow
  const handleDeselectDuringFlow = (role) => {
    if (!assigningSlot) return;
    const { team, roles, sessionRoles } = assigningSlot;

    if (team === 1) {
      setTeam1(prev => ({ ...prev, [role]: null }));
    } else {
      setTeam2(prev => ({ ...prev, [role]: null }));
    }

    // Put role back if it's part of the original session but not in current roles
    if (sessionRoles.includes(role) && !roles.includes(role)) {
      setAssigningSlot({
        team,
        roles: [role, ...roles],
        sessionRoles
      });
    }
  };

  // Remove a participant from a slot
  const removeFromSlot = (team, role) => {
    if (team === 1) {
      setTeam1(prev => ({ ...prev, [role]: null }));
    } else {
      setTeam2(prev => ({ ...prev, [role]: null }));
    }
  };

  // Get user info by ID
  const getUserById = (userId) => {
    return registeredUsers.find(u => u.id === userId);
  };

  // Get team participants with display info from a tournament
  const getTeamParticipants = (tournament) => {
    const teamA = [];
    const teamB = [];
    if (tournament.permissions) {
      Object.entries(tournament.permissions).forEach(([uid, perm]) => {
        if (perm === 'A' || perm === 'B') {
          const userData = getUserById(uid);
          const participant = {
            uid,
            displayName: userData?.auroryPlayerName || userData?.displayName || userData?.username || 'Player',
            photoURL: userData?.auroryProfilePicture || userData?.photoURL || null,
            isLeader: false,
          };
          // Check if this user is a leader
          if (tournament.preAssignedTeams) {
            if (tournament.preAssignedTeams.team1?.leader === uid || tournament.preAssignedTeams.team2?.leader === uid) {
              participant.isLeader = true;
            }
          }
          if (perm === 'A') teamA.push(participant);
          else teamB.push(participant);
        }
      });
    }
    // Sort leaders first
    teamA.sort((a, b) => (b.isLeader ? 1 : 0) - (a.isLeader ? 1 : 0));
    teamB.sort((a, b) => (b.isLeader ? 1 : 0) - (a.isLeader ? 1 : 0));
    return { teamA, teamB };
  };

  // Handle banner image upload
  const handleBannerUpload = (teamNumber, event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      alert('Image must be smaller than 2MB');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      if (teamNumber === 1) {
        setTeam1Banner(reader.result);
      } else {
        setTeam2Banner(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  // Filter users for search (exclude already assigned)
  const filteredUsers = registeredUsers.filter(u => {
    // Exclude super admins and assigned admins
    if (isSuperAdmin(u.email) || u.role === 'admin') return false;


    // Exclude already assigned participants
    if (getAssignedParticipants().includes(u.id)) return false;

    const searchLower = participantSearchQuery.toLowerCase();
    const nameMatch = u.displayName?.toLowerCase().includes(searchLower);
    const emailMatch = u.email?.toLowerCase().includes(searchLower);
    return nameMatch || emailMatch;
  });

  // Create new tournament
  const handleCreateTournament = async () => {
    if (!newTournament.title.trim()) {
      alert('Please enter a draft title');
      return;
    }

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

    // If not using manual timer start, participants are required (6 for normal, 2 for 1v1)
    if (!newTournament.manualTimerStart && !areTeamsComplete()) {
      const required = newTournament.draftType === 'mode3' ? 2 : 6;
      alert(`Please assign all ${required} participants, or check "Start timer manually" to add participants later.`);
      return;
    }

    try {
      // Generate unique tournament ID
      const tournamentId = `tournament_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const draftRef = doc(db, 'drafts', tournamentId);

      // Build permissions object with assigned participants as spectators
      const permissions = {
        [user.uid]: 'admin'
      };
      getAssignedParticipants().forEach(uid => {
        permissions[uid] = 'spectator';
      });

      // Save team structure (will be shuffled to A/B when draft starts)
      const preAssignedTeams = {
        team1: {
          leader: team1.leader,
          member1: team1.member1,
          member2: team1.member2
        },
        team2: {
          leader: team2.leader,
          member1: team2.member1,
          member2: team2.member2
        }
      };

      // Get team names for display (use custom names or fallback to leader names)
      const team1LeaderUser = getUserById(team1.leader);
      const team2LeaderUser = getUserById(team2.leader);
      const teamNames = {
        team1: team1Name.trim() || team1LeaderUser?.username || team1LeaderUser?.displayName || 'Team 1',
        team2: team2Name.trim() || team2LeaderUser?.username || team2LeaderUser?.displayName || 'Team 2',
      };

      // Store team banners (base64)
      const teamBanners = {
        team1: team1Banner || null,
        team2: team2Banner || null,
      };

      const tournamentData = {
        title: newTournament.title.trim(),
        description: newTournament.description.trim(),
        prizePool: newTournament.prizePool.trim(),
        draftType: newTournament.draftType,
        timerDuration: timerMs,
        manualTimerStart: newTournament.manualTimerStart,
        timerStarted: false,
        teamA: [],
        teamB: [],
        currentPhase: 0,
        currentTeam: 'A',
        picksInPhase: 0,
        timerStartA: null,
        timerStartB: null,
        status: 'waiting',
        permissions: permissions,
        preAssignedTeams: preAssignedTeams, // NEW: Store pre-assigned teams
        teamNames: teamNames, // Store team names for display
        teamBanners: teamBanners, // Store team banner images
        lockedPhases: [],
        awaitingLockConfirmation: false,
        activeViewers: {},
        createdAt: serverTimestamp(),
        createdBy: user.uid
      };

      // Generate private code for 1v1 mode
      if (newTournament.draftType === 'mode3') {
        tournamentData.privateCode = Math.floor(10000 + Math.random() * 90000).toString();
      }

      await setDoc(draftRef, tournamentData);

      // Reset form and close modal
      setNewTournament({
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
      setTeam1({ leader: null, member1: null, member2: null });
      setTeam2({ leader: null, member1: null, member2: null });
      setTeam1Name('');
      setTeam2Name('');
      setTeam1Banner(null);
      setTeam2Banner(null);
      setAssigningSlot(null);
      setParticipantSearchQuery('');
      setShowCreateModal(false);

      // Notify all assigned participants
      const assignedUids = getAssignedParticipants();
      for (const uid of assignedUids) {
        if (uid === user.uid) continue; // Don't notify self
        await createNotification(uid, {
          type: 'invite',
          title: 'Draft Invitation',
          message: `You have been invited to participate in "${newTournament.title.trim()}".`,
          link: `/tournament/${tournamentId}`
        });
      }

      // Navigate to the new tournament
      // If not using manual timer start, pass autoStart flag to trigger draft immediately
      navigate(`/tournament/${tournamentId}`, {
        state: { autoStart: !newTournament.manualTimerStart }
      });
    } catch (error) {
      console.error('Error creating tournament:', error);
      alert('Failed to create draft: ' + error.message);
    }
  };

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1200) setItemsPerView(4);
      else if (window.innerWidth >= 768) setItemsPerView(2);
      else setItemsPerView(1);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Fetch dynamic banners
  useEffect(() => {
    const bannersRef = collection(db, 'banners');
    const q = query(bannersRef, orderBy('order', 'asc'), orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const AMIKO_LEGENDS_BANNER = {
        id: 'amiko-legends-static',
        tag: 'Amiko Legends',
        title: 'Enter the Amiko Realm',
        text: 'Venture into dangerous, ever-shifting realms where every decision matters. Collect and bond with powerful Amiko, overcome relentless enemies, and forge your path through a rogue-like adventure where only true legends endure.',
        image: 'https://app.aurory.io/images/sot-dashboard/sot-logo.png',
        video: '/amiko-vid.mp4',
        isStatic: true
      };

      if (!snapshot.empty) {
        const bannerData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setAnnouncementSlides([AMIKO_LEGENDS_BANNER, ...bannerData]);
      } else {
        setAnnouncementSlides([AMIKO_LEGENDS_BANNER]);
      }
    });

    return () => unsubscribe();
  }, []);

  // Navigate to Tournament page
  const goToTournament = (tournamentId) => {
    navigate(`/tournament/${tournamentId}`);
  };

  // Get participant count for a tournament
  const getParticipantCount = (tournament) => {
    if (!tournament.permissions) return 0;
    return Object.values(tournament.permissions).filter(p => p === 'A' || p === 'B').length;
  };

  // Get status badge color
  const getStatusColor = (status) => {
    switch (status) {
      case 'active': return 'status-active';
      case 'coinFlip':
      case 'poolShuffle':
      case 'assignment': return 'status-starting';
      case 'completed': return 'status-completed';
      default: return 'status-waiting';
    }
  };

  // Format status text
  const getStatusText = (status) => {
    switch (status) {
      case 'active': return '🟢 Active';
      case 'coinFlip': return '🪙 Coin Flip';
      case 'poolShuffle': return '🔀 Shuffling';
      case 'assignment': return '📋 Assigning';
      case 'completed': return '✅ Completed';
      default: return '⏳ Waiting';
    }
  };

  const isSuperAdminUser = user && isSuperAdmin(getUserEmail(user));
  const isAdminUser = user && (isSuperAdminUser || user.role === 'admin');
  const isAdmin = isAdminUser; // Preserve for backwards compatibility within this file


  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <div className="homepage">
      {/* Header with Discord Login */}
      <header className="header">
        <div className="logo">
          <h1>Aurory Draft</h1>
        </div>
        <div className="auth-section">
          {user ? (
            <div className="user-info">
              {/* Admin: Create Draft Button in Header */}
              {isAdmin && (
                <button onClick={() => setShowCreateModal(true)} className="header-create-btn">
                  ⚡ Create
                </button>
              )}

              {/* Wallet Balance */}
              <button
                className="wallet-btn"
                onClick={() => setShowWalletModal(true)}
              >
                <img src="/aury-icon.png" alt="AURY" className="wallet-icon-img" />
                <span className="wallet-amount">{formatAuryAmount(walletBalance)} AURY</span>
              </button>

              {/* Notifications Bell */}
              <div className="notification-container">
                <button
                  className={`notification-bell ${unreadCount > 0 ? 'has-unread' : ''}`}
                  onClick={() => {
                    setShowNotificationPanel(!showNotificationPanel);
                    if (!showNotificationPanel) markAllAsRead();
                  }}
                  title="Notifications"
                >
                  🔔
                  {unreadCount > 0 && <span className="notification-badge">{unreadCount}</span>}
                </button>

                {showNotificationPanel && (
                  <div className="notification-panel">
                    <div className="notification-panel-header">
                      <div className="header-left">
                        <h3>Notifications</h3>
                        {notifications.length > 0 && (
                          <button
                            className="delete-all-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteAllNotifications();
                            }}
                            title="Delete all notifications"
                          >
                            🗑️ Clear All
                          </button>
                        )}
                      </div>
                      <button className="close-panel-btn" onClick={() => setShowNotificationPanel(false)}>✕</button>
                    </div>
                    <div className="notification-list">
                      {notifications.length === 0 ? (
                        <div className="no-notifications">No new notifications</div>
                      ) : (
                        notifications.map(notif => (
                          <div
                            key={notif.id}
                            className={`notification-item ${!notif.read ? 'unread' : ''} ${notif.type}`}
                            onClick={() => {
                              if (notif.link && notif.link !== '#') navigate(notif.link);
                              setShowNotificationPanel(false);
                            }}
                          >
                            <div className="notification-icon">
                              {notif.type === 'invite' ? '🎮' :
                                notif.type === 'deposit' ? '📥' :
                                  notif.type === 'withdrawal' ? '📤' : '🔔'}
                            </div>
                            <div className="notification-content">
                              <div className="notification-title">{notif.title}</div>
                              <div className="notification-message">{notif.message}</div>
                              <div className="notification-time">
                                {formatTransactionTime(notif.createdAt)}
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Clickable Profile Section */}
              <div
                className="profile-trigger"
                onClick={() => setShowUserModal(true)}
                title="User Menu"
              >
                <img
                  src={user.auroryProfilePicture || user.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png'}
                  alt="Profile"
                  className="profile-pic"
                  onError={(e) => { e.target.onerror = null; e.target.src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }}
                />
                <div className="profile-names">
                  <span className="username">
                    {user.displayName || user.email?.split('@')[0] || 'User'}
                    {user.isAurorian && <span className="aurorian-badge" title="Aurorian NFT Holder">🛡️</span>}
                  </span>
                  {isSuperAdminUser ? (
                    <span className="admin-badge">⭐ Super Admin</span>
                  ) : isAdminUser ? (
                    <span className="admin-badge admin-staff">⭐ Admin</span>
                  ) : null}
                  {user.isAurorian && <span className="aurorian-tag">Aurorian Holder</span>}

                </div>
                <span className="menu-arrow">▾</span>
              </div>
            </div>
          ) : (
            <button onClick={handleDiscordLogin} className="discord-login-btn">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z" />
              </svg>
              Login with Discord
            </button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content">
        {/* Welcome Header - Full Width Above Grid */}
        <div className="hero-section">
          <h2>Welcome to Aurory Draft</h2>
          <p>Competitive Amiko drafting for your matches</p>
        </div>

        <div className="content-wrapper">
          <div className="main-column">
            {announcementSlides.length > 0 && (
              <div className="main-column-inner">
                {/* Announcement Banner */}
                <div
                  ref={bannerRef}
                  className={`announcement-banner ${isDraggingBanner ? 'dragging' : ''}`}
                  onTouchStart={onTouchStart}
                  onTouchMove={onTouchMove}
                  onTouchEnd={onTouchEnd}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                >
                  <div
                    className="banner-track"
                    style={{
                      transform: `translateX(calc(-${currentSlide * 100}% + ${dragOffset}px))`,
                      transition: isDraggingBanner ? 'none' : 'transform 0.6s cubic-bezier(0.23, 1, 0.32, 1)'
                    }}
                  >
                    {announcementSlides.map((slide, index) => (
                      <div
                        key={slide.id}
                        className={`banner-slide ${index === currentSlide ? 'active' : ''} ${slide.link ? 'clickable' : ''} ${slide.video ? 'has-video' : ''}`}
                        style={!slide.video ? { backgroundImage: `url(${slide.image})` } : {}}
                        onClick={(e) => {
                          // Prevent click if we were dragging
                          if (Math.abs(dragOffset) > 5) return;
                          // If it's the static banner, we don't want a slide-wide link
                          if (slide.isStatic) return;
                          if (slide.link) window.open(slide.link, '_blank');
                        }}
                      >
                        {slide.video && (
                          <video className="banner-video-base" autoPlay muted loop playsInline>
                            <source src={slide.video} type="video/mp4" />
                          </video>
                        )}
                        <div className="slide-overlay"></div>
                        <div className="banner-content">
                          {slide.isStatic && (
                            <div className="static-banner-logo-wrapper">
                              <img src={slide.image} alt="Logo" className="banner-static-logo" />
                            </div>
                          )}
                          <div className="banner-meta">
                            <span className={`banner-tag ${slide.tag === 'Amiko Legends' ? 'amiko-legends' : ''}`}>{slide.tag}</span>
                            {slide.date && <span className="banner-date">📅 {slide.date}</span>}
                          </div>
                          <h3 className="banner-title">{slide.title}</h3>
                          <p className="banner-text">{slide.text}</p>
                          {slide.isStatic && (
                            <div className="banner-store-links" onClick={(e) => e.stopPropagation()}>
                              <a href="https://store.epicgames.com/en-US/p/amiko-legends-a5986d" target="_blank" rel="noopener noreferrer" className="banner-store-btn epic">
                                <img src="https://upload.wikimedia.org/wikipedia/commons/3/31/Epic_Games_logo.svg" alt="Epic Store" />
                                <div className="btn-label">
                                  <small>Available on</small>
                                  <span>Epic Store</span>
                                </div>
                              </a>
                              <a href="https://play.google.com/store/apps/details?id=io.aurory.seekersoftokane&pcampaignid=web_share" target="_blank" rel="noopener noreferrer" className="banner-store-btn play">
                                <img src="https://upload.wikimedia.org/wikipedia/commons/7/78/Google_Play_Store_badge_EN.svg" alt="Google Play" className="play-badge" />
                              </a>
                              <a href="https://testflight.apple.com/join/FuaxsScP" target="_blank" rel="noopener noreferrer" className="banner-store-btn ios">
                                <img src="https://upload.wikimedia.org/wikipedia/commons/3/3c/Download_on_the_App_Store_Badge.svg" alt="App Store" className="app-badge" />
                              </a>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="banner-indicators">
                    {announcementSlides.map((_, index) => (
                      <div
                        key={index}
                        className={`indicator ${index === currentSlide ? 'active' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setCurrentSlide(index);
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Drafts Grid */}
            <div className="tournaments-section">
              <div className="tournaments-header">
                <h3>♟️ All Drafts </h3>
              </div>

              {/* Filter Tabs */}
              <div className="tournament-filters">
                <div className="filter-tabs-row">
                  {[
                    { key: 'active', label: 'Active', icon: '🟢' },
                    { key: 'waiting', label: 'Waiting', icon: '⏳' },
                    { key: 'completed', label: 'Completed', icon: '✅' },
                    { key: 'played', label: 'Played', icon: '🎮' },
                    { key: 'participating', label: 'Joined', icon: '👤' },
                    { key: 'myTurn', label: 'Your Turn', icon: '⚡' },
                  ].map(tab => {
                    const count = tournaments.filter(t => {
                      const myPerm = user ? t.permissions?.[user.uid] : null;
                      const isPart = myPerm === 'A' || myPerm === 'B';
                      if (tab.key === 'active') return t.status === 'active' || t.status === 'coinFlip' || t.status === 'poolShuffle' || t.status === 'assignment';
                      if (tab.key === 'waiting') return t.status === 'waiting';
                      if (tab.key === 'completed') return t.status === 'completed';
                      if (tab.key === 'played') return t.status === 'completed' && !!t.overallWinner;
                      if (tab.key === 'participating') return isPart;
                      if (tab.key === 'myTurn') {
                        if (!isPart || t.status !== 'active') return false;
                        const tmr = getTournamentTimer(t);
                        return tmr && !tmr.expired && !tmr.waiting && tmr.team === myPerm;
                      }
                      return true;
                    }).length;
                    return (
                      <button
                        key={tab.key}
                        className={`filter-tab ${tournamentFilter === tab.key ? 'active' : ''} ${tab.key === 'myTurn' && count > 0 ? 'has-turns' : ''}`}
                        onClick={() => { setTournamentFilter(tab.key); setDraftsExpanded(false); }}
                      >
                        <span className="filter-tab-icon">{tab.icon}</span>
                        <span className="filter-tab-label">{tab.label}</span>
                        {count > 0 && <span className="filter-tab-count">{count}</span>}
                      </button>
                    );
                  })}

                  {/* Draft Mode Dropdown */}
                  <select
                    className="mode-filter-dropdown"
                    value={draftModeFilter}
                    onChange={(e) => { setDraftModeFilter(e.target.value); setDraftsExpanded(false); }}
                  >
                    <option value="all">All Modes</option>
                    <option value="mode1">Triad Format 3-6-3</option>
                    <option value="mode2">Triad Format 1-2-1</option>
                    <option value="mode3">Deathmatch 3-3</option>
                  </select>
                </div>
              </div>

              {filteredTournaments.length === 0 ? (
                <div className="no-tournaments">
                  {tournaments.length === 0 ? (
                    <>
                      <p>🎮 No drafts available</p>
                      {isAdmin ? (
                        <p className="hint">Click "⚡ Create" to start one!</p>
                      ) : (
                        <p className="hint">Check back later for upcoming drafts</p>
                      )}
                    </>
                  ) : (
                    <p>No drafts match this filter</p>
                  )}
                </div>
              ) : (
                <>
                  <div className="tournaments-grid">
                    {(draftsExpanded ? filteredTournaments : filteredTournaments.slice(0, DRAFTS_PER_PAGE)).map(tournament => {
                      const timer = getTournamentTimer(tournament);
                      const myPermissions = user ? tournament.permissions?.[user.uid] : null;
                      const isParticipating = myPermissions === 'A' || myPermissions === 'B';
                      const isMyTurn = tournament.status === 'active' && timer && !timer.expired && !timer.waiting && timer.team === myPermissions;

                      // Determine display name for current turn
                      // Use teamA/teamB keys which are set after shuffle in finalizeDraft
                      // Fall back to team1/team2 for backwards compatibility with existing tournaments
                      let turnName = `Team ${timer?.team || 'A'}`;
                      if (timer?.team && tournament.leaderNames) {
                        // First try the shuffled team keys (teamA/teamB) - new format
                        const shuffledKey = timer.team === 'A' ? 'teamA' : 'teamB';
                        if (tournament.leaderNames[shuffledKey]) {
                          turnName = tournament.leaderNames[shuffledKey];
                        } else {
                          // Fallback to pre-shuffle keys (team1/team2) for existing tournaments
                          const fallbackKey = timer.team === 'A' ? 'team1' : 'team2';
                          if (tournament.leaderNames[fallbackKey]) {
                            turnName = tournament.leaderNames[fallbackKey];
                          }
                        }
                      }

                      // Leader VS Leader display - use teamNames (set at creation) or leaderNames
                      const team1Name = tournament.teamNames?.team1 || tournament.leaderNames?.team1 || 'Team A';
                      const team2Name = tournament.teamNames?.team2 || tournament.leaderNames?.team2 || 'Team B';

                      // Get actual participants
                      const teamParticipants = getTeamParticipants(tournament);

                      return (
                        <div
                          key={tournament.id}
                          className={`tournament-card ${isMyTurn ? 'active-turn' : ''} ${isParticipating && !isMyTurn ? 'participating' : ''}`}
                          onClick={() => goToTournament(tournament.id)}
                        >
                          {/* Live Timer Ribbon for Active Drafts */}
                          {tournament.status === 'active' && timer && (
                            <div className={`timer-ribbon ${isMyTurn ? 'my-turn-ribbon' : ''} ${isParticipating && !isMyTurn ? 'not-my-turn' : ''} ${timer.isUrgent ? 'urgent' : ''} ${timer.expired ? 'expired' : ''} ${timer.waiting ? 'waiting' : ''}`}>
                              <div className="ribbon-content">
                                {timer.waiting ? (
                                  <span className="ribbon-text">⏸️ Waiting to Start</span>
                                ) : timer.expired ? (
                                  <span className="ribbon-text">⚠️ Time Expired!</span>
                                ) : (
                                  <>
                                    <span className="ribbon-team">
                                      {isMyTurn ? '⚡ YOUR TURN!' : `${turnName}'s Turn`}
                                    </span>
                                    <span className="ribbon-timer">⏱️ {formatTimer(timer)}</span>
                                  </>
                                )}
                              </div>
                            </div>
                          )}

                          <div className="card-content">
                            <div className="tournament-header">
                              <h4>{tournament.title || 'Untitled Draft'}</h4>
                              <div className="card-badges">
                                <span className={`mode-badge mode-${tournament.draftType || 'mode1'}`}>
                                  {tournament.draftType === 'mode3' ? 'DM 3-3' : tournament.draftType === 'mode2' ? 'Triad 1-2-1' : 'Triad 3-6-3'}
                                </span>
                                <span className={`status-badge ${getStatusColor(tournament.status)}`}>
                                  {getStatusText(tournament.status)}
                                </span>
                              </div>
                            </div>

                            <p className="tournament-description">
                              {tournament.description || ''}
                            </p>

                            <div className="tournament-details">
                              {tournament.prizePool && (
                                <div className="detail-item prize">
                                  <span className="detail-icon">🏆</span>
                                  <span>{tournament.prizePool}</span>
                                </div>
                              )}

                              {/* Team VS Team Participant Display */}
                              <div className="card-vs-matchup">
                                <div className="card-team-side">
                                  <span className="card-team-name">{team1Name}</span>
                                  <div className="card-team-members">
                                    {teamParticipants.teamA.length > 0 ? (
                                      teamParticipants.teamA.map((p) => (
                                        <div key={p.uid} className={`card-member ${p.isLeader ? 'leader' : ''}`} title={p.displayName}>
                                          <img
                                            src={p.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png'}
                                            alt=""
                                            className="card-member-avatar"
                                            onError={(e) => { e.target.onerror = null; e.target.src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }}
                                          />
                                          <span className="card-member-name">{p.displayName}</span>
                                          {p.isLeader && <span className="card-leader-crown">👑</span>}
                                        </div>
                                      ))
                                    ) : (
                                      <span className="card-no-members">No players yet</span>
                                    )}
                                  </div>
                                </div>

                                <div className="card-vs-badge">VS</div>

                                <div className="card-team-side">
                                  <span className="card-team-name">{team2Name}</span>
                                  <div className="card-team-members">
                                    {teamParticipants.teamB.length > 0 ? (
                                      teamParticipants.teamB.map((p) => (
                                        <div key={p.uid} className={`card-member ${p.isLeader ? 'leader' : ''}`} title={p.displayName}>
                                          <img
                                            src={p.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png'}
                                            alt=""
                                            className="card-member-avatar"
                                            onError={(e) => { e.target.onerror = null; e.target.src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }}
                                          />
                                          <span className="card-member-name">{p.displayName}</span>
                                          {p.isLeader && <span className="card-leader-crown">👑</span>}
                                        </div>
                                      ))
                                    ) : (
                                      <span className="card-no-members">No players yet</span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <div className="detail-item participants">
                                <span className="detail-icon">👥</span>
                                <span>{getParticipantCount(tournament)} participants</span>
                              </div>
                            </div>

                            <div className="tournament-footer">
                              <span className="view-btn">View Draft →</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {filteredTournaments.length > DRAFTS_PER_PAGE && (
                    <button
                      className="show-more-btn"
                      onClick={() => setDraftsExpanded(!draftsExpanded)}
                    >
                      {draftsExpanded
                        ? `▲ Show Less`
                        : `▼ Show More (${filteredTournaments.length - DRAFTS_PER_PAGE} more)`
                      }
                    </button>
                  )}
                </>
              )}
            </div>
          </div>{/* end main-column */}

          {/* Right Column: Match History + Top Players */}
          <div className="right-sidebar">
            {/* Match History */}
            <div className="match-history-section">
              <div className="match-history-header">
                <h3>⚔️ Match History</h3>
                <select
                  className="mode-filter-select"
                  value={matchHistoryFilter}
                  onChange={(e) => setMatchHistoryFilter(e.target.value)}
                >
                  <option value="all">All Modes</option>
                  <option value="mode1">Triad Format 3-6-3</option>
                  <option value="mode2">Triad Format 1-2-1</option>
                  <option value="mode3">Deathmatch 3-3</option>
                </select>
              </div>

              <div className="match-history-list">
                {matchHistoryLoading ? (
                  <div className="match-history-loading">
                    <div className="spinner-small"></div>
                    <span>Loading matches...</span>
                  </div>
                ) : matchHistory.length === 0 ? (
                  <div className="match-history-empty">
                    <p>No verified matches yet</p>
                  </div>
                ) : (
                  matchHistory
                    .filter(match => {
                      // For 3v3 modes, only show completed drafts (has overallWinner or status completed)
                      if (match.draftType === 'mode1' || match.draftType === 'mode2') {
                        return match.overallWinner && match.status === 'completed';
                      }
                      return true;
                    })
                    .slice(0, 5)
                    .map((match) => {
                      const isExpanded = expandedMatch === match.draftId;
                      const is3v3 = match.draftType === 'mode1' || match.draftType === 'mode2';
                      let teamAPlayers, teamBPlayers;
                      if (match.matchPlayers?.length > 0) {
                        teamAPlayers = match.matchPlayers.filter(p => p.team === 'A');
                        teamBPlayers = match.matchPlayers.filter(p => p.team === 'B');
                      } else {
                        teamAPlayers = match.finalAssignments?.filter(a => a.team === 'A').map(a => a.participant) || [];
                        teamBPlayers = match.finalAssignments?.filter(a => a.team === 'B').map(a => a.participant) || [];
                      }
                      const teamAColor = match.teamColors?.teamA || 'blue';
                      const teamBColor = match.teamColors?.teamB || 'red';
                      const modeLabels = { mode1: 'Triad 3-6-3', mode2: 'Triad 1-2-1', mode3: 'DM 3-3' };

                      // For 3v3: show team names; For 1v1: show player names
                      let teamADisplay, teamBDisplay;
                      if (is3v3) {
                        teamADisplay = match.teamNames?.team1 || 'Team A';
                        teamBDisplay = match.teamNames?.team2 || 'Team B';
                      } else {
                        // 1v1: use actual player names
                        const playerA = teamAPlayers[0];
                        const playerB = teamBPlayers[0];
                        teamADisplay = playerA?.auroryPlayerName || playerA?.displayName || match.teamNames?.team1 || 'Player 1';
                        teamBDisplay = playerB?.auroryPlayerName || playerB?.displayName || match.teamNames?.team2 || 'Player 2';
                      }

                      return (
                        <div key={match.draftId} className={`match-history-item ${isExpanded ? 'expanded' : ''}`}>
                          <div
                            className="match-history-summary"
                            onClick={() => setExpandedMatch(isExpanded ? null : match.draftId)}
                          >
                            <div className="match-summary-top">
                              <span className="match-mode-badge">{modeLabels[match.draftType] || match.draftType}</span>
                              <span className="match-date">
                                {match.verifiedAt ? new Date(match.verifiedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}
                              </span>
                            </div>

                            <div className="match-summary-teams">
                              <div className={`match-team ${match.overallWinner === 'A' ? 'winner' : 'loser'} team-${teamAColor}`}>
                                {match.overallWinner === 'A' && <span className="mini-trophy">🏆</span>}
                                {teamADisplay}
                              </div>
                              <div className="match-score-vs">
                                {match.score ? (
                                  <span className="match-score">{match.score}</span>
                                ) : (
                                  <span className="match-vs">vs</span>
                                )}
                              </div>
                              <div className={`match-team ${match.overallWinner === 'B' ? 'winner' : 'loser'} team-${teamBColor}`}>
                                {match.overallWinner === 'B' && <span className="mini-trophy">🏆</span>}
                                {teamBDisplay}
                              </div>
                            </div>

                            {match.overallWinner && match.overallWinner !== 'draw' && (
                              <div className="match-winner-label">
                                <span>Winner: </span>
                                <span className={`winner-name team-${match.overallWinner === 'A' ? teamAColor : teamBColor}`}>
                                  {match.overallWinner === 'A' ? teamADisplay : teamBDisplay}
                                </span>
                              </div>
                            )}

                            <div className="match-summary-title">{match.title}</div>
                            <span className="expand-icon">{isExpanded ? '▲' : '▼'}</span>
                          </div>

                          {isExpanded && (
                            <div className="match-history-details">
                              <div className="match-detail-players">
                                <div className={`match-detail-team team-${teamAColor}`}>
                                  <span className="team-label">{teamADisplay}</span>
                                  {/* For 1v1, show player amiko picks; for 3v3, show roster */}
                                  {!is3v3 && teamAPlayers.map((p, i) => (
                                    <span key={i} className="match-player-name">{p.auroryPlayerName || p.displayName || 'Player'}</span>
                                  ))}
                                </div>
                                <div className={`match-detail-team team-${teamBColor}`}>
                                  <span className="team-label">{teamBDisplay}</span>
                                  {!is3v3 && teamBPlayers.map((p, i) => (
                                    <span key={i} className="match-player-name">{p.auroryPlayerName || p.displayName || 'Player'}</span>
                                  ))}
                                </div>
                              </div>

                              {(match.matchResults || []).map((result, idx) => (
                                <div key={idx} className={`match-detail-battle status-${result.status}`}>
                                  <div className="battle-detail-header">
                                    <span>{match.draftType === 'mode3' ? 'Match' : `Battle ${idx + 1}`}</span>
                                    <span className={`status-badge status-${result.status}`}>
                                      {result.status === 'verified' && '✅'}
                                      {(result.status === 'disqualified_A' || result.status === 'disqualified_B') && '⛔ DQ'}
                                      {result.status === 'both_disqualified' && '⛔ Both DQ'}
                                      {result.status === 'not_found' && '⏳'}
                                    </span>
                                  </div>

                                  {result.playerA && result.playerB && (
                                    <div className="battle-detail-matchup">
                                      <div className={`battle-detail-player ${result.winner === 'A' ? 'winner' : 'loser'}`}>
                                        <span className="bd-outcome">{result.winner === 'A' ? '🏆' : '💀'}</span>
                                        <span className="bd-name">{result.playerA.displayName}</span>
                                        {!result.playerA.lineupValid && <span className="dq-mini">DQ</span>}
                                      </div>
                                      <div className="battle-detail-amikos">
                                        {(result.playerA.usedAmikos || []).map((amikoId, i) => {
                                          const amiko = AMIKOS.find(a => a.id === amikoId);
                                          return amiko ? (
                                            <img key={i} src={amiko.image} alt={amiko.name} title={amiko.name} className="bd-amiko-img" />
                                          ) : <span key={i} className="bd-amiko-text">{amikoId}</span>;
                                        })}
                                      </div>
                                      <span className="bd-vs">vs</span>
                                      <div className={`battle-detail-player ${result.winner === 'B' ? 'winner' : 'loser'}`}>
                                        <span className="bd-outcome">{result.winner === 'B' ? '🏆' : '💀'}</span>
                                        <span className="bd-name">{result.playerB.displayName}</span>
                                        {!result.playerB.lineupValid && <span className="dq-mini">DQ</span>}
                                      </div>
                                      <div className="battle-detail-amikos">
                                        {(result.playerB.usedAmikos || []).map((amikoId, i) => {
                                          const amiko = AMIKOS.find(a => a.id === amikoId);
                                          return amiko ? (
                                            <img key={i} src={amiko.image} alt={amiko.name} title={amiko.name} className="bd-amiko-img" />
                                          ) : <span key={i} className="bd-amiko-text">{amikoId}</span>;
                                        })}
                                      </div>
                                    </div>
                                  )}

                                  {result.disqualificationReason && (
                                    <div className="battle-detail-dq">⚠️ {result.disqualificationReason}</div>
                                  )}
                                </div>
                              ))}

                              <button
                                className="view-tournament-btn"
                                onClick={() => navigate(`/tournament/${match.draftId}`)}
                              >
                                View Draft →
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })
                )}
              </div>
            </div>

            {/* Best Player of the Month */}
            <div className="top-players-section">
              <div className="top-players-header">
                <h3>🏆 Best Players</h3>
                <span className="top-players-month">
                  {new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                </span>
                <select
                  className="leaderboard-mode-select"
                  value={leaderboardMode}
                  onChange={(e) => setLeaderboardMode(e.target.value)}
                >
                  <option value="individual">Individual</option>
                  <option value="team">Team</option>
                </select>
              </div>
              <div className="top-players-list">
                {topPlayers.length === 0 ? (
                  <div className="top-players-empty">
                    <p>No matches this month</p>
                  </div>
                ) : (
                  topPlayers.map((player, idx) => (
                    <div key={player.uid} className={`top-player-row ${idx < 3 ? `rank-${idx + 1}` : ''}`}>
                      <span className="top-player-rank">
                        {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`}
                      </span>
                      <img
                        src={player.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png'}
                        alt=""
                        className="top-player-avatar"
                        onError={(e) => { e.target.onerror = null; e.target.src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }}
                      />
                      <div className="top-player-info">
                        <span className="top-player-name">{player.displayName}</span>
                        <span className="top-player-record">
                          <span className="record-wins">{player.wins}W</span>
                          <span className="record-sep">·</span>
                          <span className="record-losses">{player.losses}L</span>
                        </span>
                      </div>
                      <div className="top-player-winrate">
                        {Math.round((player.wins / (player.wins + player.losses)) * 100)}%
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>
        </div>{/* end content-wrapper */}

        {/* Draft Flow & System Rules */}
        <section className="rules-section">
          <div className="rules-header">
            <div className="rules-header-line"></div>
            <h3 className="rules-title">
              <span className="rules-icon">📜</span>
              Draft Flow & System
            </h3>
            <div className="rules-header-line"></div>
          </div>

          <div className="rules-carousel-wrapper">
            <div
              ref={rulesRef}
              className={`rules-carousel-viewport ${isRulesDragging ? 'dragging' : ''}`}
              onTouchStart={(e) => onRulesStart(e.targetTouches[0].clientX)}
              onTouchMove={(e) => onRulesMove(e.targetTouches[0].clientX)}
              onTouchEnd={onRulesEnd}
              onMouseDown={(e) => onRulesStart(e.clientX)}
              onMouseMove={(e) => onRulesMove(e.clientX)}
              onMouseUp={onRulesEnd}
              onMouseLeave={() => isRulesDragging && onRulesEnd()}
              style={{ cursor: isRulesDragging ? 'grabbing' : 'grab' }}
            >
              <div
                className="rules-carousel-content"
                style={{
                  transform: `translateX(calc(-${rulesCurrentSlide * 100}% + ${rulesDragOffset}px))`,
                  transition: isRulesDragging ? 'none' : 'transform 0.5s cubic-bezier(0.23, 1, 0.32, 1)'
                }}
              >
                {rules.map((rule, index) => (
                  <div key={index} className="rules-carousel-item" style={{ flex: `0 0 ${100 / itemsPerView}%` }}>
                    <div className={`rule-card rule-card--${rule.color}`}>
                      <div className="rule-card-top">
                        <span className="rule-card-icon">{rule.icon}</span>
                        <span className="rule-card-number">STEP {String(index + 1).padStart(2, '0')}</span>
                      </div>
                      <h4 className="rule-card-title">{rule.title}</h4>
                      <p className="rule-card-content">{rule.content}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rules-indicators">
              {Array.from({ length: totalRulesPages }).map((_, i) => (
                <div
                  key={i}
                  className={`rules-indicator ${i === rulesCurrentSlide ? 'active' : ''}`}
                  onClick={() => setRulesCurrentSlide(i)}
                />
              ))}
            </div>
          </div>
        </section>

      </main >



      {/* Create Draft Modal */}
      {
        showCreateModal && (
          <div className="modal-overlay">
            <div className="create-modal">
              <div className="modal-header">
                <h3>➕ Create New Draft</h3>
                <button className="close-modal" onClick={() => setShowCreateModal(false)}>✕</button>
              </div>

              <div className="modal-body">
                <div className="form-group">
                  <label>Draft Title *</label>
                  <input
                    type="text"
                    placeholder="Enter draft title..."
                    value={newTournament.title}
                    onChange={(e) => setNewTournament({ ...newTournament, title: e.target.value })}
                    className="form-input"
                  />
                </div>

                <div className="form-group">
                  <label>Description</label>
                  <textarea
                    placeholder="Enter draft description..."
                    value={newTournament.description}
                    onChange={(e) => setNewTournament({ ...newTournament, description: e.target.value })}
                    className="form-textarea"
                    rows={3}
                  />
                </div>

                <div className="form-group">
                  <label>Prize Pool</label>
                  <input
                    type="text"
                    placeholder="e.g. $1,000 or 10,000 AURY"
                    value={newTournament.prizePool}
                    onChange={(e) => setNewTournament({ ...newTournament, prizePool: e.target.value })}
                    className="form-input"
                  />
                </div>

                {/* NEW: Draft Type Dropdown */}
                <div className="form-group">
                  <label>Draft Type</label>
                  <select
                    value={newTournament.draftType}
                    onChange={(e) => setNewTournament({ ...newTournament, draftType: e.target.value })}
                    className="form-input"
                  >
                    <option value="mode1">Triad Format 3-6-3</option>
                    <option value="mode2">Triad Format 1-2-1</option>
                    <option value="mode3">Deathmatch 3-3</option>
                  </select>
                  <span className="input-hint">
                    {newTournament.draftType === 'mode1'
                      ? 'Triad Format 3-6-3: A picks 3, B picks 6, A picks 6, B picks 3'
                      : newTournament.draftType === 'mode2'
                        ? 'Triad Format 1-2-1: 10 phases with smaller alternating picks'
                        : 'Deathmatch 3-3: Simultaneous picks from random pools (3 picks each)'}
                  </span>
                </div>

                <div className="form-group">
                  <label>Timer Duration (per turn)</label>
                  <div className="timer-inputs">
                    <div className="timer-input-group">
                      <input
                        type="number"
                        min="0"
                        max="30"
                        value={newTournament.timerDays}
                        onChange={(e) => setNewTournament({ ...newTournament, timerDays: parseInt(e.target.value) || 0 })}
                        className="timer-input"
                      />
                      <span>Days</span>
                    </div>
                    <div className="timer-input-group">
                      <input
                        type="number"
                        min="0"
                        max="23"
                        value={newTournament.timerHours}
                        onChange={(e) => setNewTournament({ ...newTournament, timerHours: parseInt(e.target.value) || 0 })}
                        className="timer-input"
                      />
                      <span>Hours</span>
                    </div>
                    <div className="timer-input-group">
                      <input
                        type="number"
                        min="0"
                        max="59"
                        value={newTournament.timerMinutes}
                        onChange={(e) => setNewTournament({ ...newTournament, timerMinutes: parseInt(e.target.value) || 0 })}
                        className="timer-input"
                      />
                      <span>Min</span>
                    </div>
                    <div className="timer-input-group">
                      <input
                        type="number"
                        min="0"
                        max="59"
                        value={newTournament.timerSeconds}
                        onChange={(e) => setNewTournament({ ...newTournament, timerSeconds: parseInt(e.target.value) || 0 })}
                        className="timer-input"
                      />
                      <span>Sec</span>
                    </div>
                  </div>

                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={newTournament.manualTimerStart}
                      onChange={(e) => setNewTournament({ ...newTournament, manualTimerStart: e.target.checked })}
                    />
                    <span>Start timer manually (wait for all players to be ready)</span>
                  </label>
                </div>

                {/* Team Assignment Section */}
                <div className="form-group team-assignment-section">
                  <label>
                    Assign Teams ({getAssignedCount()}/{newTournament.draftType === 'mode3' ? 2 : 6} assigned)
                    {!newTournament.manualTimerStart && <span className="required-text"> *</span>}
                  </label>
                  {!newTournament.manualTimerStart && !areTeamsComplete() && (
                    <p className="field-hint">All {newTournament.draftType === 'mode3' ? 2 : 6} participants required, or enable "Start timer manually"</p>
                  )}

                  <div className="teams-container">
                    {/* Team 1 */}
                    <div className="team-assignment-panel team-1">
                      <div className="team-header-editable">
                        <span className="team-color-badge blue">🔵</span>
                        {newTournament.draftType !== 'mode3' && (
                          <input
                            type="text"
                            className="team-name-input"
                            placeholder="Team 1 Name"
                            value={team1Name}
                            onChange={(e) => setTeam1Name(e.target.value)}
                          />
                        )}
                        {newTournament.draftType === 'mode3' && (
                          <span className="team-name-static">Player 1</span>
                        )}
                      </div>

                      {/* Banner Upload */}
                      {newTournament.draftType !== 'mode3' && (
                        <div className="team-banner-upload">
                          <label className="banner-upload-label">
                            {team1Banner ? (
                              <div className="banner-preview">
                                <img src={team1Banner} alt="Team 1 Banner" />
                                <button
                                  type="button"
                                  className="remove-banner-btn"
                                  onClick={(e) => { e.preventDefault(); setTeam1Banner(null); }}
                                >✕</button>
                              </div>
                            ) : (
                              <div className="banner-placeholder">
                                <span>📷</span>
                                <span>Upload Banner</span>
                              </div>
                            )}
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => handleBannerUpload(1, e)}
                              style={{ display: 'none' }}
                            />
                          </label>
                        </div>
                      )}

                      {newTournament.draftType !== 'mode3' && (
                        <p className="team-hint">Will be shuffled to Team A or B</p>
                      )}

                      {/* Leader Slot */}
                      <div className="assignment-slot">
                        <span className="slot-label">{newTournament.draftType === 'mode3' ? '👤 Player' : '👑 Leader'}</span>
                        {team1.leader ? (
                          <div className="assigned-user">
                            <img
                              src={getUserById(team1.leader)?.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png'}
                              alt=""
                              onError={(e) => { e.target.onerror = null; e.target.src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }}
                            />
                            <span>{getUserById(team1.leader)?.displayName || 'Unknown'}</span>
                            <button className="remove-btn" onClick={() => removeFromSlot(1, 'leader')}>✕</button>
                          </div>
                        ) : (
                          <button
                            className={`assign-btn ${assigningSlot?.team === 1 && assigningSlot?.roles?.includes('leader') ? 'active' : ''}`}
                            onClick={() => setAssigningSlot({ team: 1, roles: ['leader'], sessionRoles: ['leader'] })}
                          >
                            {newTournament.draftType === 'mode3' ? '+ Select Player' : '+ Assign Leader'}
                          </button>
                        )}
                      </div>

                      {newTournament.draftType !== 'mode3' && (
                        <div className="assignment-slot members-slot">
                          <span className="slot-label">👤 Members (2)</span>
                          {team1.member1 && team1.member2 ? (
                            <div className="assigned-members-group">
                              <div className="assigned-user mini">
                                <img
                                  src={getUserById(team1.member1)?.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png'}
                                  alt=""
                                  onError={(e) => { e.target.onerror = null; e.target.src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }}
                                />
                                <span className="mini-name">{getUserById(team1.member1)?.displayName || 'Unknown'}</span>
                              </div>
                              <div className="assigned-user mini">
                                <img
                                  src={getUserById(team1.member2)?.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png'}
                                  alt=""
                                  onError={(e) => { e.target.onerror = null; e.target.src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }}
                                />
                                <span className="mini-name">{getUserById(team1.member2)?.displayName || 'Unknown'}</span>
                                <button className="remove-btn" onClick={() => { removeFromSlot(1, 'member1'); removeFromSlot(1, 'member2'); }}>✕</button>
                              </div>
                            </div>
                          ) : (
                            <button
                              className="assign-bulk-btn"
                              onClick={() => setAssigningSlot({ team: 1, roles: ['member1', 'member2'], sessionRoles: ['member1', 'member2'] })}
                            >
                              + Select 2 Members
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Team 2 */}
                    <div className="team-assignment-panel team-2">
                      <div className="team-header-editable">
                        <span className="team-color-badge red">🔴</span>
                        {newTournament.draftType !== 'mode3' && (
                          <input
                            type="text"
                            className="team-name-input"
                            placeholder="Team 2 Name"
                            value={team2Name}
                            onChange={(e) => setTeam2Name(e.target.value)}
                          />
                        )}
                        {newTournament.draftType === 'mode3' && (
                          <span className="team-name-static">Player 2</span>
                        )}
                      </div>

                      {/* Banner Upload */}
                      {newTournament.draftType !== 'mode3' && (
                        <div className="team-banner-upload">
                          <label className="banner-upload-label">
                            {team2Banner ? (
                              <div className="banner-preview">
                                <img src={team2Banner} alt="Team 2 Banner" />
                                <button
                                  type="button"
                                  className="remove-banner-btn"
                                  onClick={(e) => { e.preventDefault(); setTeam2Banner(null); }}
                                >✕</button>
                              </div>
                            ) : (
                              <div className="banner-placeholder">
                                <span>📷</span>
                                <span>Upload Logo</span>
                              </div>
                            )}
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => handleBannerUpload(2, e)}
                              style={{ display: 'none' }}
                            />
                          </label>
                        </div>
                      )}

                      {newTournament.draftType !== 'mode3' && (
                        <p className="team-hint">Will be shuffled to Team A or B</p>
                      )}

                      {/* Leader Slot */}
                      <div className="assignment-slot">
                        <span className="slot-label">{newTournament.draftType === 'mode3' ? '👤 Player' : '👑 Leader'}</span>
                        {team2.leader ? (
                          <div className="assigned-user">
                            <img
                              src={getUserById(team2.leader)?.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png'}
                              alt=""
                              onError={(e) => { e.target.onerror = null; e.target.src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }}
                            />
                            <span>{getUserById(team2.leader)?.displayName || 'Unknown'}</span>
                            <button className="remove-btn" onClick={() => removeFromSlot(2, 'leader')}>✕</button>
                          </div>
                        ) : (
                          <button
                            className={`assign-btn ${assigningSlot?.team === 2 && assigningSlot?.roles?.includes('leader') ? 'active' : ''}`}
                            onClick={() => setAssigningSlot({ team: 2, roles: ['leader'], sessionRoles: ['leader'] })}
                          >
                            {newTournament.draftType === 'mode3' ? '+ Select Player' : '+ Assign Leader'}
                          </button>
                        )}
                      </div>

                      {newTournament.draftType !== 'mode3' && (
                        <div className="assignment-slot members-slot">
                          <span className="slot-label">👤 Members (2)</span>
                          {team2.member1 && team2.member2 ? (
                            <div className="assigned-members-group">
                              <div className="assigned-user mini">
                                <img
                                  src={getUserById(team2.member1)?.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png'}
                                  alt=""
                                  onError={(e) => { e.target.onerror = null; e.target.src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }}
                                />
                                <span className="mini-name">{getUserById(team2.member1)?.displayName || 'Unknown'}</span>
                              </div>
                              <div className="assigned-user mini">
                                <img
                                  src={getUserById(team2.member2)?.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png'}
                                  alt=""
                                  onError={(e) => { e.target.onerror = null; e.target.src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }}
                                />
                                <span className="mini-name">{getUserById(team2.member2)?.displayName || 'Unknown'}</span>
                                <button className="remove-btn" onClick={() => { removeFromSlot(2, 'member1'); removeFromSlot(2, 'member2'); }}>✕</button>
                              </div>
                            </div>
                          ) : (
                            <button
                              className="assign-bulk-btn"
                              onClick={() => setAssigningSlot({ team: 2, roles: ['member1', 'member2'], sessionRoles: ['member1', 'member2'] })}
                            >
                              + Select 2 Members
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Participant Selection Modal Overlay */}
                  {assigningSlot && (
                    <div className="modal-overlay selection-overlay">
                      <div className="participant-selection-modal">
                        <div className="modal-header">
                          <div className="selection-title-group">
                            <h3>👥 Select {newTournament.draftType === 'mode3' ? `Player ${assigningSlot.team}` : `Team ${assigningSlot.team} ${assigningSlot.sessionRoles.length > 1 ? 'Members' : 'Leader'}`}</h3>
                            <span className="selection-progress-badge">
                              {assigningSlot.roles.length === 2 ? 'Step 1/2' : assigningSlot.roles.length === 1 && assigningSlot.sessionRoles.length === 2 ? 'Step 2/2' : 'Assigning Slot'}
                            </span>
                          </div>
                          <button className="close-modal" onClick={() => setAssigningSlot(null)}>✕</button>
                        </div>

                        <div className="selection-search-container">
                          <input
                            type="text"
                            placeholder="Search by name or email..."
                            value={participantSearchQuery}
                            onChange={(e) => setParticipantSearchQuery(e.target.value)}
                            className="form-input selection-search-input"
                            autoFocus
                          />
                        </div>

                        <div className="selection-modal-content">
                          <div className="participants-list">
                            {/* Show current selections at the top */}
                            {assigningSlot.sessionRoles.filter(r => !assigningSlot.roles.includes(r)).map(role => {
                              const assignedUserId = (assigningSlot.team === 1 ? team1 : team2)[role];
                              const u = getUserById(assignedUserId);
                              if (!u) return null;
                              return (
                                <div key={role} className="participant-item selection-active sticky-selection">
                                  <img
                                    src={u.auroryProfilePicture || u.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png'}
                                    alt=""
                                    className="participant-avatar"
                                    onError={(e) => { e.target.onerror = null; e.target.src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }}
                                  />
                                  <div className="participant-info">
                                    <span className="participant-name">{u.displayName}</span>
                                    <span className="participant-email">
                                      {newTournament.draftType === 'mode3' ? 'Participant' : `Selected as ${role === 'leader' ? 'Leader' : role === 'member1' ? 'Member 1' : 'Member 2'}`}
                                    </span>
                                  </div>
                                  <button className="deselect-circle-btn" onClick={() => handleDeselectDuringFlow(role)}>✕</button>
                                </div>
                              );
                            })}

                            <div className="selection-divider">
                              <span>Available Participants</span>
                            </div>

                            {filteredUsers.length === 0 ? (
                              <div className="no-users-container">
                                <p className="no-users">No available users found matching "{participantSearchQuery}"</p>
                                <button className="clear-search-btn" onClick={() => setParticipantSearchQuery('')}>Clear Search</button>
                              </div>
                            ) : (
                              filteredUsers.map(u => (
                                <div
                                  key={u.id}
                                  className="participant-item hoverable"
                                  onClick={() => assignParticipant(u.id)}
                                >
                                  <img
                                    src={u.auroryProfilePicture || u.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png'}
                                    alt={u.displayName}
                                    className="participant-avatar"
                                    onError={(e) => { e.target.onerror = null; e.target.src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }}
                                  />
                                  <div className="participant-info">
                                    <span className="participant-name">{u.displayName || 'Unknown'}</span>
                                    <span className="participant-email">{u.email}</span>
                                  </div>
                                  <div className="plus-indicator">+</div>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="modal-footer">
                <button className="cancel-btn" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </button>
                <button className="create-btn" onClick={handleCreateTournament}>
                  🚀 Proceed
                </button>
              </div>
            </div>
          </div>
        )
      }

      {/* Wallet Modal */}
      {
        showWalletModal && user && (
          <div className="modal-overlay">
            <div className="wallet-modal">
              <div className="modal-header">
                <h3><img src="/aury-icon.png" alt="" className="modal-aury-icon" /> AURY Wallet</h3>
                <button className="close-modal" onClick={() => setShowWalletModal(false)}>✕</button>
              </div>

              {/* Wallet Balance Display */}
              <div className="wallet-balance-display">
                <span className="balance-label">Available Balance</span>
                <span className="balance-amount">{formatAuryAmount(walletBalance)} AURY</span>
              </div>

              {/* Wallet Tabs */}
              <div className="wallet-tabs">
                <button
                  className={`wallet-tab ${walletTab === 'deposit' ? 'active' : ''}`}
                  onClick={() => setWalletTab('deposit')}
                >
                  📥 Deposit
                </button>
                <button
                  className={`wallet-tab ${walletTab === 'withdraw' ? 'active' : ''}`}
                  onClick={() => setWalletTab('withdraw')}
                >
                  📤 Withdraw
                </button>
                <button
                  className={`wallet-tab ${walletTab === 'history' ? 'active' : ''}`}
                  onClick={() => setWalletTab('history')}
                >
                  📋 History
                </button>
              </div>

              <div className="wallet-content">
                {/* Deposit Tab */}
                {walletTab === 'deposit' && (
                  <div className="deposit-section">
                    <p className="deposit-instructions">
                      Send AURY tokens to the address below with your unique memo.
                      Your balance will be updated after admin confirmation.
                    </p>

                    <div className="deposit-field">
                      <label>Deposit Address</label>
                      <div className="copy-field">
                        <input
                          type="text"
                          value={DEPOSIT_WALLET_ADDRESS}
                          readOnly
                        />
                        <button
                          className={`copy-btn ${copySuccess === 'address' ? 'copied' : ''}`}
                          onClick={() => copyToClipboard(DEPOSIT_WALLET_ADDRESS, 'address')}
                        >
                          {copySuccess === 'address' ? '✓ Copied!' : '📋 Copy'}
                        </button>
                      </div>
                    </div>

                    <div className="deposit-field">
                      <label>Your Unique Memo (Required)</label>
                      <div className="copy-field">
                        <input
                          type="text"
                          value={generateDepositMemo(user.uid)}
                          readOnly
                        />
                        <button
                          className={`copy-btn ${copySuccess === 'memo' ? 'copied' : ''}`}
                          onClick={() => copyToClipboard(generateDepositMemo(user.uid), 'memo')}
                        >
                          {copySuccess === 'memo' ? '✓ Copied!' : '📋 Copy'}
                        </button>
                      </div>
                    </div>

                    <div className="deposit-warning">
                      ⚠️ <strong>Important:</strong> Always include your unique memo when sending.
                      Deposits without the correct memo cannot be credited to your account.
                    </div>

                    {/* NEW: Deposit Notification Section */}
                    <div className="deposit-notification-section">
                      <div className="deposit-notification-header">
                        <h4>💬 Already Sent Your Deposit?</h4>
                        <p>Notify the admin to speed up the crediting process</p>
                      </div>

                      <div className="form-group">
                        <label>Transaction Signature (Optional but Helpful)</label>
                        <input
                          type="text"
                          placeholder="Paste your Solana transaction signature..."
                          value={depositTxSignature}
                          onChange={(e) => setDepositTxSignature(e.target.value)}
                          className="form-input"
                        />
                        <span className="input-hint">
                          Find this in your wallet after sending (e.g., 5j6k7l8m9n...)
                        </span>
                      </div>

                      <div className="form-group">
                        <label>Amount Sent (AURY)</label>
                        <input
                          type="number"
                          placeholder="Enter amount you sent..."
                          value={depositAmount}
                          onChange={(e) => setDepositAmount(e.target.value)}
                          min="0"
                          step="0.01"
                          className="form-input"
                        />
                      </div>

                      <div className="form-group">
                        <label>Additional Note (Optional)</label>
                        <textarea
                          placeholder="Any additional information..."
                          value={depositNote}
                          onChange={(e) => setDepositNote(e.target.value)}
                          className="form-textarea"
                          rows="3"
                        />
                      </div>

                      <button
                        className="notify-admin-btn"
                        onClick={submitDepositNotification}
                        disabled={walletLoading || !depositAmount}
                      >
                        {walletLoading ? 'Sending...' : '📨 Notify Admin About Deposit'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Withdraw Tab */}
                {walletTab === 'withdraw' && (
                  <div className="withdraw-section">
                    <div className="form-group">
                      <label>Amount (AURY)</label>
                      <div className="amount-input-wrapper">
                        <input
                          type="number"
                          placeholder="0.00"
                          value={withdrawAmount}
                          onChange={(e) => setWithdrawAmount(e.target.value)}
                          min="0"
                          step="0.01"
                        />
                        <button
                          className="max-btn"
                          onClick={() => setWithdrawAmount((walletBalance / 1e9).toString())}
                        >
                          MAX
                        </button>
                      </div>
                      <span className="available-balance">
                        Available: {formatAuryAmount(walletBalance)} AURY
                      </span>
                    </div>

                    <div className="form-group">
                      <label>Destination Wallet Address (Solana)</label>
                      <input
                        type="text"
                        placeholder="Enter your Solana wallet address"
                        value={withdrawAddress}
                        onChange={(e) => setWithdrawAddress(e.target.value)}
                        className="form-input"
                      />
                    </div>

                    <button
                      className="withdraw-submit-btn"
                      onClick={submitWithdrawal}
                      disabled={walletLoading || !withdrawAmount || !withdrawAddress}
                    >
                      {walletLoading ? 'Processing...' : '📤 Submit Withdrawal'}
                    </button>

                    <p className="withdraw-note">
                      Withdrawals are processed within 24 hours. Minimum withdrawal: 1 AURY.
                    </p>
                  </div>
                )}

                {/* History Tab */}
                {walletTab === 'history' && (
                  <div className="history-section">
                    {transactions.length === 0 ? (
                      <div className="no-transactions">
                        <p>No transactions yet</p>
                      </div>
                    ) : (
                      <div className="transaction-list">
                        {transactions.map(tx => {
                          // Determine transaction display based on type
                          let icon, label, amountClass;

                          switch (tx.type) {
                            case 'deposit':
                              icon = '📥';
                              label = 'Deposit';
                              amountClass = 'positive';
                              break;
                            case 'withdrawal':
                              icon = '✅';
                              label = 'Withdrawal Completed';
                              amountClass = 'negative';
                              break;
                            case 'withdrawal_pending':
                              icon = '⏳';
                              label = 'Withdrawal Pending';
                              amountClass = 'negative';
                              break;
                            case 'withdrawal_rejected_refund':
                              icon = '🔄';
                              label = 'Withdrawal Rejected (Refunded)';
                              amountClass = 'positive';
                              break;
                            default:
                              icon = '💫';
                              label = tx.type;
                              amountClass = '';
                          }

                          return (
                            <div key={tx.id} className={`transaction-item ${tx.type}`}>
                              <div className="tx-icon">{icon}</div>
                              <div className="tx-details">
                                <span className="tx-type">{label}</span>
                                <span className="tx-time">{formatTransactionTime(tx.timestamp)}</span>
                                {tx.reason && <span className="tx-reason">{tx.reason}</span>}
                              </div>
                              <div className={`tx-amount ${amountClass}`}>
                                {(tx.type === 'deposit' || tx.type === 'withdrawal_rejected_refund') ? '+' : '-'}
                                {formatAuryAmount(tx.amount)} AURY
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      }

      {/* Aurory Account Link Modal */}
      <AuroryAccountLink
        user={user}
        isOpen={showAuroryModal}
        onClose={() => setShowAuroryModal(false)}
      />

      {/* User Profile Modal */}
      {
        showUserModal && user && (
          <div className="modal-overlay" onClick={() => setShowUserModal(false)}>
            <div className="user-profile-modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3>👤 User Profile</h3>
                <button className="close-modal" onClick={() => setShowUserModal(false)}>✕</button>
              </div>

              <div className="user-modal-content">
                <div className="user-header-info">
                  <img
                    src={user.auroryProfilePicture || user.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png'}
                    alt="Profile"
                    className="modal-profile-pic"
                    onError={(e) => { e.target.onerror = null; e.target.src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }}
                  />
                  <div className="user-text-info">
                    <span className="modal-username">
                      {user.displayName}
                      {user.isAurorian && <span className="aurorian-badge" title="Aurorian NFT Holder">🛡️</span>}
                    </span>
                    <span className="modal-email">{user.email}</span>
                    {isSuperAdminUser ? (
                      <span className="modal-admin-badge">⭐ Super Admin</span>
                    ) : isAdminUser ? (
                      <span className="modal-admin-badge admin-staff">⭐ Admin</span>
                    ) : null}

                    {user.isAurorian && <span className="aurorian-tag">Aurorian Holder</span>}
                  </div>
                </div>

                <div className="user-modal-actions">
                  <button
                    className="modal-action-btn aurory"
                    onClick={() => {
                      setShowUserModal(false);
                      setShowAuroryModal(true);
                    }}
                  >
                    <span className="btn-icon">🎮</span>
                    <div className="btn-text">
                      <span className="btn-title">Aurory Account</span>
                      <span className="btn-desc">Link your game account</span>
                    </div>
                  </button>

                  {isAdmin && (
                    <button
                      className="modal-action-btn admin"
                      onClick={() => {
                        setShowUserModal(false);
                        navigate('/admin/wallet');
                      }}
                    >
                      <span className="btn-icon">💼</span>
                      <div className="btn-text">
                        <span className="btn-title">Admin Panel</span>
                        <span className="btn-desc">Manage wallets & deposits</span>
                      </div>
                    </button>
                  )}

                  <div className="modal-divider"></div>

                  <button
                    className="modal-action-btn logout"
                    onClick={() => {
                      setShowUserModal(false);
                      setShowLogoutConfirm(true);
                    }}
                  >
                    <span className="btn-icon">🚪</span>
                    <div className="btn-text">
                      <span className="btn-title">Logout</span>
                      <span className="btn-desc">Sign out of your account</span>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      }

      {/* Logout Confirmation Modal */}
      {
        showLogoutConfirm && (
          <div className="modal-overlay" onClick={() => setShowLogoutConfirm(false)}>
            <div className="confirmation-modal logout-confirm" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3>🚪 Confirm Logout</h3>
                <button className="close-modal" onClick={() => setShowLogoutConfirm(false)}>✕</button>
              </div>
              <div className="modal-body">
                <div className="confirm-icon">🚪</div>
                <p>Are you sure you want to log out of Aurory Draft?</p>
                <div className="confirm-actions">
                  <button
                    className="btn-secondary"
                    onClick={() => setShowLogoutConfirm(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn-danger"
                    onClick={() => {
                      setShowLogoutConfirm(false);
                      handleLogout();
                    }}
                  >
                    Yes, Log Out
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      }
      {/* Footer */}
      <footer className="homepage-footer">
        <div className="footer-content">
          <div className="footer-left">
            <p className="footer-msg">Built with ❤️ for the Aurory Tournament Community. Happy Playing! 🎮🔴</p>
            <p className="footer-tagline">Anito Guild Community 2026</p>
          </div>
          <div className="footer-right">
            <div className="footer-links-wrapper">
              <p className="footer-links-label">Join our Discord!</p>
              <div className="footer-links-container">
                <a
                  href="https://discord.gg/GQ4mbtRj"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="footer-discord-link aurory"
                  title="Join Aurory Community Discord"
                >
                  <img src="/aurory-logo.png" alt="Aurory Community" className="footer-link-logo" />
                  <span>Aurory</span>
                </a>
                <a
                  href="https://discord.gg/Q4rBwzpv"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="footer-discord-link anito"
                  title="Join Anito Guild Discord"
                >
                  <img src="/anito-logo.png" alt="Anito Guild" className="footer-link-logo" />
                  <span>Anito Guild</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div >
  );
}

export default HomePage;