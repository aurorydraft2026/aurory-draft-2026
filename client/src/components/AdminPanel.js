import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db, auth, functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import {
  collection,
  onSnapshot,
  doc,
  updateDoc,
  query,
  where,
  orderBy,
  getDocs,
  addDoc,
  serverTimestamp,
  runTransaction,
  increment,
  limit,
  writeBatch,
  deleteDoc,
  setDoc,
  getDoc
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { isSuperAdmin } from '../config/admins';
import { createNotification } from '../services/notifications';
import { logActivity } from '../services/activityService';
import LoadingScreen from './LoadingScreen';
import { resolveDisplayName, resolveAvatar } from '../utils/userUtils';
import { awardPoints } from '../services/pointsService';
import { getRecommendedIcons } from '../services/miniGameService';
import './AdminPanel.css';

// Helper to get user email
const getUserEmail = (user) => {
  if (!user) return null;
  if (user.email) return user.email;
  if (user.providerData && user.providerData.length > 0) {
    return user.providerData[0].email;
  }
  return null;
};

// Format amount based on currency
const formatAmount = (amount, currency = 'AURY') => {
  const divisor = currency === 'USDC' ? 1e6 : 1e9;
  const decimals = currency === 'USDC' ? 2 : 4;
  return (amount / divisor).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals
  });
};

const formatAuryAmount = (amount) => formatAmount(amount, 'AURY');

