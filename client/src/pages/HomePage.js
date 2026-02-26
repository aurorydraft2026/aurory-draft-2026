import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  collection, onSnapshot, doc
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../firebase';
import AuroryAccountLink from '../components/AuroryAccountLink';
import {
  syncAuroryName
} from '../services/auroryProfileService';
import { AMIKOS } from '../data/amikos';
import { isSuperAdmin } from '../config/admins';
import LoadingScreen from '../components/LoadingScreen';
import DraftRulesModal from '../components/DraftRulesModal';
import { useTournamentCreation } from '../hooks/useTournamentCreation';
import { useWallet } from '../hooks/useWallet';
import { useLeaderboard } from '../hooks/useLeaderboard';
import { useAuth } from '../hooks/useAuth';
import { useNotifications } from '../hooks/useNotifications';
import { useAppContent } from '../hooks/useAppContent';
import MatchupsSection from '../components/MatchupsSection';
import './HomePage.css';

// Your AURY deposit wallet address (replace with your actual address)
const DEPOSIT_WALLET_ADDRESS = 'Gx8pDnqYwn7pb5bWQMGsmTVbpB1EPrPEBCgKVZJGKqTo';





function HomePage() {
  const navigate = useNavigate();

  const {
    user, setUser,
    showUserModal, setShowUserModal,
    showLoginModal, setShowLoginModal,
    showLoginSuccessModal, setShowLoginSuccessModal,
    showLogoutConfirm,
    showLogoutSuccessModal, setShowLogoutSuccessModal,
    registeredUsers,
    fetchRegisteredUsers,
    isSuperAdminUser,
    isAdminUser,
    renderUserProfileContent,
    renderLoginModalContent,
    renderLoginSuccessModal,
    renderLogoutSuccessModal,
    renderLogoutConfirmModal,
    profileMenuRef
  } = useAuth(navigate);

  const isAdmin = isAdminUser;

  const [loading, setLoading] = useState(true);
  const syncInProgressRef = React.useRef(false); // Guard for infinite sync loops
  const [tournaments, setTournaments] = useState([]);
  const [tournamentFilter, setTournamentFilter] = useState('active');
  const [draftModeFilter, setDraftModeFilter] = useState('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAuroryModal, setShowAuroryModal] = useState(false);
  const DRAFTS_PER_PAGE = 32;
  const hasRedirectedRef = useRef(false);
  const [seenTabs, setSeenTabs] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('aurory_seen_tabs') || '{}');
    } catch (e) {
      return {};
    }
  });

  const {
    announcementSlides,
    currentSlide, setCurrentSlide,
    onTouchStart, onTouchMove, onTouchEnd,
    rules, rulesCurrentSlide, setRulesCurrentSlide, itemsPerView, totalRulesPages,
    handleRulesStart, handleRulesMove, handleRulesEnd,
    getRulesTransform, rulesRef, showRulesModal, setShowRulesModal,
    rulesDrag,
    selectedTournamentForRules, setSelectedTournamentForRules,
    tickerAnnouncements, showTicker, recentWinners, showWinnerTicker,
    news, newsLoading, selectedNews,
    showNewsModal, setShowNewsModal, hasNewNews, handleNewsClick,
    allNews, allNewsLoading, showAllNewsModal, setShowAllNewsModal, fetchAllNews
  } = useAppContent(db);

  const [currentTime, setCurrentTime] = useState(Date.now());



  const [draftsExpanded, setDraftsExpanded] = useState(false);
  const {
    walletBalance,
    showWalletModal, setShowWalletModal,
    walletTab, setWalletTab,
    withdrawAmount, setWithdrawAmount,
    withdrawAddress, setWithdrawAddress,
    transactions,
    walletLoading,
    copySuccess,
    depositTxSignature, setDepositTxSignature,
    depositAmount, setDepositAmount,
    depositNote, setDepositNote,
    formatAuryAmount,
    formatTransactionTime,
    submitWithdrawal,
    submitDepositNotification,
    copyToClipboard
  } = useWallet(user);

  const {
    matchHistory,
    matchHistoryLoading,
    matchHistoryFilter, setMatchHistoryFilter,
    expandedMatch, setExpandedMatch,
    leaderboardMode, setLeaderboardMode,
    topPlayers
  } = useLeaderboard(registeredUsers);

  const {
    newTournament, setNewTournament,
    team1,
    team2,
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
  } = useTournamentCreation(user, walletBalance, registeredUsers, setShowCreateModal);

  const {
    showNotificationPanel,
    setShowNotificationPanel,
    unreadCount,
    notificationMenuRef,
    markAllAsRead,
    renderNotificationPanelContent
  } = useNotifications(user, navigate, formatTransactionTime);

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
  }, [setUser]);



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





  // Handle Scroll to auto-hide ticker





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

  useEffect(() => {
    if (showCreateModal) {
      fetchRegisteredUsers();
      // Non-admins can only create 1v1 modes - default to mode3
      if (!isAdmin && newTournament.draftType !== 'mode3' && newTournament.draftType !== 'mode4') {
        setNewTournament(prev => ({ ...prev, draftType: 'mode3' }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCreateModal, isAdmin]);


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








  if (loading) {
    return <LoadingScreen fullScreen />;
  }

  return (
    <div className="homepage">
      {/* Header with Discord Login */}
      <header className="header">
        <div className="logo" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>
          <img
            src="/AsgardDuels logos/Asgard Duels Logo_color-white text_Horizontal.svg"
            alt="Asgard Duels"
            className="logo-desktop"
          />
          <img
            src="/AsgardDuels logos/AD_logo_mobile_colored.svg"
            alt="Asgard Duels"
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
                    {renderUserProfileContent({ setShowAuroryModal })}
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
          {recentWinners.length > 0 && (
            <div className={`winner-stats-fixed ${showWinnerTicker ? 'visible' : 'hidden'}`}>
              <span className="announcement-icon">🏆</span>
              <div className="stats-scroll-container">
                <div className="winner-static-content">
                  <span className="winner-name-highlight">{recentWinners[0].winnerName}</span>
                  <span className="winner-meta">won against</span>
                  <span className="winner-name-highlight">{recentWinners[0].loserName}</span>
                  <span className="winner-meta">in "{recentWinners[0].title}"</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <main className="main-content">
        {/* Welcome Header - Full Width Above Grid */}
        <div className="hero-section">
          <h2>Welcome to Asgard Duels</h2>
          <p>The ultimate competitive tactical PvP drafting platform for Amiko Legends.</p>
        </div>

        <div className="content-wrapper">
          <div className="main-column">
            {announcementSlides.length > 0 && (
              <div className="main-column-inner">
                {/* Announct Banner */}
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

            {/* Matchups Section */}
            <MatchupsSection user={user} isAdmin={isAdmin} />

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

          {/* Right Column: News + Match History + Top Players */}
          <div className="right-sidebar">
            {/* News Section */}
            <div className="news-section">
              <div className="news-section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <h3>📰 Latest News</h3>
                  {hasNewNews && <span className="news-count-badge">NEW</span>}
                </div>
                <button
                  className="view-all-news-btn"
                  onClick={() => {
                    fetchAllNews();
                    setShowAllNewsModal(true);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#cbd5e1',
                    fontSize: '0.9em',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    padding: 0
                  }}
                >
                  View All
                </button>
              </div>
              <div className="news-list">
                {newsLoading ? (
                  <div className="news-loading">
                    <div className="spinner-small"></div>
                  </div>
                ) : news.length === 0 ? (
                  <div className="news-empty">
                    <p>No news yet</p>
                  </div>
                ) : (
                  news.map((item) => (
                    <div
                      key={item.id}
                      className="news-item"
                      onClick={() => handleNewsClick(item)}
                    >
                      <div className="news-item-banner">
                        <img src={item.banner} alt="" />
                      </div>
                      <div className="news-item-info">
                        <h4 className="news-item-title">{item.title}</h4>
                        <div className="news-item-meta">
                          <span className="news-author">{item.authorName}</span>
                          <span className="news-dot">•</span>
                          <span className="news-date">
                            {item.createdAt?.toDate ? item.createdAt.toDate().toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Recently'}
                          </span>
                          {item.viewCount !== undefined && (
                            <>
                              <span className="news-dot">•</span>
                              <span className="news-views">{item.viewCount || 0} clicks</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
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
                              ? `Entry fee: ${(parseFloat(newTournament.poolAmount) / 2).toFixed(2)} AURY per player • Winner takes ${(parseFloat(newTournament.poolAmount)).toFixed(2)} AURY`
                              : `Sponsored: You pay ${(parseFloat(newTournament.poolAmount)).toFixed(2)} AURY. Entry is FREE for players. Winner takes ${(parseFloat(newTournament.poolAmount)).toFixed(2)} AURY`)
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
                                <span>Upload Banner</span>
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

                    {/* Simplified Tax Breakdown */}
                    {withdrawAmount && !isNaN(parseFloat(withdrawAmount)) && (
                      <div className="withdraw-tax-simple">
                        <p>{parseFloat(withdrawAmount).toFixed(2)} - 5% tax = <span className="net-amount">{(parseFloat(withdrawAmount) * 0.95).toFixed(4)} AURY</span> (Available withdrawal)</p>
                      </div>
                    )}

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

      {/* View All News Modal */}
      {showAllNewsModal && (
        <div className="modal-overlay all-news-overlay">
          <div className="all-news-modal">
            <div className="news-modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2>📰 All News</h2>
              <button className="close-modal" onClick={() => setShowAllNewsModal(false)}>✖</button>
            </div>

            <div className="all-news-content">
              {allNewsLoading ? (
                <div className="news-loading"><div className="news-spinner"></div></div>
              ) : allNews.length === 0 ? (
                <div className="news-empty"><p>No news history available.</p></div>
              ) : (
                <div className="all-news-grid">
                  {allNews.map((item) => (
                    <div
                      key={item.id}
                      className="news-item"
                      onClick={() => handleNewsClick(item)}
                    >
                      <div className="news-item-banner">
                        <img src={item.banner} alt={item.title} loading="lazy" />
                        <div className="news-item-overlay"></div>
                      </div>
                      <div className="news-item-info">
                        <h4 className="news-item-title">{item.title}</h4>
                        <div className="news-item-meta">
                          <span className="news-author">{item.authorName}</span>
                          <span className="news-dot">•</span>
                          <span className="news-date">
                            {item.createdAt?.toDate ? item.createdAt.toDate().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown'}
                          </span>
                          {item.viewCount !== undefined && (
                            <>
                              <span className="news-dot">•</span>
                              <span className="news-views">{item.viewCount || 0} clicks</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mobile User Profile Modal (Root level to avoid header clipping) */}
      {/* Mobile User Profile Modal */}
      {showUserModal && window.innerWidth <= 768 && (
        <div className="modal-overlay mobile-profile-modal-overlay" onClick={() => setShowUserModal(false)}>
          {renderUserProfileContent({ setShowAuroryModal })}
        </div>
      )}

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

      {/* Authentication Modals from useAuth hook */}
      {showLoginModal && renderLoginModalContent()}
      {showLoginSuccessModal && (
        <div className="modal-overlay success-overlay" onClick={() => setShowLoginSuccessModal(false)}>
          {renderLoginSuccessModal()}
        </div>
      )}
      {showLogoutSuccessModal && (
        <div className="modal-overlay success-overlay" onClick={() => setShowLogoutSuccessModal(false)}>
          {renderLogoutSuccessModal()}
        </div>
      )}
      {showLogoutConfirm && renderLogoutConfirmModal()}

      {/* Mobile Notification Modal (Root level to avoid header clipping) */}
      {
        showNotificationPanel && window.innerWidth <= 768 && (
          <div className="modal-overlay mobile-notification-modal-overlay" onClick={() => setShowNotificationPanel(false)}>
            {renderNotificationPanelContent()}
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
      {/* Full News Modal */}
      {showNewsModal && selectedNews && (
        <div className="modal-overlay news-modal-overlay">
          <div className="news-full-modal">
            <div className="news-modal-header">
              <button className="close-modal" onClick={() => setShowNewsModal(false)}>✖</button>
            </div>
            <div className="news-modal-content">
              <img src={selectedNews.banner} alt="" className="news-modal-banner" />
              <h2 className="news-modal-title">{selectedNews.title}</h2>
              <div className="news-modal-meta">
                <div className="news-modal-author-info">
                  <span className="author-label">Posted by</span>
                  <span className="author-name">{selectedNews.authorName}</span>
                </div>
                <div className="news-modal-stats">
                  {selectedNews.viewCount !== undefined && (
                    <span className="news-views">{selectedNews.viewCount || 0} clicks</span>
                  )}
                  <span className="news-modal-date">
                    {selectedNews.createdAt?.toDate ? selectedNews.createdAt.toDate().toLocaleDateString(undefined, {
                      weekday: 'long',
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric'
                    }) : 'Recently'}
                  </span>
                </div>
              </div>
              <div
                className="news-modal-body"
                dangerouslySetInnerHTML={{
                  __html: selectedNews.description
                    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                    .replace(/_(.*?)_/g, '<em>$1</em>')
                    .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
                    .replace(/\n/g, '<br />')
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div >
  );
}

export default HomePage;