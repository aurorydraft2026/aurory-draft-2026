import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { auth, db, discordProvider, googleProvider } from '../firebase';
import { signInWithPopup, getAdditionalUserInfo, signOut, onAuthStateChanged } from 'firebase/auth';
import {
  collection, onSnapshot, doc, setDoc, serverTimestamp, getDocs,
  addDoc, query, orderBy, limit, runTransaction, writeBatch, where
} from 'firebase/firestore';
import { isSuperAdmin } from '../config/admins';
import { createNotification } from '../services/notifications';
import { updateDoc } from 'firebase/firestore';
import AuroryAccountLink from '../components/AuroryAccountLink';
import {
  syncAuroryName
} from '../services/auroryProfileService';
import { fetchVerifiedMatches, scanAndVerifyCompletedDrafts } from '../services/matchVerificationService';
import { auroryFetch } from '../services/auroryProxyClient';
import { AMIKOS } from '../data/amikos';
import { logActivity } from '../services/activityService';
import LoadingScreen from '../components/LoadingScreen';
import DraftRulesModal from '../components/DraftRulesModal';
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



function HomePage() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const syncInProgressRef = React.useRef(false); // Guard for infinite sync loops
  const [tournaments, setTournaments] = useState([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isCreatingDraft, setIsCreatingDraft] = useState(false);
  const [registeredUsers, setRegisteredUsers] = useState([]);
  const [participantSearchQuery, setParticipantSearchQuery] = useState('');
  const hasRedirectedRef = useRef(false);
  const [seenTabs, setSeenTabs] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('aurory_seen_tabs') || '{}');
    } catch (e) {
      return {};
    }
  });

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
      icon: "⏲️",
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
      icon: "⚠️",
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

  // Banner swipe state (original)
  const [touchStart, setTouchStart] = useState(null);
  const [touchEnd, setTouchEnd] = useState(null);

  // Minimum swipe distance (in px)
  const minSwipeDistance = 50;

  // Announcement Ticker State
  const [tickerAnnouncements, setTickerAnnouncements] = useState([]);
  const [showTicker, setShowTicker] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);

  // Draft Rules Modal State for HomePage Join
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [selectedTournamentForRules, setSelectedTournamentForRules] = useState(null);

  const [tokenStats, setTokenStats] = useState(null);

  const onTouchStart = (e) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;

    if (isLeftSwipe) {
      setCurrentSlide((prev) => (prev + 1) % announcementSlides.length);
    } else if (isRightSwipe) {
      setCurrentSlide((prev) => (prev - 1 + announcementSlides.length) % announcementSlides.length);
    }
    setTouchStart(null);
    setTouchEnd(null);
  };

  // Rules position-based drag state (KEEP THIS)
  const rulesRef = useRef(null);
  const [rulesDrag, setRulesDrag] = useState({
    isDragging: false,
    startX: 0,
    currentX: 0,
    offset: 0
  });

  // Rules drag handlers (KEEP THIS)
  const handleRulesStart = (e) => {
    const clientX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
    setRulesDrag({
      isDragging: true,
      startX: clientX,
      currentX: clientX,
      offset: -rulesCurrentSlide * 100
    });
  };

  const handleRulesMove = (e) => {
    if (!rulesDrag.isDragging) return;
    const clientX = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
    setRulesDrag(prev => ({ ...prev, currentX: clientX }));
  };

  const handleRulesEnd = () => {
    if (!rulesDrag.isDragging) return;

    const diff = rulesDrag.currentX - rulesDrag.startX;
    const threshold = 50;

    if (diff > threshold && rulesCurrentSlide > 0) {
      prevRules();
    } else if (diff < -threshold && rulesCurrentSlide < totalRulesPages - 1) {
      nextRules();
    }

    setRulesDrag({
      isDragging: false,
      startX: 0,
      currentX: 0,
      offset: 0
    });
  };

  // Calculate rules transform (KEEP THIS)
  const getRulesTransform = () => {
    if (!rulesDrag.isDragging) {
      return `translateX(-${rulesCurrentSlide * 100}%)`;
    }
    const diff = rulesDrag.currentX - rulesDrag.startX;
    const containerWidth = rulesRef.current?.offsetWidth || 1;
    const percentDiff = (diff / containerWidth) * 100;
    const newOffset = rulesDrag.offset + percentDiff;
    return `translateX(${newOffset}%)`;
  };

  // Auto-rotate banner slides
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % announcementSlides.length);
    }, 8000);
    return () => clearInterval(timer);
  }, [announcementSlides.length]);

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
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showLoginSuccessModal, setShowLoginSuccessModal] = useState(false);

  // Match History state
  const [matchHistory, setMatchHistory] = useState([]);
  const [matchHistoryLoading, setMatchHistoryLoading] = useState(true);
  const [matchHistoryFilter, setMatchHistoryFilter] = useState('all'); // 'all', 'mode1', 'mode2', 'mode3'
  const [expandedMatch, setExpandedMatch] = useState(null); // draftId of expanded match
  const [showUserModal, setShowUserModal] = useState(false);
  const profileMenuRef = useRef(null);
  const notificationMenuRef = useRef(null);
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
    timerHours: 0,
    timerMinutes: 1,
    timerSeconds: 0,
    manualTimerStart: false,
    poolAmount: '',  // AURY pool amount (human-readable, e.g. "100")
    isFriendly: false, // No-cost match
    requiresEntryFee: true // If true, players pay half. If false, creator pays full.
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
        setLoading(false);

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
        setLoading(false);
        if (unsubscribeUserDoc) unsubscribeUserDoc();
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeUserDoc) unsubscribeUserDoc();
    };
  }, []);

  // Handle click outside for profile dropdown
  useEffect(() => {
    function handleClickOutside(event) {
      // Only handle click-outside for desktop dropdown
      if (window.innerWidth <= 768) return;

      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target)) {
        setShowUserModal(false);
      }

      if (notificationMenuRef.current && !notificationMenuRef.current.contains(event.target)) {
        setShowNotificationPanel(false);
      }
    }
    if (showUserModal || showNotificationPanel) {
      document.addEventListener('click', handleClickOutside);
    }
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [showUserModal, showNotificationPanel]);

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

  // Handle automatic tab redirection
  useEffect(() => {
    if (tournaments.length > 0 && !hasRedirectedRef.current && tournamentFilter === 'active') {
      const activeCount = tournaments.filter(t => t.status === 'active' || t.status === 'coinFlip' || t.status === 'poolShuffle' || t.status === 'assignment').length;
      const waitingCount = tournaments.filter(t => t.status === 'waiting').length;
      const completedCount = tournaments.filter(t => t.status === 'completed').length;

      if (activeCount === 0) {
        if (waitingCount > 0) {
          setTournamentFilter('waiting');
        } else if (completedCount > 0) {
          setTournamentFilter('completed');
        }
      }
      hasRedirectedRef.current = true;
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
          createdAt: serverTimestamp()
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

  // Fetch Ticker Announcements from Firestore
  useEffect(() => {
    const q = query(
      collection(db, 'settings'),
      where('type', '==', 'ticker_announcement'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setTickerAnnouncements(docs);
    });

    return () => unsubscribe();
  }, []);

  // Fetch Token Stats from Aurory API via Proxy
  useEffect(() => {
    const fetchTokenStats = async () => {
      try {
        const data = await auroryFetch('/v1/token-stats');
        setTokenStats(data);
      } catch (err) {
        console.error('Error fetching token stats:', err);
      }
    };

    fetchTokenStats();
    const interval = setInterval(fetchTokenStats, 10 * 60 * 1000); // Update every 10 mins
    return () => clearInterval(interval);
  }, []);

  // Handle Scroll to auto-hide ticker
  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;

      // If scrolling down and past 100px, hide ticker
      if (currentScrollY > lastScrollY && currentScrollY > 100) {
        setShowTicker(false);
      }
      // If scrolling up, show ticker
      else if (currentScrollY < lastScrollY) {
        setShowTicker(true);
      }

      setLastScrollY(currentScrollY);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [lastScrollY]);



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

    const timerDuration = tournament.timerDuration || 30 * 1000;
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
      logActivity({
        user: enhancedUser,
        type: 'AUTH',
        action: 'login_discord'
      });
      setShowLoginSuccessModal(true);
    } catch (error) {
      console.error('Login error:', error);
      alert('Login failed: ' + error.message);
    }
  };

  // Handle Google Login
  const handleGoogleLogin = async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);

      const userEmail = result.user.email;
      const displayName = result.user.displayName || userEmail?.split('@')[0] || 'User';

      const enhancedUser = {
        ...result.user,
        email: userEmail || '',
        displayName: displayName
      };

      // Save user to Firestore
      try {
        await setDoc(doc(db, 'users', result.user.uid), {
          uid: result.user.uid,
          email: userEmail || '',
          displayName: displayName,
          photoURL: result.user.photoURL || null,
          lastLogin: new Date(),
          createdAt: new Date()
        }, { merge: true });

        console.log('✅ User saved to Firestore on Google login:', result.user.uid);
      } catch (firestoreError) {
        console.error('❌ Failed to save user to Firestore:', firestoreError);
      }

      setUser(enhancedUser);
      logActivity({
        user: enhancedUser,
        type: 'AUTH',
        action: 'login_google'
      });
      setShowLoginSuccessModal(true);
    } catch (error) {
      console.error('Google login error:', error);
      alert('Google login failed: ' + error.message);
    }
  };

  // Handle Logout
  const handleLogout = async () => {
    try {
      logActivity({
        user,
        type: 'AUTH',
        action: 'logout'
      });
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

    logActivity({
      user,
      type: 'WALLET',
      action: 'withdraw_request',
      metadata: {
        amount: amount,
        address: withdrawAddress
      }
    });

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

    logActivity({
      user,
      type: 'WALLET',
      action: 'deposit_notify',
      metadata: {
        amount: amount,
        signature: depositTxSignature,
        note: depositNote
      }
    });

    setWalletLoading(true);
    try {
      // Create deposit notification request
      const notificationRef = collection(db, 'depositNotifications');
      await addDoc(notificationRef, {
        userId: user.uid,
        userEmail: user.email,
        userName: user.displayName,
        createdAt: serverTimestamp(),
        amount: amount,
        txSignature: depositTxSignature || '',
        note: depositNote || '',
        status: 'pending' // pending, processed
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
      // Non-admins can only create 1v1 modes - default to mode3
      const isAdmin = user && (isSuperAdmin(getUserEmail(user)) || user.role === 'admin');
      if (!isAdmin && newTournament.draftType !== 'mode3' && newTournament.draftType !== 'mode4') {
        setNewTournament(prev => ({ ...prev, draftType: 'mode3' }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        // --- TEAM MODE: Group by leader + members set ---
        // Skip 1v1 matches in team leaderboard
        if (match.draftType === 'mode3' || match.draftType === 'mode4') return;

        const teams = ['A', 'B'];
        teams.forEach(tCode => {
          const teamPlayers = match.matchPlayers?.filter(p => p.team === tCode) || [];
          if (teamPlayers.length === 0) return;

          // Identity: First player is leader, rest are members
          const leader = teamPlayers[0];
          const members = teamPlayers.slice(1).map(p => p.uid).sort();
          const teamKey = `${leader.uid}|${members.join(',')}`;

          const teamName = match.teamNames?.[tCode === 'A' ? 'team1' : 'team2'] || 'Team';
          const bannerUrl = match.teamBanners?.[tCode === 'A' ? 'team1' : 'team2'] || null;
          const matchTime = match.verifiedAt?.seconds || (new Date(match.verifiedAt).getTime() / 1000) || 0;

          if (!winCounts[teamKey]) {
            winCounts[teamKey] = {
              teamKey,
              teamName,
              bannerUrl,
              wins: 0,
              losses: 0,
              lastUpdated: matchTime,
              members: teamPlayers.map(p => {
                const userData = registeredUsers.find(u => u.id === p.uid);
                return {
                  uid: p.uid,
                  displayName: p.auroryPlayerName || p.displayName || userData?.displayName || 'Player',
                  photoURL: userData?.auroryProfilePicture || userData?.photoURL || null
                };
              })
            };
          } else {
            // Update to latest team name and banner if match is newer
            if (matchTime > winCounts[teamKey].lastUpdated) {
              winCounts[teamKey].teamName = teamName;
              winCounts[teamKey].bannerUrl = bannerUrl;
              winCounts[teamKey].lastUpdated = matchTime;
            }
          }

          if (tCode === match.overallWinner) {
            winCounts[teamKey].wins += 1;
          } else {
            winCounts[teamKey].losses += 1;
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
                displayName: userData?.auroryPlayerName || result.playerA.displayName || userData?.displayName || 'Player',
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
                displayName: userData?.auroryPlayerName || result.playerB.displayName || userData?.displayName || 'Player',
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
    if (newTournament.draftType === 'mode3' || newTournament.draftType === 'mode4') {
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
        // Show A/B participants, OR spectators if the tournament is still waiting (pre-assigned)
        if (perm === 'A' || perm === 'B' || (perm === 'spectator' && tournament.status === 'waiting')) {
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

          // Assign to team based on permission OR preAssignedMTeams if they are spectator
          if (perm === 'A') {
            teamA.push(participant);
          } else if (perm === 'B') {
            teamB.push(participant);
          } else if (perm === 'spectator' && tournament.status === 'waiting') {
            // New logic: check preAssignedTeams to see which side they belong to
            if (tournament.preAssignedTeams?.team1?.leader === uid ||
              tournament.preAssignedTeams?.team1?.member1 === uid ||
              tournament.preAssignedTeams?.team1?.member2 === uid) {
              teamA.push(participant);
            } else if (tournament.preAssignedTeams?.team2?.leader === uid ||
              tournament.preAssignedTeams?.team2?.member1 === uid ||
              tournament.preAssignedTeams?.team2?.member2 === uid) {
              teamB.push(participant);
            }
          }
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

    // 1v1: Enforce minimum 30-second timer
    if (is1v1 && timerMs < 30 * 1000) {
      alert('1v1 drafts require a minimum timer of 30 seconds so both players have time to prepare.');
      return;
    }

    // 3v3: If not using manual timer start, participants are required
    if (!is1v1 && !newTournament.manualTimerStart && !areTeamsComplete()) {
      alert('Please assign all 6 participants, or check "Start timer manually" to add participants later.');
      return;
    }

    // 1v1 Pool validation
    const isFriendly = is1v1 ? newTournament.isFriendly : true;
    const requiresEntryFee = is1v1 && !isFriendly ? (newTournament.requiresEntryFee !== false) : true;
    const poolAmountAury = is1v1 && !isFriendly ? parseFloat(newTournament.poolAmount) || 0 : 0;
    const poolAmountSmallest = Math.floor(poolAmountAury * 1e9); // Convert to smallest unit

    // If requires fee: Entry is half the pool.
    // If sponsored (no fee): Entry is 0 for joiners.
    const entryFee = requiresEntryFee ? Math.floor(poolAmountSmallest / 2) : 0;

    if (is1v1 && !isFriendly && poolAmountAury <= 0) {
      alert('Please enter a pool amount greater than 0, or check "Friendly Match".');
      return;
    }

    // Check if creator is self-assigned as a player
    const creatorIsPlayer1 = team1.leader === user.uid;
    const creatorIsPlayer2 = team2.leader === user.uid;
    const creatorIsPlayer = creatorIsPlayer1 || creatorIsPlayer2;

    // Calculate how much the creator needs to pay NOW
    // If sponsored: Creator pays FULL pool.
    // If split: Creator pays their share (only if they are playing).
    let creatorDeduction = 0;
    if (is1v1 && !isFriendly) {
      if (!requiresEntryFee) {
        // Sponsored: Creator pays everything
        creatorDeduction = poolAmountSmallest;
      } else if (creatorIsPlayer) {
        // Split: Creator pays their share
        creatorDeduction = entryFee;
      }
    }

    // Wallet balance check for ALL non-friendly 1v1 drafts
    if (creatorDeduction > 0) {
      if (walletBalance < creatorDeduction) {
        alert(`Insufficient balance to create this match. You need at least ${(creatorDeduction / 1e9).toFixed(2)} AURY.`);
        return;
      }
    }

    try {
      setIsCreatingDraft(true);
      // Generate unique tournament ID
      const tournamentId = `tournament_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const draftRef = doc(db, 'drafts', tournamentId);

      // Deduct from creator's wallet
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
          // Record transaction
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

      // Build permissions object
      const permissions = {};
      // Creator is admin only if they're NOT a player, otherwise they'll be assigned as A/B later
      if (!is1v1 || (!creatorIsPlayer)) {
        permissions[user.uid] = 'admin';
      } else {
        permissions[user.uid] = 'spectator'; // Will be upgraded when draft starts
      }
      getAssignedParticipants().forEach(uid => {
        if (!permissions[uid]) permissions[uid] = 'spectator';
      });

      // Save team structure
      const preAssignedTeams = {
        team1: {
          leader: team1.leader || null,
          member1: team1.member1 || null,
          member2: team1.member2 || null
        },
        team2: {
          leader: team2.leader || null,
          member1: team2.member1 || null,
          member2: team2.member2 || null
        }
      };

      // Get team names
      const team1LeaderUser = getUserById(team1.leader);
      const team2LeaderUser = getUserById(team2.leader);
      const teamNames = {
        team1: team1Name.trim() || team1LeaderUser?.auroryPlayerName || team1LeaderUser?.displayName || team1LeaderUser?.username || 'Player 1',
        team2: team2Name.trim() || team2LeaderUser?.auroryPlayerName || team2LeaderUser?.displayName || team2LeaderUser?.username || 'Player 2',
      };

      // Store team banners
      const teamBanners = {
        team1: team1Banner || null,
        team2: team2Banner || null,
      };

      // Determine if 1v1 is joinable (has open player slots)
      const bothPlayersAssigned = is1v1 && team1.leader && team2.leader;
      const hasOpenSlots = is1v1 && (!team1.leader || !team2.leader);

      const tournamentData = {
        title: newTournament.title.trim(),
        description: newTournament.description.trim(),
        prizePool: is1v1 ? (isFriendly ? 'Friendly' : `${poolAmountAury} AURY`) : newTournament.prizePool.trim(),
        draftType: newTournament.draftType,
        timerDuration: timerMs,
        manualTimerStart: is1v1 ? false : newTournament.manualTimerStart, // 1v1 always auto-starts timer
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
        teamNames: teamNames,
        teamBanners: teamBanners,
        lockedPhases: [],
        awaitingLockConfirmation: false,
        activeViewers: {},
        createdAt: serverTimestamp(),
        createdBy: user.uid,
        creatorDisplayName: user.auroryPlayerName || user.displayName || user.email || 'Unknown',
        // 1v1 pool fields
        poolAmount: poolAmountSmallest,
        entryFee: entryFee,
        isFriendly: isFriendly,
        joinable: hasOpenSlots, // Open for others to join
        entryPaid: creatorDeduction > 0 ? { [user.uid]: creatorDeduction } : {}
      };

      // Generate private code for 1v1 mode
      if (is1v1) {
        tournamentData.privateCode = Math.floor(10000 + Math.random() * 90000).toString();
      }

      // If both players assigned, set up coinFlip phase for immediate confirmation
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

      // Reset form and close modal
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
        isFriendly: false
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

      // Notify all assigned participants
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

      // Navigate to the new tournament
      navigate(`/tournament/${tournamentId}`, {
        state: { autoStart: !is1v1 && !newTournament.manualTimerStart }
      });
    } catch (error) {
      setIsCreatingDraft(false);
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
    const tournament = tournaments.find(t => t.id === tournamentId);
    if (!tournament) {
      navigate(`/tournament/${tournamentId}`);
      return;
    }

    const myPermissions = user ? tournament.permissions?.[user.uid] : null;
    const isParticipating = myPermissions === 'A' || myPermissions === 'B';
    const isJoinable = (tournament.draftType === 'mode3' || tournament.draftType === 'mode4') &&
      tournament.joinable &&
      tournament.status === 'waiting';

    // If joinable and user isn't already a participant, show rules first
    if (isJoinable && user && !isParticipating) {
      setSelectedTournamentForRules(tournament);
      setShowRulesModal(true);
    } else {
      navigate(`/tournament/${tournamentId}`);
    }
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
      case 'poolShuffle': return '� Shuffling';
      case 'assignment': return '📋 Assigning';
      case 'completed': return '✅ Completed';
      default: return '⏳ Waiting';
    }
  };

  const isSuperAdminUser = user && isSuperAdmin(getUserEmail(user));
  const isAdminUser = user && (isSuperAdminUser || user.role === 'admin');
  const isAdmin = isAdminUser; // Preserve for backwards compatibility within this file

  // Helper to render profile menu content (shared between mobile modal and desktop dropdown)
  const renderUserProfileContent = () => {
    if (!user) return null;
    return (
      <div
        className="user-profile-modal"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>👤 User Profile</h3>
          <button className="close-modal" onClick={() => setShowUserModal(false)}>✖</button>
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
                <span className="modal-admin-badge">⭐Super Admin</span>
              ) : isAdminUser ? (
                <span className="modal-admin-badge admin-staff">⭐Admin</span>
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
                  navigate('/admin/panel');
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
    );
  };

  // Helper to render notification panel content (shared between mobile modal and desktop dropdown)
  const renderNotificationPanelContent = () => {
    return (
      <div className="notification-panel" onClick={(e) => e.stopPropagation()}>
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
                🗑️ Clear All
              </button>
            )}
          </div>
          <button className="close-panel-btn" onClick={() => setShowNotificationPanel(false)}>✖</button>
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
    );
  };

  const renderLoginModalContent = () => {
    return (
      <div className="login-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>🔍 Welcome to Aurory Draft</h3>
          <button className="close-modal" onClick={() => setShowLoginModal(false)}>✖</button>
        </div>
        <div className="modal-body">
          <div className="login-welcome-text">
            <p>Connect your account to start participating in drafts and managing your wallet.</p>
          </div>
          <div className="login-options">
            <button
              className="modal-action-btn discord"
              onClick={() => {
                setShowLoginModal(false);
                handleDiscordLogin();
              }}
            >
              <span className="btn-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z" />
                </svg>
              </span>
              <div className="btn-text">
                <span className="btn-title">Continue with Discord</span>
                <span className="btn-desc">Fastest way to join tournaments</span>
              </div>
            </button>
            <button
              className="modal-action-btn google"
              onClick={() => {
                setShowLoginModal(false);
                handleGoogleLogin();
              }}
            >
              <span className="btn-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 12-4.53z" fill="#EA4335" />
                </svg>
              </span>
              <div className="btn-text">
                <span className="btn-title">Continue with Google</span>
                <span className="btn-desc">Secure access via your Google account</span>
              </div>
            </button>
          </div>
          <div className="login-footer">
            <p>
              By logging in, you agree to our{' '}
              <Link to="/terms" onClick={() => setShowLoginModal(false)}>Terms of Service</Link>
              {' '}and{' '}
              <Link to="/privacy" onClick={() => setShowLoginModal(false)}>Privacy Policy</Link>.
            </p>
          </div>
        </div>
      </div>
    );
  };

  const renderLoginSuccessModal = () => {
    return (
      <div className="login-success-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-body">
          <div className="success-icon-wrapper">
            <div className="success-icon">🎉</div>
          </div>
          <h3>Login Successful!</h3>
          <p>Welcome back! You're now connected and ready to explore Aurory Draft.</p>
          <button
            className="btn-primary awesome-btn"
            onClick={() => setShowLoginSuccessModal(false)}
          >
            Awesome!
          </button>
        </div>
      </div>
    );
  };


  if (loading) {
    return <LoadingScreen fullScreen />;
  }

  return (
    <div className="homepage">
      {/* Header with Discord Login */}
      <header className="header">
        <div className="logo" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>
          <img
            src="/Aurorydraft logos/Aurory Draft Logo_color-white text_Horizontal.svg"
            alt="Aurory Draft"
            className="logo-desktop"
          />
          <img
            src="/Aurorydraft logos/AD_logo_mobile_colored.svg"
            alt="Aurory Draft"
            className="logo-mobile"
          />
        </div>
        <div className="auth-section">
          {user ? (
            <div className="user-info">

              {/* Wallet Balance */}
              <button
                className="wallet-btn"
                onClick={() => setShowWalletModal(true)}
              >
                <img src="/aury-icon.png" alt="AURY" className="wallet-icon-img" />
                <span className="wallet-amount">{formatAuryAmount(walletBalance)} AURY</span>
              </button>

              {/* Notifications Bell */}
              <div className="notification-menu-container" ref={notificationMenuRef}>
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
                  <div className="desktop-notification-dropdown">
                    {renderNotificationPanelContent()}
                  </div>
                )}
              </div>

              {/* Clickable Profile Section */}
              <div className="profile-menu-container" ref={profileMenuRef}>
                <div
                  className="profile-trigger"
                  onClick={() => setShowUserModal(!showUserModal)}
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
                    <div className="profile-badges-row">
                      {isSuperAdminUser ? (
                        <span className="admin-badge">⭐Super Admin</span>
                      ) : isAdminUser ? (
                        <span className="admin-badge admin-staff">⭐Admin</span>
                      ) : null}
                      {user.isAurorian && <span className="aurorian-tag">Aurorian Holder</span>}
                    </div>
                  </div>
                  <span className={`menu-arrow ${showUserModal ? 'active' : ''}`}>▾</span>
                </div>

                {showUserModal && (
                  <div className="desktop-profile-dropdown">
                    {renderUserProfileContent()}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="login-container">
              <button
                className="btn-primary login-trigger-btn"
                onClick={() => setShowLoginModal(true)}
              >
                <span>🔑</span> Login
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Announcement Ticker Stash */}
      <div className={`announcement-bar ${(!showTicker || tickerAnnouncements.length === 0) ? 'hidden' : ''}`}>
        <div className="announcement-content">
          <div className="announcement-track">
            {tickerAnnouncements.length > 0 && (
              <>
                {/* Repeat enough times to cover screen and allow seamless loop */}
                {[...Array(tickerAnnouncements.length <= 2 ? 4 : 2)].map((_, i) => (
                  <React.Fragment key={`loop-${i}`}>
                    {tickerAnnouncements.map((ticker) => (
                      <span key={`${ticker.id}-${i}`} className="announcement-item">
                        <span className="announcement-icon">{ticker.icon}</span>
                        <span dangerouslySetInnerHTML={{ __html: (ticker.text || '').replace(/\*\*(.*?)\*\*/g, '<span class="highlight-text">$1</span>') }} />
                      </span>
                    ))}
                  </React.Fragment>
                ))}
              </>
            )}
          </div>
          {tokenStats && (
            <div className="token-stats-fixed">
              <span className="announcement-icon">📊</span>
              <div className="stats-scroll-container">
                <span className="stat-group">
                  <span className="stat-label">$AURY:</span>
                  <span className="highlight-text">${tokenStats.aury?.current_price?.toFixed(3)}</span>
                </span>
                <span className="stat-divider">|</span>
                <span className="stat-group">
                  <span className="stat-label">SOL:</span>
                  <span className="highlight-text">${tokenStats.sol?.current_price?.toFixed(2)}</span>
                </span>
                <span className="stat-divider">|</span>
                <span className="stat-group">
                  <span className="stat-label">USDC:</span>
                  <span className="highlight-text">$1.00</span>
                </span>
                <span className="stat-divider">|</span>
                <span className="stat-group">
                  <span className="stat-label">Aurorian Floor:</span>
                  <span className="highlight-text">{(tokenStats.aurorian?.floor_price / 1000000000).toFixed(2)} SOL</span>
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

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
                  className="announcement-banner"
                  onTouchStart={onTouchStart}
                  onTouchMove={onTouchMove}
                  onTouchEnd={onTouchEnd}
                >
                  {announcementSlides.map((slide, index) => {
                    // Support both video (static) and videoUrl (dynamic) fields
                    const videoSrc = slide.video || slide.videoUrl;
                    return (
                      <div
                        key={slide.id}
                        className={`banner-slide ${index === currentSlide ? 'active' : ''} ${slide.link ? 'clickable' : ''} ${videoSrc ? 'has-video' : ''}`}
                        onClick={(e) => {
                          // If it's the static banner, we don't want a slide-wide link
                          if (slide.isStatic) return;
                          if (slide.link) window.open(slide.link, '_blank');
                        }}
                      >
                        {!videoSrc && (
                          <img src={slide.image} alt="" className="banner-image-base" />
                        )}
                        {videoSrc && (
                          <video className="banner-video-base" autoPlay muted loop playsInline>
                            <source src={videoSrc} type="video/mp4" />
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

                          {/* Social Links for dynamic banners (max 3) */}
                          {!slide.isStatic && (() => {
                            // Helper to ensure URL has protocol
                            const normalizeUrl = (url) => {
                              if (!url) return url;
                              if (url.startsWith('http://') || url.startsWith('https://')) {
                                return url;
                              }
                              return 'https://' + url;
                            };
                            const socialIcons = {
                              discord: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" /></svg>,
                              twitter: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>,
                              twitch: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" /></svg>,
                              facebook: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" /></svg>,
                              instagram: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.899 1.382-.419.419-.824.679-1.38.896-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.569-.224-.96-.479-1.379-.899-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06l.045.03zm0 3.678c-3.405 0-6.162 2.76-6.162 6.162 0 3.405 2.76 6.162 6.162 6.162 3.405 0 6.162-2.76 6.162-6.162 0-3.405-2.76-6.162-6.162-6.162zM12 16c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm7.846-10.405c0 .795-.646 1.44-1.44 1.44-.795 0-1.44-.646-1.44-1.44 0-.794.646-1.439 1.44-1.439.793-.001 1.44.645 1.44 1.439z" /></svg>,
                              youtube: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" /></svg>
                            };
                            const socialLinks = [
                              { type: 'discord', url: slide.discord, label: 'Discord' },
                              { type: 'twitter', url: slide.twitter, label: 'X' },
                              { type: 'twitch', url: slide.twitch, label: 'Twitch' },
                              { type: 'facebook', url: slide.facebook, label: 'Facebook' },
                              { type: 'instagram', url: slide.instagram, label: 'Instagram' },
                              { type: 'youtube', url: slide.youtube, label: 'YouTube' }
                            ].filter(s => s.url).slice(0, 3);

                            return socialLinks.length > 0 ? (
                              <div className="banner-social-buttons" onClick={(e) => e.stopPropagation()}>
                                {socialLinks.map((s, i) => (
                                  <a
                                    key={i}
                                    href={normalizeUrl(s.url)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={`banner-social-btn ${s.type}`}
                                    title={s.label}
                                  >
                                    <span className="social-btn-icon">{socialIcons[s.type]}</span>
                                    <span className="social-btn-label">{s.label}</span>
                                  </a>
                                ))}
                              </div>
                            ) : null;
                          })()}

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
                    );
                  })}

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
                <div className="header-title-group">
                  <h3>♟️All Drafts </h3>
                  {user && (
                    <button onClick={() => setShowCreateModal(true)} className="inline-create-btn">
                      <span className="plus-icon">+</span> Create Draft
                    </button>
                  )}
                </div>
              </div>

              {/* Filter Tabs */}
              <div className="tournament-filters">
                <div className="filter-tabs-row">
                  {[
                    { key: 'active', label: 'Active', icon: '🟢' },
                    { key: 'waiting', label: 'Waiting', icon: '⌛' },
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
                        onClick={() => {
                          setTournamentFilter(tab.key);
                          setDraftsExpanded(false);
                          if (!seenTabs[tab.key]) {
                            const newSeen = { ...seenTabs, [tab.key]: true };
                            setSeenTabs(newSeen);
                            localStorage.setItem('aurory_seen_tabs', JSON.stringify(newSeen));
                          }
                        }}
                      >
                        <span className="filter-tab-icon">{tab.icon}</span>
                        <span className="filter-tab-label">{tab.label}</span>
                        {count > 0 && (
                          <span className={`filter-tab-count ${(tab.key === 'active' || tab.key === 'waiting') && !seenTabs[tab.key] ? 'count-highlight' : ''}`}>
                            {count}
                          </span>
                        )}
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
                    <option value="mode1">3v3 Triad Swiss Format 3-6-3</option>
                    <option value="mode2">3v3 Triad Swiss Format 1-2-1</option>
                    <option value="mode3">1v1 Deathmatch 3-3</option>
                    <option value="mode4">1v1 Ban Draft 1-2-1</option>
                  </select>
                </div>
              </div>

              {filteredTournaments.length === 0 ? (
                <div className="no-tournaments-container">
                  <div className="tournaments-grid">
                    {user && (
                      <div className="create-placeholder-card" onClick={() => setShowCreateModal(true)}>
                        <div className="placeholder-content">
                          <div className="plus-circle">
                            <span className="plus-icon">+</span>
                          </div>
                          <h4>Create New Draft</h4>
                          <p>Start a new Triad or DM match</p>
                        </div>
                      </div>
                    )}
                  </div>
                  {!user && (
                    <div className="no-tournaments">
                      <p>No drafts match this filter</p>
                      <p className="hint">Log in to create or join a draft</p>
                    </div>
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
                      let turnName = `Team ${timer?.team || 'A'}`;
                      if (timer?.team) {
                        const teamId = timer.team === 'A' ? 'team1' : 'team2';
                        const leaderUid = tournament.preAssignedTeams?.[teamId]?.leader;
                        const leaderUser = leaderUid ? getUserById(leaderUid) : null;

                        // Priority 1: Current In-game name from user data
                        // Priority 2: Stored leader name from shuffled session
                        // Priority 3: Stored leader name from creation
                        // Priority 4: Fallback
                        const teamKey = timer.team === 'A' ? 'teamA' : 'teamB';
                        turnName = leaderUser?.auroryPlayerName ||
                          tournament.leaderNames?.[teamKey] ||
                          tournament.leaderNames?.[teamId] ||
                          leaderUser?.displayName ||
                          `Team ${timer.team}`;
                      }

                      // Leader VS Leader display - prioritize in-game names
                      const team1LeaderId = tournament.preAssignedTeams?.team1?.leader;
                      const team2LeaderId = tournament.preAssignedTeams?.team2?.leader;
                      const team1User = team1LeaderId ? getUserById(team1LeaderId) : null;
                      const team2User = team2LeaderId ? getUserById(team2LeaderId) : null;

                      const team1Name = team1User?.auroryPlayerName || tournament.teamNames?.team1 || tournament.leaderNames?.team1 || 'Team A';
                      const team2Name = team2User?.auroryPlayerName || tournament.teamNames?.team2 || tournament.leaderNames?.team2 || 'Team B';



                      return (
                        <div
                          key={tournament.id}
                          className={`tournament-card ${isMyTurn ? 'active-turn' : ''} ${isParticipating && !isMyTurn ? 'participating' : ''} ${(tournament.draftType === 'mode3' || tournament.draftType === 'mode4') && tournament.joinable && tournament.status === 'waiting' ? 'joinable-card' : ''
                            }`}
                          onClick={() => goToTournament(tournament.id)}
                        >
                          {/* Live Timer Ribbon for Active Drafts */}
                          {tournament.status === 'active' && timer && (
                            <div className={`timer-ribbon ${isMyTurn ? 'my-turn-ribbon' : ''} ${isParticipating && !isMyTurn ? 'not-my-turn' : ''} ${timer.isUrgent ? 'urgent' : ''} ${timer.expired ? 'expired' : ''} ${timer.waiting ? 'waiting' : ''}`}>
                              <div className="ribbon-content">
                                {timer.waiting ? (
                                  <span className="ribbon-text">⏳Waiting to Start</span>
                                ) : timer.expired ? (
                                  <span className="ribbon-text">⚠️Time Expired!</span>
                                ) : (
                                  <>
                                    <span className="ribbon-team">
                                      {isMyTurn ? '⚡YOUR TURN!' : `${turnName}'s Turn`}
                                    </span>
                                    <span className="ribbon-timer">⏲{formatTimer(timer)}</span>
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
                                  {tournament.draftType === 'mode4' ? 'Ban 1-2-1' : tournament.draftType === 'mode3' ? 'DM 3-3' : tournament.draftType === 'mode2' ? 'Triad 1-2-1' : 'Triad 3-6-3'}
                                </span>
                                {(tournament.draftType === 'mode3' || tournament.draftType === 'mode4') && (
                                  <span className={`pool-badge ${tournament.isFriendly ? 'friendly' : 'pool'}`}>
                                    {tournament.isFriendly ? '🤝 Friendly' : `💰 ${(tournament.poolAmount / 1e9).toFixed(0)} AURY`}
                                  </span>
                                )}
                                <span className={`status-badge ${getStatusColor(tournament.status)}`}>
                                  {getStatusText(tournament.status)}
                                </span>
                              </div>
                            </div>

                            <p className="tournament-description">
                              {tournament.description || ''}
                            </p>

                            <div className="hosted-by">
                              👑 Hosted by: {tournament.creatorDisplayName || tournament.teamNames?.team1 || 'Unknown'}
                            </div>

                            <div className="tournament-details">
                              {tournament.prizePool && (
                                <div className="detail-item prize">
                                  <span className="detail-icon">🏆</span>
                                  <span>{tournament.prizePool}</span>
                                </div>
                              )}

                              {/* Team VS Team Participant Display */}
                              {(() => {
                                // Resolve leader photos from preAssignedTeams (stays in sync with teamNames)
                                const team1LeaderUid = tournament.preAssignedTeams?.team1?.leader;
                                const team2LeaderUid = tournament.preAssignedTeams?.team2?.leader;
                                const team1Leader = team1LeaderUid ? getUserById(team1LeaderUid) : null;
                                const team2Leader = team2LeaderUid ? getUserById(team2LeaderUid) : null;
                                const team1Photo = team1Leader?.auroryProfilePicture || team1Leader?.photoURL || null;
                                const team2Photo = team2Leader?.auroryProfilePicture || team2Leader?.photoURL || null;

                                return (
                                  <div className="card-vs-matchup">
                                    <div
                                      className="card-team-side team-a-side"
                                      style={{
                                        backgroundImage: tournament.teamBanners?.team1
                                          ? `url(${tournament.teamBanners.team1})`
                                          : team1Photo
                                            ? `url(${team1Photo})`
                                            : 'none'
                                      }}
                                    >
                                      <div className="card-team-overlay"></div>
                                      <span className="card-team-label">{team1Name}</span>
                                    </div>

                                    <div className={`card-vs-badge ${tournament.status === 'active' ? 'vs-active' : ''}`}>
                                      <img
                                        src={tournament.status === 'active' ? '/SwordFight.gif' : '/SwordFight.svg'}
                                        alt="VS"
                                        className="vs-sword-gif"
                                      />
                                    </div>

                                    <div
                                      className="card-team-side team-b-side"
                                      style={{
                                        backgroundImage: tournament.teamBanners?.team2
                                          ? `url(${tournament.teamBanners.team2})`
                                          : team2Photo
                                            ? `url(${team2Photo})`
                                            : 'none'
                                      }}
                                    >
                                      <div className="card-team-overlay"></div>
                                      <span className="card-team-label">{team2Name}</span>
                                    </div>
                                  </div>
                                );
                              })()}

                            </div>

                            <div className="tournament-footer">
                              {(() => {
                                const is1v1Card = tournament.draftType === 'mode3' || tournament.draftType === 'mode4';
                                const isJoinable = is1v1Card && tournament.joinable && tournament.status === 'waiting';
                                const canJoin = isJoinable && user && !isParticipating;

                                if (canJoin) {
                                  return (
                                    <span className="view-btn join-now-btn">
                                      ⚔️ Join Now →
                                    </span>
                                  );
                                }
                                if (isJoinable && !user) {
                                  return <span className="view-btn join-now-btn">⚔️ Join Now →</span>;
                                }
                                if (is1v1Card && tournament.status === 'coinFlip') {
                                  return <span className="view-btn starting-btn">🎲 Confirming... →</span>;
                                }
                                if (is1v1Card && tournament.status === 'waiting' && !isJoinable) {
                                  return <span className="view-btn waiting-btn">⏳ Awaiting Players →</span>;
                                }
                                if (is1v1Card && tournament.status === 'assignment') {
                                  return <span className="view-btn starting-btn">🎲 Starting... →</span>;
                                }
                                if (isParticipating) {
                                  return <span className="view-btn">Enter Draft →</span>;
                                }
                                return <span className="view-btn">Spectate →</span>;
                              })()}
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
                  <option value="mode1">3v3 Triad Swiss Format 3-6-3</option>
                  <option value="mode2">3v3 Triad Swiss Format 1-2-1</option>
                  <option value="mode3">1v1 Deathmatch 3-3</option>
                  <option value="mode4">1v1 Ban Draft 1-2-1</option>
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
                      const modeLabels = { mode1: 'Triad 3-6-3', mode2: 'Triad 1-2-1', mode3: 'DM 3-3', mode4: 'Ban 1-2-1' };

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
                                    <span>{(match.draftType === 'mode3' || match.draftType === 'mode4') ? 'Match' : `Battle ${idx + 1}`}</span>
                                    <span className={`status-badge status-${result.status}`}>
                                      {result.status === 'verified' && '✅'}
                                      {(result.status === 'disqualified_A' || result.status === 'disqualified_B') && '⛔ DQ'}
                                      {result.status === 'both_disqualified' && '⛔ Both DQ'}
                                      {result.status === 'not_found' && '⏱️'}
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
                  topPlayers.map((item, idx) => {
                    const isTeam = leaderboardMode === 'team';
                    return (
                      <div key={isTeam ? item.teamKey : item.uid} className={`top-player-row ${idx < 3 ? `rank-${idx + 1}` : ''} ${isTeam ? 'team-row' : ''}`}>
                        {isTeam && item.bannerUrl && (
                          <div
                            className="top-player-banner-bg"
                            style={{ backgroundImage: `url(${item.bannerUrl})` }}
                          />
                        )}
                        <span className="top-player-rank">
                          {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`}
                        </span>

                        {isTeam ? (
                          <div className="team-avatar-stack">
                            {item.members.map((m, mIdx) => (
                              <img
                                key={m.uid}
                                src={m.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png'}
                                alt=""
                                className={`top-player-avatar ${mIdx === 0 ? 'leader-avatar' : 'member-avatar'}`}
                                style={{
                                  zIndex: 10 - mIdx
                                }}
                                onError={(e) => { e.target.onerror = null; e.target.src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }}
                              />
                            ))}
                          </div>
                        ) : (
                          <img
                            src={item.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png'}
                            alt=""
                            className="top-player-avatar"
                            onError={(e) => { e.target.onerror = null; e.target.src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }}
                          />
                        )}

                        <div className="top-player-info">
                          <span className="top-player-name">{isTeam ? item.teamName : item.displayName}</span>
                          <span className="top-player-record">
                            <span className="record-wins">{item.wins}W</span>
                            <span className="record-sep">·</span>
                            <span className="record-losses">{item.losses}L</span>
                          </span>
                        </div>
                        <div className="top-player-winrate">
                          {Math.round((item.wins / (item.wins + item.losses || 1)) * 100)}%
                        </div>
                      </div>
                    );
                  })
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
              className="rules-carousel-viewport"
              ref={rulesRef}
              onMouseDown={handleRulesStart}
              onMouseMove={handleRulesMove}
              onMouseUp={handleRulesEnd}
              onMouseLeave={handleRulesEnd}
              onTouchStart={handleRulesStart}
              onTouchMove={handleRulesMove}
              onTouchEnd={handleRulesEnd}
              style={{ cursor: rulesDrag.isDragging ? 'grabbing' : 'grab' }}
            >
              <div
                className="rules-carousel-content"
                style={{
                  transform: getRulesTransform(),
                  transition: rulesDrag.isDragging ? 'none' : 'transform 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
                  willChange: 'transform'
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
                <button className="close-modal" onClick={() => setShowCreateModal(false)}>✖</button>
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

                {/* NEW: Draft Type Dropdown */}
                <div className="form-group">
                  <label>Draft Type</label>
                  <select
                    value={newTournament.draftType}
                    onChange={(e) => setNewTournament({ ...newTournament, draftType: e.target.value })}
                    className="form-input"
                  >
                    {isAdmin && <option value="mode1">3v3 Triad Swiss Format 3-6-3</option>}
                    {isAdmin && <option value="mode2">3v3 Triad Swiss Format 1-2-1</option>}
                    <option value="mode3">1v1 Deathmatch 3-3</option>
                    <option value="mode4">1v1 Ban Draft 1-2-1</option>
                  </select>
                  <span className="input-hint">
                    {newTournament.draftType === 'mode1'
                      ? '3v3 Triad Swiss Format 3-6-3: A picks 3, B picks 6, A picks 6, B picks 3'
                      : newTournament.draftType === 'mode2'
                        ? '3v3 Triad Swiss Format 1-2-1: 10 phases with smaller alternating picks'
                        : newTournament.draftType === 'mode4'
                          ? '1v1 Ban Draft 1-2-1: Turn-based bans (1-2-2-1), then picks (1-2-2-1) with coin flip'
                          : '1v1 Deathmatch 3-3: Simultaneous picks from random pools (3 picks each)'}
                  </span>
                </div>

                {/* Prize Pool - Text based for 3v3 modes */}
                {(newTournament.draftType !== 'mode3' && newTournament.draftType !== 'mode4') && (
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
                )}

                {/* AURY Pool - Numeric for 1v1 modes */}
                {(newTournament.draftType === 'mode3' || newTournament.draftType === 'mode4') && (
                  <div className="form-group">
                    <label className="checkbox-label friendly-toggle">
                      <input
                        type="checkbox"
                        checked={newTournament.isFriendly}
                        onChange={(e) => setNewTournament({ ...newTournament, isFriendly: e.target.checked, poolAmount: '' })}
                      />
                      <span>🤝 Friendly Match (no cost)</span>
                    </label>
                    {!newTournament.isFriendly && (
                      <>
                        <label className="checkbox-label" style={{ marginBottom: '10px' }}>
                          <input
                            type="checkbox"
                            checked={newTournament.requiresEntryFee !== false}
                            onChange={(e) => setNewTournament({ ...newTournament, requiresEntryFee: e.target.checked })}
                          />
                          <span>Requires Entry Fee (Split Pool)</span>
                        </label>
                        {newTournament.requiresEntryFee === false && <span className="input-hint" style={{ display: 'block', marginBottom: '10px', color: '#ffd700' }}>🌟 Sponsored: You pay the full pool amount. Players join for free.</span>}

                        <label>Pool Amount (AURY)</label>
                        <div className="pool-input-row">
                          <img src="/aury-icon.png" alt="AURY" className="pool-aury-icon" />
                          <input
                            type="number"
                            placeholder="e.g. 100"
                            min="0"
                            step="any"
                            value={newTournament.poolAmount}
                            onChange={(e) => setNewTournament({ ...newTournament, poolAmount: e.target.value })}
                            onWheel={(e) => e.target.blur()}
                            className="form-input pool-amount-input"
                          />
                          <span className="pool-label">AURY</span>
                        </div>
                        <span className="input-hint">
                          {newTournament.poolAmount && parseFloat(newTournament.poolAmount) > 0
                            ? (newTournament.requiresEntryFee !== false
                              ? `Entry fee: ${(parseFloat(newTournament.poolAmount) / 2).toFixed(2)} AURY per player • Winner takes ${(parseFloat(newTournament.poolAmount) * 0.975).toFixed(2)} AURY (2.5% tax)`
                              : `Sponsored: You pay ${(parseFloat(newTournament.poolAmount)).toFixed(2)} AURY. Entry is FREE for players. Winner takes ${(parseFloat(newTournament.poolAmount) * 0.975).toFixed(2)} AURY`)
                            : (newTournament.requiresEntryFee !== false
                              ? 'Total pool will be split equally. Each player pays half as entry fee.'
                              : 'You pay the full pool amount. Players join for free.')}
                        </span>
                        {newTournament.poolAmount && parseFloat(newTournament.poolAmount) > 0 && (
                          <span className="input-hint wallet-hint">
                            Your balance: {formatAuryAmount(walletBalance)} AURY
                            {(() => {
                              const cost = newTournament.requiresEntryFee !== false
                                ? ((team1.leader === user?.uid || team2.leader === user?.uid) ? parseFloat(newTournament.poolAmount) / 2 : 0)
                                : parseFloat(newTournament.poolAmount);
                              return cost * 1e9 > walletBalance ? ' ⚠️ Insufficient balance' : '';
                            })()}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                )}

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
                </div>

                {/* Team Assignment Section */}
                <div className="form-group team-assignment-section">
                  <label>
                    {(newTournament.draftType === 'mode3' || newTournament.draftType === 'mode4')
                      ? `Assign Players (${getAssignedCount()}/2 — optional)`
                      : `Assign Teams (${getAssignedCount()}/6 assigned)`}
                    {(newTournament.draftType !== 'mode3' && newTournament.draftType !== 'mode4') && !newTournament.manualTimerStart && <span className="required-text"> *</span>}
                  </label>
                  {(newTournament.draftType === 'mode3' || newTournament.draftType === 'mode4') && (
                    <p className="field-hint">Leave slots open for anyone to join (first come, first serve), or assign specific players.</p>
                  )}
                  {(newTournament.draftType !== 'mode3' && newTournament.draftType !== 'mode4') && !newTournament.manualTimerStart && !areTeamsComplete() && (
                    <p className="field-hint">All 6 participants required, or enable "Start timer manually"</p>
                  )}

                  <div className="teams-container">
                    {/* Team 1 */}
                    <div className="team-assignment-panel team-1">
                      <div className="team-header-editable">
                        <span className="team-color-badge blue">🔵</span>
                        {(newTournament.draftType !== 'mode3' && newTournament.draftType !== 'mode4') && (
                          <input
                            type="text"
                            className="team-name-input"
                            placeholder="Team 1 Name"
                            value={team1Name}
                            onChange={(e) => setTeam1Name(e.target.value)}
                          />
                        )}
                        {(newTournament.draftType === 'mode3' || newTournament.draftType === 'mode4') && (
                          <span className="team-name-static">Player 1</span>
                        )}
                      </div>

                      {/* Banner Upload */}
                      {(newTournament.draftType !== 'mode3' && newTournament.draftType !== 'mode4') && (
                        <div className="team-banner-upload">
                          <label className="banner-upload-label">
                            {team1Banner ? (
                              <div className="banner-preview">
                                <img src={team1Banner} alt="Team 1 Banner" />
                                <button
                                  type="button"
                                  className="remove-banner-btn"
                                  onClick={(e) => { e.preventDefault(); setTeam1Banner(null); }}
                                >✖</button>
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
                              onChange={(e) => handleBannerUpload(1, e)}
                              style={{ display: 'none' }}
                            />
                          </label>
                        </div>
                      )}

                      {(newTournament.draftType !== 'mode3' && newTournament.draftType !== 'mode4') && (
                        <p className="team-hint">Will be shuffled to Team A or B</p>
                      )}

                      {/* Leader Slot */}
                      <div className="assignment-slot">
                        <span className="slot-label">{(newTournament.draftType === 'mode3' || newTournament.draftType === 'mode4') ? '👤 Player' : '👑 Leader'}</span>
                        {team1.leader ? (
                          <div className="assigned-user">
                            <img
                              src={getUserById(team1.leader)?.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png'}
                              alt=""
                              onError={(e) => { e.target.onerror = null; e.target.src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }}
                            />
                            <span>{getUserById(team1.leader)?.displayName || 'Unknown'}</span>
                            <button className="remove-btn" onClick={() => removeFromSlot(1, 'leader')}>✖</button>
                          </div>
                        ) : (
                          <button
                            className={`assign-btn ${assigningSlot?.team === 1 && assigningSlot?.roles?.includes('leader') ? 'active' : ''}`}
                            onClick={() => setAssigningSlot({ team: 1, roles: ['leader'], sessionRoles: ['leader'] })}
                          >
                            {(newTournament.draftType === 'mode3' || newTournament.draftType === 'mode4') ? '+ Select Player' : '+ Assign Leader'}
                          </button>
                        )}
                      </div>

                      {(newTournament.draftType !== 'mode3' && newTournament.draftType !== 'mode4') && (
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
                                <button className="remove-btn" onClick={() => { removeFromSlot(1, 'member1'); removeFromSlot(1, 'member2'); }}>✖</button>
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
                        {(newTournament.draftType !== 'mode3' && newTournament.draftType !== 'mode4') && (
                          <input
                            type="text"
                            className="team-name-input"
                            placeholder="Team 2 Name"
                            value={team2Name}
                            onChange={(e) => setTeam2Name(e.target.value)}
                          />
                        )}
                        {(newTournament.draftType === 'mode3' || newTournament.draftType === 'mode4') && (
                          <span className="team-name-static">Player 2</span>
                        )}
                      </div>

                      {/* Banner Upload */}
                      {(newTournament.draftType !== 'mode3' && newTournament.draftType !== 'mode4') && (
                        <div className="team-banner-upload">
                          <label className="banner-upload-label">
                            {team2Banner ? (
                              <div className="banner-preview">
                                <img src={team2Banner} alt="Team 2 Banner" />
                                <button
                                  type="button"
                                  className="remove-banner-btn"
                                  onClick={(e) => { e.preventDefault(); setTeam2Banner(null); }}
                                >✖</button>
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

                      {(newTournament.draftType !== 'mode3' && newTournament.draftType !== 'mode4') && (
                        <p className="team-hint">Will be shuffled to Team A or B</p>
                      )}

                      {/* Leader Slot */}
                      <div className="assignment-slot">
                        <span className="slot-label">{(newTournament.draftType === 'mode3' || newTournament.draftType === 'mode4') ? '👤 Player' : '👑 Leader'}</span>
                        {team2.leader ? (
                          <div className="assigned-user">
                            <img
                              src={getUserById(team2.leader)?.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png'}
                              alt=""
                              onError={(e) => { e.target.onerror = null; e.target.src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }}
                            />
                            <span>{getUserById(team2.leader)?.displayName || 'Unknown'}</span>
                            <button className="remove-btn" onClick={() => removeFromSlot(2, 'leader')}>✖</button>
                          </div>
                        ) : (
                          <button
                            className={`assign-btn ${assigningSlot?.team === 2 && assigningSlot?.roles?.includes('leader') ? 'active' : ''}`}
                            onClick={() => setAssigningSlot({ team: 2, roles: ['leader'], sessionRoles: ['leader'] })}
                          >
                            {(newTournament.draftType === 'mode3' || newTournament.draftType === 'mode4') ? '+ Select Player' : '+ Assign Leader'}
                          </button>
                        )}
                      </div>

                      {(newTournament.draftType !== 'mode3' && newTournament.draftType !== 'mode4') && (
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
                                <button className="remove-btn" onClick={() => { removeFromSlot(2, 'member1'); removeFromSlot(2, 'member2'); }}>✖</button>
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
                            <h3>👥 Select {(newTournament.draftType === 'mode3' || newTournament.draftType === 'mode4') ? `Player ${assigningSlot.team}` : `Team ${assigningSlot.team} ${assigningSlot.sessionRoles.length > 1 ? 'Members' : 'Leader'}`}</h3>
                            <span className="selection-progress-badge">
                              {assigningSlot.roles.length === 2 ? 'Step 1/2' : assigningSlot.roles.length === 1 && assigningSlot.sessionRoles.length === 2 ? 'Step 2/2' : 'Assigning Slot'}
                            </span>
                          </div>
                          <button className="close-modal" onClick={() => setAssigningSlot(null)}>✖</button>
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
                                      {(newTournament.draftType === 'mode3' || newTournament.draftType === 'mode4') ? 'Participant' : `Selected as ${role === 'leader' ? 'Leader' : role === 'member1' ? 'Member 1' : 'Member 2'}`}
                                    </span>
                                  </div>
                                  <button className="deselect-circle-btn" onClick={() => handleDeselectDuringFlow(role)}>✖</button>
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
                                  className={`participant-item hoverable ${!u.auroryPlayerId ? 'unlinked-warning' : ''}`}
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
                                    {!u.auroryPlayerId && (
                                      <span className="unlinked-label">⚠️ No Aurory account linked</span>
                                    )}
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

                <div className="form-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={newTournament.manualTimerStart}
                      onChange={(e) => setNewTournament({ ...newTournament, manualTimerStart: e.target.checked })}
                      disabled={newTournament.draftType === 'mode3' || newTournament.draftType === 'mode4'}
                    />
                    <span style={{ fontWeight: '600', color: '#ffd700' }}>🚀 Start timer manually</span>
                  </label>
                  <span className="input-hint" style={{ marginTop: '5px', display: 'block' }}>
                    {newTournament.draftType === 'mode3' || newTournament.draftType === 'mode4'
                      ? '1v1 drafts always start when both players confirm ready. Minimum timer: 30 seconds.'
                      : 'Wait for all players to be ready before starting the countdown.'}
                  </span>
                </div>
              </div>

              <div className="modal-footer">
                <button className="cancel-btn" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </button>
                <button
                  className="create-btn"
                  onClick={handleCreateTournament}
                  disabled={isCreatingDraft}
                >
                  {isCreatingDraft ? '⏳ Creating...' : '🚀 Proceed'}
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
                <button className="close-modal" onClick={() => setShowWalletModal(false)}>✖</button>
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
                      Send AURY tokens to the address below.
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


                    {/* NEW: Deposit Notification Section */}
                    <div className="deposit-notification-section">
                      <div className="deposit-notification-header">
                        <h4>✉️ Already Sent Your Deposit?</h4>
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
                        {walletLoading ? 'Sending...' : '📧 Notify Admin About Deposit'}
                      </button>

                      {/* Logic inside submitDepositNotification is handled elsewhere, let's look for the function actual definition if this is JSX */}
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

                          const txTypeKey = (tx.type || '').toLowerCase();

                          switch (txTypeKey) {
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
                              icon = '⏱️';
                              label = 'Withdrawal Pending';
                              amountClass = 'negative';
                              break;
                            case 'withdrawal_rejected_refund':
                              icon = '↩️';
                              label = 'Withdrawal Rejected (Refunded)';
                              amountClass = 'positive';
                              break;
                            case 'entry_fee':
                              icon = '🎟️';
                              label = 'Entry Fee';
                              amountClass = 'negative';
                              break;
                            case 'sponsored_pool':
                              icon = '💎';
                              label = 'Sponsored Pool';
                              amountClass = 'negative';
                              break;
                            case 'prize_won':
                              icon = '🏆';
                              label = 'Prize Won';
                              amountClass = 'positive';
                              break;
                            case 'tax_collected':
                              icon = '🏛️';
                              label = 'Tax Collected';
                              amountClass = 'negative';
                              break;
                            case 'refund_draw':
                              icon = '↩️';
                              label = 'Match Refund (Draw)';
                              amountClass = 'positive';
                              break;
                            case 'refund_pool':
                              icon = '↩️';
                              label = 'Tournament Refund';
                              amountClass = 'positive';
                              break;
                            case 'entry_fee_refund':
                              icon = '↩️';
                              label = 'Entry Fee Refund';
                              amountClass = 'positive';
                              break;
                            default:
                              icon = '❓';
                              label = tx.type?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'Unknown';
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
                                {amountClass === 'positive' ? '+' : '-'}
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

      {/* Mobile User Profile Modal (Root level to avoid header clipping) */}
      {
        showUserModal && window.innerWidth <= 768 && (
          <div className="modal-overlay mobile-profile-modal-overlay" onClick={() => setShowUserModal(false)}>
            {renderUserProfileContent()}
          </div>
        )
      }

      {/* Aurory Account Link Modal */}
      <AuroryAccountLink
        user={user}
        isOpen={showAuroryModal}
        onClose={() => setShowAuroryModal(false)}
      />

      {/* Draft Rules Modal for Joining */}
      <DraftRulesModal
        isOpen={showRulesModal}
        onClose={() => {
          setShowRulesModal(false);
          setSelectedTournamentForRules(null);
        }}
        draftType={selectedTournamentForRules?.draftType}
        showAcceptButton={true}
        onAccept={() => {
          if (selectedTournamentForRules) {
            navigate(`/tournament/${selectedTournamentForRules.id}`);
            setShowRulesModal(false);
            setSelectedTournamentForRules(null);
          }
        }}
      />

      {/* Login Modal */}
      {
        showLoginModal && (
          <div className="modal-overlay" onClick={() => setShowLoginModal(false)}>
            {renderLoginModalContent()}
          </div>
        )
      }

      {/* Login Success Modal */}
      {showLoginSuccessModal && (
        <div className="modal-overlay success-overlay" onClick={() => setShowLoginSuccessModal(false)}>
          {renderLoginSuccessModal()}
        </div>
      )}

      {/* Mobile Notification Modal (Root level to avoid header clipping) */}
      {
        showNotificationPanel && window.innerWidth <= 768 && (
          <div className="modal-overlay mobile-notification-modal-overlay" onClick={() => setShowNotificationPanel(false)}>
            {renderNotificationPanelContent()}
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
                <button className="close-modal" onClick={() => setShowLogoutConfirm(false)}>✖</button>
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
            <div className="footer-legal-links">
              <Link to="/terms">Terms of Service</Link>
              <span className="dot">•</span>
              <Link to="/privacy">Privacy Policy</Link>
            </div>
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