function AdminPanel() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('credit');
  const [pendingWithdrawals, setPendingWithdrawals] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [userBalanceType, setUserBalanceType] = useState('AURY'); // Added for balance selector

  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState(null);
  const [expandedCategory, setExpandedCategory] = useState('balance'); // Default expanded category on mobile

  // Online visitors state
  const [onlineVisitors, setOnlineVisitors] = useState([]);

  // Users tab search
  const [usersSearchQuery, setUsersSearchQuery] = useState('');

  const [depositNotifications, setDepositNotifications] = useState([]);
  const [depositError, setDepositError] = useState(null);

  // History state
  const [processedWithdrawals, setProcessedWithdrawals] = useState([]);
  const [processedDeposits, setProcessedDeposits] = useState([]);
  const [manualAdjustmentLogs, setManualAdjustmentLogs] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Credit form
  const [selectedCreditUsers, setSelectedCreditUsers] = useState([]);
  const [isSelectingCreditUser, setIsSelectingCreditUser] = useState(false);
  const [creditUserSearch, setCreditUserSearch] = useState('');
  const [creditAmount, setCreditAmount] = useState('');
  const [creditReason, setCreditReason] = useState('');

  // Deduction form
  const [selectedDeductUsers, setSelectedDeductUsers] = useState([]);
  const [isSelectingDeductUser, setIsSelectingDeductUser] = useState(false);
  const [deductUserSearch, setDeductUserSearch] = useState('');
  const [deductAmount, setDeductAmount] = useState('');
  const [deductReason, setDeductReason] = useState('');

  // Announcements form
  const [selectedNotifyUsers, setSelectedNotifyUsers] = useState([]);
  const [isSelectingNotifyUser, setIsSelectingNotifyUser] = useState(false);
  const [notifyUserSearch, setNotifyUserSearch] = useState('');
  const [notifyTitle, setNotifyTitle] = useState('');
  const [notifyMessage, setNotifyMessage] = useState('');

  // Withdrawal approval form
  const [approvalTxSignature, setApprovalTxSignature] = useState({});

  // Banners state
  const [banners, setBanners] = useState([]);
  const [bannerTitle, setBannerTitle] = useState('');
  const [bannerText, setBannerText] = useState('');
  const [bannerImage, setBannerImage] = useState('');
  const [bannerVideoUrl, setBannerVideoUrl] = useState(''); // Video link embed option
  const [bannerLink, setBannerLink] = useState('');
  const [bannerTag, setBannerTag] = useState('');
  const [bannerOrder, setBannerOrder] = useState(0);
  const [bannerDate, setBannerDate] = useState('');
  const [editingBannerId, setEditingBannerId] = useState(null);

  // Activity Logs state
  const [globalLogs, setGlobalLogs] = useState([]);
  const [userLogs, setUserLogs] = useState([]); // Per-user logs
  const [selectedUserForLogs, setSelectedUserForLogs] = useState(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState(null);
  
  // User Notifications state
  const [selectedUserForNotifications, setSelectedUserForNotifications] = useState(null);
  const [userNotifications, setUserNotifications] = useState([]);
  const [userNotificationsLoading, setUserNotificationsLoading] = useState(false);

  // Wallet History Tab State
  const [walletHistoryUserSearch, setWalletHistoryUserSearch] = useState('');
  const [selectedWalletHistoryUser, setSelectedWalletHistoryUser] = useState(null);
  const [walletHistoryTransactions, setWalletHistoryTransactions] = useState([]);
  const [walletHistoryLoading, setWalletHistoryLoading] = useState(false);

  // Ticker Announcements state
  const [tickerAnnouncements, setTickerAnnouncements] = useState([]);
  const [tickerText, setTickerText] = useState('');
  const [tickerIcon, setTickerIcon] = useState('📢');
  const [editingTickerId, setEditingTickerId] = useState(null);
  const [tickerLoading, setTickerLoading] = useState(false);

  // Manual Payout state
  const [payoutDraftId, setPayoutDraftId] = useState('');
  const [payoutLoading, setPayoutLoading] = useState(false);
  
  // Custom Global Wipes
  const [wipeAllConfirmText, setWipeAllConfirmText] = useState('');
  const [isWiping, setIsWiping] = useState(false);

  // Banner social links (max 3 displayed)
  const [bannerDiscord, setBannerDiscord] = useState('');
  const [bannerTwitter, setBannerTwitter] = useState('');
  const [bannerTwitch, setBannerTwitch] = useState('');
  const [bannerFacebook, setBannerFacebook] = useState('');
  const [bannerInstagram, setBannerInstagram] = useState('');
  const [bannerYoutube, setBannerYoutube] = useState('');

  // News management state
  const [news, setNews] = useState([]);
  const [newsTitle, setNewsTitle] = useState('');
  const [newsDescription, setNewsDescription] = useState('');
  const [newsBanner, setNewsBanner] = useState('');
  const [newsVideoUrl, setNewsVideoUrl] = useState(''); // Added for news video support
  const [editingNewsId, setEditingNewsId] = useState(null);
  
  // Mini-Games state
  const [miniGamesConfig, setMiniGamesConfig] = useState(null);
  const [miniGamesLoading, setMiniGamesLoading] = useState(false);
  const [activeGameType, setActiveGameType] = useState('slotMachine');
  const [isAutoAssigning, setIsAutoAssigning] = useState(false);
  const [newPrize, setNewPrize] = useState({
    name: '',
    type: 'valcoins',
    amount: 10,
    weight: 10,
    rarity: 'common',
    icon: 'common_horn.png'
  });
  const [editingPrizeId, setEditingPrizeId] = useState(null);
  const [earnersHistory, setEarnersHistory] = useState([]);
  const [earnersSearchQuery, setEarnersSearchQuery] = useState('');
  const [earnersSelectedUser, setEarnersSelectedUser] = useState(null);
  const [isSelectingEarnersUser, setIsSelectingEarnersUser] = useState(false);
  const [earnersLoading, setEarnersLoading] = useState(false);

  // Major Announcement Campaign state
  const [announcementEnabled, setAnnouncementEnabled] = useState(false);
  const [announcementTitle, setAnnouncementTitle] = useState('🎮 Triad Tourney Season 1');
  const [announcementContent, setAnnouncementContent] = useState(`Official Tournament Rules and Mechanics
Hosted within the Aurory competitive scene

I. Tournament Overview
Tournament Name: Triad Tourney Season 1
Format: Team Tournament
Team Composition: 3 Players per Team
Amiko Restriction: Max Rare Amikos
Battle Format: Draft 1–2–1
Structure: Round Robin | 2 Groups
Duration: 3 Weeks
Start Date: March 9
Group Stage: March 9–22
Finals: March 23–29

II. Registration Details
Entry Fee:
100 $AURY per player
300 $AURY per team

Total Prize Pool:
Accumulated registration pool from Group Stage
Additional 3,000 $AURY reward pool

III. Tournament Structure
1. Group Division
All registered teams will be divided into two separate groups:
Realm of Frost
Realm of Fire

Each team will compete against every other team within their assigned group in a Round Robin format.

IV. <img src="/valcoin-icon.jpg" alt="" className="valcoin-icon" /> Valcoins System
Teams compete for Valcoins during the Group Stage.
3 Valcoins per individual player win
Maximum of 9 Valcoins per match (3 players × 3 Valcoins)
1 Valcoin per player in case of a draw

V. Match Rules and Draft Mechanics
1. Coin Toss
Each match begins with a coin toss to determine which team picks or bans first.
2. Draft Format
Draft Structure: 1–2–1
Ban System: 1 ban per team
Only the Team Captain may officially submit bans and picks

VI. Advancement to Playoffs
After all Group Stage matches are completed:
The Top 2 teams from Realm of Frost
The Top 2 teams from Realm of Fire
Will advance to the Semifinals, followed by the Finals.

VII. Registration Pool Allocation
The accumulated registration pool will be distributed as follows:
60% distributed across Group Stage matches as bounty rewards per team win
30% allocated to the next season’s Registration Pool
10% reserved for gas fees and operational expenses

VIII. $3,000 AURY Reward Pool Distribution
1,500 $AURY — Champion
1,000 $AURY — 2nd Place
250 $AURY — 3rd Place
250 $AURY — 4th Place

IX. General Conduct
Teams are expected to follow fair play standards.
All decisions made by tournament organizers may change throughout the tourney.`);
  const [announcementLink, setAnnouncementLink] = useState('');

  // Selected currencies for manual operations
  const [selectedCreditCurrency, setSelectedCreditCurrency] = useState('AURY');
  const [selectedDeductCurrency, setSelectedDeductCurrency] = useState('AURY');

  // Valcoins Global Configuration state
  const [valcoinConfig, setValcoinConfig] = useState({
    joinRaffle: 20,
    joinTournament: 30
  });
  const [valcoinConfigLoading, setValcoinConfigLoading] = useState(false);

  // Website Maintenance state
  const [maintenanceEnabled, setMaintenanceEnabled] = useState(false);
  const [maintenanceDate, setMaintenanceDate] = useState('TBD');
  const [maintenanceAnnouncement, setMaintenanceAnnouncement] = useState('We are currently performing scheduled maintenance to improve your experience. Please check back soon!');
  
  // Maintenance Warning state
  const [maintenanceWarningEnabled, setMaintenanceWarningEnabled] = useState(false);
  const [maintenanceWarningText, setMaintenanceWarningText] = useState('⚠️ Website Maintenance is scheduled for today. Please save your work!');

  // Handle image upload to Base64
  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 1024 * 1024) { // 1MB limit for Firestore
        alert('Image too large. Please use an image under 1MB.');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setBannerImage(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  // Listen for auth state changes
  useEffect(() => {
    let unsubscribeUserDoc = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser && !currentUser.isAnonymous) {
        let userEmail = currentUser.email;
        if (!userEmail && currentUser.providerData && currentUser.providerData.length > 0) {
          userEmail = currentUser.providerData[0].email;
        }

        // Set initial user data
        setUser({
          ...currentUser,
          email: userEmail || ''
        });

        // Fetch additional user data (like role) from Firestore
        const userRef = doc(db, 'users', currentUser.uid);
        unsubscribeUserDoc = onSnapshot(userRef, (docSnap) => {
          if (docSnap.exists()) {
            setUser(prev => ({
              ...prev,
              ...docSnap.data()
            }));
          }
        });
      } else {
        setUser(null);
        if (unsubscribeUserDoc) unsubscribeUserDoc();
      }
      setAuthLoading(false);
    });
    return () => {
      unsubscribeAuth();
      if (unsubscribeUserDoc) unsubscribeUserDoc();
    };
  }, []);

  // Check if current user is admin/super admin
  const isSuperAdminUser = user && (isSuperAdmin(getUserEmail(user)) || user.role === 'superadmin');
  const isGamesManagerUser = user && user.role === 'games_manager';
  const isGeneralAdmin = user && (isSuperAdminUser || user.role === 'admin');
  const isAdminUser = isGeneralAdmin || isGamesManagerUser;
  const isAdmin = isGeneralAdmin; // Keep for existing checks in the file (withdrawals, etc)

  // Force Games Manager to appropriate initial tab
  useEffect(() => {
    if (isGamesManagerUser && !isGeneralAdmin) {
        if (activeTab !== 'mini_games' && activeTab !== 'mini_game_history') {
            setActiveTab('mini_games');
            setExpandedCategory('games');
        }
    }
  }, [isGamesManagerUser, isGeneralAdmin, activeTab]);


  // Fetch pending withdrawals
  useEffect(() => {
    if (!isAdminUser) return;
    
    // If not a general admin, they don't have access to withdrawals, so we stop loading
    if (!isGeneralAdmin) {
      setLoading(false);
      return;
    }

    const withdrawalsRef = collection(db, 'withdrawals');
    const q = query(
      withdrawalsRef,
      where('status', '==', 'pending'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q,
      (snapshot) => {
        const withdrawals = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setPendingWithdrawals(withdrawals);
        setLoading(false);
      },
      (error) => {
        console.error('Error fetching withdrawals:', error);
        alert('Error loading withdrawals. Check console and Firestore indexes.');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [isAdminUser, isGeneralAdmin]);

  // Fetch pending deposit notifications
  useEffect(() => {
    if (!isAdminUser) return;
    
    if (!isGeneralAdmin) return;

    console.log('Setting up deposit notifications listener...');
    console.log('Admin email:', getUserEmail(user));
    console.log('Is super admin:', isSuperAdmin(getUserEmail(user)));

    const notificationsRef = collection(db, 'depositNotifications');

    // TRY TWO APPROACHES:
    // Approach 1: With orderBy (requires composite index)
    const qWithOrder = query(
      notificationsRef,
      where('status', '==', 'pending'),
      orderBy('createdAt', 'desc')
    );

    // Approach 2: Without orderBy (fallback if index doesn't exist)
    const qWithoutOrder = query(
      notificationsRef,
      where('status', '==', 'pending')
    );

    // Try the query with orderBy first
    const unsubscribe = onSnapshot(
      qWithOrder,
      (snapshot) => {
        console.log('✅ Deposit notifications loaded:', snapshot.docs.length);
        const notifications = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        // Sort manually by createdAt if needed
        notifications.sort((a, b) => {
          const dateA = a.createdAt?.toDate?.() || new Date(0);
          const dateB = b.createdAt?.toDate?.() || new Date(0);
          return dateB - dateA;
        });
        setDepositNotifications(notifications);
        setDepositError(null);
      },
      (error) => {
        console.error('❌ Error with orderBy query, trying without orderBy:', error);
        setDepositError(error.message);

        // Fallback: Try without orderBy
        const fallbackUnsubscribe = onSnapshot(
          qWithoutOrder,
          (snapshot) => {
            console.log('✅ Deposit notifications loaded (fallback):', snapshot.docs.length);
            const notifications = snapshot.docs.map(doc => ({
              id: doc.id,
              ...doc.data()
            }));
            // Sort manually by createdAt
            notifications.sort((a, b) => {
              const dateA = a.createdAt?.toDate?.() || new Date(0);
              const dateB = b.createdAt?.toDate?.() || new Date(0);
              return dateB - dateA;
            });
            setDepositNotifications(notifications);
            setDepositError('⚠️ Using fallback query. Create Firestore index for better performance.');
          },
          (fallbackError) => {
            console.error('❌ Error with fallback query:', fallbackError);
            setDepositError(`Error loading deposit notifications: ${fallbackError.message}`);
          }
        );

        return fallbackUnsubscribe;
      }
    );

    return () => unsubscribe();
  }, [isAdminUser, isGeneralAdmin, user]);

  // Fetch mini-games config
  useEffect(() => {
    if (!isAdminUser || activeTab !== 'mini_games') return;

    setMiniGamesLoading(true);
    const unsub = onSnapshot(doc(db, 'settings', 'mini_games'), (snap) => {
      if (snap.exists()) {
        setMiniGamesConfig(snap.data());
      } else {
        // Initialize with defaults if it doesn't exist
        setDoc(doc(db, 'settings', 'mini_games'), {
          slotMachine: { enabled: true, costPerPlay: 50, prizes: [] },
          treasureChest: { enabled: true, costPerPlay: 30, prizes: [] }
        });
      }
      setMiniGamesLoading(false);
    });
    return () => unsub();
  }, [activeTab, isAdminUser, isAdmin]);

  // Fetch Mini-Game Earners (User specific)
  useEffect(() => {
    if (!isAdminUser || activeTab !== 'mini_game_history' || !db) return;

    // If no user selected, we don't fetch history (as requested: "per user searched")
    if (!earnersSelectedUser) {
      setEarnersHistory([]);
      setEarnersLoading(false);
      return;
    }

    setEarnersLoading(true);
    const q = query(
      collection(db, 'users', earnersSelectedUser.id, 'miniGameHistory'),
      orderBy('timestamp', 'desc'),
      limit(500)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const history = snapshot.docs.map(doc => ({
        id: doc.id,
        userId: earnersSelectedUser.id,
        ...doc.data()
      }));
      setEarnersHistory(history);
      setEarnersLoading(false);
    }, (error) => {
      console.error('Error fetching earners history:', error);
      setEarnersLoading(false);
    });

    return () => unsubscribe();
  }, [activeTab, isAdminUser, earnersSelectedUser]);

  // Fetch Website Maintenance config
  useEffect(() => {
    if (!isAdmin || activeTab !== 'website_mgmt') return;

    const unsub = onSnapshot(doc(db, 'settings', 'maintenance'), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setMaintenanceEnabled(data.enabled || false);
        setMaintenanceDate(data.scheduledDate || 'TBD');
        setMaintenanceAnnouncement(data.announcement || '');
        setMaintenanceWarningEnabled(data.warningEnabled || false);
        setMaintenanceWarningText(data.warningText || '⚠️ Website Maintenance is scheduled for today. Please save your work!');
      } else {
        // Initialize if doesn't exist
        setDoc(doc(db, 'settings', 'maintenance'), {
          enabled: false,
          scheduledDate: 'TBD',
          announcement: 'We are currently performing scheduled maintenance to improve your experience. Please check back soon!',
          createdAt: serverTimestamp()
        });
      }
    });

    return () => unsub();
  }, [activeTab, isAdmin, isAdminUser]);

  const handleUpdateMiniGameConfig = async (gameType, updates) => {
    try {
      const configRef = doc(db, 'settings', 'mini_games');
      const updateData = {};
      
      // Use Firestore nested field paths (e.g., 'slotMachine.enabled')
      Object.keys(updates).forEach(key => {
        updateData[`${gameType}.${key}`] = updates[key];
      });
      
      await updateDoc(configRef, updateData);
      
      logActivity({
        user,
        type: 'ADMIN',
        action: 'update_mini_game_config',
        metadata: { gameType, updates }
      });
    } catch (error) {
      console.error('Error updating mini-game config:', error);
      alert('Error updating config: ' + error.message);
    }
  };

  const handleAutoAssignIcons = async (gameType) => {
    if (!window.confirm(`This will overwrite all current prize icons for ${gameType} with themed classic symbols based on rarity. Continue?`)) return;
    
    setIsAutoAssigning(true);
    try {
      const configRef = doc(db, 'settings', 'mini_games');
      const gameConfig = miniGamesConfig[gameType];
      if (!gameConfig || !gameConfig.prizes) return;

      const updatedPrizes = gameConfig.prizes.map(prize => {
        const icons = getRecommendedIcons(prize.rarity);
        // Map common icons specifically for slot machine if possible
        let icon = icons[0];
        if (gameType === 'slotMachine') {
            if (prize.rarity === 'common' && prize.name.includes('25')) icon = 'common_horn.png';
            else if (prize.rarity === 'common' && prize.name.includes('50')) icon = 'common_shield.png';
            else if (prize.rarity === 'rare') icon = 'rare_axe.png';
            else if (prize.rarity === 'epic') icon = 'epic_helmet.png';
            else if (prize.rarity === 'legendary') icon = 'legendary_ship.png';
        }
        return { ...prize, icon };
      });
      
      const updateData = {};
      updateData[`${gameType}.prizes`] = updatedPrizes;
      await updateDoc(configRef, updateData);
      alert('Icons successfully refreshed for ' + gameType);
    } catch (error) {
      console.error('Error auto-assigning icons:', error);
      alert('Failed to update icons: ' + error.message);
    } finally {
      setIsAutoAssigning(false);
    }
  };


  const handleAddPrize = async (gameType) => {
    if (!newPrize.name || newPrize.amount < 0) {
        alert('Please enter a valid prize name and amount');
        return;
    }
    
    const prizes = [...(miniGamesConfig[gameType]?.prizes || [])];
    
    if (editingPrizeId) {
      // Update Mode
      const updatedPrizes = prizes.map(p => p.id === editingPrizeId ? { ...newPrize, id: editingPrizeId } : p);
      await handleUpdateMiniGameConfig(gameType, { prizes: updatedPrizes });
      setEditingPrizeId(null);
    } else {
      // Create Mode
      const newPrizeObj = { ...newPrize, id: `p${Date.now()}` };
      prizes.push(newPrizeObj);
      await handleUpdateMiniGameConfig(gameType, { prizes });
    }
    
    setNewPrize({
      name: '',
      type: 'valcoins',
      amount: 10,
      weight: 10,
      rarity: 'common',
      icon: 'common_horn.png'
    });
  };

  const handleDeletePrize = async (gameType, prizeId) => {
    if (!window.confirm('Are you sure you want to delete this prize?')) return;
    const prizes = (miniGamesConfig[gameType]?.prizes || []).filter(p => p.id !== prizeId);
    await handleUpdateMiniGameConfig(gameType, { prizes });
  };

  const handleStartEditPrize = (prize) => {
    setEditingPrizeId(prize.id);
    setNewPrize({
      name: prize.name,
      type: prize.type,
      amount: prize.amount,
      weight: prize.weight,
      rarity: prize.rarity,
      icon: prize.icon || 'common_horn.png'
    });
    // Scroll to top of form for UX
    document.querySelector('.prizes-management-card')?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleCancelEditPrize = () => {
    setEditingPrizeId(null);
    setNewPrize({
      name: '',
      type: 'valcoins',
      amount: 10,
      weight: 10,
      rarity: 'common',
      icon: 'common_horn.png'
    });
  };

  // Fetch all users and their balances
  useEffect(() => {
    if (!isAdmin) return;

    const fetchData = async () => {
      try {
        // Fetch users
        const usersRef = collection(db, 'users');
        const usersSnapshot = await getDocs(usersRef);

        // Fetch wallets for balances
        const walletsRef = collection(db, 'wallets');
        const walletsSnapshot = await getDocs(walletsRef);

        // Create a map of balances for easy lookup
        const balanceMap = {};
        walletsSnapshot.forEach(doc => {
          const data = doc.data();
          balanceMap[doc.id] = {
            balance: data.balance || 0,
            usdcBalance: data.usdcBalance || 0
          };
        });

        const users = usersSnapshot.docs.map(doc => {
          const balances = balanceMap[doc.id] || { balance: 0, usdcBalance: 0 };
          return {
            id: doc.id,
            ...doc.data(),
            balance: balances.balance,
            usdcBalance: balances.usdcBalance
          };
        }).filter(u => u.email && !u.isGuest);

        setAllUsers(users);
      } catch (error) {
        console.error('Error fetching users and balances:', error);
      }
    };

    fetchData();
  }, [isAdmin]);

  // Track online visitors (admin and super admin)
  useEffect(() => {
    if (!isAdminUser) return;

    const usersRef = collection(db, 'users');
    const unsubscribe = onSnapshot(usersRef, (snapshot) => {
      const now = Date.now();
      const threeDaysAgo = now - (3 * 24 * 60 * 60 * 1000); // 3 days threshold

      const visitors = snapshot.docs
        .map(doc => ({
          id: doc.id,
          ...doc.data()
        }))
        .filter(user => {
          // Consider user online if they have recent activity
          const lastSeen = user.lastSeen?.toMillis?.() || user.lastSeen || 0;
          return lastSeen > threeDaysAgo;
        })
        .sort((a, b) => {
          // Sort by most recent activity
          const aTime = a.lastSeen?.toMillis?.() || a.lastSeen || 0;
          const bTime = b.lastSeen?.toMillis?.() || b.lastSeen || 0;
          return bTime - aTime;
        });

      setOnlineVisitors(visitors);
    });

    return () => unsubscribe();
  }, [isAdminUser]);

  // Fetch banners
  useEffect(() => {
    if (!isAdmin) return;

    const bannersRef = collection(db, 'banners');
    const q = query(bannersRef, orderBy('order', 'asc'), orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const bannerData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setBanners(bannerData);
    });

    return () => unsubscribe();
  }, [isAdmin]);

  // Fetch News
  useEffect(() => {
    if (!isAdmin) return;

    const newsRef = collection(db, 'news');
    const q = query(newsRef, orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const newsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setNews(newsData);
    });

    return () => unsubscribe();
  }, [isAdmin]);

  // Fetch History (processed withdrawals, deposits, and manual adjustments)
  useEffect(() => {
    if (!isAdmin || activeTab !== 'history') return;

    setHistoryLoading(true);

    // 1. Processed Withdrawals
    const withdrawalsRef = collection(db, 'withdrawals');
    const qWithdrawals = query(
      withdrawalsRef,
      where('status', 'in', ['completed', 'rejected']),
      orderBy('processedAt', 'desc')
    );

    const unsubscribeWithdrawals = onSnapshot(qWithdrawals, (snapshot) => {
      const processed = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setProcessedWithdrawals(processed);
    });

    // 2. Processed Deposits
    const depositsRef = collection(db, 'depositNotifications');
    const qDeposits = query(
      depositsRef,
      where('status', 'in', ['processed', 'dismissed']),
      orderBy('processedAt', 'desc')
    );

    const unsubscribeDeposits = onSnapshot(qDeposits, (snapshot) => {
      const processed = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setProcessedDeposits(processed);
    });

    // 3. Manual Adjustments (from Activity Logs)
    const logsRef = collection(db, 'activity_logs');
    const qManual = query(
      logsRef,
      where('type', '==', 'ADMIN'),
      where('action', 'in', ['manual_credit', 'manual_deduct']),
      orderBy('timestamp', 'desc'),
      limit(200)
    );

    const unsubscribeManual = onSnapshot(qManual, (snapshot) => {
      const logs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setManualAdjustmentLogs(logs);
      setHistoryLoading(false);
    }, (error) => {
      console.error('Error fetching history:', error);
      setHistoryLoading(false);
    });

    return () => {
      unsubscribeWithdrawals();
      unsubscribeDeposits();
      unsubscribeManual();
    };
  }, [isAdmin, activeTab]);

  // Fetch Ticker Announcements
  const fetchTickerAnnouncements = () => {
    setTickerLoading(true);
    const q = query(collection(db, 'settings'), where('type', '==', 'ticker_announcement'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setTickerAnnouncements(docs);
      setTickerLoading(false);
    });
  };

  useEffect(() => {
    if (activeTab === 'ticker') {
      const unsubscribe = fetchTickerAnnouncements();
      return () => unsubscribe();
    }
  }, [activeTab]);

  // Fetch Wallet History
  useEffect(() => {
    if (activeTab !== 'walletHistory' || !selectedWalletHistoryUser || !isSuperAdminUser) {
      setWalletHistoryTransactions([]);
      return;
    }

    setWalletHistoryLoading(true);
    const txRef = collection(db, 'wallets', selectedWalletHistoryUser.id, 'transactions');
    const q = query(txRef, orderBy('timestamp', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const txs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setWalletHistoryTransactions(txs);
      setWalletHistoryLoading(false);
    }, (error) => {
      console.error('Error fetching wallet history:', error);
      alert('Error fetching wallet history: ' + error.message);
      setWalletHistoryLoading(false);
    });

    return () => unsubscribe();
  }, [activeTab, selectedWalletHistoryUser, isSuperAdminUser]);

  // Fetch Major Announcement Settings
  useEffect(() => {
    if (activeTab !== 'campaigns') return;

    const docRef = doc(db, 'settings', 'major_announcement');

    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setAnnouncementEnabled(data.enabled || false);
        setAnnouncementTitle(data.title || '');
        setAnnouncementContent(data.content || '');
        setAnnouncementLink(data.link || '');
      }
    }, (error) => {
      console.error('Error fetching announcement settings:', error);
    });

    return () => unsubscribe();
  }, [activeTab]);

  // Fetch Valcoin Settings
  useEffect(() => {
    if (activeTab !== 'manage_valcoins') return;

    setValcoinConfigLoading(true);
    const docRef = doc(db, 'settings', 'valcoin_rewards');

    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setValcoinConfig({
          dailyCheckIn: data.dailyCheckIn ?? 10,
          linkAurory: data.linkAurory ?? 50,
          joinRaffle: data.joinRaffle ?? 20,
          joinTournament: data.joinTournament ?? 30
        });
      }
      setValcoinConfigLoading(false);
    }, (error) => {
      console.error('Error fetching valcoin config:', error);
      setValcoinConfigLoading(false);
    });

    return () => unsubscribe();
  }, [activeTab]);

  const handleSaveAnnouncement = async () => {
    setProcessingId('save_announcement');
    try {
      await setDoc(doc(db, 'settings', 'major_announcement'), {
        enabled: announcementEnabled,
        title: announcementTitle,
        content: announcementContent,
        link: announcementLink,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
        updatedByName: resolveDisplayName(user)
      }, { merge: true });

      alert('Announcement settings saved successfully!');

      logActivity({
        user,
        type: 'ADMIN',
        action: 'update_major_announcement',
        metadata: { enabled: announcementEnabled, title: announcementTitle }
      });
    } catch (error) {
      console.error('Error saving announcement settings:', error);
      alert('Error saving announcement settings: ' + error.message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleSaveValcoinConfig = async () => {
    setProcessingId('save_valcoins');
    try {
      await setDoc(doc(db, 'settings', 'valcoin_rewards'), {
        ...valcoinConfig,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
        updatedByName: resolveDisplayName(user)
      }, { merge: true });

      alert('Valcoin configuration saved successfully!');
      
      logActivity({
        user,
        type: 'ADMIN',
        action: 'update_valcoin_config',
        metadata: valcoinConfig
      });
    } catch (error) {
      console.error('Error saving valcoin config:', error);
      alert('Error saving valcoin config: ' + error.message);
    }
  };

  const handleSaveMaintenance = async () => {
    setProcessingId('save_maintenance');
    try {
      await setDoc(doc(db, 'settings', 'maintenance'), {
        enabled: maintenanceEnabled,
        scheduledDate: maintenanceDate,
        announcement: maintenanceAnnouncement,
        warningEnabled: maintenanceWarningEnabled,
        warningText: maintenanceWarningText,
        warningUpdatedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
        updatedByName: resolveDisplayName(user)
      }, { merge: true });

      alert('Maintenance settings saved successfully!');

      logActivity({
        user,
        type: 'ADMIN',
        action: 'update_maintenance_settings',
        metadata: { enabled: maintenanceEnabled, scheduledDate: maintenanceDate }
      });
    } catch (error) {
      console.error('Error saving maintenance settings:', error);
      alert('Error saving maintenance settings: ' + error.message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleRestoreValcoinDefaults = () => {
    if (window.confirm('Are you sure you want to restore the default Valcoin values?')) {
      setValcoinConfig({
        dailyCheckIn: 10,
        linkAurory: 50,
        joinRaffle: 20,
        joinTournament: 30
      });
    }
  };

  const handleDeleteWalletTransaction = async (txId, userId) => {
    if (!window.confirm('Are you sure you want to delete this transaction record? This will NOT refund or deduct any balance, it only removes the history log.')) return;

    try {
      setProcessingId(`del-tx-${txId}`);
      await deleteDoc(doc(db, 'wallets', userId, 'transactions', txId));

      logActivity({
        user,
        type: 'ADMIN',
        action: 'delete_wallet_transaction',
        metadata: { txId, userId }
      });

      alert('Transaction record deleted successfully.');
    } catch (error) {
      console.error('Error deleting transaction:', error);
      alert('Error deleting transaction: ' + error.message);
    } finally {
      setProcessingId(null);
    }
  };

  // News management functions
  const handleSaveNews = async () => {
    if (!newsTitle) return alert('News title is required');
    if (!newsDescription) return alert('News description is required');
    if (!newsBanner) return alert('News banner is required');

    setProcessingId('news');
    try {
      const newsData = {
        title: newsTitle,
        description: newsDescription,
        banner: newsBanner,
        videoUrl: newsVideoUrl || '', // Added for news video support
        authorName: resolveDisplayName(user),
        authorUid: user.uid,
        updatedAt: serverTimestamp()
      };

      if (editingNewsId) {
        const newsRef = doc(db, 'news', editingNewsId);
        await updateDoc(newsRef, newsData);
        alert('News post updated successfully!');

        logActivity({
          user,
          type: 'ADMIN',
          action: 'update_news',
          metadata: { newsId: editingNewsId, title: newsTitle }
        });
      } else {
        await addDoc(collection(db, 'news'), {
          ...newsData,
          createdAt: serverTimestamp()
        });
        alert('News post added successfully!');

        logActivity({
          user,
          type: 'ADMIN',
          action: 'create_news',
          metadata: { title: newsTitle }
        });
      }

      resetNewsForm();
    } catch (error) {
      console.error('Error saving news:', error);
      alert('Error saving news: ' + error.message);
    }
    setProcessingId(null);
  };

  const resetNewsForm = () => {
    setNewsTitle('');
    setNewsDescription('');
    setNewsBanner('');
    setNewsVideoUrl(''); // Added for news video support
    setEditingNewsId(null);
  };

  const handleEditNews = (post) => {
    setNewsTitle(post.title || '');
    setNewsDescription(post.description || '');
    setNewsBanner(post.banner || '');
    setNewsVideoUrl(post.videoUrl || ''); // Added for news video support
    setEditingNewsId(post.id);

    // Scroll to form
    const formElement = document.querySelector('.news-form-card');
    if (formElement) formElement.scrollIntoView({ behavior: 'smooth' });
  };

  const handleDeleteNews = async (id) => {
    if (!window.confirm('Are you sure you want to delete this news post?')) return;

    try {
      await deleteDoc(doc(db, 'news', id));
      alert('News post deleted!');
    } catch (error) {
      console.error('Error deleting news:', error);
      alert('Error deleting news: ' + error.message);
    }
  };

  const handleNewsBannerUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 1024 * 1024) { // 1MB limit for Firestore
        alert('Image too large. Please use an image under 1MB.');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setNewsBanner(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveBanner = async () => {
    if (!bannerTitle) return alert('Banner title is required');
    if (!bannerText) return alert('Banner description is required');
    if (!bannerImage) return alert('Banner image is required (URL or Upload)');

    setProcessingId('banner');
    try {
      const bannerData = {
        title: bannerTitle,
        text: bannerText,
        image: bannerImage,
        videoUrl: bannerVideoUrl || '', // Video link embed
        link: bannerLink || '',
        tag: bannerTag || '',
        date: bannerDate || '',
        order: parseInt(bannerOrder) || 0,
        discord: bannerDiscord || '',
        twitter: bannerTwitter || '',
        twitch: bannerTwitch || '',
        facebook: bannerFacebook || '',
        instagram: bannerInstagram || '',
        youtube: bannerYoutube || '',
        updatedAt: serverTimestamp()
      };

      if (editingBannerId) {
        const bannerRef = doc(db, 'banners', editingBannerId);
        await updateDoc(bannerRef, bannerData);
        alert('Banner updated successfully!');

        logActivity({
          user,
          type: 'ADMIN',
          action: 'update_banner',
          metadata: { bannerId: editingBannerId, title: bannerTitle }
        });
      } else {
        await addDoc(collection(db, 'banners'), {
          ...bannerData,
          createdBy: user.uid,
          createdAt: serverTimestamp()
        });
        alert('Banner added successfully!');

        logActivity({
          user,
          type: 'ADMIN',
          action: 'create_banner',
          metadata: { title: bannerTitle }
        });
      }

      // Reset form
      resetBannerForm();
    } catch (error) {
      console.error('Error saving banner:', error);
      alert('Error saving banner: ' + error.message);
    }
    setProcessingId(null);
  };

  const resetBannerForm = () => {
    setBannerTitle('');
    setBannerText('');
    setBannerImage('');
    setBannerVideoUrl('');
    setBannerLink('');
    setBannerTag('');
    setBannerDate('');
    setBannerOrder(0);
    setBannerDiscord('');
    setBannerTwitter('');
    setBannerTwitch('');
    setBannerFacebook('');
    setBannerInstagram('');
    setBannerYoutube('');
    setEditingBannerId(null);
  };

  const handleEditBanner = (banner) => {
    setBannerTitle(banner.title || '');
    setBannerText(banner.text || '');
    setBannerImage(banner.image || '');
    setBannerVideoUrl(banner.videoUrl || '');
    setBannerLink(banner.link || '');
    setBannerTag(banner.tag || '');
    setBannerDate(banner.date || '');
    setBannerDiscord(banner.discord || '');
    setBannerTwitter(banner.twitter || '');
    setBannerTwitch(banner.twitch || '');
    setBannerFacebook(banner.facebook || '');
    setBannerInstagram(banner.instagram || '');
    setBannerYoutube(banner.youtube || '');
    setBannerOrder(banner.order || 0);
    setEditingBannerId(banner.id);

    // Scroll to form
    const formElement = document.querySelector('.banner-form-card');
    if (formElement) formElement.scrollIntoView({ behavior: 'smooth' });
  };

  const handleDeleteBanner = async (id) => {
    if (!window.confirm('Are you sure you want to delete this banner?')) return;

    try {
      await deleteDoc(doc(db, 'banners', id));
      alert('Banner deleted!');
    } catch (error) {
      console.error('Error deleting banner:', error);
      alert('Error deleting banner: ' + error.message);
    }
  };

  // Ticker Management Functions
  const handleSaveTicker = async () => {
    if (!tickerText) return;

    try {
      const tickerData = {
        text: tickerText,
        icon: tickerIcon,
        type: 'ticker_announcement',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        author: {
          uid: auth.currentUser.uid,
          name: auth.currentUser.displayName || 'Admin'
        }
      };

      if (editingTickerId) {
        await updateDoc(doc(db, 'settings', editingTickerId), {
          ...tickerData,
          createdAt: tickerAnnouncements.find(t => t.id === editingTickerId)?.createdAt || serverTimestamp()
        });
        alert('Ticker updated!');
      } else {
        await addDoc(collection(db, 'settings'), tickerData);
        alert('Ticker added!');
      }

      resetTickerForm();
    } catch (error) {
      console.error("Error saving ticker:", error);
      alert("Failed to save ticker");
    }
  };

  const resetTickerForm = () => {
    setTickerText('');
    setTickerIcon('📢');
    setEditingTickerId(null);
  };

  const handleEditTicker = (ticker) => {
    setTickerText(ticker.text);
    setTickerIcon(ticker.icon);
    setEditingTickerId(ticker.id);
  };

  const handleDeleteTicker = async (id) => {
    if (!window.confirm('Are you sure you want to delete this announcement?')) return;
    try {
      await deleteDoc(doc(db, 'settings', id));
    } catch (error) {
      console.error('Error deleting ticker:', error);
    }
  };

   // Mini-game reset stats
  const [resetStatsConfirmText, setResetStatsConfirmText] = useState('');
  const [resetStatsWipeHistory, setResetStatsWipeHistory] = useState(false);
  const [isResettingStats, setIsResettingStats] = useState(false);

  // Reset Mini-Game Leaderboard Stats Handler
  const handleResetLeaderboardStats = async () => {
    if (!isSuperAdminUser) return;
    if (resetStatsConfirmText !== 'RESET ALL STATS') {
      return alert('Please type "RESET ALL STATS" to confirm the reset.');
    }

    if (!window.confirm('🚨 FINAL WARNING: This will permanently delete ALL mini-game statistics (wins, plays, spent) for ALL users. This cannot be undone. Proceed?')) {
      return;
    }

    setIsResettingStats(true);
    setProcessingId('reset_game_stats');

    try {
      const resetFn = httpsCallable(functions, 'resetMiniGameStats');
      const { data: result } = await resetFn({ wipeHistory: resetStatsWipeHistory });
      
      alert(`✅ ${result.message}`);
      setResetStatsConfirmText('');
      
      logActivity({
        user,
        type: 'ADMIN',
        action: 'reset_minigame_leaderboards',
        metadata: { userCount: result.count }
      });

    } catch (error) {
      console.error('Reset stats error:', error);
      alert('Error resetting stats: ' + error.message);
    } finally {
      setIsResettingStats(false);
      setProcessingId(null);
    }
  };

  // Fetch notifications for a specific user
  const fetchUserNotifications = async (uid) => {
    if (!uid) return;
    setUserNotificationsLoading(true);
    try {
      const notificationsRef = collection(db, 'users', uid, 'notifications');
      const q = query(notificationsRef, orderBy('createdAt', 'desc'), limit(50));
      const snapshot = await getDocs(q);
      const notifs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setUserNotifications(notifs);
    } catch (error) {
      console.error('Error fetching notifications:', error);
      alert('Error fetching notifications: ' + error.message);
    } finally {
      setUserNotificationsLoading(false);
    }
  };

  // Delete a specific notification
  const handleDeleteNotification = async (uid, notifId) => {
    if (!isSuperAdminUser || !uid || !notifId) return;
    if (!window.confirm('Are you sure you want to delete this notification?')) return;

    try {
      await deleteDoc(doc(db, 'users', uid, 'notifications', notifId));
      setUserNotifications(prev => prev.filter(n => n.id !== notifId));
    } catch (error) {
      console.error('Error deleting notification:', error);
      alert('Error deleting: ' + error.message);
    }
  };

  // Clear all notifications for a user
  const handleClearAllNotifications = async (uid) => {
    if (!isSuperAdminUser || !uid) return;
    if (!window.confirm('🚨 Irreversible: Are you sure you want to CLEAR ALL notifications for this user?')) return;

    try {
      const notificationsRef = collection(db, 'users', uid, 'notifications');
      const snapshot = await getDocs(notificationsRef);
      const batch = writeBatch(db);
      snapshot.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      setUserNotifications([]);
      alert('✅ All notifications cleared.');
    } catch (error) {
      console.error('Error clearing notifications:', error);
      alert('Error clearing notifications: ' + error.message);
    }
  };

  // Handle global notification wipe
  const handleClearAllGlobalNotifications = async () => {
    if (!isSuperAdminUser || wipeAllConfirmText !== 'WIPE ALL') return;
    if (!window.confirm('💣 FINAL WARNING: This will permanently delete ALL notifications for EVERY user on the platform. Proceed?')) return;

    setIsWiping(true);
    try {
      const clearFn = httpsCallable(functions, 'clearAllGlobalNotifications');
      const { data: result } = await clearFn({});

      if (result?.success) {
        alert(result.message);
        setWipeAllConfirmText('');
      } else {
        throw new Error(result?.message || 'Wipe failed');
      }
    } catch (error) {
      console.error('Global notification wipe error:', error);
      alert('Error wiping notifications: ' + error.message);
    } finally {
      setIsWiping(false);
    }
  };

  // Handle global wallet reset (Balances + History)
  const handleResetGlobalWallets = async () => {
    if (!isSuperAdminUser || wipeAllConfirmText !== 'WIPE ALL') return;
    if (!window.confirm('🚨 FINAL NUCLEAR WARNING: This will permanently reset ALL user balances to 0 and WIPE ALL transaction history, withdrawals, and deposits. THIS IS IRREVERSIBLE. Are you 100% sure?')) return;

    setIsWiping(true);
    try {
      const resetFn = httpsCallable(functions, 'resetGlobalWallets');
      const { data: result } = await resetFn({});

      if (result?.success) {
        alert(result.message);
        setWipeAllConfirmText('');
      } else {
        throw new Error(result?.message || 'Reset failed');
      }
    } catch (error) {
      console.error('Global wallet reset error:', error);
      alert('Error resetting wallets: ' + error.message);
    } finally {
      setIsWiping(false);
    }
  };

  // Manual Payout Handler
  const handleManualPayout = async () => {
    if (!payoutDraftId) return alert('Please enter a Draft ID');
    if (!window.confirm(`Are you sure you want to manually trigger payout for draft ${payoutDraftId}? This should only be done if the automatic payout failed.`)) return;

    setPayoutLoading(true);
    try {
      const payoutFn = httpsCallable(functions, 'manualPayout');
      const { data: result } = await payoutFn({ draftId: payoutDraftId });

      alert(`Success: ${result.message}`);
      setPayoutDraftId('');
    } catch (error) {
      console.error('Manual payout error:', error);
      alert('Error triggering payout: ' + error.message);
    }
    setPayoutLoading(false);
  };

  // Handle Leaderboard Migration (Firestore -> RTDB)
  const handleMigrateLeaderboards = async () => {
    if (!isSuperAdminUser || wipeAllConfirmText !== 'WIPE ALL') {
      return alert('Please type "WIPE ALL" in the confirmation box to run the migration.');
    }
    
    if (!window.confirm('🚀 This will scan ALL users and populate the RTDB All-Time leaderboards. Proceed?')) return;

    setIsWiping(true);
    setProcessingId('migrate_leaderboards');
    try {
      const migrateFn = httpsCallable(functions, 'migrateMinigameLeaderboards');
      const { data: result } = await migrateFn({});
      
      if (result?.success) {
        alert(result.message);
        setWipeAllConfirmText('');
        
        logActivity({
          user,
          type: 'ADMIN',
          action: 'migrate_leaderboards_rtdb',
          metadata: { userCount: result.count }
        });
      } else {
        throw new Error(result?.message || 'Migration failed');
      }
    } catch (error) {
      console.error('Migration error:', error);
      alert('Error: ' + error.message);
    } finally {
      setIsWiping(false);
      setProcessingId(null);
    }
  };



  const handleRestoreTickerDefaults = async () => {
    if (!isAdminUser) return;
    if (!window.confirm('Are you sure you want to restore the default announcements? This will add 3 items to the list.')) return;

    setProcessingId('restore_ticker_defaults');
    try {
      const defaults = [
        { icon: '📢', text: 'Welcome to **Asgard** — The ultimate esports platform for the **Aurory Community**! 🎮🔴' },
        { icon: '⚔️', text: 'New **Swiss Triad Drafts** are now live! Test your strategy in the latest competitive formats.' },
        { icon: '🎁', text: 'Join our **Official Discord** for tournament announcements and exclusive giveaways! 🚀' }
      ];

      const batch = writeBatch(db);
      defaults.forEach(item => {
        const newDocRef = doc(collection(db, 'settings'));
        batch.set(newDocRef, {
          ...item,
          type: 'ticker_announcement',
          createdBy: user.uid,
          author: {
            name: user.displayName || user.email?.split('@')[0] || 'Admin',
            uid: user.uid
          },
          createdAt: serverTimestamp()
        });
      });

      await batch.commit();
      alert('✅ Default announcements restored successfully!');

      logActivity({
        user,
        type: 'ADMIN',
        action: 'restore_ticker_defaults',
        metadata: { count: defaults.length }
      });
    } catch (error) {
      console.error('Error restoring defaults:', error);
      alert('Error: ' + error.message);
    } finally {
      setProcessingId(null);
    }
  };

  // Process withdrawal (approve/reject)
  const processWithdrawal = async (withdrawalId, action) => {
    const txSig = approvalTxSignature[withdrawalId] || '';

    if (action === 'approve' && !txSig) {
      alert('Please enter the transaction signature after sending AURY');
      return;
    }

    setProcessingId(withdrawalId);

    try {
      const withdrawal = pendingWithdrawals.find(w => w.id === withdrawalId);
      if (!withdrawal) return;

      const withdrawalRef = doc(db, 'withdrawals', withdrawalId);
      const walletRef = doc(db, 'wallets', withdrawal.userId);

      if (action === 'approve') {
        // APPROVE: Just update withdrawal status (balance already deducted)
        await updateDoc(withdrawalRef, {
          status: 'completed',
          txSignature: txSig,
          processedBy: getUserEmail(user) || user.displayName || user.uid,
          processedAt: serverTimestamp()
        });

        // Update transaction history to completed
        const txRef = collection(db, 'wallets', withdrawal.userId, 'transactions');
        await addDoc(txRef, {
          type: 'withdrawal',
          amount: withdrawal.amount,
          currency: withdrawal.currency || 'AURY',
          walletAddress: withdrawal.walletAddress,
          txSignature: txSig,
          timestamp: serverTimestamp(),
          status: 'completed'
        });

        setApprovalTxSignature(prev => ({ ...prev, [withdrawalId]: '' }));
        alert('Withdrawal approved and processed!');

        // Notify User
        await createNotification(withdrawal.userId, {
          type: 'withdrawal',
          title: 'Withdrawal Approved',
          message: `Your withdrawal has been approved. You should receive ${formatAmount(withdrawal.netAmount || (withdrawal.amount * 0.975), withdrawal.currency)} ${withdrawal.currency || 'AURY'} (after 2.5% tax).`,
          link: '#'
        });
        // Award points for withdrawal (+10)
        await awardPoints(withdrawal.userId, 10, 'withdrawal', `${withdrawal.currency || 'AURY'} Withdrawal completed`);

      } else {
        // REJECT: Refund the balance to the user
        await runTransaction(db, async (transaction) => {
          const walletDoc = await transaction.get(walletRef);

          if (!walletDoc.exists()) {
            throw new Error('User wallet not found');
          }

          const currentBalance = withdrawal.currency === 'USDC' 
            ? (walletDoc.data().usdcBalance || 0) 
            : (walletDoc.data().balance || 0);

          // Refund the withdrawal amount
          const updateData = {
            updatedAt: serverTimestamp()
          };
          if (withdrawal.currency === 'USDC') {
            updateData.usdcBalance = currentBalance + withdrawal.amount;
          } else {
            updateData.balance = currentBalance + withdrawal.amount;
          }

          transaction.update(walletRef, updateData);

          // Update withdrawal status
          transaction.update(withdrawalRef, {
            status: 'rejected',
            processedBy: getUserEmail(user) || user.displayName || user.uid,
            processedAt: serverTimestamp()
          });
        });

        // Add refund transaction to history
        const txRef = collection(db, 'wallets', withdrawal.userId, 'transactions');
        await addDoc(txRef, {
          type: 'withdrawal_rejected_refund',
          amount: withdrawal.amount,
          currency: withdrawal.currency || 'AURY',
          walletAddress: withdrawal.walletAddress,
          reason: 'Rejected by admin - balance refunded',
          timestamp: serverTimestamp()
        });

        alert('Withdrawal rejected and refunded to user.');

        // Notify User
        await createNotification(withdrawal.userId, {
          type: 'withdrawal',
          title: 'Withdrawal Rejected',
          message: `Your withdrawal of ${formatAmount(withdrawal.amount, withdrawal.currency)} ${withdrawal.currency || 'AURY'} (before tax) was rejected. Balance has been refunded.`,
          link: '#'
        });
      }

      logActivity({
        user,
        type: 'ADMIN',
        action: `withdrawal_${action}`,
        metadata: { withdrawalId, amount: withdrawal.amount, userId: withdrawal.userId }
      });

    } catch (error) {
      console.error('Process withdrawal error:', error);
      alert('Error processing withdrawal: ' + error.message);
    }

    setProcessingId(null);
  };

  // Process deposit notification (credit user balance)
  const processDepositNotification = async (notificationId, userId, amountVal, currency = 'AURY') => {
    setProcessingId(notificationId);

    try {
      // Determine decimals based on currency
      const decimals = currency === 'USDC' ? 1e6 : 1e9;
      const amountInSmallestUnit = Math.floor(parseFloat(amountVal) * decimals);

      if (isNaN(amountInSmallestUnit) || amountInSmallestUnit <= 0) {
        alert('Invalid amount');
        return;
      }

      const walletRef = doc(db, 'wallets', userId);
      const notificationRef = doc(db, 'depositNotifications', notificationId);

      // Use transaction to atomically update wallet and notification
      await runTransaction(db, async (transaction) => {
        const walletDoc = await transaction.get(walletRef);

        let currentBalance = 0;
        if (walletDoc.exists()) {
          currentBalance = currency === 'USDC' 
            ? (walletDoc.data().usdcBalance || 0) 
            : (walletDoc.data().balance || 0);
        }

        // Update or create wallet with new balance
        const updateData = {
          updatedAt: serverTimestamp()
        };
        if (currency === 'USDC') {
          updateData.usdcBalance = currentBalance + amountInSmallestUnit;
        } else {
          updateData.balance = currentBalance + amountInSmallestUnit;
        }

        transaction.set(walletRef, updateData, { merge: true });

        // Mark notification as processed
        transaction.update(notificationRef, {
          status: 'processed',
          processedBy: getUserEmail(user) || user.displayName || user.uid,
          processedAt: serverTimestamp()
        });
      });

      // Add deposit transaction to user's history
      const txRef = collection(db, 'wallets', userId, 'transactions');
      await addDoc(txRef, {
        type: 'deposit',
        amount: amountInSmallestUnit,
        currency: currency,
        timestamp: serverTimestamp(),
        processedBy: getUserEmail(user) || user.displayName || user.uid
      });

      alert(`✅ Successfully credited ${amountVal} ${currency} to user!`);

      // Notify User
      await createNotification(userId, {
        type: 'deposit',
        title: 'Deposit Credited',
        message: `Your deposit of ${amountVal} ${currency} has been verified and credited!`,
        link: '#'
      });

      // Award points for deposit (+10)
      await awardPoints(userId, 10, 'deposit', `${currency} Deposit verified`);
      logActivity({
        user,
        type: 'ADMIN',
        action: 'deposit_approve',
        metadata: { notificationId, userId, amount: amountVal }
      });

    } catch (error) {
      console.error('Process deposit notification error:', error);
      alert('Error processing deposit: ' + error.message);
    }

    setProcessingId(null);
  };

  // Dismiss deposit notification without crediting
  const dismissDepositNotification = async (notificationId) => {
    if (!window.confirm('Are you sure you want to dismiss this notification without crediting?')) {
      return;
    }

    setProcessingId(notificationId);

    try {
      const notificationRef = doc(db, 'depositNotifications', notificationId);
      await updateDoc(notificationRef, {
        status: 'dismissed',
        processedBy: getUserEmail(user) || user.displayName || user.uid,
        processedAt: serverTimestamp()
      });

      logActivity({
        user,
        type: 'ADMIN',
        action: 'deposit_reject',
        metadata: { notificationId }
      });

      alert('Notification dismissed.');
    } catch (error) {
      console.error('Dismiss notification error:', error);
      alert('Error dismissing notification: ' + error.message);
    }

    setProcessingId(null);
  };

  // Handle credit (BULK)
  const handleManualCredit = async () => {
    const amount = parseFloat(creditAmount);
    if (isNaN(amount) || amount <= 0) {
      alert('Please enter a valid amount');
      return;
    }

    if (selectedCreditUsers.length === 0) {
      alert('Please select at least one user');
      return;
    }

    if (!window.confirm(`Are you sure you want to credit ${amount} ${selectedCreditCurrency} to ${selectedCreditUsers.length} users?`)) {
      return;
    }

    setProcessingId('credit');

    try {
      // Smallest unit based on currency
      const isValcoins = selectedCreditCurrency === 'Valcoins';
      const decimals = selectedCreditCurrency === 'USDC' ? 1e6 : (isValcoins ? 1 : 1e9);
      const amountInSmallestUnit = isValcoins ? Math.floor(amount) : Math.floor(amount * decimals);

      // Process each user
      const results = await Promise.allSettled(selectedCreditUsers.map(async (selectedUser) => {
        const walletRef = doc(db, 'wallets', selectedUser.id);
        const userRef = doc(db, 'users', selectedUser.id);

        await runTransaction(db, async (transaction) => {
          const walletDoc = await transaction.get(walletRef);

          let currentBalance = 0;
          if (walletDoc.exists()) {
            currentBalance = selectedCreditCurrency === 'USDC' 
              ? (walletDoc.data().usdcBalance || 0) 
              : (walletDoc.data().balance || 0);
          }

          const updateData = {
            updatedAt: serverTimestamp()
          };
          
          if (isValcoins) {
            updateData.points = increment(amountInSmallestUnit);
            transaction.update(userRef, updateData);
          } else {
            if (selectedCreditCurrency === 'USDC') {
              updateData.usdcBalance = currentBalance + amountInSmallestUnit;
            } else {
              updateData.balance = currentBalance + amountInSmallestUnit;
            }
            transaction.set(walletRef, updateData, { merge: true });
          }
        });

        // Add transaction to user's history
        if (isValcoins) {
          await addDoc(collection(db, 'users', selectedUser.id, 'pointsHistory'), {
            amount: amountInSmallestUnit,
            type: 'manual_credit',
            description: creditReason || 'Valcoins credited by admin',
            timestamp: serverTimestamp()
          });
        } else {
          const txRef = collection(db, 'wallets', selectedUser.id, 'transactions');
          await addDoc(txRef, {
            type: 'deposit',
            amount: amountInSmallestUnit,
            currency: selectedCreditCurrency,
            reason: creditReason || 'Credit by admin',
            timestamp: serverTimestamp(),
            processedBy: getUserEmail(user) || user.displayName || user.uid
          });
        }

        // Notify User
        await createNotification(selectedUser.id, {
          type: isValcoins ? 'points' : 'deposit',
          title: isValcoins ? 'Valcoins Awarded!' : 'Balance Notification',
          message: `${amount} ${selectedCreditCurrency} has been added to your account.`,
          link: '#'
        });

      }));

      const succeeded = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      if (failed === 0) {
        alert(`✅ Successfully credited ${amount} ${selectedCreditCurrency} to ${succeeded} users!`);
      } else {
        alert(`⚠️ Processed with some issues: ${succeeded} succeeded, ${failed} failed. Check console.`);
      }

      logActivity({
        user,
        type: 'ADMIN',
        action: 'manual_credit',
        metadata: {
          amount,
          userCount: selectedCreditUsers.length,
          reason: creditReason
        }
      });

      setSelectedCreditUsers([]);
      setCreditAmount('');
      setCreditReason('');
      setIsSelectingCreditUser(false);

    } catch (error) {
      console.error('Bulk credit error:', error);
      alert('Error crediting balance: ' + error.message);
    }

    setProcessingId(null);
  };

  // Handle deduction (BULK)
  const handleManualDeduct = async () => {
    const amount = parseFloat(deductAmount);
    if (isNaN(amount) || amount <= 0) {
      alert('Please enter a valid amount');
      return;
    }

    if (selectedDeductUsers.length === 0) {
      alert('Please select at least one user');
      return;
    }

    if (!window.confirm(`Are you sure you want to deduct ${amount} ${selectedDeductCurrency} from ${selectedDeductUsers.length} users?`)) {
      return;
    }

    setProcessingId('deduct');

    try {
      // Smallest unit based on currency
      const isValcoins = selectedDeductCurrency === 'Valcoins';
      const decimals = selectedDeductCurrency === 'USDC' ? 1e6 : (isValcoins ? 1 : 1e9);
      const amountInSmallestUnit = isValcoins ? Math.floor(amount) : Math.floor(amount * decimals);

      // PRE-CHECK: Fetch all user data first to check for potential negative balances
      const preCheckResults = await Promise.all(selectedDeductUsers.map(async (selectedUser) => {
          const walletSnap = await getDoc(doc(db, 'wallets', selectedUser.id));
          const userSnap = await getDoc(doc(db, 'users', selectedUser.id));
          
          let currentBalance = 0;
          if (isValcoins) {
              currentBalance = userSnap.exists() ? (userSnap.data().points || 0) : 0;
          } else {
              if (!walletSnap.exists()) return { user: selectedUser, error: 'Wallet not found' };
              currentBalance = selectedDeductCurrency === 'USDC' 
                  ? (walletSnap.data().usdcBalance || 0) 
                  : (walletSnap.data().balance || 0);
          }
          
          return { user: selectedUser, insufficient: currentBalance < amountInSmallestUnit, currentBalance };
      }));

      const insufficientUsers = preCheckResults.filter(r => r.insufficient);
      if (insufficientUsers.length > 0) {
          const names = insufficientUsers.map(r => r.user.displayName || r.user.email).join(', ');
          if (!window.confirm(`The following users have insufficient balance for this deduction: ${names}.\n\nProceeding will result in negative balances. Continue?`)) {
              setProcessingId(null);
              return;
          }
      }

      // Process each user
      const results = await Promise.allSettled(selectedDeductUsers.map(async (selectedUser) => {
        const walletRef = doc(db, 'wallets', selectedUser.id);
        const userRef = doc(db, 'users', selectedUser.id);

        await runTransaction(db, async (transaction) => {
          const userDoc = await transaction.get(userRef);
          
          // Only get wallet if not Valcoins
          let currentBalance = 0;
          if (isValcoins) {
            currentBalance = userDoc.exists() ? (userDoc.data().points || 0) : 0;
          } else {
            const walletDoc = await transaction.get(walletRef);
            if (!walletDoc.exists()) throw new Error('User wallet not found');
            const data = walletDoc.data();
            currentBalance = selectedDeductCurrency === 'USDC' ? (data.usdcBalance || 0) : (data.balance || 0);
          }

          const updateData = {
            updatedAt: serverTimestamp()
          };
          
          if (isValcoins) {
            updateData.points = currentBalance - amountInSmallestUnit;
            transaction.set(userRef, updateData, { merge: true });
          } else {
            if (selectedDeductCurrency === 'USDC') {
              updateData.usdcBalance = currentBalance - amountInSmallestUnit;
            } else {
              updateData.balance = currentBalance - amountInSmallestUnit;
            }
            transaction.update(walletRef, updateData);
          }
        });

        // Add transaction to user's history
        if (isValcoins) {
          await addDoc(collection(db, 'users', selectedUser.id, 'pointsHistory'), {
            amount: -amountInSmallestUnit,
            type: 'manual_deduction',
            description: deductReason || 'Valcoins deducted by admin',
            timestamp: serverTimestamp()
          });
        } else {
          const txRef = collection(db, 'wallets', selectedUser.id, 'transactions');
          await addDoc(txRef, {
            type: 'withdrawal',
            amount: amountInSmallestUnit,
            currency: selectedDeductCurrency,
            reason: deductReason || 'Balance Adjustment by Admin',
            timestamp: serverTimestamp(),
            processedBy: getUserEmail(user) || user.displayName || user.uid,
            status: 'completed'
          });
        }

        // Notify User
        await createNotification(selectedUser.id, {
          type: isValcoins ? 'points' : 'withdrawal',
          title: isValcoins ? 'Valcoins Deduction' : 'Balance Notification',
          message: isValcoins ? 'Your Valcoin has been adjusted.' : `${amount} ${selectedDeductCurrency} has been deducted from your account.`,
          link: '#'
        });
      }));

      const succeeded = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      if (failed === 0) {
        alert(`✅ Successfully deducted ${amount} ${selectedDeductCurrency} from ${succeeded} users!`);
      } else {
        alert(`⚠️ Processed with some issues: ${succeeded} succeeded, ${failed} failed. Check console.`);
        console.error('Deduction failures:', results.filter(r => r.status === 'rejected'));
      }

      logActivity({
        user,
        type: 'ADMIN',
        action: 'manual_deduct',
        metadata: {
          amount,
          userCount: selectedDeductUsers.length,
          reason: deductReason
        }
      });

      setSelectedDeductUsers([]);
      setDeductAmount('');
      setDeductReason('');
      setIsSelectingDeductUser(false);

    } catch (error) {
      console.error('Bulk deduction error:', error);
      alert('Error deducting balance: ' + error.message);
    }

    setProcessingId(null);
  };

  // Handle broadcast notification
  const handleSendBroadcast = async () => {
    if (!notifyTitle || !notifyMessage) {
      alert('Please enter both a title and a message');
      return;
    }

    if (selectedNotifyUsers.length === 0) {
      alert('Please select at least one user');
      return;
    }

    if (!window.confirm(`Send this notification to ${selectedNotifyUsers.length} users?`)) {
      return;
    }

    setProcessingId('broadcast');

    try {
      // Process each user
      const results = await Promise.allSettled(selectedNotifyUsers.map(async (selectedUser) => {
        await createNotification(selectedUser.id, {
          type: 'announcement',
          title: notifyTitle,
          message: notifyMessage,
          link: '#'
        });
      }));

      const succeeded = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      if (failed === 0) {
        alert(`✅ Successfully sent notification to ${succeeded} users!`);
      } else {
        alert(`⚠️ Processed with some issues: ${succeeded} succeeded, ${failed} failed.`);
      }

      logActivity({
        user,
        type: 'ADMIN',
        action: 'broadcast_notification',
        metadata: {
          title: notifyTitle,
          message: notifyMessage,
          userCount: selectedNotifyUsers.length
        }
      });

      setSelectedNotifyUsers([]);
      setNotifyTitle('');
      setNotifyMessage('');
      setIsSelectingNotifyUser(false);

    } catch (error) {
      console.error('Broadcast error:', error);
      alert('Error sending notification: ' + error.message);
    }

    setProcessingId(null);
  };

  // Fetch global activity logs
  const fetchGlobalLogs = async () => {
    if (!isSuperAdminUser) return;
    setLogsLoading(true);
    setLogsError(null);
    try {
      const logsRef = collection(db, 'activity_logs');
      const q = query(logsRef, orderBy('timestamp', 'desc'), limit(100)); // Limit to most recent 100
      const snapshot = await getDocs(q);
      const logs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setGlobalLogs(logs);
    } catch (error) {
      console.error('Error fetching global logs:', error);
      setLogsError('Error fetching logs: ' + error.message);
    } finally {
      setLogsLoading(false);
    }
  };

  // Fetch per-user activity logs
  const fetchUserLogs = async (userId) => {
    if (!isSuperAdminUser) return;
    setLogsLoading(true);
    setLogsError(null);
    try {
      const logsRef = collection(db, 'activity_logs');
      const q = query(
        logsRef,
        where('userId', '==', userId),
        orderBy('timestamp', 'desc')
      );
      const snapshot = await getDocs(q);
      const logs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setUserLogs(logs);
    } catch (error) {
      console.error('Error fetching user logs:', error);
      setLogsError('Error fetching user logs: ' + error.message);
    } finally {
      setLogsLoading(false);
    }
  };

  // Clear all activity logs (Super Admin only)
  const clearActivityLogs = async () => {
    if (!isSuperAdminUser) return;
    if (!window.confirm('CRITICAL: Are you sure you want to permanently delete ALL activity logs? This cannot be undone.')) {
      return;
    }

    setProcessingId('clear_logs');
    try {
      const logsRef = collection(db, 'activity_logs');
      const snapshot = await getDocs(logsRef);

      if (snapshot.empty) {
        alert('No logs to clear.');
        return;
      }

      const batch = writeBatch(db);
      snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });

      await batch.commit();
      setGlobalLogs([]);
      alert('✅ All activity logs cleared successfully.');

      logActivity({
        user,
        type: 'ADMIN',
        action: 'clear_all_logs',
        metadata: { count: snapshot.docs.length }
      });
    } catch (error) {
      console.error('Error clearing logs:', error);
      alert('Error clearing logs: ' + error.message);
    } finally {
      setProcessingId(null);
    }
  };

  // Clear all transaction history (Super Admin only)
  const clearTransactionHistory = async () => {
    if (!isSuperAdminUser) return;
    if (!window.confirm('CRITICAL: Are you sure you want to permanently delete ALL transaction history? This includes processed withdrawals, deposits, and adjustment logs. This cannot be undone.')) {
      return;
    }

    setProcessingId('clear_history');
    try {
      const batch = writeBatch(db);
      let totalDeleted = 0;

      // 1. Withdrawals
      const withdrawalsRef = collection(db, 'withdrawals');
      const wSnap = await getDocs(query(withdrawalsRef, where('status', 'in', ['completed', 'rejected'])));
      wSnap.forEach(doc => {
        batch.delete(doc.ref);
        totalDeleted++;
      });

      // 2. Deposit Notifications
      const depositsRef = collection(db, 'depositNotifications');
      const dSnap = await getDocs(query(depositsRef, where('status', 'in', ['processed', 'dismissed'])));
      dSnap.forEach(doc => {
        batch.delete(doc.ref);
        totalDeleted++;
      });

      // 3. Adjustment Logs (subset of activity logs)
      const logsRef = collection(db, 'activity_logs');
      const lSnap = await getDocs(query(
        logsRef, 
        where('type', '==', 'ADMIN'), 
        where('action', 'in', ['manual_credit', 'manual_deduct'])
      ));
      lSnap.forEach(doc => {
        batch.delete(doc.ref);
        totalDeleted++;
      });

      if (totalDeleted === 0) {
        alert('No history to clear.');
        return;
      }

      await batch.commit();
      setProcessedWithdrawals([]);
      setProcessedDeposits([]);
      setManualAdjustmentLogs([]);
      
      alert(`✅ Successfully cleared ${totalDeleted} history records.`);

      logActivity({
        user,
        type: 'ADMIN',
        action: 'clear_transaction_history',
        metadata: { count: totalDeleted }
      });
    } catch (error) {
      console.error('Error clearing history:', error);
      alert('Error clearing history: ' + error.message);
    } finally {
      setProcessingId(null);
    }
  };

  // Format timestamp
  const formatTime = (timestamp) => {
    if (!timestamp) return 'N/A';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (authLoading || loading) {
    return <LoadingScreen fullScreen message="Accessing Admin Panel..." />;
  }

  if (!isAdminUser) {
    return (
      <div className="admin-wallet-denied">
        <h2>🚫 Access Denied</h2>
        <p>You don't have permission to access this page.</p>
        <button className="back-btn" onClick={() => navigate('/')}>
          ← Back to Home
        </button>
      </div>
    );
  }

  return (
    <div className="admin-wallet">
      <div className="admin-wallet-header">
        <button className="back-btn" onClick={() => navigate('/')}>
          ← Back
        </button>
        <h1>Admin Panel</h1>
      </div>

      {isSuperAdminUser && (depositNotifications.length > 0 || pendingWithdrawals.length > 0) && (
        <div className="admin-notification-alert">
          <div className="alert-content">
            <span className="alert-icon">⚠️</span>
            <div className="alert-text">
              <strong>Action Required:</strong> You have {depositNotifications.length > 0 && <span>{depositNotifications.length} pending deposit{depositNotifications.length > 1 ? 's' : ''}</span>}
              {depositNotifications.length > 0 && pendingWithdrawals.length > 0 && ' and '}
              {pendingWithdrawals.length > 0 && <span>{pendingWithdrawals.length} withdrawal request{pendingWithdrawals.length > 1 ? 's' : ''}</span>}
              {' '}awaiting review.
            </div>
          </div>
        </div>
      )}

      <div className="admin-layout">
        <div className="admin-sidebar">
          {/* Balance Category */}
          {isGeneralAdmin && (
          <div className={`admin-category ${expandedCategory === 'balance' ? 'expanded' : ''}`}>
            <div
              className="category-title"
              onClick={() => {
                console.log('Toggling balance. Current:', expandedCategory);
                setExpandedCategory(expandedCategory === 'balance' ? '' : 'balance');
              }}
              role="button"
              tabIndex={0}
            >
              <h3>Balance</h3>
              <span className="category-arrow">▼</span>
            </div>
            <div className="category-tabs">
              {isSuperAdminUser && (
                <>
                  <button
                    className={`admin-tab ${activeTab === 'credit' ? 'active' : ''}`}
                    onClick={() => setActiveTab('credit')}
                  >
                    💰 Manual Credit
                  </button>
                  <button
                    className={`admin-tab ${activeTab === 'deduct' ? 'active' : ''}`}
                    onClick={() => setActiveTab('deduct')}
                  >
                    📉 Deductions
                  </button>
                </>
              )}
              <button
                className={`admin-tab ${activeTab === 'manage_valcoins' ? 'active' : ''}`}
                onClick={() => setActiveTab('manage_valcoins')}
              >
                🛡️ Manage Valcoins
              </button>
            </div>
          </div>
          )}

          {/* Transactions Category */}
          {isGeneralAdmin && (
          <div className={`admin-category ${expandedCategory === 'transactions' ? 'expanded' : ''}`}>
            <div
              className="category-title"
              onClick={() => setExpandedCategory(expandedCategory === 'transactions' ? '' : 'transactions')}
              role="button"
              tabIndex={0}
            >
              <h3>
                Transactions
                {(depositNotifications.length + pendingWithdrawals.length) > 0 && (
                  <span className="category-badge">
                    {depositNotifications.length + pendingWithdrawals.length}
                  </span>
                )}
              </h3>
              <span className="category-arrow">▼</span>
            </div>
            <div className="category-tabs">
              <button
                className={`admin-tab ${activeTab === 'deposits' ? 'active' : ''}`}
                onClick={() => setActiveTab('deposits')}
              >
                📬 Deposits {depositNotifications.length > 0 && <span className="tab-badge">{depositNotifications.length}</span>}
              </button>
              <button
                className={`admin-tab ${activeTab === 'withdrawals' ? 'active' : ''}`}
                onClick={() => setActiveTab('withdrawals')}
              >
                📤 Withdrawals {pendingWithdrawals.length > 0 && <span className="tab-badge">{pendingWithdrawals.length}</span>}
              </button>
              <button
                className={`admin-tab ${activeTab === 'history' ? 'active' : ''}`}
                onClick={() => setActiveTab('history')}
              >
                📜 History
              </button>
              {isSuperAdminUser && (
                <button
                  className={`admin-tab ${activeTab === 'payouts' ? 'active' : ''}`}
                  onClick={() => setActiveTab('payouts')}
                >
                  💰 Manual Payouts
                </button>
              )}
            </div>
          </div>
          )}

          {/* Campaigns Category */}
          {isGeneralAdmin && (
          <div className={`admin-category ${expandedCategory === 'campaigns' ? 'expanded' : ''}`}>
            <div
              className="category-title"
              onClick={() => setExpandedCategory(expandedCategory === 'campaigns' ? '' : 'campaigns')}
              role="button"
              tabIndex={0}
            >
              <h3>Campaigns</h3>
              <span className="category-arrow">▼</span>
            </div>
            <div className="category-tabs">
              <button
                className={`admin-tab ${activeTab === 'banners' ? 'active' : ''}`}
                onClick={() => setActiveTab('banners')}
              >
                🖼️ Homepage Banners
              </button>
              <button
                className={`admin-tab ${activeTab === 'notify' ? 'active' : ''}`}
                onClick={() => setActiveTab('notify')}
              >
                📢 Notifications
              </button>
              <button
                className={`admin-tab ${activeTab === 'ticker' ? 'active' : ''}`}
                onClick={() => setActiveTab('ticker')}
              >
                🎊 Ticker Announcements
              </button>
              <button
                className={`admin-tab ${activeTab === 'campaigns' ? 'active' : ''}`}
                onClick={() => setActiveTab('campaigns')}
              >
                📣 Major Announcement
              </button>
              <button
                className={`admin-tab ${activeTab === 'news' ? 'active' : ''}`}
                onClick={() => setActiveTab('news')}
              >
                📰 News
              </button>
            </div>
          </div>
          )}

          {/* Games Category (Super Admin & Games Manager) */}
          {(isSuperAdminUser || isGamesManagerUser) && (
            <div className={`admin-category ${expandedCategory === 'games' ? 'expanded' : ''}`}>
              <div
                className="category-title"
                onClick={() => setExpandedCategory(expandedCategory === 'games' ? '' : 'games')}
                role="button"
                tabIndex={0}
              >
                <h3>Games</h3>
                <span className="category-arrow">▼</span>
              </div>
              <div className="category-tabs">
                <button
                  className={`admin-tab ${activeTab === 'mini_games' ? 'active' : ''}`}
                  onClick={() => setActiveTab('mini_games')}
                >
                  🎮 Mini-Games Management
                </button>
                <button
                  className={`admin-tab ${activeTab === 'mini_game_history' ? 'active' : ''}`}
                  onClick={() => setActiveTab('mini_game_history')}
                >
                  🏆 Earners & Plays
                </button>
              </div>
            </div>
          )}

          {/* Website Management Category */}
          {isGeneralAdmin && (
          <div className={`admin-category ${expandedCategory === 'website' ? 'expanded' : ''}`}>
            <div
              className="category-title"
              onClick={() => setExpandedCategory(expandedCategory === 'website' ? '' : 'website')}
              role="button"
              tabIndex={0}
            >
              <h3>Website</h3>
              <span className="category-arrow">▼</span>
            </div>
            <div className="category-tabs">
              <button
                className={`admin-tab ${activeTab === 'website_mgmt' ? 'active' : ''}`}
                onClick={() => setActiveTab('website_mgmt')}
              >
                🌐 Website Management
              </button>
            </div>
          </div>
          )}

          {/* User Management Category */}
          {isGeneralAdmin && (
          <div className={`admin-category ${expandedCategory === 'users' ? 'expanded' : ''}`}>
            <div
              className="category-title"
              onClick={() => setExpandedCategory(expandedCategory === 'users' ? '' : 'users')}
              role="button"
              tabIndex={0}
            >
              <h3>User Management</h3>
              <span className="category-arrow">▼</span>
            </div>
            <div className="category-tabs">
              {isAdminUser && (
                <button
                  className={`admin-tab ${activeTab === 'users' ? 'active' : ''}`}
                  onClick={() => setActiveTab('users')}
                >
                  👥 Users
                </button>
              )}
              {isAdminUser && (
                <button
                  className={`admin-tab ${activeTab === 'visitors' ? 'active' : ''}`}
                  onClick={() => setActiveTab('visitors')}
                >
                  🌐 Visitors {onlineVisitors.length > 0 && <span className="tab-badge inline">{onlineVisitors.length}</span>}
                </button>
              )}
              {isSuperAdminUser && (
                <button
                  className={`admin-tab ${activeTab === 'activity' ? 'active' : ''}`}
                  onClick={() => {
                    setActiveTab('activity');
                    fetchGlobalLogs();
                  }}
                >
                  📊 Activity Logs
                </button>
              )}
              {isSuperAdminUser && (
                <button
                  className={`admin-tab ${activeTab === 'walletHistory' ? 'active' : ''}`}
                  onClick={() => setActiveTab('walletHistory')}
                >
                  💼 Wallet History
                </button>
              )}
            </div>
          </div>
          )}
        </div>

        <div className="admin-content">
          {activeTab === 'banners' && (
            <div className="banners-management">
              <h2>🖼️ Homepage Banner Management</h2>

              <div className={`banner-form-card card ${editingBannerId ? 'editing-mode' : ''}`}>
                <h3>{editingBannerId ? 'Edit Banner' : 'Add New Banner'}</h3>
                <div className="banner-form">
                  <div className="form-group">
                    <label>Title</label>
                    <input
                      type="text"
                      value={bannerTitle}
                      onChange={(e) => setBannerTitle(e.target.value)}
                      placeholder="e.g., New Season: Crystal Caves"
                    />
                  </div>
                  <div className="form-group">
                    <label>Description</label>
                    <textarea
                      value={bannerText}
                      onChange={(e) => setBannerText(e.target.value)}
                      placeholder="Short description for the banner"
                      className="form-textarea"
                    />
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Tag (e.g., Updated, Event)</label>
                      <input
                        type="text"
                        value={bannerTag}
                        onChange={(e) => setBannerTag(e.target.value)}
                        placeholder="e.g., Updated"
                      />
                    </div>
                    <div className="form-group">
                      <label>Event Date (Optional)</label>
                      <input
                        type="text"
                        value={bannerDate}
                        onChange={(e) => setBannerDate(e.target.value)}
                        placeholder="e.g., Feb 10th - 15th"
                      />
                    </div>
                    <div className="form-group">
                      <label>Order</label>
                      <input
                        type="number"
                        value={bannerOrder}
                        onChange={(e) => setBannerOrder(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Image (URL or Upload)</label>
                    <div className="image-input-container">
                      <input
                        type="text"
                        value={bannerImage}
                        onChange={(e) => setBannerImage(e.target.value)}
                        placeholder="/amikos/ghouliath.png or external link"
                        className="flex-1"
                      />
                      <div className="file-upload-wrapper">
                        <label className="upload-btn">
                          Upload Image
                          <input type="file" accept="image/*" onChange={handleImageUpload} style={{ display: 'none' }} />
                        </label>
                      </div>
                    </div>
                    {bannerImage && bannerImage.startsWith('data:') && (
                      <div className="image-preview-mini">
                        <img src={bannerImage} alt="Uploaded preview" />
                        <button onClick={() => setBannerImage('')} type="button">Remove</button>
                      </div>
                    )}
                  </div>
                  <div className="form-group">
                    <label>Video Link (Optional - Alternative to Image)</label>
                    <input
                      type="text"
                      value={bannerVideoUrl}
                      onChange={(e) => setBannerVideoUrl(e.target.value)}
                      placeholder="https://example.com/video.mp4"
                    />
                    <p className="field-hint">If provided, the video will play as banner background instead of the image.</p>
                  </div>
                  <div className="form-group">
                    <label>External Link (Optional)</label>
                    <input
                      type="text"
                      value={bannerLink}
                      onChange={(e) => setBannerLink(e.target.value)}
                      placeholder="https://..."
                    />
                  </div>

                  {/* Social Links Section */}
                  <div className="form-group social-links-section">
                    <label>Social Links (Max 3 displayed)</label>
                    <p className="field-hint">Fill only the socials you want to show. Only the first 3 will be displayed.</p>
                    <div className="social-inputs-grid">
                      <div className="social-input-item">
                        <span className="social-icon discord">
                          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" /></svg>
                        </span>
                        <input
                          type="text"
                          value={bannerDiscord}
                          onChange={(e) => setBannerDiscord(e.target.value)}
                          placeholder="Discord invite link"
                        />
                      </div>
                      <div className="social-input-item">
                        <span className="social-icon twitter">
                          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
                        </span>
                        <input
                          type="text"
                          value={bannerTwitter}
                          onChange={(e) => setBannerTwitter(e.target.value)}
                          placeholder="X/Twitter profile link"
                        />
                      </div>
                      <div className="social-input-item">
                        <span className="social-icon twitch">
                          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" /></svg>
                        </span>
                        <input
                          type="text"
                          value={bannerTwitch}
                          onChange={(e) => setBannerTwitch(e.target.value)}
                          placeholder="Twitch channel link"
                        />
                      </div>
                      <div className="social-input-item">
                        <span className="social-icon facebook">
                          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" /></svg>
                        </span>
                        <input
                          type="text"
                          value={bannerFacebook}
                          onChange={(e) => setBannerFacebook(e.target.value)}
                          placeholder="Facebook page link"
                        />
                      </div>
                      <div className="social-input-item">
                        <span className="social-icon instagram">
                          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.899 1.382-.419.419-.824.679-1.38.896-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.569-.224-.96-.479-1.379-.899-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06l.045.03zm0 3.678c-3.405 0-6.162 2.76-6.162 6.162 0 3.405 2.76 6.162 6.162 6.162 3.405 0 6.162-2.76 6.162-6.162 0-3.405-2.76-6.162-6.162-6.162zM12 16c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm7.846-10.405c0 .795-.646 1.44-1.44 1.44-.795 0-1.44-.646-1.44-1.44 0-.794.646-1.439 1.44-1.439.793-.001 1.44.645 1.44 1.439z" /></svg>
                        </span>
                        <input
                          type="text"
                          value={bannerInstagram}
                          onChange={(e) => setBannerInstagram(e.target.value)}
                          placeholder="Instagram profile link"
                        />
                      </div>
                      <div className="social-input-item">
                        <span className="social-icon youtube">
                          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" /></svg>
                        </span>
                        <input
                          type="text"
                          value={bannerYoutube}
                          onChange={(e) => setBannerYoutube(e.target.value)}
                          placeholder="YouTube channel link"
                        />
                      </div>
                    </div>
                    {[bannerDiscord, bannerTwitter, bannerTwitch, bannerFacebook, bannerInstagram, bannerYoutube].filter(Boolean).length > 3 && (
                      <p className="field-warning">⚠️ Only the first 3 filled links will be shown on the banner.</p>
                    )}
                  </div>
                  <div className="form-actions">
                    <button
                      className={`save-banner-btn ${editingBannerId ? 'update-btn' : ''}`}
                      onClick={handleSaveBanner}
                      disabled={processingId === 'banner'}
                    >
                      {processingId === 'banner' ? 'Saving...' : editingBannerId ? 'Update Banner' : 'Add Banner'}
                    </button>
                    {editingBannerId && (
                      <button className="cancel-edit-btn" onClick={resetBannerForm}>
                        Cancel Edit
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="banners-list-card card">
                <h3>Existing Banners</h3>
                <div className="banners-grid">
                  {banners.length === 0 ? (
                    <p>No dynamic banners found. Using defaults.</p>
                  ) : (
                    banners.map(banner => {
                      // Get first 3 filled social links
                      const socialLinks = [
                        { type: 'discord', url: banner.discord },
                        { type: 'twitter', url: banner.twitter },
                        { type: 'twitch', url: banner.twitch },
                        { type: 'facebook', url: banner.facebook },
                        { type: 'instagram', url: banner.instagram },
                        { type: 'youtube', url: banner.youtube }
                      ].filter(s => s.url).slice(0, 3);

                      // Check if current user can edit/delete this banner
                      const canManage = user && (user.uid === banner.createdBy || isSuperAdminUser);

                      return (
                        <div key={banner.id} className={`banner-admin-item ${editingBannerId === banner.id ? 'being-edited' : ''}`}>
                          <div className="banner-preview" style={{ backgroundImage: `url(${banner.image})` }}>
                            <div className="banner-preview-overlay">
                              <span className="tag">{banner.tag}</span>
                              <h4>{banner.title}</h4>
                              {socialLinks.length > 0 && (
                                <div className="banner-social-icons">
                                  {socialLinks.map((s, i) => (
                                    <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className={`social-icon-btn ${s.type}`} title={s.type}>
                                      <span className={`social-svg ${s.type}`}></span>
                                    </a>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="banner-admin-info">
                            <p>{banner.text}</p>
                            {banner.date && <span className="date-tag">📅 {banner.date}</span>}
                            {banner.link && <span className="link-tag">🔗 {banner.link}</span>}
                            {canManage ? (
                              <div className="banner-admin-actions">
                                <button
                                  className="edit-banner-btn"
                                  onClick={() => handleEditBanner(banner)}
                                >
                                  Edit
                                </button>
                                <button
                                  className="delete-banner-btn"
                                  onClick={() => handleDeleteBanner(banner.id)}
                                >
                                  Delete
                                </button>
                              </div>
                            ) : (
                              <div className="banner-admin-actions">
                                <span className="ownership-notice">Created by another user</span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'ticker' && (
            <div className="ticker-management-section">
              <div className="section-header">
                <h2>🎊 Ticker Announcement Management</h2>
                <div className="header-actions">
                  <p>Manage the scrolling announcements that appear on the homepage.</p>
                  <button
                    className="secondary-btn small"
                    onClick={handleRestoreTickerDefaults}
                    disabled={processingId === 'restore_ticker_defaults'}
                  >
                    {processingId === 'restore_ticker_defaults' ? 'Restoring...' : '🔄 Restore Defaults'}
                  </button>
                </div>
              </div>

              <div className="ticker-form-card card">
                <h3>{editingTickerId ? 'Edit Announcement' : 'Add New Announcement'}</h3>
                <div className="ticker-form">
                  <div className="form-group icon-input-group">
                    <label>Icon (Emoji)</label>
                    <div className="emoji-select-wrapper">
                      <select
                        value={tickerIcon}
                        onChange={(e) => setTickerIcon(e.target.value)}
                        className="emoji-select"
                      >
                        {['📢', '⚔️', '🎁', '🥚', '🔥', '🏆', '💎', '🚀', '✨', '🎫', '🎮', '🔴'].map(emoji => (
                          <option key={emoji} value={emoji}>{emoji} {emoji === '📢' ? '(Default)' : ''}</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={tickerIcon}
                        onChange={(e) => setTickerIcon(e.target.value)}
                        placeholder="📢"
                        className="emoji-manual-input"
                        title="Manual emoji entry"
                      />
                    </div>
                  </div>

                  <div className="form-group text-input-group">
                    <label>Announcement Text</label>
                    <input
                      type="text"
                      value={tickerText}
                      onChange={(e) => setTickerText(e.target.value)}
                      placeholder="Enter announcement text..."
                    />
                  </div>

                  <div className="form-actions">
                    <button className="save-btn" onClick={handleSaveTicker}>
                      {editingTickerId ? 'Update Announcement' : 'Add Announcement'}
                    </button>
                    {editingTickerId && (
                      <button className="cancel-btn" onClick={resetTickerForm}>Cancel</button>
                    )}
                  </div>
                </div>
              </div>

              <div className="ticker-list-card card">
                <h3>Current Announcements</h3>
                {tickerLoading ? (
                  <p>Loading announcements...</p>
                ) : tickerAnnouncements.length === 0 ? (
                  <p className="empty-msg">No active announcements. Homepage will show defaults.</p>
                ) : (
                  <div className="ticker-items-list">
                    {tickerAnnouncements.map(ticker => (
                      <div key={ticker.id} className="ticker-admin-item">
                        <span className="admin-ticker-icon">{ticker.icon}</span>
                        <div className="ticker-info">
                          <p className="ticker-text">{ticker.text}</p>
                          <span className="ticker-meta">Added by {ticker.author?.name} on {formatTime(ticker.createdAt)}</span>
                        </div>
                        <div className="ticker-actions">
                          <button onClick={() => handleEditTicker(ticker)}>Edit</button>
                          <button className="delete" onClick={() => handleDeleteTicker(ticker.id)}>Delete</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'news' && (
            <div className="news-management">
              <h2>📰 News & Blog Management</h2>

              <div className={`news-form-card card ${editingNewsId ? 'editing-mode' : ''}`}>
                <h3>{editingNewsId ? 'Edit News Post' : 'Create New News Post'}</h3>
                <div className="news-form">
                  <div className="form-group">
                    <label>Title</label>
                    <input
                      type="text"
                      value={newsTitle}
                      onChange={(e) => setNewsTitle(e.target.value)}
                      placeholder="Enter a catchy title..."
                    />
                  </div>

                  <div className="form-group">
                    <label>Banner Image (Square Recommended)</label>
                    <div className="image-input-container">
                      <input
                        type="text"
                        value={newsBanner}
                        onChange={(e) => setNewsBanner(e.target.value)}
                        placeholder="Image URL or upload below..."
                        className="flex-1"
                      />
                      <div className="file-upload-wrapper">
                        <label className="upload-btn">
                          Upload Banner
                          <input type="file" accept="image/*" onChange={handleNewsBannerUpload} style={{ display: 'none' }} />
                        </label>
                      </div>
                    </div>
                    {newsBanner && (
                      <div className="image-preview-mini">
                        <img src={newsBanner} alt="Banner Preview" style={{ width: '100px', height: '100px', objectFit: 'cover', borderRadius: '8px' }} />
                        <button onClick={() => setNewsBanner('')} type="button">Remove</button>
                      </div>
                    )}
                  </div>

                  <div className="form-group">
                    <label>Video Link (Optional - Alternative to Image)</label>
                    <input
                      type="text"
                      value={newsVideoUrl}
                      onChange={(e) => setNewsVideoUrl(e.target.value)}
                      placeholder="https://example.com/video.mp4"
                    />
                    <p className="field-hint">If provided, the video will play in the detail view instead of the static banner.</p>
                  </div>

                  <div className="form-group">
                    <label>Description (Rich Text)</label>
                    <div className="rich-text-toolbar">
                      <button
                        type="button"
                        title="Bold"
                        onClick={() => {
                          const textArea = document.getElementById('news-description');
                          const start = textArea.selectionStart;
                          const end = textArea.selectionEnd;
                          const text = textArea.value;
                          const before = text.substring(0, start);
                          const selected = text.substring(start, end);
                          const after = text.substring(end);
                          setNewsDescription(before + '**' + selected + '**' + after);
                        }}
                      ><strong>B</strong></button>
                      <button
                        type="button"
                        title="Italic"
                        onClick={() => {
                          const textArea = document.getElementById('news-description');
                          const start = textArea.selectionStart;
                          const end = textArea.selectionEnd;
                          const text = textArea.value;
                          const before = text.substring(0, start);
                          const selected = text.substring(start, end);
                          const after = text.substring(end);
                          setNewsDescription(before + '_' + selected + '_' + after);
                        }}
                      ><em>I</em></button>
                      <button
                        type="button"
                        title="Add Link"
                        onClick={() => {
                          const url = prompt('Enter URL:');
                          if (url) {
                            const textArea = document.getElementById('news-description');
                            const start = textArea.selectionStart;
                            const end = textArea.selectionEnd;
                            const text = textArea.value;
                            const before = text.substring(0, start);
                            const selected = text.substring(start, end) || 'link text';
                            const after = text.substring(end);
                            setNewsDescription(before + '[' + selected + '](' + url + ')' + after);
                          }
                        }}
                      >🔗</button>
                      <button
                        type="button"
                        title="Insert Image (max 500KB, up to 3 images)"
                        onClick={() => {
                          const existingImages = (newsDescription.match(/!\[.*?\]\(.*?\)/g) || []).length;
                          if (existingImages >= 3) {
                            alert('Maximum 3 images per news post. Please remove an existing image first.');
                            return;
                          }
                          const input = document.createElement('input');
                          input.type = 'file';
                          input.accept = 'image/*';
                          input.onchange = (e) => {
                            const file = e.target.files[0];
                            if (!file) return;
                            if (file.size > 500 * 1024) {
                              alert('Image too large. Please use an image under 500KB.');
                              return;
                            }
                            const reader = new FileReader();
                            reader.onloadend = () => {
                              const img = new Image();
                              img.onload = () => {
                                const canvas = document.createElement('canvas');
                                const MAX_SIZE = 400;
                                let w = img.width, h = img.height;
                                if (w > h) { if (w > MAX_SIZE) { h = Math.round(h * MAX_SIZE / w); w = MAX_SIZE; } }
                                else { if (h > MAX_SIZE) { w = Math.round(w * MAX_SIZE / h); h = MAX_SIZE; } }
                                canvas.width = w; canvas.height = h;
                                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                                const compressed = canvas.toDataURL('image/jpeg', 0.6);
                                const textArea = document.getElementById('news-description');
                                const start = textArea.selectionStart;
                                const text = textArea.value;
                                const before = text.substring(0, start);
                                const after = text.substring(start);
                                setNewsDescription(before + '\n![image](' + compressed + ')\n' + after);
                              };
                              img.src = reader.result;
                            };
                            reader.readAsDataURL(file);
                          };
                          input.click();
                        }}
                      >📷</button>
                    </div>
                    <textarea
                      id="news-description"
                      value={newsDescription}
                      onChange={(e) => setNewsDescription(e.target.value)}
                      placeholder="Write your news content here... (Supports Markdown-like formatting)"
                      className="form-textarea news-textarea"
                      rows={12}
                    />
                  </div>

                  <div className="form-actions">
                    <button
                      className={`save-news-btn ${editingNewsId ? 'update-btn' : ''}`}
                      onClick={handleSaveNews}
                      disabled={processingId === 'news'}
                    >
                      {processingId === 'news' ? 'Saving...' : editingNewsId ? 'Update News' : 'Post News'}
                    </button>
                    {editingNewsId && (
                      <button className="cancel-edit-btn" onClick={resetNewsForm}>
                        Cancel Edit
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="news-list-card card">
                <h3>Existing News Posts</h3>
                <div className="news-grid-admin">
                  {news.length === 0 ? (
                    <p className="empty-msg">No news posts found.</p>
                  ) : (
                    news.map(post => {
                      const canManage = user && (user.uid === post.authorUid || isSuperAdminUser);
                      return (
                        <div key={post.id} className="news-admin-item">
                          <img src={post.banner} alt="" className="news-admin-banner" />
                          <div className="news-admin-content">
                            <h4>{post.title}</h4>
                            <p className="news-admin-meta">By {post.authorName} • {post.createdAt?.toDate ? post.createdAt.toDate().toLocaleDateString() : 'Just now'}</p>
                            {canManage && (
                              <div className="news-admin-actions">
                                <button onClick={() => handleEditNews(post)}>Edit</button>
                                <button className="delete" onClick={() => handleDeleteNews(post.id)}>Delete</button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'withdrawals' && (
            <div className="withdrawals-section">
              <div className="section-info">
                <p>📤 Approve or reject withdrawal requests. Send AURY to the user's wallet, then enter the TX signature.</p>
              </div>

              {loading ? (
                <LoadingScreen message="Loading withdrawals..." />
              ) : pendingWithdrawals.length === 0 ? (
                <div className="empty-state">
                  <p>✅ No pending withdrawals</p>
                </div>
              ) : (
                <div className="withdrawal-list">
                  {pendingWithdrawals.map(withdrawal => (
                    <div key={withdrawal.id} className="withdrawal-card">
                      <div className="withdrawal-header">
                        <span className="user-name">{withdrawal.userName || 'Unknown User'}</span>
                        <span className="user-email">{withdrawal.userEmail}</span>
                      </div>

                      <div className="withdrawal-details">
                        <div className="detail-row">
                          <span className="label">Requested (Gross):</span>
                          <span className="value amount">{formatAmount(withdrawal.amount, withdrawal.currency)} {withdrawal.currency || 'AURY'}</span>
                        </div>
                        <div className="detail-row tax-highlight">
                          <span className="label">Tax (2.5%):</span>
                          <span className="value">-{formatAmount(withdrawal.taxAmount || (withdrawal.amount * 0.025), withdrawal.currency)} {withdrawal.currency || 'AURY'}</span>
                        </div>
                        <div className="detail-row net-highlight">
                          <span className="label">SEND TO USER (Net):</span>
                          <span className="value received">{formatAmount(withdrawal.netAmount || (withdrawal.amount * 0.975), withdrawal.currency)} {withdrawal.currency || 'AURY'}</span>
                        </div>
                        <div className="detail-row">
                          <span className="label">Wallet Address:</span>
                          <span className="value mono">{withdrawal.walletAddress}</span>
                        </div>
                        <div className="detail-row">
                          <span className="label">Requested:</span>
                          <span className="value">{formatTime(withdrawal.createdAt)}</span>
                        </div>
                      </div>

                      <div className="withdrawal-actions">
                        <input
                          type="text"
                          placeholder={`Enter TX signature after sending ${withdrawal.currency || 'AURY'}...`}
                          value={approvalTxSignature[withdrawal.id] || ''}
                          onChange={(e) => setApprovalTxSignature(prev => ({
                            ...prev,
                            [withdrawal.id]: e.target.value
                          }))}
                          className="tx-input"
                        />
                        <div className="action-buttons">
                          <button
                            className="approve-btn"
                            onClick={() => processWithdrawal(withdrawal.id, 'approve')}
                            disabled={processingId === withdrawal.id}
                          >
                            {processingId === withdrawal.id ? '...' : '✅ Approve'}
                          </button>
                          <button
                            className="reject-btn"
                            onClick={() => processWithdrawal(withdrawal.id, 'reject')}
                            disabled={processingId === withdrawal.id}
                          >
                            ❌ Reject
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'deposits' && (
            <div className="deposits-section">
              <div className="section-info">
                <p>📬 Users notify you when they've sent deposits. Verify the transaction on-chain, then credit their balance.</p>
              </div>

              {depositError && (
                <div className="error-message" style={{
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: '8px',
                  padding: '12px',
                  marginBottom: '16px',
                  color: '#ef4444'
                }}>
                  <strong>⚠️ Error:</strong> {depositError}
                  {depositError.includes('index') && (
                    <div style={{ marginTop: '8px', fontSize: '13px' }}>
                      <strong>To fix:</strong> Go to Firebase Console → Firestore Database → Indexes →
                      Create composite index for collection "depositNotifications" with fields: status (Ascending) and createdAt (Descending)
                    </div>
                  )}
                </div>
              )}

              {loading ? (
                <LoadingScreen message="Loading deposits..." />
              ) : depositNotifications.length === 0 ? (
                <div className="empty-state">
                  <p>✅ No pending deposit notifications</p>
                </div>
              ) : (
                <div className="deposit-list">
                  {depositNotifications.map(notification => (
                    <div key={notification.id} className="deposit-card">
                      <div className="withdrawal-header">
                        <div>
                          <span className="user-name">{notification.userName || 'Unknown User'}</span>
                          <span className="user-email">{notification.userEmail}</span>
                        </div>
                      </div>

                      <div className="deposit-details">
                        <div className="detail-row">
                          <span className="label">Amount Claimed:</span>
                          <span className="value amount">{notification.amount} {notification.currency || 'AURY'}</span>
                        </div>
                        {notification.txSignature && (
                          <div className="detail-row">
                            <span className="label">TX Signature:</span>
                            <span className="value mono">
                              <a
                                href={`https://solscan.io/tx/${notification.txSignature}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="tx-link"
                              >
                                {notification.txSignature.slice(0, 20)}...
                              </a>
                            </span>
                          </div>
                        )}
                        {notification.note && (
                          <div className="detail-row">
                            <span className="label">Note:</span>
                            <span className="value">{notification.note}</span>
                          </div>
                        )}
                        <div className="detail-row">
                          <span className="label">Submitted:</span>
                          <span className="value">{formatTime(notification.createdAt)}</span>
                        </div>
                      </div>

                      <div className="withdrawal-actions">

                        <div className="action-buttons">
                          <button
                            className="approve-btn"
                            onClick={() => processDepositNotification(
                              notification.id,
                              notification.userId,
                              notification.amount,
                              notification.currency || 'AURY'
                            )}
                            disabled={processingId === notification.id}
                          >
                            {processingId === notification.id ? '...' : '✅ Credit Balance'}
                          </button>
                          <button
                            className="reject-btn"
                            onClick={() => dismissDepositNotification(notification.id)}
                            disabled={processingId === notification.id}
                          >
                            🗑️ Dismiss
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'website_mgmt' && (
            <div className="credit-section website-mgmt-section">
              <div className="section-info">
                <p>🌐 Manage global website settings, including maintenance mode and scheduled downtime.</p>
              </div>

              <div className="credit-form">
                <div className="form-group">
                  <label>Maintenance Mode</label>
                  <div className="currency-toggle-group">
                    <button 
                      className={`toggle-btn ${maintenanceEnabled ? 'active' : ''}`}
                      onClick={() => setMaintenanceEnabled(true)}
                    >ON</button>
                    <button 
                      className={`toggle-btn ${!maintenanceEnabled ? 'active' : ''}`}
                      onClick={() => setMaintenanceEnabled(false)}
                    >OFF</button>
                  </div>
                  <p className="helper-text" style={{ marginTop: '8px', fontSize: '13px', color: maintenanceEnabled ? '#ef4444' : '#10b981' }}>
                    {maintenanceEnabled 
                      ? "⚠️ Maintenance mode is ACTIVE. Non-admin users are being redirected to the maintenance page." 
                      : "✅ Website is live for all users."}
                  </p>
                </div>

                <div className="form-group">
                  <label>Scheduled Completion (UTC)</label>
                  <input
                    type="text"
                    placeholder="e.g., Oct 24, 2026 - 14:00 UTC"
                    value={maintenanceDate}
                    onChange={(e) => setMaintenanceDate(e.target.value)}
                    className="credit-input"
                    style={{ width: '100%', padding: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: 'white' }}
                  />
                  <p className="helper-text" style={{ marginTop: '4px', fontSize: '12px', color: '#94a3b8' }}>Enter the estimated time when maintenance will conclude. This will be shown to users.</p>
                </div>

                <div className="form-group">
                  <label>Announcement Message</label>
                  <textarea
                    placeholder="Enter the message to display on the maintenance page..."
                    value={maintenanceAnnouncement}
                    onChange={(e) => setMaintenanceAnnouncement(e.target.value)}
                    style={{ minHeight: '120px', resize: 'vertical', width: '100%', padding: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: 'white' }}
                  />
                  <p className="helper-text" style={{ marginTop: '4px', fontSize: '12px', color: '#94a3b8' }}>This message will be shown on the maintenance screen. Use it to provide details about the update.</p>
                </div>

                <div className="form-group" style={{ marginTop: '30px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '20px' }}>
                  <label>Maintenance Warning Banner</label>
                  <p className="helper-text" style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '15px' }}>
                    Show a pulsing red indicator at the top of all screens to warn players of upcoming maintenance.
                  </p>
                  
                  <div className="currency-toggle-group">
                    <button 
                      className={`toggle-btn ${maintenanceWarningEnabled ? 'active' : ''}`}
                      onClick={() => setMaintenanceWarningEnabled(true)}
                    >SHOW WARNING</button>
                    <button 
                      className={`toggle-btn ${!maintenanceWarningEnabled ? 'active' : ''}`}
                      onClick={() => setMaintenanceWarningEnabled(false)}
                    >HIDE WARNING</button>
                  </div>
                </div>

                <div className="form-group" style={{ display: maintenanceWarningEnabled ? 'block' : 'none' }}>
                  <label>Warning Message</label>
                  <input
                    type="text"
                    placeholder="e.g., ⚠️ Scheduled maintenance in 15 minutes. Save your games!"
                    value={maintenanceWarningText}
                    onChange={(e) => setMaintenanceWarningText(e.target.value)}
                    className="credit-input"
                    style={{ width: '100%', padding: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: 'white' }}
                  />
                  <p className="helper-text" style={{ marginTop: '4px', fontSize: '12px', color: '#94a3b8' }}>This banner will pulse red at the top of every screen when enabled.</p>
                </div>

                <button
                  className="approve-btn"
                  onClick={handleSaveMaintenance}
                  disabled={processingId === 'save_maintenance'}
                  style={{ marginTop: '30px', width: '100%' }}
                >
                  {processingId === 'save_maintenance' ? 'Saving...' : '💾 Save Website Settings'}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'credit' && isSuperAdminUser && (
            <div className="credit-section">
              <div className="section-info">
                <p>📥 Select multiple players to credit AURY or USDC simultaneously.</p>
              </div>

              <div className="form-group">
                <label>Currency</label>
                <div className="currency-toggle-group">
                  <button 
                    className={`toggle-btn ${selectedCreditCurrency === 'AURY' ? 'active' : ''}`}
                    onClick={() => setSelectedCreditCurrency('AURY')}
                  >AURY</button>
                  <button 
                    className={`toggle-btn ${selectedCreditCurrency === 'USDC' ? 'active' : ''}`}
                    onClick={() => setSelectedCreditCurrency('USDC')}
                  >USDC</button>
                  <button 
                    className={`toggle-btn ${selectedCreditCurrency === 'Valcoins' ? 'active' : ''}`}
                    onClick={() => setSelectedCreditCurrency('Valcoins')}
                  >Valcoins</button>
                </div>
              </div>

              <div className="credit-form">
                <div className="form-group bulk-selection-group">
                  <label>Select Users ({selectedCreditUsers.length})</label>
                  <div className="selected-users-list">
                    {selectedCreditUsers.map(u => (
                      <div key={u.id} className="selected-user-tag">
                        <img src={resolveAvatar(u)} alt="" />
                        <span>{resolveDisplayName(u)}</span>
                        <button
                          onClick={() => setSelectedCreditUsers(prev => prev.filter(user => user.id !== u.id))}
                          className="remove-tag"
                        >✕</button>
                      </div>
                    ))}
                    <button
                      className="add-user-btn"
                      onClick={() => setIsSelectingCreditUser(!isSelectingCreditUser)}
                    >
                      {isSelectingCreditUser ? '✕ Close' : '+ Add User'}
                    </button>
                  </div>

                  {isSelectingCreditUser && (
                    <div className="user-selection-dropdown-inline">
                      <input
                        type="text"
                        placeholder="Search by name or email..."
                        value={creditUserSearch}
                        onChange={(e) => setCreditUserSearch(e.target.value)}
                        className="search-input"
                        autoFocus
                      />
                      <div className="participants-list">
                        {allUsers
                          .filter(u =>
                            (resolveDisplayName(u).toLowerCase().includes(creditUserSearch.toLowerCase()) ||
                              u.email?.toLowerCase().includes(creditUserSearch.toLowerCase())) &&
                            !selectedCreditUsers.find(selected => selected.id === u.id)
                          )
                          .slice(0, 10)
                          .map(u => (
                            <div
                              key={u.id}
                              className="participant-item"
                              onClick={() => {
                                setSelectedCreditUsers(prev => [...prev, u]);
                                setCreditUserSearch('');
                              }}
                            >
                              <img src={resolveAvatar(u)} alt="" />
                              <div className="participant-info">
                                <span className="participant-name">{resolveDisplayName(u)}</span>
                                <span className="participant-email">{u.email}</span>
                              </div>
                              <div className="participant-balance">
                                {selectedCreditCurrency === 'Valcoins'
                                  ? `${u.points || 0} Valcoins`
                                  : (selectedCreditCurrency === 'USDC' 
                                      ? formatAmount(u.usdcBalance || 0, 'USDC') 
                                      : formatAmount(u.balance || 0, 'AURY')
                                    ) + ' ' + selectedCreditCurrency
                                }
                              </div>
                            </div>
                          ))
                        }
                      </div>
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label>Amount ({selectedCreditCurrency}) - Will be sent to EACH user</label>
                  <input
                    type="number"
                    placeholder={`Enter amount of ${selectedCreditCurrency} to send to each selected user...`}
                    value={creditAmount}
                    onChange={(e) => setCreditAmount(e.target.value)}
                    onWheel={(e) => e.target.blur()}
                    min="0"
                    step="0.01"
                  />
                </div>

                <div className="form-group">
                  <label>Note (optional)</label>
                  <input
                    type="text"
                    placeholder="e.g., Prize for tournament, special event..."
                    value={creditReason}
                    onChange={(e) => setCreditReason(e.target.value)}
                  />
                </div>

                <button
                  className="credit-btn"
                  onClick={handleManualCredit}
                  disabled={processingId === 'credit' || selectedCreditUsers.length === 0 || !creditAmount}
                >
                  {processingId === 'credit' ? 'Processing...' : `💰 Send Credit to ${selectedCreditUsers.length} Users`}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'deduct' && isSuperAdminUser && (
            <div className="credit-section deduct-section">
              <div className="section-info deduct-info">
                <p>📉 Subtract balance from users for corrections or adjustments.</p>
              </div>

              <div className="form-group">
                <label>Currency</label>
                <div className="currency-toggle-group">
                  <button 
                    className={`toggle-btn ${selectedDeductCurrency === 'AURY' ? 'active' : ''}`}
                    onClick={() => setSelectedDeductCurrency('AURY')}
                  >AURY</button>
                  <button 
                    className={`toggle-btn ${selectedDeductCurrency === 'USDC' ? 'active' : ''}`}
                    onClick={() => setSelectedDeductCurrency('USDC')}
                  >USDC</button>
                  <button 
                    className={`toggle-btn ${selectedDeductCurrency === 'Valcoins' ? 'active' : ''}`}
                    onClick={() => setSelectedDeductCurrency('Valcoins')}
                  >Valcoins</button>
                </div>
              </div>

              <div className="credit-form">
                <div className="form-group bulk-selection-group">
                  <label>Select Users ({selectedDeductUsers.length})</label>
                  <div className="selected-users-list">
                    {selectedDeductUsers.map(u => (
                      <div key={u.id} className="selected-user-tag">
                        <img src={resolveAvatar(u)} alt="" />
                        <span>{resolveDisplayName(u)}</span>
                        <button
                          onClick={() => setSelectedDeductUsers(prev => prev.filter(user => user.id !== u.id))}
                          className="remove-tag"
                        >✕</button>
                      </div>
                    ))}
                    <button
                      className="add-user-btn"
                      onClick={() => setIsSelectingDeductUser(!isSelectingDeductUser)}
                    >
                      {isSelectingDeductUser ? '✕ Close' : '+ Add User'}
                    </button>
                  </div>

                  {isSelectingDeductUser && (
                    <div className="user-selection-dropdown-inline">
                      <input
                        type="text"
                        placeholder="Search by name or email..."
                        value={deductUserSearch}
                        onChange={(e) => setDeductUserSearch(e.target.value)}
                        className="search-input"
                        autoFocus
                      />
                      <div className="participants-list">
                        {allUsers
                          .filter(u =>
                            (resolveDisplayName(u).toLowerCase().includes(deductUserSearch.toLowerCase()) ||
                              u.email?.toLowerCase().includes(deductUserSearch.toLowerCase())) &&
                            !selectedDeductUsers.find(selected => selected.id === u.id)
                          )
                          .slice(0, 10)
                          .map(u => (
                            <div
                              key={u.id}
                              className="participant-item"
                              onClick={() => {
                                setSelectedDeductUsers(prev => [...prev, u]);
                                setDeductUserSearch('');
                              }}
                            >
                              <img src={resolveAvatar(u)} alt="" />
                              <div className="participant-info">
                                <span className="participant-name">{resolveDisplayName(u)}</span>
                                <span className="participant-email">{u.email}</span>
                              </div>
                              <div className="participant-balance">
                                {selectedDeductCurrency === 'Valcoins'
                                  ? `${u.points || 0} Valcoins`
                                  : (selectedDeductCurrency === 'USDC' 
                                      ? formatAmount(u.usdcBalance || 0, 'USDC') 
                                      : formatAmount(u.balance || 0, 'AURY')
                                    ) + ' ' + selectedDeductCurrency
                                }
                              </div>
                            </div>
                          ))
                        }
                      </div>
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label>Amount ({selectedDeductCurrency}) - Will be deducted from EACH user</label>
                  <input
                    type="number"
                    placeholder={`Enter amount of ${selectedDeductCurrency} to deduct from each selected user...`}
                    value={deductAmount}
                    onChange={(e) => setDeductAmount(e.target.value)}
                    onWheel={(e) => e.target.blur()}
                    min="0"
                    step="0.01"
                  />
                </div>

                <div className="form-group">
                  <label>Reason (optional)</label>
                  <input
                    type="text"
                    placeholder="e.g., Balance correction, penalty..."
                    value={deductReason}
                    onChange={(e) => setDeductReason(e.target.value)}
                  />
                </div>

                <button
                  className="deduct-btn"
                  onClick={handleManualDeduct}
                  disabled={processingId === 'deduct' || selectedDeductUsers.length === 0 || !deductAmount}
                >
                  {processingId === 'deduct' ? 'Processing...' : `📉 Deduct balance from ${selectedDeductUsers.length} Users`}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'manage_valcoins' && (
            <div className="manage-valcoins-section">
              <div className="section-info">
                <p>⚙️ Configure the default number of Valcoins users earn globally for various activities.</p>
              </div>

              {valcoinConfigLoading ? (
                <LoadingScreen message="Loading configuration..." />
              ) : (
                <div className="credit-form">
                  <h3><img src="/valcoin-icon.jpg" alt="" className="valcoin-icon" /> Valcoin Rewards Matrix</h3>
                  
                  <div className="form-group" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginTop: '15px' }}>
                    <div className="input-group">
                      <label>Daily Check-In Default</label>
                      <input
                        type="number"
                        min="0"
                        className="credit-input"
                        value={valcoinConfig.dailyCheckIn}
                        onChange={(e) => setValcoinConfig({...valcoinConfig, dailyCheckIn: parseInt(e.target.value) || 0})}
                      />
                    </div>

                    <div className="input-group">
                      <label>Link Aurory Profile</label>
                      <input
                        type="number"
                        min="0"
                        className="credit-input"
                        value={valcoinConfig.linkAurory}
                        onChange={(e) => setValcoinConfig({...valcoinConfig, linkAurory: parseInt(e.target.value) || 0})}
                      />
                    </div>

                    <div className="input-group">
                      <label>Join a Raffle</label>
                      <input
                        type="number"
                        min="0"
                        className="credit-input"
                        value={valcoinConfig.joinRaffle}
                        onChange={(e) => setValcoinConfig({...valcoinConfig, joinRaffle: parseInt(e.target.value) || 0})}
                      />
                    </div>

                    <div className="input-group">
                      <label>Join a Tournament</label>
                      <input
                        type="number"
                        min="0"
                        className="credit-input"
                        value={valcoinConfig.joinTournament}
                        onChange={(e) => setValcoinConfig({...valcoinConfig, joinTournament: parseInt(e.target.value) || 0})}
                      />
                    </div>
                  </div>

                  <div className="action-buttons" style={{ marginTop: '30px' }}>
                    <button 
                      className="approve-btn" 
                      onClick={handleSaveValcoinConfig}
                      disabled={processingId === 'save_valcoins'}
                    >
                      {processingId === 'save_valcoins' ? 'Saving...' : '💾 Save Configuration'}
                    </button>
                    <button 
                      className="reject-btn"
                      onClick={handleRestoreValcoinDefaults}
                      disabled={processingId === 'save_valcoins'}
                    >
                      🔄 Restore Defaults
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'notify' && (
            <div className="credit-section notify-section">
              <div className="section-info">
                <p>📢 Send custom notifications/announcements to users.</p>
              </div>

              <div className="credit-form">
                <div className="form-group bulk-selection-group">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <label>Recipient Users ({selectedNotifyUsers.length})</label>
                    <button
                      className="select-all-btn"
                      onClick={() => {
                        if (selectedNotifyUsers.length === allUsers.length) {
                          setSelectedNotifyUsers([]);
                        } else {
                          setSelectedNotifyUsers([...allUsers]);
                        }
                      }}
                    >
                      {selectedNotifyUsers.length === allUsers.length ? 'Deselect All' : 'Select All Users'}
                    </button>
                  </div>

                  <div className="selected-users-list">
                    {selectedNotifyUsers.length === allUsers.length ? (
                      <div className="selected-user-tag all-tag">
                        <span>📢 ALL USERS SELECTED</span>
                      </div>
                    ) : (
                      <>
                        {selectedNotifyUsers.map(u => (
                          <div key={u.id} className="selected-user-tag">
                            <img src={resolveAvatar(u)} alt="" />
                            <span>{resolveDisplayName(u)}</span>
                            <button
                              onClick={() => setSelectedNotifyUsers(prev => prev.filter(user => user.id !== u.id))}
                              className="remove-tag"
                            >✕</button>
                          </div>
                        ))}
                        <button
                          className="add-user-btn"
                          onClick={() => setIsSelectingNotifyUser(!isSelectingNotifyUser)}
                        >
                          {isSelectingNotifyUser ? '✕ Close' : '+ Add User'}
                        </button>
                      </>
                    )}
                  </div>

                  {isSelectingNotifyUser && selectedNotifyUsers.length !== allUsers.length && (
                    <div className="user-selection-dropdown-inline">
                      <input
                        type="text"
                        placeholder="Search by name or email..."
                        value={notifyUserSearch}
                        onChange={(e) => setNotifyUserSearch(e.target.value)}
                        className="search-input"
                        autoFocus
                      />
                      <div className="participants-list">
                        {allUsers
                          .filter(u =>
                            (resolveDisplayName(u).toLowerCase().includes(notifyUserSearch.toLowerCase()) ||
                              u.email?.toLowerCase().includes(notifyUserSearch.toLowerCase())) &&
                            !selectedNotifyUsers.find(selected => selected.id === u.id)
                          )
                          .slice(0, 10)
                          .map(u => (
                            <div
                              key={u.id}
                              className="participant-item"
                              onClick={() => {
                                setSelectedNotifyUsers(prev => [...prev, u]);
                                setNotifyUserSearch('');
                              }}
                            >
                              <img src={resolveAvatar(u)} alt="" />
                              <div className="participant-info">
                                <span className="participant-name">{resolveDisplayName(u)}</span>
                                <span className="participant-email">{u.email}</span>
                              </div>
                            </div>
                          ))
                        }
                      </div>
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label>Title</label>
                  <input
                    type="text"
                    placeholder="Enter notification title..."
                    value={notifyTitle}
                    onChange={(e) => setNotifyTitle(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label>Message</label>
                  <textarea
                    placeholder="Enter message content..."
                    value={notifyMessage}
                    onChange={(e) => setNotifyMessage(e.target.value)}
                    style={{ minHeight: '120px', resize: 'vertical' }}
                    className="form-input"
                  />
                </div>

                <button
                  className="notify-admin-btn"
                  onClick={handleSendBroadcast}
                  disabled={processingId === 'broadcast' || selectedNotifyUsers.length === 0 || !notifyTitle || !notifyMessage}
                >
                  {processingId === 'broadcast' ? 'Broadcasting...' : `📢 Send Notification to ${selectedNotifyUsers.length} Users`}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'users' && isAdminUser && (
            <div className="users-assignment-section">
              {(() => {
                  const registeredUsers = allUsers.filter(u => !u.isAnonymous);
                  const totalCount = registeredUsers.length;
                  const linkedCount = registeredUsers.filter(u => u.auroryPlayerId).length;
                  const notLinkedCount = totalCount - linkedCount;

                  return (
                    <div className="section-info users-stats-header">
                      <div className="stats-grid">
                        <div className="stat-item">
                          <span className="label">Total Users</span>
                          <span className="value">{totalCount}</span>
                        </div>
                        <div className="stat-item split">
                          <div className="sub-stat linked">
                            <span className="label">🔗 Linked</span>
                            <span className="value">{linkedCount}</span>
                          </div>
                          <div className="sub-stat not-linked">
                            <span className="label">🚫 Not Linked</span>
                            <span className="value">{notLinkedCount}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
              })()}

              {/* Search Bar */}
              <div className="search-bar" style={{ marginBottom: '20px' }}>
                <input
                  type="text"
                  placeholder="🔍 Search users by name or email..."
                  value={usersSearchQuery}
                  onChange={(e) => setUsersSearchQuery(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    fontSize: '14px',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '8px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    color: 'white'
                  }}
                />
              </div>

              {isSuperAdminUser && (
                <div className="global-maintenance-row" style={{ 
                  display: 'flex', alignItems: 'center', gap: '10px', 
                  marginBottom: '20px', padding: '15px', background: 'rgba(239, 68, 68, 0.05)', 
                  borderRadius: '12px', border: '1px dashed rgba(239, 68, 68, 0.2)' 
                }}>
                  <div style={{ marginRight: '10px' }}>
                    <span style={{ color: '#ef4444', fontWeight: 'bold', fontSize: '0.85em', display: 'block' }}>🚨 Global Maintenance</span>
                    <span style={{ fontSize: '0.75em', opacity: 0.6 }}>Irreversible Platform-wide Actions</span>
                  </div>
                  <input 
                    type="text" 
                    placeholder="Type WIPE ALL to confirm" 
                    value={wipeAllConfirmText}
                    onChange={(e) => setWipeAllConfirmText(e.target.value)}
                    className="admin-compact-input"
                    style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(239,68,68,0.3)', width: '180px' }}
                  />
                  <button 
                    className="clear-btn-admin risky" 
                    onClick={clearActivityLogs}
                    disabled={isWiping || wipeAllConfirmText !== 'WIPE ALL'}
                    style={{ padding: '8px 15px', fontSize: '0.85em' }}
                  >
                    🗑️ Clear All Activity Logs
                  </button>
                  <button 
                    className="clear-btn-admin risky" 
                    onClick={handleClearAllGlobalNotifications}
                    disabled={isWiping || wipeAllConfirmText !== 'WIPE ALL'}
                    style={{ padding: '8px 15px', fontSize: '0.85em' }}
                  >
                    🔔 Clear All Notifications
                  </button>
                  <button 
                    className="clear-btn-admin risky" 
                    onClick={handleResetGlobalWallets}
                    disabled={isWiping || wipeAllConfirmText !== 'WIPE ALL'}
                    style={{ padding: '8px 15px', fontSize: '0.85em', background: 'linear-gradient(135deg, #ef4444 0%, #991b1b 100%)' }}
                  >
                    💰 Wipe All Wallet Balances
                  </button>
                  <button 
                    className="clear-btn-admin risky" 
                    onClick={() => {
                      setResetStatsWipeHistory(true);
                      setResetStatsConfirmText('RESET ALL STATS');
                      handleResetLeaderboardStats();
                    }}
                    disabled={isWiping || wipeAllConfirmText !== 'WIPE ALL'}
                    style={{ padding: '8px 15px', fontSize: '0.85em', background: 'linear-gradient(135deg, #f59e0b 0%, #b45309 100%)' }}
                  >
                    🎮 Wipe All Mini-Game Histories
                  </button>
                  <button 
                    className="clear-btn-admin risky" 
                    onClick={handleMigrateLeaderboards}
                    disabled={isWiping || wipeAllConfirmText !== 'WIPE ALL'}
                    style={{ padding: '8px 15px', fontSize: '0.85em', background: 'linear-gradient(135deg, #10b981 0%, #047857 100%)' }}
                  >
                    🚀 Migrate Leaderboards to RTDB
                  </button>
                </div>
              )}

              <div className="admin-user-list">
                <div className="user-list-header">
                  <div className="col-user">User</div>
                  <div className="col-email">Email</div>
                  <div className="col-linked">Linked</div>
                  <div className="col-holder">Holder</div>
                  <div className="col-balance">
                    <select 
                      value={userBalanceType} 
                      onChange={(e) => setUserBalanceType(e.target.value)}
                      className="balance-type-select"
                    >
                      <option value="AURY">AURY Balance</option>
                      <option value="USDC">USDC Balance</option>
                      <option value="Valcoins">Valcoins</option>
                    </select>
                  </div>
                  <div className="col-last-checkin">Last Claim</div>
                  <div className="col-streak">Streak</div>
                  <div className="col-role">Role</div>
                </div>
                <div className="user-list-body">
                  {allUsers
                    .filter(u => {
                      if (!usersSearchQuery) return true;
                      const query = usersSearchQuery.toLowerCase();
                      const name = resolveDisplayName(u).toLowerCase();
                      const email = (u.email || '').toLowerCase();
                      const isMatch = name.includes(query) || email.includes(query);
                      return isMatch && !u.isAnonymous;
                    })
                    .sort((a, b) => (isSuperAdmin(getUserEmail(a)) ? -1 : isSuperAdmin(getUserEmail(b)) ? 1 : 0))
                    .map(u => {
                      const userIsSuper = isSuperAdmin(getUserEmail(u));
                      return (
                        <div key={u.id} className={`user-list-item ${userIsSuper ? 'super-admin' : ''}`}>
                          <div className="col-user">
                            <img src={resolveAvatar(u)} alt="" />
                            <span>{resolveDisplayName(u)}</span>
                          </div>
                          <div className="col-email">{u.email}</div>
                          <div className="col-linked">
                            {u.auroryPlayerId ? (
                              <span className="linked-badge" title={`Linked to ${u.auroryPlayerName || 'Aurory Account'}`}>🔗 Yes</span>
                            ) : (
                              <span className="non-linked-badge">No</span>
                            )}
                          </div>
                          <div className="col-holder">
                            {u.isAurorian ? (
                              <span className="holder-badge" title="Aurorian NFT Holder">🛡️ Yes</span>
                            ) : (
                              <span className="non-holder-badge">No</span>
                            )}
                          </div>
                          <div className="col-balance">
                            {userBalanceType === 'AURY' && (
                              <span className="balance-aury">{formatAuryAmount(u.balance || 0)} AURY</span>
                            )}
                            {userBalanceType === 'USDC' && (
                              <span className="balance-usdc">{formatAmount(u.usdcBalance || 0, 'USDC')} USDC</span>
                            )}
                            {userBalanceType === 'Valcoins' && (
                              <span className="balance-valcoins">
                                <img src="/valcoin-icon.jpg" alt="" className="valcoin-icon-mini" /> 
                                {u.points || 0}
                              </span>
                            )}
                          </div>
                          <div className="col-last-checkin">
                            {isSuperAdminUser ? (
                              <div className="date-edit-wrapper">
                                <input
                                  type="text"
                                  placeholder="YYYY-MM-DD"
                                  defaultValue={u.lastDailyCheckIn || ''}
                                  onBlur={async (e) => {
                                    const newDate = e.target.value.trim();
                                    if (newDate === (u.lastDailyCheckIn || '')) return;
                                    // Basic validation
                                    if (newDate && !/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
                                      alert('Invalid format. Use YYYY-MM-DD');
                                      e.target.value = u.lastDailyCheckIn || '';
                                      return;
                                    }

                                    try {
                                      await updateDoc(doc(db, 'users', u.id), {
                                        lastDailyCheckIn: newDate || null,
                                        updatedAt: serverTimestamp()
                                      });
                                      setAllUsers(prev => prev.map(user => 
                                        user.id === u.id ? { ...user, lastDailyCheckIn: newDate || null } : user
                                      ));
                                    } catch (err) {
                                      console.error('Error updating check-in date:', err);
                                      alert('Update failed');
                                    }
                                  }}
                                  className="date-edit-input"
                                />
                                <button
                                  className="set-yesterday-btn"
                                  title="Set to Yesterday for testing"
                                  onClick={async () => {
                                    const yesterday = new Date();
                                    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
                                    const yesterdayStr = yesterday.toISOString().split('T')[0];
                                    
                                    try {
                                      setProcessingId(`date-${u.id}`);
                                      await updateDoc(doc(db, 'users', u.id), {
                                        lastDailyCheckIn: yesterdayStr,
                                        updatedAt: serverTimestamp()
                                      });
                                      setAllUsers(prev => prev.map(user => 
                                        user.id === u.id ? { ...user, lastDailyCheckIn: yesterdayStr } : user
                                      ));
                                      alert(`✅ Last Check-in set to ${yesterdayStr}`);
                                    } catch (err) {
                                      console.error('Error setting yesterday:', err);
                                      alert('Failed to set yesterday');
                                    } finally {
                                      setProcessingId(null);
                                    }
                                  }}
                                  disabled={processingId === `date-${u.id}`}
                                >
                                  Yesterday
                                </button>
                              </div>
                            ) : (
                              <span>{u.lastDailyCheckIn || 'Never'}</span>
                            )}
                          </div>
                          <div className="col-streak">
                            {isSuperAdminUser ? (
                              <input
                                type="number"
                                min="0"
                                defaultValue={u.checkInStreak || 0}
                                onBlur={async (e) => {
                                  const newStreak = parseInt(e.target.value);
                                  if (isNaN(newStreak) || newStreak < 0) {
                                    e.target.value = u.checkInStreak || 0;
                                    return;
                                  }
                                  if (newStreak === (u.checkInStreak || 0)) return;

                                  try {
                                    const userRef = doc(db, 'users', u.id);
                                    await updateDoc(userRef, {
                                      checkInStreak: newStreak,
                                      updatedAt: serverTimestamp()
                                    });
                                    // Update local state
                                    setAllUsers(prev => prev.map(user => 
                                      user.id === u.id ? { ...user, checkInStreak: newStreak } : user
                                    ));
                                    console.log(`✅ Streak updated for ${u.id} to ${newStreak}`);
                                  } catch (error) {
                                    console.error('Error updating streak:', error);
                                    alert('Failed to update streak');
                                    e.target.value = u.checkInStreak || 0;
                                  }
                                }}
                                className="streak-edit-input"
                                title="Edit streak (SuperAdmin only)"
                              />
                            ) : (
                              <span className="streak-value">🔥 {u.checkInStreak || 0}</span>
                            )}
                          </div>
                          <div className="col-role">
                            {userIsSuper ? (
                              <span className="badge-super">Super Admin</span>
                            ) : (
                              <div className="role-actions">
                                <select
                                  className={`role-select ${u.role === 'blocked' ? 'blocked' : ''}`}
                                  value={u.role || 'user'}
                                  onChange={async (e) => {
                                    const newRole = e.target.value;
                                    try {
                                      if (newRole === 'delete') {
                                        if (!window.confirm(`⚠️ WARNING: Are you SURE you want to permanently delete user ${resolveDisplayName(u)}? This will remove their platform profile data.`)) {
                                          e.target.value = u.role || 'user'; 
                                          return;
                                        }
                                        setProcessingId(`role-${u.id}`);
                                        await deleteDoc(doc(db, 'users', u.id));
                                        setAllUsers(prev => prev.filter(user => user.id !== u.id));
                                        alert(`✅ User gracefully deleted.`);
                                        return;
                                      }

                                      setProcessingId(`role-${u.id}`);
                                      const userRef = doc(db, 'users', u.id);
                                      await updateDoc(userRef, {
                                        role: newRole === 'user' ? null : newRole
                                      });
                                      // Update local state
                                      setAllUsers(prev => prev.map(user =>
                                        user.id === u.id ? { ...user, role: newRole === 'user' ? null : newRole } : user
                                      ));
                                      alert(`✅ Role updated for ${resolveDisplayName(u)}`);
                                    } catch (error) {
                                      console.error('Error updating role/deleting:', error);
                                      alert('Error: ' + error.message);
                                      e.target.value = u.role || 'user';
                                    } finally {
                                      setProcessingId(null);
                                    }
                                  }}
                                  disabled={processingId === `role-${u.id}`}
                                >
                                  <option value="user">User</option>
                                  <option value="games_manager">Games Manager</option>
                                  <option value="admin">Admin</option>
                                  {u.role === 'blocked' ? (
                                    <option value="user">✅ Unblock User</option>
                                  ) : (
                                    <option value="blocked">🚫 Block User</option>
                                  )}
                                  {isSuperAdminUser && <option value="delete">🗑️ Delete User</option>}
                                </select>
                                {isSuperAdminUser && (
                                  <div style={{ display: 'flex', gap: '5px' }}>
                                    <button
                                      className="manage-btn"
                                      onClick={() => {
                                        setSelectedUserForLogs(u);
                                        fetchUserLogs(u.id);
                                      }}
                                    >
                                      📊 Logs
                                    </button>
                                    <button
                                      className="manage-btn"
                                      onClick={() => {
                                        setSelectedUserForNotifications(u);
                                        fetchUserNotifications(u.id);
                                      }}
                                      style={{ background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', border: '1px solid rgba(59, 130, 246, 0.2)' }}
                                    >
                                      🔔 Alerts
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'history' && (
            <div className="history-section">
              <div className="section-info history-header-info">
                <p>📜 Comprehensive history of withdrawals, deposits, and balance adjustments (AURY, USDC, and Valcoins).</p>
                {isSuperAdminUser && (
                  <button
                    className="clear-btn-admin"
                    onClick={clearTransactionHistory}
                    disabled={processingId === 'clear_history'}
                  >
                    🗑️ {processingId === 'clear_history' ? 'Cleaning...' : 'Remove All History'}
                  </button>
                )}
              </div>

              {historyLoading ? (
                <LoadingScreen message="Loading history..." />
              ) : (
                <div className="history-grids">
                  <div className="history-block">
                    <h3>Withdrawal History</h3>
                    {processedWithdrawals.length === 0 ? (
                      <p className="empty-mini">No processed withdrawals found.</p>
                    ) : (
                      <div className="history-table-wrapper">
                        <table className="history-table">
                          <thead>
                            <tr>
                              <th>User</th>
                              <th>Amount</th>
                              <th>Status</th>
                              <th>Date</th>
                            </tr>
                          </thead>
                          <tbody>
                            {processedWithdrawals.map(w => (
                              <tr key={w.id}>
                                <td>
                                  <div className="user-cell">
                                    <span className="name">{w.userName || 'Unknown'}</span>
                                    <span className="email">{w.userEmail}</span>
                                  </div>
                                </td>
                                <td className="amount">{formatAmount(w.amount, w.currency || 'AURY')} {w.currency || 'AURY'}</td>
                                <td>
                                  <span className={`status-badge ${w.status}`}>
                                    {w.status === 'completed' ? 'Approved' : 'Rejected'}
                                  </span>
                                </td>
                                <td className="date">{formatTime(w.processedAt)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div className="history-block">
                    <h3>Deposit History</h3>
                    {processedDeposits.length === 0 ? (
                      <p className="empty-mini">No processed deposit notifications found.</p>
                    ) : (
                      <div className="history-table-wrapper">
                        <table className="history-table">
                          <thead>
                            <tr>
                              <th>User</th>
                              <th>Amount</th>
                              <th>Status</th>
                              <th>Date</th>
                            </tr>
                          </thead>
                          <tbody>
                            {processedDeposits.map(d => (
                              <tr key={d.id}>
                                <td>
                                  <div className="user-cell">
                                    <span className="name">{d.userName || 'Unknown'}</span>
                                    <span className="email">{d.userEmail}</span>
                                  </div>
                                </td>
                                <td className="amount">{d.amount} {d.currency || 'AURY'}</td>
                                <td>
                                  <span className={`status-badge ${d.status}`}>
                                    {d.status === 'processed' ? 'Credited' : 'Dismissed'}
                                  </span>
                                </td>
                                <td className="date">{d.processedAt ? formatTime(d.processedAt) : 'N/A'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div className="history-block full-width">
                    <h3>Manual Adjustments & Rewards History</h3>
                    {manualAdjustmentLogs.length === 0 ? (
                      <p className="empty-mini">No manual adjustment records found.</p>
                    ) : (
                      <div className="history-table-wrapper">
                        <table className="history-table">
                          <thead>
                            <tr>
                              <th>Action</th>
                              <th>User Count</th>
                              <th>Amount / Metadata</th>
                              <th>Date</th>
                            </tr>
                          </thead>
                          <tbody>
                            {manualAdjustmentLogs.map(log => {
                              const amount = log.metadata?.amount;
                              const currency = log.metadata?.currency || (log.action.includes('deduct') ? 'Valcoins' : 'AURY');
                              const isPointAction = currency === 'Valcoins';
                              
                              return (
                                <tr key={log.id}>
                                  <td>
                                    <span className={`action-tag ${log.action}`}>
                                      {log.action.replace('_', ' ')}
                                    </span>
                                  </td>
                                  <td>{log.metadata?.userCount || 1} users</td>
                                  <td className="amount">
                                    {isPointAction ? (
                                      <><img src="/valcoin-icon.jpg" alt="" className="valcoin-icon-mini" /> {amount}</>
                                    ) : (
                                      <>{amount} {currency}</>
                                    )}
                                  </td>
                                  <td className="date">{formatTime(log.timestamp)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}


          {activeTab === 'payouts' && isSuperAdminUser && (
            <div className="credit-section">
              <div className="section-info">
                <p>💰 Manually trigger payout for a draft. Use this ONLY if the automatic payout failed (e.g., due to API error or missing data).</p>
              </div>

              <div className="credit-form">
                <div className="form-group">
                  <label>Draft ID</label>
                  <input
                    type="text"
                    placeholder="Enter Draft ID..."
                    value={payoutDraftId}
                    onChange={(e) => setPayoutDraftId(e.target.value)}
                  />
                </div>

                <div className="form-info-box">
                  <p>⚠️ <strong>Warning:</strong> This will attempt to pay out the Overall Winner of the draft.</p>
                  <ul style={{ marginTop: '8px', paddingLeft: '20px', fontSize: '0.9em' }}>
                    <li>Ensure the draft is marked as "completed" and verified.</li>
                    <li>If it already paid out, the system will block a double payment.</li>
                    <li>The system will attempt to recover the winner UID from legacy fields if needed.</li>
                  </ul>
                </div>

                <button
                  className="credit-btn"
                  onClick={handleManualPayout}
                  disabled={payoutLoading || !payoutDraftId}
                  style={{ marginTop: '16px' }}
                >
                  {payoutLoading ? 'Processing...' : '🚀 Trigger Payout'}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'visitors' && isAdminUser && (
            <div className="visitors-section">
              <div className="section-info">
                <p>🌐 Users who visited the website in the last 3 days.</p>
              </div>

              {onlineVisitors.length === 0 ? (
                <div className="empty-state">
                  <p>👻 No visitors online right now</p>
                </div>
              ) : (
                <div className="visitors-list">
                  <div className="visitor-list-header">
                    <div className="col-user">User</div>
                    <div className="col-email">Email</div>
                    <div className="col-last-seen">Last Seen</div>
                    <div className="col-status">Status</div>
                  </div>
                  <div className="visitor-list-body">
                    {onlineVisitors.map(visitor => {
                      const lastSeenTime = visitor.lastSeen?.toMillis?.() || visitor.lastSeen || 0;
                      const minutesAgo = Math.floor((Date.now() - lastSeenTime) / 60000);
                      const isVeryRecent = minutesAgo < 1;

                      return (
                        <div key={visitor.id} className="visitor-list-item">
                          <div className="col-user">
                            <img
                              src={resolveAvatar(visitor)}
                              alt=""
                              style={{ width: '32px', height: '32px', borderRadius: '50%', marginRight: '8px' }}
                            />
                            <span>{resolveDisplayName(visitor)}</span>
                          </div>
                          <div className="col-email">{visitor.email || 'No email'}</div>
                          <div className="col-last-seen">
                            {minutesAgo < 1 ? 'Just now' :
                              minutesAgo < 60 ? `${minutesAgo} min ago` :
                                minutesAgo < 1440 ? `${Math.floor(minutesAgo / 60)}h ${minutesAgo % 60}m ago` :
                                  `${Math.floor(minutesAgo / 1440)}d ${Math.floor((minutesAgo % 1440) / 60)}h ago`}
                          </div>
                          <div className="col-status">
                            <span className={`status-badge ${isVeryRecent ? 'online' : 'recent'} ${visitor.isAnonymous ? 'guest' : ''}`}>
                              {visitor.isAnonymous ? '👤 Guest' : (isVeryRecent ? '🟢 Online' : '🟡 Recent')}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'activity' && isSuperAdminUser && (
            <div className="activity-section">
              <div className="section-header">
                <h2>📊 Activity Logs</h2>
                <div className="header-actions">
                  <button className="refresh-btn" onClick={fetchGlobalLogs} disabled={logsLoading}>
                    🔄 Refresh
                  </button>
                  <button className="clear-btn-admin" onClick={clearActivityLogs} disabled={processingId === 'clear_logs'}>
                    🗑️ Clear All Logs
                  </button>
                </div>
              </div>

              {logsLoading ? (
                <LoadingScreen message="Loading logs..." />
              ) : logsError ? (
                <div className="error-message">{logsError}</div>
              ) : globalLogs.length === 0 ? (
                <div className="empty-state">
                  <p>📭 No activity logs found</p>
                </div>
              ) : (
                <div className="logs-table-container">
                  <table className="logs-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>User</th>
                        <th>Type</th>
                        <th>Action</th>
                        <th>Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {globalLogs.map(log => (
                        <tr key={log.id}>
                          <td className="log-time">{formatTime(log.timestamp)}</td>
                          <td className="log-user">
                            <span className="user-id">
                              {log.userName || log.userId?.slice(0, 8)}
                              {log.isAnonymous && ' (Guest)'}
                            </span>
                          </td>
                          <td className="log-type">
                            <span className={`type-tag tag-${log.type?.toLowerCase()}`}>
                              {log.type}
                            </span>
                          </td>
                          <td className="log-action">{log.action?.replace(/_/g, ' ')}</td>
                          <td className="log-details">
                            <pre className="details-json">
                              {JSON.stringify(log.metadata, null, 1)}
                            </pre>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === 'walletHistory' && isSuperAdminUser && (
            <div className="wallet-history-section admin-category-section" style={{ padding: '20px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px' }}>
              <div className="section-header" style={{ marginBottom: '20px' }}>
                <h2 style={{ fontSize: '1.5em', margin: '0 0 10px 0' }}>💼 Wallet History</h2>
                <div className="header-actions">
                  <p style={{ margin: 0, opacity: 0.8 }}>View user wallet transaction history and delete erroneous records. Deleting a record here does NOT change the user's AURY balance.</p>
                </div>
              </div>

              <div className="search-bar" style={{ marginBottom: '20px' }}>
                <input
                  type="text"
                  placeholder="🔍 Search users by name or email to view their wallet history..."
                  value={walletHistoryUserSearch}
                  onChange={(e) => setWalletHistoryUserSearch(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    fontSize: '14px',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '8px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    color: 'white'
                  }}
                />
              </div>

              {!selectedWalletHistoryUser ? (
                walletHistoryUserSearch && (
                  <div className="participants-list" style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '8px', padding: '10px' }}>
                    {allUsers
                      .filter(u => {
                        const query = walletHistoryUserSearch.toLowerCase();
                        const name = resolveDisplayName(u).toLowerCase();
                        const email = (u.email || '').toLowerCase();
                        return name.includes(query) || email.includes(query);
                      })
                      .slice(0, 10)
                      .map(u => (
                        <div
                          key={u.id}
                          className="participant-item"
                          onClick={() => {
                            setSelectedWalletHistoryUser(u);
                            setWalletHistoryUserSearch('');
                          }}
                          style={{ cursor: 'pointer', padding: '10px', display: 'flex', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.1)' }}
                        >
                          <img src={resolveAvatar(u)} alt="" style={{ width: '32px', height: '32px', borderRadius: '50%', marginRight: '10px' }} />
                          <div className="participant-info" style={{ flex: 1 }}>
                            <span className="participant-name" style={{ display: 'block', fontWeight: 'bold' }}>{resolveDisplayName(u)}</span>
                            <span className="participant-email" style={{ fontSize: '0.9em', color: '#aaa' }}>{u.email}</span>
                          </div>
                          <div className="participant-balance">
                            {formatAuryAmount(u.balance || 0)} AURY
                          </div>
                        </div>
                      ))}
                    {allUsers.filter(u => {
                      const query = walletHistoryUserSearch.toLowerCase();
                      return resolveDisplayName(u).toLowerCase().includes(query) || (u.email || '').toLowerCase().includes(query);
                    }).length === 0 && (
                        <p style={{ padding: '10px', margin: 0, opacity: 0.7 }}>No users found matching "{walletHistoryUserSearch}"</p>
                      )}
                  </div>
                )
              ) : (
                <div className="wallet-history-content">
                  <div className="selected-user-header" style={{ display: 'flex', alignItems: 'center', gap: '15px', background: 'rgba(0,0,0,0.2)', padding: '15px', borderRadius: '8px', marginBottom: '20px' }}>
                    <img src={resolveAvatar(selectedWalletHistoryUser)} alt="" style={{ width: '50px', height: '50px', borderRadius: '50%' }} />
                    <div style={{ flex: 1 }}>
                      <h3 style={{ margin: '0 0 5px 0' }}>{resolveDisplayName(selectedWalletHistoryUser)}</h3>
                      <p style={{ margin: 0, color: '#aaa' }}>{selectedWalletHistoryUser.email}</p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '1.2em', fontWeight: 'bold', color: '#ef4444' }}>{formatAuryAmount(selectedWalletHistoryUser.balance || 0)} AURY</div>
                      <button className="secondary-btn small" onClick={() => setSelectedWalletHistoryUser(null)} style={{ marginTop: '5px' }}>
                        Change User
                      </button>
                    </div>
                  </div>

                  {walletHistoryLoading ? (
                    <LoadingScreen message="Loading transactions..." />
                  ) : walletHistoryTransactions.length === 0 ? (
                    <div className="empty-state" style={{ padding: '20px', textAlign: 'center', background: 'rgba(255,255,255,0.02)', borderRadius: '8px' }}>
                      <p style={{ margin: 0, opacity: 0.8 }}>📭 No wallet history found for this user.</p>
                    </div>
                  ) : (
                    <div className="logs-table-container">
                      <table className="logs-table">
                        <thead>
                          <tr>
                            <th>Time</th>
                            <th>Type</th>
                            <th>Amount (AURY)</th>
                            <th>Reason/Status</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {walletHistoryTransactions.map(tx => (
                            <tr key={tx.id}>
                              <td className="log-time">{formatTime(tx.timestamp)}</td>
                              <td className="log-type">
                                <span className={`type-tag tag-${(tx.type || 'unknown').toLowerCase()}`}>
                                  {tx.type}
                                </span>
                              </td>
                              <td className="log-action">
                                {tx.amount ? formatAuryAmount(tx.amount) : 'N/A'}
                              </td>
                              <td className="log-details">
                                <div>
                                  {tx.status && <span style={{ marginRight: '8px', opacity: 0.8 }}>[{tx.status.toUpperCase()}]</span>}
                                  {tx.reason || tx.txSignature || 'N/A'}
                                </div>
                              </td>
                              <td>
                                <button
                                  className="delete-btn"
                                  onClick={() => handleDeleteWalletTransaction(tx.id, selectedWalletHistoryUser.id)}
                                  disabled={processingId === `del-tx-${tx.id}`}
                                  style={{ padding: '6px 12px', fontSize: '0.85em', background: '#dc2626', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', opacity: processingId === `del-tx-${tx.id}` ? 0.5 : 1 }}
                                >
                                  {processingId === `del-tx-${tx.id}` ? 'Deleting...' : 'Delete'}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === 'campaigns' && (
            <div className="campaigns-section">
              <div className="section-header">
                <h2>📣 Marketing Campaigns & Announcements</h2>
                <p>Manage high-impact popups and special event notifications.</p>
              </div>

              <div className="announcement-form-card card">
                <h3>Major Announcement Popup</h3>
                <div className="form-info-box" style={{ marginBottom: '20px' }}>
                  <p>This popup will appear for all users on the landing page when enabled. Use it for major tournament announcements or critical updates.</p>
                </div>

                <div className="campaign-form">
                  <div className="form-group toggle-group">
                    <label className="toggle-label">
                      <span>Enable Popup Announcement</span>
                      <input
                        type="checkbox"
                        checked={announcementEnabled}
                        onChange={(e) => setAnnouncementEnabled(e.target.checked)}
                        className="admin-checkbox"
                      />
                    </label>
                  </div>

                  <div className="form-group">
                    <label>Announcement Title</label>
                    <input
                      type="text"
                      value={announcementTitle}
                      onChange={(e) => setAnnouncementTitle(e.target.value)}
                      placeholder="e.g., 🎮 Triad Tourney Season 1"
                    />
                  </div>

                  <div className="form-group">
                    <label>Announcement Content (Rich Text)</label>
                    <div className="rich-text-toolbar">
                      <button
                        type="button"
                        title="Bold"
                        onClick={() => {
                          const textArea = document.getElementById('announcement-content');
                          const start = textArea.selectionStart;
                          const end = textArea.selectionEnd;
                          const text = textArea.value;
                          const before = text.substring(0, start);
                          const selected = text.substring(start, end);
                          const after = text.substring(end);
                          setAnnouncementContent(before + '**' + selected + '**' + after);
                        }}
                      ><strong>B</strong></button>
                      <button
                        type="button"
                        title="Italic"
                        onClick={() => {
                          const textArea = document.getElementById('announcement-content');
                          const start = textArea.selectionStart;
                          const end = textArea.selectionEnd;
                          const text = textArea.value;
                          const before = text.substring(0, start);
                          const selected = text.substring(start, end);
                          const after = text.substring(end);
                          setAnnouncementContent(before + '_' + selected + '_' + after);
                        }}
                      ><em>I</em></button>
                      <button
                        type="button"
                        title="Add Link"
                        onClick={() => {
                          const url = prompt('Enter URL:');
                          if (url) {
                            const textArea = document.getElementById('announcement-content');
                            const start = textArea.selectionStart;
                            const end = textArea.selectionEnd;
                            const text = textArea.value;
                            const before = text.substring(0, start);
                            const selected = text.substring(start, end) || 'link text';
                            const after = text.substring(end);
                            setAnnouncementContent(before + '[' + selected + '](' + url + ')' + after);
                          }
                        }}
                      >🔗</button>
                      <button
                        type="button"
                        title="Insert Image (max 500KB, up to 3 images)"
                        onClick={() => {
                          const existingImages = (announcementContent.match(/!\[.*?\]\(.*?\)/g) || []).length;
                          if (existingImages >= 3) {
                            alert('Maximum 3 images per announcement. Please remove an existing image first.');
                            return;
                          }
                          const input = document.createElement('input');
                          input.type = 'file';
                          input.accept = 'image/*';
                          input.onchange = (e) => {
                            const file = e.target.files[0];
                            if (!file) return;
                            if (file.size > 500 * 1024) {
                              alert('Image too large. Please use an image under 500KB.');
                              return;
                            }
                            const reader = new FileReader();
                            reader.onloadend = () => {
                              const img = new Image();
                              img.onload = () => {
                                const canvas = document.createElement('canvas');
                                const MAX_SIZE = 400;
                                let w = img.width, h = img.height;
                                if (w > h) { if (w > MAX_SIZE) { h = Math.round(h * MAX_SIZE / w); w = MAX_SIZE; } }
                                else { if (h > MAX_SIZE) { w = Math.round(w * MAX_SIZE / h); h = MAX_SIZE; } }
                                canvas.width = w; canvas.height = h;
                                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                                const compressed = canvas.toDataURL('image/jpeg', 0.6);
                                const textArea = document.getElementById('announcement-content');
                                const start = textArea.selectionStart;
                                const text = textArea.value;
                                const before = text.substring(0, start);
                                const after = text.substring(start);
                                setAnnouncementContent(before + '\n![image](' + compressed + ')\n' + after);
                              };
                              img.src = reader.result;
                            };
                            reader.readAsDataURL(file);
                          };
                          input.click();
                        }}
                      >📷</button>
                    </div>
                    <textarea
                      id="announcement-content"
                      value={announcementContent}
                      onChange={(e) => setAnnouncementContent(e.target.value)}
                      placeholder="Enter the full rules or announcement details here..."
                      style={{ minHeight: '300px' }}
                      className="form-textarea"
                    />
                  </div>

                  <div className="form-group">
                    <label>Action Link (Optional - e.g., Join Tournament button)</label>
                    <input
                      type="text"
                      value={announcementLink}
                      onChange={(e) => setAnnouncementLink(e.target.value)}
                      placeholder="https://..."
                    />
                  </div>

                  <div className="form-actions">
                    <button
                      className="save-btn"
                      onClick={handleSaveAnnouncement}
                      disabled={processingId === 'save_announcement'}
                    >
                      {processingId === 'save_announcement' ? 'Saving...' : '💾 Save Announcement Settings'}
                    </button>
                    <button
                      className="secondary-btn"
                      onClick={() => {
                        window.open('/', '_blank');
                      }}
                    >
                      👁️ Preview on Live Site
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'mini_games' && (
            <div className="mini-games-section">
              <div className="section-header">
                <h2>🎮 Mini-Games Configuration</h2>
                <div className="header-actions">
                  <button 
                    className="admin-secondary-btn" 
                    onClick={() => handleAutoAssignIcons(activeGameType)}
                    disabled={isAutoAssigning || miniGamesLoading}
                    title="Automatically assigns classic slot/chest icons to all prizes"
                  >
                    {isAutoAssigning ? 'Updating...' : '✨ Auto-Refresh Icons'}
                  </button>
                  <div className="game-type-selector">
                    <button 
                      className={`selector-btn ${activeGameType === 'slotMachine' ? 'active' : ''}`}
                      onClick={() => setActiveGameType('slotMachine')}
                    >
                      Slot Machine
                    </button>
                    <button 
                      className={`selector-btn ${activeGameType === 'treasureChest' ? 'active' : ''}`}
                      onClick={() => setActiveGameType('treasureChest')}
                    >
                      Treasure Chest
                    </button>
                    <button 
                      className={`selector-btn ${activeGameType === 'drakkarRace' ? 'active' : ''}`}
                      onClick={() => setActiveGameType('drakkarRace')}
                    >
                      Drakkar Race
                    </button>
                  </div>
                </div>
              </div>


              {activeGameType !== 'drakkarRace' && (
                <div className="config-card probability-guide-card">
                  <div className="guide-header">
                    <h3>⚖️ Probability Balance Guide</h3>
                    <span className="guide-subtitle">Use these weights to achieve professional game balance</span>
                  </div>
                  <div className="guide-table-container">
                    <table className="guide-table">
                      <thead>
                        <tr>
                          <th>Rarity Tier/Type</th>
                          <th>Target Luck</th>
                          <th>Recommended Weight</th>
                          <th>Example Prize</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="rarity-loss">
                          <td><strong>House Edge</strong> ❌</td>
                          <td>Configurable</td>
                          <td><strong>50 - 150</strong></td>
                          <td>"Better Luck Next Time" (Loss)</td>
                        </tr>
                        <tr className="rarity-common">
                          <td><strong>Common</strong> ⚪</td>
                          <td>~70%</td>
                          <td><strong>100</strong></td>
                          <td>25 Valcoins (Safe Hit)</td>
                        </tr>
                        <tr className="rarity-rare">
                          <td><strong>Rare</strong> 🔵</td>
                          <td>~20%</td>
                          <td><strong>30</strong></td>
                          <td>75 Valcoins (Sweet Spot)</td>
                        </tr>
                        <tr className="rarity-epic">
                          <td><strong>Epic</strong> 🟣</td>
                          <td>~8%</td>
                          <td><strong>10</strong></td>
                          <td>250 Valcoins (Big Win)</td>
                        </tr>
                        <tr className="rarity-legendary">
                          <td><strong>Legendary</strong> 🟡</td>
                          <td>~2%</td>
                          <td><strong>2</strong></td>
                          <td>1000 Valcoins (Jackpot)</td>
                        </tr>
                      </tbody>
                    </table>
                    <div className="guide-footer">
                      <p>💡 <em>Weights are relative. Probability = (Prize Weight / (Total Prize Weight + No-Win Weight))</em></p>
                      <p>🛡️ <strong>Recommended:</strong> For a 25% house edge, set the <strong>No-Win Weight</strong> roughly equal to 1/3 of your total prize weights.</p>
                    </div>
                  </div>
                </div>
              )}

              {miniGamesLoading ? (
                <LoadingScreen message="Loading configuration..." />
              ) : !miniGamesConfig ? (
                <div className="error-message">Configuration not found. Initialization should happen automatically.</div>
              ) : (
                <div className="mini-game-config-content">
                  <div className="config-card card">
                    <h3>General Settings</h3>
                    <div className="form-group toggle-group" style={{ marginBottom: "15px", borderBottom: "1px solid rgba(255,255,255,0.1)", paddingBottom: "15px" }}>
                      <label className="toggle-label" style={{ color: "#ef4444" }}>
                        <span>🚧 Global Testing Mode (SuperAdmins Only)</span>
                        <input
                          type="checkbox"
                          checked={miniGamesConfig.global?.superAdminOnly ?? false}
                          onChange={(e) => handleUpdateMiniGameConfig('global', { superAdminOnly: e.target.checked })}
                          className="admin-checkbox"
                        />
                      </label>
                      <p style={{ fontSize: '0.8em', color: '#94a3b8', marginTop: '5px' }}>
                        When enabled, the ARCADE button is hidden from all regular users. Only SuperAdmins can see and test the games.
                      </p>
                    </div>

                    <div className="form-row">
                      <div className="form-group toggle-group">
                        <label className="toggle-label">
                          <span>Enabled</span>
                          <input
                            type="checkbox"
                            checked={miniGamesConfig[activeGameType]?.enabled ?? true}
                            onChange={(e) => handleUpdateMiniGameConfig(activeGameType, { enabled: e.target.checked })}
                            className="admin-checkbox"
                          />
                        </label>
                      </div>

                      {activeGameType === 'drakkarRace' ? (
                        <>
                          <div className="form-group">
                            <label>House Multiplier Factor (Default 0.9)</label>
                            <input
                              type="number"
                              step="0.01"
                              value={miniGamesConfig[activeGameType]?.multiplierFactor ?? 0.9}
                              onChange={(e) => handleUpdateMiniGameConfig(activeGameType, { multiplierFactor: parseFloat(e.target.value) })}
                              min="0"
                              max="2"
                              title="The final pool multiplier. 0.9 = 10% House Cut"
                            />
                          </div>
                          <div className="form-group">
                            <label>House Seed Amount (Default 500)</label>
                            <input
                              type="number"
                              value={miniGamesConfig[activeGameType]?.houseSeed ?? 500}
                              onChange={(e) => handleUpdateMiniGameConfig(activeGameType, { houseSeed: parseInt(e.target.value) })}
                              min="0"
                              title="Starting valcoins injected into each ship's pool"
                            />
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="form-group">
                            <label>Cost Per Play (Valcoins)</label>
                            <input
                              type="number"
                              value={miniGamesConfig[activeGameType]?.costPerPlay ?? 50}
                              onChange={(e) => handleUpdateMiniGameConfig(activeGameType, { costPerPlay: parseInt(e.target.value) })}
                              min="0"
                            />
                          </div>
                          <div className="form-group">
                            <label>No-Win Weight (Dead Weight)</label>
                            <input
                              type="number"
                              value={miniGamesConfig[activeGameType]?.noWinWeight ?? 0}
                              onChange={(e) => handleUpdateMiniGameConfig(activeGameType, { noWinWeight: parseInt(e.target.value) })}
                              min="0"
                              title="Higher weight = more chance of losing"
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </div>


                  {activeGameType !== 'drakkarRace' && (
                    <div className="prizes-management-card card">
                      <h3>Prize Pool</h3>
                      <div className="new-prize-form">
                        <div className="form-row">
                          <div className="form-group">
                            <label>Prize Name</label>
                            <input
                              type="text"
                              value={newPrize.name}
                              onChange={(e) => setNewPrize({ ...newPrize, name: e.target.value })}
                              placeholder="e.g. 100 Valcoins"
                            />
                          </div>
                          <div className="form-group">
                            <label>Type</label>
                            <select
                              value={newPrize.type}
                              onChange={(e) => setNewPrize({ ...newPrize, type: e.target.value })}
                            >
                              <option value="valcoins">Valcoins</option>
                              <option value="AURY">AURY</option>
                              <option value="USDC">USDC</option>
                              <option value="item">Custom Item</option>
                            </select>
                          </div>
                          <div className="form-group">
                            <label>Amount</label>
                            <input
                              type="number"
                              value={newPrize.amount}
                              onChange={(e) => setNewPrize({ ...newPrize, amount: parseFloat(e.target.value) })}
                            />
                          </div>
                        </div>
                        <div className="form-row">
                          <div className="form-group">
                            <label>Rarity</label>
                            <select
                              value={newPrize.rarity}
                              onChange={(e) => setNewPrize({ ...newPrize, rarity: e.target.value })}
                            >
                              <option value="common">Common</option>
                              <option value="rare">Rare</option>
                              <option value="epic">Epic</option>
                              <option value="legendary">Legendary</option>
                            </select>
                          </div>
                          <div className="form-group">
                            <label>Weight (Probability)</label>
                            <input
                              type="number"
                              value={newPrize.weight}
                              onChange={(e) => setNewPrize({ ...newPrize, weight: parseInt(e.target.value) })}
                              title="Higher weight = more common"
                            />
                          </div>
                          <div className="form-group icon-picker-group">
                          <label>Icon</label>
                          <div className="icon-quick-picker">
                            {getRecommendedIcons(newPrize.rarity).map(emoji => (
                              <button 
                                key={emoji} 
                                type="button"
                                className={`icon-emoji-btn ${newPrize.icon === emoji ? 'active' : ''}`}
                                onClick={() => setNewPrize({ ...newPrize, icon: emoji })}
                              >
                                {emoji && emoji.endsWith('.png') ? (
                                  <img src={`${process.env.PUBLIC_URL}/icons/minigames/${emoji}`} alt="" className="admin-icon-btn-img" />
                                ) : (
                                  emoji
                                )}
                              </button>
                            ))}
                          </div>
                          <input
                            type="text"
                            value={newPrize.icon}
                            onChange={(e) => setNewPrize({ ...newPrize, icon: e.target.value })}
                            placeholder="Emoji or icon reference"
                          />
                        </div>
                        <div className="form-actions-mini">
                          <button 
                            className={editingPrizeId ? "update-prize-btn" : "add-prize-btn"} 
                            onClick={() => handleAddPrize(activeGameType)}
                          >
                            {editingPrizeId ? 'Update Prize' : 'Add Prize'}
                          </button>
                          {editingPrizeId && (
                            <button className="cancel-edit-btn" onClick={handleCancelEditPrize}>
                              Cancel
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="prizes-list">
                      <h4>Existing Prizes</h4>
                      {(!miniGamesConfig[activeGameType]?.prizes || miniGamesConfig[activeGameType].prizes.length === 0) ? (
                        <p className="empty-mini">No prizes configured for this game.</p>
                      ) : (
                        <div className="prizes-grid-admin">
                          {miniGamesConfig[activeGameType].prizes.map((prize) => (
                            <div key={prize.id} className={`prize-item-admin rarity-${prize.rarity} ${editingPrizeId === prize.id ? 'being-edited' : ''}`}>
                              <div className="prize-icon-admin">
                                {prize.icon && prize.icon.endsWith('.png') ? (
                                  <img src={`${process.env.PUBLIC_URL}/icons/minigames/${prize.icon}`} alt="" className="admin-prize-img" />
                                ) : (
                                  prize.icon || '🎁'
                                )}
                              </div>
                              <div className="prize-info-admin">
                                <span className="prize-name-admin">{prize.name}</span>
                                <span className="prize-details-admin">
                                  {prize.type.toUpperCase()}: {prize.amount} | Weight: {prize.weight}
                                </span>
                              </div>
                              <div className="prize-actions-admin">
                                <button 
                                  className="edit-prize-btn"
                                  onClick={() => handleStartEditPrize(prize)}
                                  title="Edit Prize"
                                >
                                  📝
                                </button>
                                <button 
                                  className="delete-prize-btn" 
                                  onClick={() => handleDeletePrize(activeGameType, prize.id)}
                                  title="Delete Prize"
                                >
                                  ×
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
            </div>
          )}

          {activeTab === 'mini_game_history' && (
            <div className="mini-games-section">
              <div className="section-header">
                <h2>🏆 Earners & Plays</h2>
                <div className="header-actions">
                  {isSuperAdminUser && (
                    <div className="global-reset-control">
                      <div className="wipe-option" style={{ display: 'flex', alignItems: 'center', marginRight: '15px', color: '#94a3b8', fontSize: '0.8em', cursor: 'pointer' }} onClick={() => setResetStatsWipeHistory(!resetStatsWipeHistory)}>
                        <input 
                          type="checkbox" 
                          checked={resetStatsWipeHistory}
                          onChange={(e) => setResetStatsWipeHistory(e.target.checked)}
                          style={{ marginRight: '6px' }}
                        />
                        <span>Wipe History Logs</span>
                      </div>
                      <input 
                        type="text" 
                        placeholder="Type RESET ALL STATS to confirm" 
                        value={resetStatsConfirmText}
                        onChange={(e) => setResetStatsConfirmText(e.target.value)}
                        className="admin-compact-input"
                        style={{ marginRight: '8px', fontSize: '0.8em' }}
                      />
                      <button 
                        className="clear-btn-admin risky" 
                        onClick={handleResetLeaderboardStats}
                        disabled={isResettingStats || resetStatsConfirmText !== 'RESET ALL STATS'}
                      >
                        {isResettingStats ? 'Resetting...' : resetStatsWipeHistory ? '🔥 Wipe All Records' : '🚨 Reset Leaderboard Stats'}
                      </button>
                    </div>
                  )}
                  {earnersSelectedUser && (
                    <button 
                      className="secondary-btn small" 
                      onClick={() => {
                        setEarnersSelectedUser(null);
                        setEarnersSearchQuery('');
                      }}
                    >
                      ⬅️ Back to Search
                    </button>
                  )}
                </div>
              </div>

              <div className="mini-game-earners-content">
                {!earnersSelectedUser && isSuperAdminUser && (
                  <div className="admin-status-alert urgent" style={{ marginBottom: '20px' }}>
                    <div className="alert-content">
                      <span className="alert-icon">⚠️</span>
                      <div className="alert-text text-sm">
                        <strong>Global Reset:</strong> Resetting stats will zero out all mini-game cumulative points for all users. Use this to start a new season of the leaderboard. This action is irreversible.
                      </div>
                    </div>
                  </div>
                )}
                {!earnersSelectedUser ? (
                  <div className="user-lookup-container card" style={{ maxWidth: '600px', margin: '0 auto' }}>
                    <h3>🔍 User History Lookup</h3>
                    <p style={{ opacity: 0.7, fontSize: '0.9em', marginBottom: '15px' }}>
                      Search for a player by name or email to view their full mini-game activity.
                    </p>
                    <div className="search-bar" style={{ position: 'relative' }}>
                      <input
                        type="text"
                        placeholder="Type member name or email..."
                        value={earnersSearchQuery}
                        onChange={(e) => {
                          setEarnersSearchQuery(e.target.value);
                          setIsSelectingEarnersUser(true);
                        }}
                        onFocus={() => setIsSelectingEarnersUser(true)}
                        style={{
                          width: '100%',
                          padding: '12px 16px',
                          fontSize: '14px',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          borderRadius: '8px',
                          background: 'rgba(255, 255, 255, 0.05)',
                          color: 'white'
                        }}
                      />
                      {isSelectingEarnersUser && earnersSearchQuery.length >= 2 && (
                        <div className="user-search-dropdown" style={{ 
                          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100, 
                          background: '#1a1b23', border: '1px solid rgba(255,255,255,0.1)', 
                          borderRadius: '8px', marginTop: '5px', maxHeight: '300px', overflowY: 'auto' 
                        }}>
                          {allUsers
                            .filter(u => 
                              u.email?.toLowerCase().includes(earnersSearchQuery.toLowerCase()) || 
                              resolveDisplayName(u).toLowerCase().includes(earnersSearchQuery.toLowerCase())
                            )
                            .slice(0, 10)
                            .map(u => (
                              <div 
                                key={u.id} 
                                className="user-search-item"
                                onClick={() => {
                                  setEarnersSelectedUser(u);
                                  setIsSelectingEarnersUser(false);
                                  setEarnersSearchQuery('');
                                }}
                                style={{ padding: '10px 15px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', gap: '10px' }}
                              >
                                <img src={resolveAvatar(u)} alt="" style={{ width: '24px', height: '24px', borderRadius: '50%' }} />
                                <div>
                                  <div style={{ fontSize: '0.9em', fontWeight: 'bold' }}>{resolveDisplayName(u)}</div>
                                  <div style={{ fontSize: '0.75em', opacity: 0.6 }}>{u.email}</div>
                                </div>
                              </div>
                            ))
                          }
                          {allUsers.filter(u => 
                              u.email?.toLowerCase().includes(earnersSearchQuery.toLowerCase()) || 
                              resolveDisplayName(u).toLowerCase().includes(earnersSearchQuery.toLowerCase())
                            ).length === 0 && (
                            <div style={{ padding: '15px', textAlign: 'center', opacity: 0.5 }}>No users found</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="selected-user-history">
                    <div className="user-info-banner card" style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '20px', padding: '15px' }}>
                      <img src={resolveAvatar(earnersSelectedUser)} alt="" style={{ width: '48px', height: '48px', borderRadius: '50%' }} />
                      <div>
                        <h3>{resolveDisplayName(earnersSelectedUser)}</h3>
                        <p style={{ opacity: 0.7 }}>{earnersSelectedUser.email}</p>
                      </div>
                      <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                        <span className="balance-tag" style={{ background: 'rgba(74, 222, 128, 0.1)', color: '#4ade80', padding: '4px 12px', borderRadius: '20px', fontSize: '0.9em' }}>
                          💰 {earnersSelectedUser.points || 0} Valcoins
                        </span>
                      </div>
                    </div>

                    {earnersLoading ? (
                      <LoadingScreen message="Fetching logs..." />
                    ) : earnersHistory.length === 0 ? (
                      <div className="empty-state card">
                        <p>📭 This user hasn't played any mini-games yet.</p>
                      </div>
                    ) : (
                      <div className="logs-table-container">
                        <table className="logs-table">
                          <thead>
                            <tr>
                              <th>Time</th>
                              <th>Game</th>
                              <th>Prize</th>
                              <th>Value</th>
                            </tr>
                          </thead>
                          <tbody>
                            {earnersHistory.map(log => {
                              const isLoss = log.prizeType === 'none' || log.prizeAmount === 0;
                              return (
                                <tr key={log.id} style={{ opacity: isLoss ? 0.7 : 1 }}>
                                  <td className="log-time">{formatTime(log.timestamp)}</td>
                                  <td className="log-action">
                                    <span style={{ textTransform: 'capitalize' }}>
                                      {log.gameType === 'slotMachine' ? '🎰 Slot Machine' : '🎁 Treasure Chest'}
                                    </span>
                                  </td>
                                  <td className="log-details">
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                      <span style={{ color: isLoss ? '#ff4d4d' : '#4ade80', fontWeight: isLoss ? 'normal' : 'bold' }}>
                                        {isLoss ? '🔴 ' : '🟢 '}
                                        {log.prizeName || log.prize}
                                      </span>
                                    </div>
                                  </td>
                                  <td>
                                    {!isLoss && (
                                      <span className="log-amount positive">
                                        +{log.prizeAmount} {log.prizeType?.toUpperCase()}
                                      </span>
                                    )}
                                    {isLoss && <span style={{ opacity: 0.4 }}>-</span>}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div >

      {/* Per-User Logs Modal */}
      {
        selectedUserForLogs && (
          <div className="admin-modal-overlay activity-modal">
            <div className="admin-modal">
              <div className="modal-header">
                <h2>Activity Log: {resolveDisplayName(selectedUserForLogs)}</h2>
                <button className="close-btn" onClick={() => setSelectedUserForLogs(null)}>×</button>
              </div>
              <div className="modal-body">
                {logsLoading ? (
                  <LoadingScreen message="Loading logs..." />
                ) : logsError ? (
                  <div className="error-message">{logsError}</div>
                ) : userLogs.length === 0 ? (
                  <div className="empty-state">
                    <p>📭 No activity logs found for this user.</p>
                  </div>
                ) : (
                  <div className="logs-table-container">
                    <table className="logs-table">
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>Type</th>
                          <th>Action</th>
                          <th>Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {userLogs.map(log => (
                          <tr key={log.id}>
                            <td className="log-time">{formatTime(log.timestamp)}</td>
                            <td className="log-type">
                              <span className={`type-tag tag-${log.type?.toLowerCase()}`}>
                                {log.type}
                              </span>
                            </td>
                            <td className="log-action">{log.action?.replace(/_/g, ' ')}</td>
                            <td className="log-details short">
                              <pre className="details-json">
                                {JSON.stringify(log.metadata, null, 1)}
                              </pre>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button className="secondary-btn" onClick={() => setSelectedUserForLogs(null)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        )
      }
      {/* Per-User Notifications Modal */}
      {selectedUserForNotifications && (
        <div className="admin-modal-overlay activity-modal">
          <div className="admin-modal" style={{ maxWidth: '800px' }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                <h2>🔔 Notifications: {resolveDisplayName(selectedUserForNotifications)}</h2>
                {isSuperAdminUser && userNotifications.length > 0 && (
                  <button 
                    className="clear-btn-admin small risky" 
                    onClick={() => handleClearAllNotifications(selectedUserForNotifications.id)}
                    style={{ padding: '5px 12px', fontSize: '0.75em' }}
                  >
                    🧹 Clear All
                  </button>
                )}
              </div>
              <button className="close-btn" onClick={() => setSelectedUserForNotifications(null)}>×</button>
            </div>
            <div className="modal-body">
              {userNotificationsLoading ? (
                <LoadingScreen message="Fetching notifications..." />
              ) : userNotifications.length === 0 ? (
                <div className="empty-state">
                  <p>📭 This user's inbox is currently empty.</p>
                </div>
              ) : (
                <div className="logs-table-container">
                  <table className="logs-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Type</th>
                        <th>Title</th>
                        <th>Message</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {userNotifications.map(notif => (
                        <tr key={notif.id} style={{ opacity: notif.read ? 0.6 : 1 }}>
                          <td className="log-time">{formatTime(notif.createdAt)}</td>
                          <td>
                            <span className={`status-badge ${notif.type || 'info'}`} style={{ fontSize: '10px' }}>
                              {notif.type?.toUpperCase() || 'SYSTEM'}
                            </span>
                          </td>
                          <td style={{ fontWeight: 600 }}>{notif.title}</td>
                          <td style={{ fontSize: '0.85em', opacity: 0.8 }}>{notif.message}</td>
                          <td>
                            <button 
                              className="delete-prize-btn" 
                              onClick={() => handleDeleteNotification(selectedUserForNotifications.id, notif.id)}
                              style={{ width: '24px', height: '24px', fontSize: '14px' }}
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminPanel;