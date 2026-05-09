import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db, auth, functions, storage } from '../firebase';
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
  limit,
  writeBatch,
  deleteDoc,
  setDoc,
  getDoc,
  collectionGroup,
  Timestamp
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { onAuthStateChanged } from 'firebase/auth';
import { isSuperAdmin } from '../config/admins';
import { createNotification } from '../services/notifications';
import { logActivity } from '../services/activityService';
import LoadingScreen from './LoadingScreen';
import { resolveDisplayName, resolveAvatar } from '../utils/userUtils';
import AvatarWithAura from './AvatarWithAura';
import { awardPoints } from '../services/pointsService';
import { getRecommendedIcons } from '../services/miniGameService';
import './AdminPanel.css';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { DEFAULT_KNOWLEDGE } from './RunieChatBot';
import { RARITY_CONFIG } from '../data/cosmetics';
import ArmoryModal from './ArmoryModal';

const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary', 'mythic'];

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
const formatAmount = (amount, currency = 'AURY', isSmallestUnit = true) => {
  if (!amount && amount !== 0) return '0.00';
  const curr = currency?.toUpperCase() || 'AURY';

  if (curr === 'VALCOINS') {
    return amount.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  const divisor = isSmallestUnit ? (curr === 'USDC' ? 1e6 : 1e9) : 1;
  const decimals = curr === 'USDC' ? 2 : 4;

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
  const [pendingPrizeClaims, setPendingPrizeClaims] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [userBalanceType, setUserBalanceType] = useState('AURY'); // Added for balance selector
  const [userContactType, setUserContactType] = useState('email'); // Toggle between Email and UID

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

  // User Armory state
  const [selectedUserForArmory, setSelectedUserForArmory] = useState(null);

  // Wallet History Tab State
  const [walletHistoryUserSearch, setWalletHistoryUserSearch] = useState('');
  const [selectedWalletHistoryUser, setSelectedWalletHistoryUser] = useState(null);
  const [walletHistoryTransactions, setWalletHistoryTransactions] = useState([]);
  const [walletHistoryLoading, setWalletHistoryLoading] = useState(false);

  // Economy Tab State
  const [economyDeposits, setEconomyDeposits] = useState([]);
  const [economyWithdrawals, setEconomyWithdrawals] = useState([]);
  const [economyShopSales, setEconomyShopSales] = useState([]);
  const [economyTaxes, setEconomyTaxes] = useState([]);
  const [economyBurns, setEconomyBurns] = useState([]);
  const [economyLoading, setEconomyLoading] = useState(false);
  const [totalCirculatingAury, setTotalCirculatingAury] = useState(0);
  const [totalAuryBurned, setTotalAuryBurned] = useState(0);
  const [burnBreakdown, setBurnBreakdown] = useState({ matchups: 0, raffles: 0, shop: 0 });
  const [economySubTab, setEconomySubTab] = useState('dashboard'); // dashboard, deposits, withdrawals, burns, revenue
  const [economyTimeframe, setEconomyTimeframe] = useState('daily'); // daily, weekly, monthly
  const [economyError, setEconomyError] = useState(null);

  // Ticker Announcements state
  const [tickerAnnouncements, setTickerAnnouncements] = useState([]);
  const [tickerText, setTickerText] = useState('');
  const [tickerIcon, setTickerIcon] = useState('📢');
  const [editingTickerId, setEditingTickerId] = useState(null);
  const [tickerLoading, setTickerLoading] = useState(false);

  // Economy Management State
  const [showEconomyModal, setShowEconomyModal] = useState(false);
  const [editingEconomyRecord, setEditingEconomyRecord] = useState(null); // null = adding
  const [economyForm, setEconomyForm] = useState({
    type: 'deposit', // 'deposit', 'withdrawal', 'sale'
    amount: '',
    currency: 'AURY',
    userEmail: '',
    userId: '',
    txSignature: '',
    details: '',
    status: 'processed',
    timestamp: ''
  });

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

  // Runie Chatbot state
  const [chatbotKnowledge, setChatbotKnowledge] = useState([]);
  const [cbGreetings, setCbGreetings] = useState([]);
  const [cbLabel, setCbLabel] = useState('');
  const [cbKeywords, setCbKeywords] = useState('');
  const [cbResponse, setCbResponse] = useState('');
  const [cbOrder, setCbOrder] = useState(0);
  const [cbShowAsBadge, setCbShowAsBadge] = useState(true);
  const [editingKnowledgeId, setEditingKnowledgeId] = useState(null);

  // Greetings state
  const [cbGreetingText, setCbGreetingText] = useState('');
  const [cbGreetingOrder, setCbGreetingOrder] = useState(0);
  const [editingGreetingId, setEditingGreetingId] = useState(null);
  const [cbEnabled, setCbEnabled] = useState(true);
  const [calcEnabled, setCalcEnabled] = useState(true);

  // Chatbot Search & Unanswered
  const [knowledgeSearchQuery, setKnowledgeSearchQuery] = useState('');
  const [unansweredQueries, setUnansweredQueries] = useState([]);
  const [unansweredLoading, setUnansweredLoading] = useState(false);

  // Mini-Games state
  const [miniGamesConfig, setMiniGamesConfig] = useState(null);
  const [miniGamesLoading, setMiniGamesLoading] = useState(false);
  const [activeGameType, setActiveGameType] = useState('slotMachine');

  // Firestore User Editor (God Mode)
  const [userToEditFirestore, setUserToEditFirestore] = useState(null);
  const [localEditingData, setLocalEditingData] = useState(null);
  const [isSavingEditingDoc, setIsSavingEditingDoc] = useState(false);
  const [newFieldKey, setNewFieldKey] = useState('');
  const [newFieldType, setNewFieldType] = useState('string');

  // Users Tab Sorting
  const [usersSortKey, setUsersSortKey] = useState('superAdmin'); // superAdmin priority first by default
  const [usersSortDirection, setUsersSortDirection] = useState('desc');
  const [isAutoAssigning, setIsAutoAssigning] = useState(false);
  const [newPrize, setNewPrize] = useState({
    name: '',
    type: 'valcoins',
    amount: 10,
    weight: 10,
    rarity: 'common',
    icon: 'common_horn.png',
    isJackpot: false
  });

  // Odin's Riddle Specific State
  const [newRiddle, setNewRiddle] = useState({
    id: '',
    question: '',
    options: ['', '', '', ''],
    correctIndex: 0,
    category: 'norse',
    difficulty: 'easy',
    enabled: true,
    imageUrl: ''
  });
  const [riddleFile, setRiddleFile] = useState(null);
  const [riddlePreview, setRiddlePreview] = useState('');
  const [allRiddles, setAllRiddles] = useState([]);
  const [riddlesLoading, setRiddlesLoading] = useState(false);
  const [editingPrizeId, setEditingPrizeId] = useState(null);
  const [earnersHistory, setEarnersHistory] = useState([]);
  const [earnersSearchQuery, setEarnersSearchQuery] = useState('');
  const [earnersSelectedUser, setEarnersSelectedUser] = useState(null);
  const [isSelectingEarnersUser, setIsSelectingEarnersUser] = useState(false);
  const [earnersLoading, setEarnersLoading] = useState(false);

  // Yggdrasil Rune Shop Inventory
  const [newRuneShopItem, setNewRuneShopItem] = useState({
    name: '',
    description: '',
    icon: '🎁',
    image: '',
    price: 10,
    currency: 'runes',
    stock: 50,
    rarity: 'common'
  });
  const [isCreatingRuneShopItem, setIsCreatingRuneShopItem] = useState(false);
  const [editingRuneShopItemId, setEditingRuneShopItemId] = useState(null);

  // PvP Rewards state
  const [pvpRewardsConfig, setPvpRewardsConfig] = useState(null);
  const [pvpRewardsLoading, setPvpRewardsLoading] = useState(false);
  const [pvpSaving, setPvpSaving] = useState(false);
  const [pvpCountdown, setPvpCountdown] = useState("");
  const [pvpRewardLogs, setPvpRewardLogs] = useState([]);
  const [rewardLogsLoading, setRewardLogsLoading] = useState(false);
  const [isScanningPvp, setIsScanningPvp] = useState(false);
  const [isRepairingPvp, setIsRepairingPvp] = useState(false);

  // Yggdrasil Events State
  const [yggEvents, setYggEvents] = useState([]);
  const [isCreatingYggEvent, setIsCreatingYggEvent] = useState(false);
  const [editingYggEventId, setEditingYggEventId] = useState(null);
  const [newYggEvent, setNewYggEvent] = useState({
    name: '',
    entryFee: 5,
    currency: 'AURY', // AURY or Valcoins
    prizeName: '',
    prizeImage: '',
    prizeRarity: 'epic',
    altitudeFrom: 5000,
    altitudeTo: 15000,
    targetPool: 60,
    status: 'open'
  });
  const [yggEventPrizePreview, setYggEventPrizePreview] = useState('');

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

  // Valhalla's Vault (Shop) Management state
  const [websiteSubTab, setWebsiteSubTab] = useState('maintenance');
  const [shopSubTab, setShopSubTab] = useState('settings');
  const [discordCommandsEnabled, setDiscordCommandsEnabled] = useState(true);
  const [shopEnabled, setShopEnabled] = useState(true);
  const [shopHistory, setShopHistory] = useState([]);
  const [shopHistoryLoading, setShopHistoryLoading] = useState(false);

  // Shop Inventory Management state
  const [shopCosmetics, setShopCosmetics] = useState([]);
  const [cosmeticsLoading, setCosmeticsLoading] = useState(false);
  const [editingCosmetic, setEditingCosmetic] = useState(null); // null = adding new
  const [cosmeticFile, setCosmeticFile] = useState(null);
  const [cosmeticStaticFile, setCosmeticStaticFile] = useState(null);
  const [cosmeticForm, setCosmeticForm] = useState({
    name: '',
    type: 'aura',
    rarity: 'common',
    price: 1000,
    description: '',
    placement: 'behind', // behind | overlay | border
    profileScale: 100, // 50-100, percentage of avatar size relative to aura frame
    auraOffsetX: 0, // -50 to 50 px
    auraOffsetY: 0, // -50 to 50 px
    auraScale: 100, // 50-200, percentage scale of the aura frame
    gifUrl: '',
    pngUrl: '',
    cssClass: '',
    style: {}
  });

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
  const isSeniorAdminUser = user && (isSuperAdminUser || user.role === 'senior_admin');
  const isGamesManagerUser = user && user.role === 'games_manager';
  const isMerchantUser = user && user.role === 'merchant';
  const isGeneralAdmin = user && (isSeniorAdminUser || user.role === 'admin');
  const isAdminUser = isGeneralAdmin || isGamesManagerUser || isMerchantUser;
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

  // Fetch pending prize claims
  useEffect(() => {
    if (!isAdminUser || !isGeneralAdmin) return;

    const claimsRef = collection(db, 'prize_claims');
    const q = query(
      claimsRef,
      where('status', '==', 'pending'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const claims = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setPendingPrizeClaims(claims);
    }, (error) => {
      console.error('Error fetching prize claims:', error);
    });

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

  // Fetch PvP rewards config
  useEffect(() => {
    if (!isAdminUser || activeTab !== 'pvp_rewards') return;

    setPvpRewardsLoading(true);
    const unsub = onSnapshot(doc(db, 'settings', 'pvp_rewards'), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setPvpRewardsConfig({
          ...data,
          enabled: data.enabled ?? true
        });
      } else {
        const defaults = { enabled: true, rewardPerWin: 20, minMatchDuration: 120 };
        setDoc(doc(db, 'settings', 'pvp_rewards'), defaults);
        setPvpRewardsConfig(defaults);
      }
      setPvpRewardsLoading(false);
    });
    return () => unsub();
  }, [activeTab, isAdminUser]);

  // PvP Next Scan Timer
  useEffect(() => {
    if (activeTab !== 'pvp_rewards') return;

    const updateTimer = () => {
      const now = new Date();
      const totalSecondsInInterval = 10 * 60; // 10 minutes
      const secondsInCurrentInterval = (now.getMinutes() % 10) * 60 + now.getSeconds();
      const secondsRemaining = totalSecondsInInterval - secondsInCurrentInterval;

      const m = Math.floor(secondsRemaining / 60);
      const s = secondsRemaining % 60;
      setPvpCountdown(`${m}m ${String(s).padStart(2, '0')}s`);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [activeTab]);

  // Fetch PvP reward logs
  useEffect(() => {
    if (!isAdminUser || activeTab !== 'pvp_rewards') return;

    setRewardLogsLoading(true);
    const q = query(
      collection(db, 'reward_logs'),
      where('type', '==', 'pvp_win'),
      orderBy('timestamp', 'desc'),
      limit(20)
    );

    const unsub = onSnapshot(q, (snap) => {
      const logs = snap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setPvpRewardLogs(logs);
      setRewardLogsLoading(false);
    }, (error) => {
      console.error("Error fetching reward logs:", error);
      setRewardLogsLoading(false);
    });

    return () => unsub();
  }, [activeTab, isAdminUser]);

  // Fetch chatbot knowledge
  useEffect(() => {
    if (!isAdminUser || activeTab !== 'chatbot') return;

    const q = query(collection(db, 'chatbot_knowledge'), orderBy('order', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const knowledge = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setChatbotKnowledge(knowledge);
    });

    return () => unsubscribe();
  }, [activeTab, isAdminUser]);

  // Fetch Unanswered Queries
  useEffect(() => {
    if (!isAdminUser || activeTab !== 'chatbot') return;

    setUnansweredLoading(true);
    const q = query(collection(db, 'chatbot_unanswered'), orderBy('timestamp', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const queries = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setUnansweredQueries(queries);
      setUnansweredLoading(false);
    });

    return () => unsubscribe();
  }, [activeTab, isAdminUser]);

  // Fetch Greetings
  useEffect(() => {
    if (!isAdminUser || activeTab !== 'chatbot') return;

    const q = query(collection(db, 'chatbot_greetings'), orderBy('order', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const greetings = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setCbGreetings(greetings);
    });

    return () => unsubscribe();
  }, [activeTab, isAdminUser]);

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

  // Fetch Chatbot toggle configuration
  useEffect(() => {
    if (!isAdminUser || activeTab !== 'chatbot') return;

    const unsub = onSnapshot(doc(db, 'settings', 'chatbot'), (snap) => {
      if (snap.exists()) {
        setCbEnabled(snap.data().enabled !== false);
        setCalcEnabled(snap.data().damageCalcEnabled !== false);
      } else {
        // Initialize if doesn't exist
        setDoc(doc(db, 'settings', 'chatbot'), {
          enabled: true,
          damageCalcEnabled: true,
          updatedAt: serverTimestamp()
        });
      }
    });

    return () => unsub();
  }, [activeTab, isAdminUser]);

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

  // Fetch Discord Bot config
  useEffect(() => {
    if (!isAdmin || activeTab !== 'website_mgmt') return;

    const unsub = onSnapshot(doc(db, 'settings', 'discord_bot'), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setDiscordCommandsEnabled(data.enabled !== false); // Default to true if not set
      } else {
        // Initialize if doesn't exist
        setDoc(doc(db, 'settings', 'discord_bot'), {
          enabled: true,
          updatedAt: serverTimestamp()
        });
      }
    });

    return () => unsub();
  }, [activeTab, isAdmin, isAdminUser]);

  // Fetch all shop cosmetics (Inventory Management)
  useEffect(() => {
    if (!isAdminUser || activeTab !== 'shop_mgmt') return;

    setCosmeticsLoading(true);
    const q = query(collection(db, 'cosmetics'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setShopCosmetics(data);
      setCosmeticsLoading(false);
    }, (error) => {
      console.error('Error fetching shop cosmetics:', error);
      setCosmeticsLoading(false);
    });

    return () => unsub();
  }, [activeTab, isAdminUser]);

  // Fetch shop purchase history
  useEffect(() => {
    if (!isAdminUser || activeTab !== 'shop_mgmt' || shopSubTab !== 'settings') return;

    const fetchHistory = async () => {
      setShopHistoryLoading(true);
      try {
        // 1. Fetch from the new central collection (future sales)
        let salesQuery;
        if (isMerchantUser && !isSuperAdminUser) {
          salesQuery = query(
            collection(db, 'cosmetic_sales'),
            where('creatorId', '==', user.uid),
            orderBy('timestamp', 'desc'),
            limit(500)
          );
        } else {
          salesQuery = query(collection(db, 'cosmetic_sales'), orderBy('timestamp', 'desc'), limit(500));
        }
        const salesSnap = await getDocs(salesQuery);
        const salesData = salesSnap.docs.map(d => ({ id: d.id, ...d.data(), source: 'log' }));

        // 2. Fetch from legacy pointsHistory (old sales)
        let legacySnap;
        if (isMerchantUser && !isSuperAdminUser) {
          const merchantLegacyQuery = query(
            collection(db, 'users', user.uid, 'pointsHistory'),
            where('type', '==', 'cosmetic_commission'),
            orderBy('timestamp', 'desc'),
            limit(200)
          );
          legacySnap = await getDocs(merchantLegacyQuery);
        } else {
          const legacyQuery = query(
            collectionGroup(db, 'pointsHistory'),
            where('type', '==', 'cosmetic_commission'),
            orderBy('timestamp', 'desc'),
            limit(200)
          );
          legacySnap = await getDocs(legacyQuery);
        }

        const legacyData = [];
        const userCache = {};

        for (const d of legacySnap.docs) {
          const data = d.data();
          const buyerId = data.buyerId;
          const creatorId = d.ref.parent.parent.id; // Parent of pointsHistory is the user document

          // Fetch names if not in cache
          if (creatorId && !userCache[creatorId]) {
            const u = await getDoc(doc(db, 'users', creatorId));
            userCache[creatorId] = u.exists() ? resolveDisplayName(u.data()) : 'Unknown';
          }
          if (buyerId && !userCache[buyerId]) {
            const u = await getDoc(doc(db, 'users', buyerId));
            userCache[buyerId] = u.exists() ? resolveDisplayName(u.data()) : 'Unknown';
          }

          legacyData.push({
            id: d.id,
            buyerId: buyerId,
            buyerName: userCache[buyerId],
            creatorId: creatorId,
            creatorName: userCache[creatorId],
            cosmeticName: data.description.replace('60% share from sale of ', ''),
            price: (data.amount / 0.6),
            commission: data.amount,
            currency: data.currency || 'valcoins',
            timestamp: data.timestamp,
            source: 'legacy'
          });
        }

        // 3. For new logs, we also want to ensure we're showing the LATEST names, 
        // not just what was captured at the time of sale.
        const freshSalesData = [];
        for (const sale of salesData) {
          const bId = sale.buyerId;
          const cId = sale.creatorId;

          if (bId && !userCache[bId]) {
            const u = await getDoc(doc(db, 'users', bId));
            userCache[bId] = u.exists() ? resolveDisplayName(u.data()) : (sale.buyerName || 'Unknown');
          }
          if (cId && cId !== 'System' && !userCache[cId]) {
            const u = await getDoc(doc(db, 'users', cId));
            userCache[cId] = u.exists() ? resolveDisplayName(u.data()) : (sale.creatorName || 'System');
          }

          freshSalesData.push({
            ...sale,
            buyerName: userCache[bId] || sale.buyerName,
            creatorName: userCache[cId] || sale.creatorName || 'System'
          });
        }

        // 4. Merge and De-duplicate
        // We use a unique key (buyerId + item + timestamp) to ensure that if a transaction 
        // exists in both 'cosmetic_sales' and 'pointsHistory', we only show it once.
        const seen = new Set();
        const finalData = [];

        // Add fresh sales first (they are more complete)
        freshSalesData.forEach(s => {
          const key = `${s.buyerId}_${s.cosmeticName}_${s.timestamp?.toMillis() || 0}`;
          seen.add(key);
          finalData.push(s);
        });

        // Add legacy records only if we haven't seen this specific sale already
        legacyData.forEach(l => {
          const key = `${l.buyerId}_${l.cosmeticName}_${l.timestamp?.toMillis() || 0}`;
          if (!seen.has(key)) {
            finalData.push(l);
          }
        });

        // Sort the finalized list
        const combined = finalData
          .sort((a, b) => (b.timestamp?.toMillis() || 0) - (a.timestamp?.toMillis() || 0))
          .slice(0, 500);

        setShopHistory(combined);
      } catch (err) {
        console.error("Error fetching purchase history:", err);
      } finally {
        setShopHistoryLoading(false);
      }
    };

    fetchHistory();
  }, [activeTab, isAdminUser, shopSubTab, isMerchantUser, isSuperAdminUser, user?.uid]);

  const handleSaveShopSettings = async () => {
    setProcessingId('save_shop');
    try {
      await setDoc(doc(db, 'settings', 'shop'), {
        enabled: shopEnabled,
        updatedAt: serverTimestamp()
      }, { merge: true });

      logActivity({
        user,
        type: 'ADMIN',
        action: 'update_shop_settings',
        metadata: { enabled: shopEnabled }
      });
      alert('Shop settings saved successfully!');
    } catch (error) {
      console.error('Error saving shop settings:', error);
      alert('Failed to save shop settings. Check console.');
    }
    setProcessingId(null);
  };

  // ─── SHOP INVENTORY MANAGEMENT HANDLERS ───

  const handleCosmeticImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) { // 2MB limit for storage assets
        alert('File too large. Please keep images under 2MB.');
        return;
      }
      setCosmeticFile(file);

      // Local preview if it's a small enough image
      const reader = new FileReader();
      reader.onloadend = () => {
        setCosmeticForm(prev => ({ ...prev, gifUrl: reader.result }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleCosmeticStaticUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        alert('File too large. Please keep static images under 2MB.');
        return;
      }
      setCosmeticStaticFile(file);

      const reader = new FileReader();
      reader.onloadend = () => {
        setCosmeticForm(prev => ({ ...prev, pngUrl: reader.result }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveCosmetic = async (e) => {
    if (e) e.preventDefault();
    setProcessingId('save_cosmetic');

    try {
      let finalUrl = cosmeticForm.gifUrl;
      let finalPngUrl = cosmeticForm.pngUrl;

      // 1. Upload animated file if selected
      if (cosmeticFile) {
        const storageRef = ref(storage, `cosmetics/${Date.now()}_${cosmeticFile.name}`);
        const uploadResult = await uploadBytes(storageRef, cosmeticFile);
        finalUrl = await getDownloadURL(uploadResult.ref);
      }

      // 2. Upload static preview file if selected
      if (cosmeticStaticFile) {
        const storageRef = ref(storage, `cosmetics/static/${Date.now()}_${cosmeticStaticFile.name}`);
        const uploadResult = await uploadBytes(storageRef, cosmeticStaticFile);
        finalPngUrl = await getDownloadURL(uploadResult.ref);
      }

      const basePrice = Number(cosmeticForm.price) || 0;
      const discountPrice = (cosmeticForm.discountPrice !== undefined && cosmeticForm.discountPrice !== null) ? Number(cosmeticForm.discountPrice) : null;

      // Validate Discount Price
      if (discountPrice !== null && discountPrice >= basePrice) {
        alert('Discount price must be LOWER than the original price.');
        setProcessingId(null);
        return;
      }

      // Calculate Discount Expiry if duration is set
      let discountExpiry = null;
      const days = parseInt(cosmeticForm.discountDays) || 0;
      const hours = parseInt(cosmeticForm.discountHours) || 0;

      if (discountPrice !== null && (days > 0 || hours > 0)) {
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + days);
        expiryDate.setHours(expiryDate.getHours() + hours);
        discountExpiry = Timestamp.fromDate(expiryDate);
      }

      const cosmeticData = {
        ...cosmeticForm,
        gifUrl: finalUrl,
        pngUrl: finalPngUrl,
        discountExpiry: discountExpiry,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid
      };

      // Clean up UI-only fields before saving to Firestore
      delete cosmeticData.discountDays;
      delete cosmeticData.discountHours;

      if (!editingCosmetic) {
        // 🆕 DUPLICATE CHECK: Prevent adding items with the exact same name
        const isDuplicate = shopCosmetics.some(c => c.name.toLowerCase().trim() === cosmeticForm.name.toLowerCase().trim());
        if (isDuplicate) {
          if (!window.confirm(`⚠️ An item named "${cosmeticForm.name}" already exists in the vault. Do you want to add another one anyway?`)) {
            setProcessingId('');
            return;
          }
        }

        // Create new
        cosmeticData.createdAt = serverTimestamp();
        cosmeticData.createdBy = user.uid;
        cosmeticData.createdByName = resolveDisplayName(user) || 'Admin';
        cosmeticData.saleCount = 0;
        await addDoc(collection(db, 'cosmetics'), cosmeticData);
        alert('New cosmetic added successfully!');
      } else {
        // Update existing
        const docRef = doc(db, 'cosmetics', editingCosmetic.id);

        // If the item has no creator (System), we KEEP it as System (null/undefined)
        // Only assign current user if it was already their item or if explicitly creating a new one.
        cosmeticData.createdBy = editingCosmetic.createdBy || null;
        cosmeticData.createdByName = editingCosmetic.createdByName || 'System';

        await updateDoc(docRef, cosmeticData);
        alert('Cosmetic updated successfully!');
      }

      // Reset form
      setCosmeticForm({
        name: '', type: 'aura', rarity: 'common', price: 1000, discountPrice: null,
        discountDays: 0, discountHours: 0, currency: 'valcoins',
        description: '', placement: 'behind', gifUrl: '', pngUrl: '', cssClass: '', style: {}
      });
      setEditingCosmetic(null);
      setCosmeticFile(null);
      setCosmeticStaticFile(null);

    } catch (error) {
      console.error('Error saving cosmetic:', error);
      alert('Error saving cosmetic: ' + error.message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleDeleteCosmetic = async (id) => {
    if (!window.confirm('⚔️ Are you sure you want to PERMANENTLY delete this item? This will NOT remove it from users who already bought it, but new users cannot buy it.')) return;

    try {
      await deleteDoc(doc(db, 'cosmetics', id));
      alert('Cosmetic removed from inventory.');
    } catch (error) {
      console.error('Error deleting cosmetic:', error);
      alert('Error deleting cosmetic: ' + error.message);
    }
  };

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
      setMiniGamesConfig(prev => ({ ...prev, [gameType]: { ...prev[gameType], ...updates } }));
    } catch (error) {
      console.error('Error updating mini-game config:', error);
      alert('Error updating config: ' + error.message);
    }
  };

  // Odin's Riddle Management
  const handleRiddleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        alert('File too large. Please keep images under 2MB.');
        return;
      }
      setRiddleFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setRiddlePreview(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveRiddle = async () => {
    if (!newRiddle.question || newRiddle.options.some(opt => !opt)) {
      return alert('Question and all 4 options are required.');
    }

    setProcessingId('save_riddle');
    try {
      let finalImageUrl = newRiddle.imageUrl;

      // Upload image if selected
      if (riddleFile) {
        const storageRef = ref(storage, `riddles/${Date.now()}_${riddleFile.name}`);
        const uploadResult = await uploadBytes(storageRef, riddleFile);
        finalImageUrl = await getDownloadURL(uploadResult.ref);
      }

      const riddleData = {
        ...newRiddle,
        imageUrl: finalImageUrl,
        updatedAt: serverTimestamp()
      };

      if (newRiddle.id) {
        // Update existing
        const riddleRef = doc(db, 'riddles', newRiddle.id);
        const { id, ...dataToUpdate } = riddleData;
        await updateDoc(riddleRef, dataToUpdate);
        alert('Riddle updated successfully!');
      } else {
        // Create new
        await addDoc(collection(db, 'riddles'), {
          ...riddleData,
          createdAt: serverTimestamp()
        });
        alert('Riddle added successfully!');
      }

      // Reset form and refresh list
      setNewRiddle({
        id: '',
        question: '',
        options: ['', '', '', ''],
        correctIndex: 0,
        category: 'norse',
        difficulty: 'easy',
        enabled: true,
        imageUrl: ''
      });
      setRiddleFile(null);
      setRiddlePreview('');

      // Trigger refresh
      const snapshot = await getDocs(collection(db, 'riddles'));
      const riddles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      riddles.sort((a, b) => a.category.localeCompare(b.category) || a.difficulty.localeCompare(b.difficulty));
      setAllRiddles(riddles);

    } catch (error) {
      console.error('Error saving riddle:', error);
      alert('Error saving riddle: ' + error.message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleTriggerPvpScan = async (resetCheckpoints = false) => {
    if (!isSeniorAdminUser) return;

    if (resetCheckpoints && !window.confirm('⚠️ This will rewind ALL player checkpoints by 7 days and re-scan their entire match history. Any already-rewarded wins will NOT be double-counted (they will be filtered as "old"). Continue?')) {
      return;
    }

    setIsScanningPvp(true);
    try {
      const triggerPvpScan = httpsCallable(functions, 'triggerPvpScan');
      const result = await triggerPvpScan({ resetCheckpoints, rewindDays: 7 });

      if (result.data.success) {
        alert(`✅ ${result.data.message}`);

        // Refresh logs immediately
        setRewardLogsLoading(true);
        const q = query(
          collection(db, 'reward_logs'),
          where('type', '==', 'pvp_win'),
          orderBy('timestamp', 'desc'),
          limit(20)
        );
        const snap = await getDocs(q);
        const logs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setPvpRewardLogs(logs);
        setRewardLogsLoading(false);

        logActivity({
          user,
          type: 'ADMIN',
          action: resetCheckpoints ? 'manual_pvp_reset_scan' : 'manual_pvp_scan',
          metadata: { count: result.data.count, resetCheckpoints }
        });
      }
    } catch (error) {
      console.error('Error triggering PvP scan:', error);
      alert('❌ Scan failed: ' + error.message);
    } finally {
      setIsScanningPvp(false);
    }
  };


  const handleDeleteRiddle = async (id) => {
    if (!window.confirm('Are you sure you want to delete this riddle?')) return;
    try {
      await deleteDoc(doc(db, 'riddles', id));
      setAllRiddles(prev => prev.filter(r => r.id !== id));
      alert('Riddle deleted.');
    } catch (error) {
      console.error('Error deleting riddle:', error);
      alert('Error: ' + error.message);
    }
  };

  const handleSeedExpandedRiddles = async () => {
    if (!window.confirm('This will seed 40 new riddles into the database. Continue?')) return;

    setProcessingId('seed_riddles');
    try {
      const riddlesBatch = [
        // ── AMIKO SKILLSETS (10) ──
        { question: "Which one is not part of Axobubbles Skillset?", options: ["Volt Surge III", "Reckless Shriek II", "Bubble Chain II", "Sear I"], correctIndex: 3, category: 'skillsets', difficulty: 'medium', enabled: true },
        { question: "Which one is not part of Keybab Skillset?", options: ["Devour III", "Burning Confidence II", "Spice Layer II", "Rest I"], correctIndex: 0, category: 'skillsets', difficulty: 'medium', enabled: true },
        { question: "Which one is not part of Bitebit Skillset?", options: ["Energetic Jba I", "Volt Surge III", "Flash Step I", "Devour III"], correctIndex: 1, category: 'skillsets', difficulty: 'hard', enabled: true },
        { question: "Which one is not part of Dracurve Skillset?", options: ["Draconic Roar II", "Clear Sky II", "Scorching Bite II", "Burning Confidence II"], correctIndex: 3, category: 'skillsets', difficulty: 'hard', enabled: true },
        { question: "Which one is not part of Dodorex Skillset?", options: ["Dumb Kick I", "Prime Target II", "Flash Step I", "PayBack II"], correctIndex: 2, category: 'skillsets', difficulty: 'medium', enabled: true },
        { question: "Which one is not part of Unikirin Skillset?", options: ["Recharge I", "Draconic Roar II", "Fulgurous Steps I", "Flamethrower I"], correctIndex: 1, category: 'skillsets', difficulty: 'hard', enabled: true },
        { question: "Which one is not part of Cybertooth Skillset?", options: ["Sandering Fang I", "Flowing Strike I", "Aqua Bolt I", "Shattering Wind II"], correctIndex: 0, category: 'skillsets', difficulty: 'hard', enabled: true },
        { question: "Which one is not part of Walpuff Skillset?", options: ["Wingblade II", "Headbutt II", "Stone Skin I", "Dumb Kick I"], correctIndex: 3, category: 'skillsets', difficulty: 'medium', enabled: true },
        { question: "Which one is not part of Dinotusk Skillset?", options: ["Shared Fate III", "Headbutt II", "NoPain, No Gain I", "Peak State I"], correctIndex: 1, category: 'skillsets', difficulty: 'hard', enabled: true },
        { question: "Which one is not part of Zzoo Skillset?", options: ["Flint Snap II", "Mirror Coat II", "Clear Sky II", "Talon Guard I"], correctIndex: 2, category: 'skillsets', difficulty: 'medium', enabled: true },

        // ── WHO AM I? (10) ──
        { question: "Who Am I?", imageUrl: "/amikos/hollowoo.png", options: ["Hollowoo", "Ghouliath", "Bloomtail", "Raccoin"], correctIndex: 0, category: 'who_am_i', difficulty: 'easy', enabled: true },
        { question: "Who Am I?", imageUrl: "/amikos/dodorex.png", options: ["Dodorex", "Chocorex", "Dinobit", "Keybab"], correctIndex: 0, category: 'who_am_i', difficulty: 'easy', enabled: true },
        { question: "Who Am I?", imageUrl: "/amikos/tokoma.png", options: ["Tokoma", "Oogrock", "Zzoo", "Unikirin"], correctIndex: 0, category: 'who_am_i', difficulty: 'easy', enabled: true },
        { question: "Who Am I?", imageUrl: "/amikos/ghouliath.png", options: ["Ghouliath", "Hollowoo", "Walpuff", "Wassie"], correctIndex: 0, category: 'who_am_i', difficulty: 'easy', enabled: true },
        { question: "Who Am I?", imageUrl: "/amikos/bloomtail.png", options: ["Bloomtail", "Axobubble", "N9", "Lucky"], correctIndex: 0, category: 'who_am_i', difficulty: 'easy', enabled: true },
        { question: "Who Am I?", imageUrl: "/amikos/oogrock.png", options: ["Oogrock", "Cybertooth", "Dinotusk", "Tokoma"], correctIndex: 0, category: 'who_am_i', difficulty: 'medium', enabled: true },
        { question: "Who Am I?", imageUrl: "/amikos/znix.png", options: ["Znix", "Bitebit", "Walpuff", "Dipking"], correctIndex: 0, category: 'who_am_i', difficulty: 'hard', enabled: true },
        { question: "Who Am I?", imageUrl: "/amikos/raccoin.png", options: ["Raccoin", "Lucky", "Unika", "Shibark"], correctIndex: 0, category: 'who_am_i', difficulty: 'easy', enabled: true },
        { question: "Who Am I?", imageUrl: "/amikos/shiba-ignite.png", options: ["Shiba Ignite", "Shibark", "Dracurve", "Keybab"], correctIndex: 0, category: 'who_am_i', difficulty: 'medium', enabled: true },
        { question: "Who Am I?", imageUrl: "/amikos/dinobit.png", options: ["Dinobit", "Dinotusk", "Dodorex", "Raccoin"], correctIndex: 0, category: 'who_am_i', difficulty: 'easy', enabled: true },

        // ── EGG MASTER (10) ──
        { question: "Which egg contains: Lucky, Logator, Bubllu Popper?", options: ["Zen Egg", "Dune Egg", "Cliff Egg", "Marsh Egg"], correctIndex: 0, category: 'egg_master', difficulty: 'medium', enabled: true },
        { question: "Which egg contains Beeblock, Chocorex, and Keybab?", options: ["Dune Egg", "Frost Egg", "Volatile Egg", "Zen Egg"], correctIndex: 0, category: 'egg_master', difficulty: 'medium', enabled: true },
        { question: "Which egg contains Raccoin, Shibark, and Unikirin?", options: ["Cliff Egg", "Aurora Egg", "Zen Egg", "Marsh Egg"], correctIndex: 0, category: 'egg_master', difficulty: 'medium', enabled: true },
        { question: "Which egg contains Chocomint, Ghouliath, and Walpuff?", options: ["Aurora Egg", "Frost Egg", "Marsh Egg", "Volatile Egg"], correctIndex: 0, category: 'egg_master', difficulty: 'medium', enabled: true },
        { question: "Which egg contains Cybertooth, Dinotusk, and Oogrock?", options: ["Frost Egg", "Cliff Egg", "Dune Egg", "Aurora Egg"], correctIndex: 0, category: 'egg_master', difficulty: 'medium', enabled: true },
        { question: "Which egg does Dipking belong to?", options: ["Volatile Egg", "Marsh Egg", "Zen Egg", "Coco Egg"], correctIndex: 0, category: 'egg_master', difficulty: 'hard', enabled: true },
        { question: "Which egg contains the Matriarch Bloomtail?", options: ["Bloomer Egg", "Marsh Egg", "Zen Egg", "Aurora Egg"], correctIndex: 0, category: 'egg_master', difficulty: 'hard', enabled: true },
        { question: "Which egg contains Dinobit, Raccoin, and Wassie?", options: ["Dune Egg", "Cliff Egg", "Zen Egg", "Marsh Egg"], correctIndex: 0, category: 'egg_master', difficulty: 'medium', enabled: true },
        { question: "Which egg contains Axobubble, Bloomtail, and N9?", options: ["Marsh Egg", "Aurora Egg", "Zen Egg", "Cliff Egg"], correctIndex: 0, category: 'egg_master', difficulty: 'medium', enabled: true },
        { question: "Which egg contains Dodorex?", options: ["Coco Egg", "Zen Egg", "Cliff Egg", "Marsh Egg"], correctIndex: 0, category: 'egg_master', difficulty: 'hard', enabled: true },

        // ── PASSIVE EFFECTS (10) ──
        { question: "What is the Passive Skill of Pandata?", options: ["Maintenance", "Crabby", "Wash It Down", "Power Nap"], correctIndex: 0, category: 'passives', difficulty: 'medium', enabled: true },
        { question: "What is the Passive Skill of Bubble Popper?", options: ["Crabby", "Hexdrinker", "Maintenance", "Second Wind"], correctIndex: 0, category: 'passives', difficulty: 'medium', enabled: true },
        { question: "What is the Passive Skill of Block Choy?", options: ["Wash It Down", "Power Nap", "Maintenance", "Scarecrow"], correctIndex: 0, category: 'passives', difficulty: 'medium', enabled: true },
        { question: "What is the Passive Skill of Raccoin?", options: ["Power Nap", "Maintenance", "Hexdrinker", "Swan Song"], correctIndex: 0, category: 'passives', difficulty: 'medium', enabled: true },
        { question: "What is the Passive Skill of Number 9?", options: ["Hexdrinker", "Scarecrow", "Insulated", "Eye of the Storm"], correctIndex: 0, category: 'passives', difficulty: 'hard', enabled: true },
        { question: "What does the 'Swan Song' effect do?", options: ["After each action, if Cursed, +1 Mana", "Heal on Unlucky Hit", "Shadowbind on swap in", "Starts with Lightning Res"], correctIndex: 0, category: 'passives', difficulty: 'hard', enabled: true },
        { question: "What does the 'Insulated' effect do?", options: ["Starts with +5 Lightning Res & Uncleansable", "Opponent Atk -2 when hit by Lightning", "Heal on Unlucky Hit", "Mana if Cursed"], correctIndex: 0, category: 'passives', difficulty: 'hard', enabled: true },
        { question: "What does the 'Eye of the Storm' effect do?", options: ["Opponent Atk/Ether Atk -2 when hit by Lightning", "Starts with +5 Lightning Res", "Shadowbind on swap in", "Mana if Cursed"], correctIndex: 0, category: 'passives', difficulty: 'hard', enabled: true },
        { question: "What does the 'Scarecrow' effect do?", options: ["Every time this Amiko Swaps in, Shadowbind Opponent (2 turns)", "Atk -2 when hit by Lightning", "Heal on Unlucky Hit", "Lightning Res"], correctIndex: 0, category: 'passives', difficulty: 'hard', enabled: true },
        { question: "What does the 'Second Wind' effect do?", options: ["Every time this Amiko Unlucky Hits, Heal 7% Max HP", "Mana if Cursed", "Lightning Res", "Shadowbind on swap in"], correctIndex: 0, category: 'passives', difficulty: 'hard', enabled: true }
      ];

      const batch = writeBatch(db);
      riddlesBatch.forEach(r => {
        const ref = doc(collection(db, 'riddles'));
        batch.set(ref, {
          ...r,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      });

      await batch.commit();
      alert(`✅ Successfully seeded ${riddlesBatch.length} new riddles!`);

      // Refresh list
      const snapshot = await getDocs(collection(db, 'riddles'));
      setAllRiddles(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch (e) {
      console.error('Seed error:', e);
      alert('Error seeding: ' + e.message);
    } finally {
      setProcessingId('');
    }
  };

  const handleEditRiddle = (riddle) => {
    setNewRiddle({
      id: riddle.id || '',
      question: riddle.question || '',
      options: [
        riddle.options?.[0] || '',
        riddle.options?.[1] || '',
        riddle.options?.[2] || '',
        riddle.options?.[3] || ''
      ],
      correctIndex: riddle.correctIndex ?? 0,
      category: riddle.category || 'norse',
      difficulty: riddle.difficulty || 'easy',
      enabled: riddle.enabled ?? true,
      imageUrl: riddle.imageUrl || ''
    });
    setRiddleFile(null);
    setRiddlePreview('');
    const formElement = document.querySelector('.riddle-form-card');
    if (formElement) formElement.scrollIntoView({ behavior: 'smooth' });
  };

  const handleAutoAssignIcons = async (gameType) => {
    if (!window.confirm(`This will overwrite all current prize icons for ${gameType} with themed classic symbols based on rarity. Continue?`)) return;

    setIsAutoAssigning(true);
    try {
      const configRef = doc(db, 'settings', 'mini_games');
      const gameConfig = miniGamesConfig[gameType];
      if (!gameConfig || !gameConfig.prizes) return;

      const updatedPrizes = gameConfig.prizes.map(prize => {
        const icons = getRecommendedIcons(prize.rarity, prize.isJackpot);
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
      name: prize.name || '',
      type: prize.type || 'valcoins',
      amount: prize.amount ?? 10,
      weight: prize.weight ?? 10,
      rarity: prize.rarity || 'common',
      icon: prize.icon || 'common_horn.png',
      isJackpot: prize.isJackpot || false
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

  // Yggdrasil Event Handlers
  const handleYggPrizeUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 1024 * 1024) {
        alert('Image too large. Please use an image under 1MB.');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setYggEventPrizePreview(reader.result);
        setNewYggEvent(prev => ({ ...prev, prizeImage: reader.result }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveYggEvent = async () => {
    if (!newYggEvent.name || !newYggEvent.prizeName || !newYggEvent.prizeImage) {
      alert('Please fill in all required fields (Name, Prize Name, and Prize Image)');
      return;
    }

    setProcessingId('save_ygg_event');
    try {
      const randomAltitude = Math.floor(Math.random() * (parseInt(newYggEvent.altitudeTo) - parseInt(newYggEvent.altitudeFrom) + 1)) + parseInt(newYggEvent.altitudeFrom);

      const eventData = {
        ...newYggEvent,
        targetAltitude: editingYggEventId ? (newYggEvent.targetAltitude || randomAltitude) : randomAltitude,
        currentPool: editingYggEventId ? (newYggEvent.currentPool || 0) : 0,
        status: newYggEvent.status || 'open',
        winner: newYggEvent.winner || null,
        updatedAt: serverTimestamp()
      };

      if (editingYggEventId) {
        await updateDoc(doc(db, 'yggdrasil_events', editingYggEventId), eventData);
      } else {
        eventData.createdAt = serverTimestamp();
        await addDoc(collection(db, 'yggdrasil_events'), eventData);
      }

      setIsCreatingYggEvent(false);
      setEditingYggEventId(null);
      setNewYggEvent({
        name: '',
        entryFee: 5,
        currency: 'AURY',
        prizeName: '',
        prizeImage: '',
        prizeRarity: 'epic',
        altitudeFrom: 5000,
        altitudeTo: 15000,
        targetPool: 60,
        status: 'open',
        redRunesEnabled: false
      });
      setYggEventPrizePreview('');
      alert(editingYggEventId ? 'Event updated successfully!' : 'Yggdrasil Event created successfully!');
    } catch (error) {
      console.error('Error saving Yggdrasil event:', error);
      alert('Failed to save event: ' + error.message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleStartEditYggEvent = (event) => {
    setEditingYggEventId(event.id);
    setNewYggEvent({
      name: event.name,
      entryFee: event.entryFee,
      currency: event.currency || 'AURY',
      prizeName: event.prizeName,
      prizeImage: event.prizeImage,
      prizeRarity: event.prizeRarity || 'epic',
      altitudeFrom: event.altitudeFrom || 5000,
      altitudeTo: event.altitudeTo || 15000,
      targetPool: event.targetPool,
      status: event.status,
      redRunesEnabled: event.redRunesEnabled || false,
      // Preserve hidden fields if we're editing
      targetAltitude: event.targetAltitude,
      currentPool: event.currentPool,
      winner: event.winner || null,
      winnerId: event.winnerId || null,
      winnerName: event.winnerName || null,
      claimTimestamp: event.claimTimestamp || null
    });
    setYggEventPrizePreview(event.prizeImage);
    setIsCreatingYggEvent(true);
  };

  const handleCloseYggEvent = async (eventId) => {
    if (!window.confirm('Are you sure you want to manually close this event?')) return;
    try {
      await updateDoc(doc(db, 'yggdrasil_events', eventId), {
        status: 'closed',
        closedAt: serverTimestamp(),
        closedBy: user.email
      });
    } catch (error) {
      console.error('Error closing event:', error);
    }
  };

  const handleReopenYggEvent = async (eventId) => {
    if (!window.confirm('Are you sure you want to REOPEN this event? This will clear the previous winner and make the prize claimable again.')) return;

    setProcessingId('reopen_ygg_event');
    try {
      await updateDoc(doc(db, 'yggdrasil_events', eventId), {
        status: 'open',
        winner: null,
        winnerId: null,
        winnerName: null,
        claimTimestamp: null,
        reopenedAt: serverTimestamp(),
        reopenedBy: user.email
      });
      alert('Event reopened successfully!');
    } catch (error) {
      console.error('Error reopening event:', error);
      alert('Failed to reopen: ' + error.message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleDeleteYggEvent = async (eventId) => {
    if (!window.confirm('Delete this event forever?')) return;
    try {
      await deleteDoc(doc(db, 'yggdrasil_events', eventId));
    } catch (error) {
      console.error('Error deleting event:', error);
    }
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

        let totalAury = 0;
        // Create a map of balances for easy lookup
        const balanceMap = {};
        walletsSnapshot.forEach(doc => {
          const data = doc.data();
          const bal = data.balance || 0;
          totalAury += bal;
          balanceMap[doc.id] = {
            balance: bal,
            usdcBalance: data.usdcBalance || 0
          };
        });
        setTotalCirculatingAury(totalAury);

        const users = usersSnapshot.docs.map(doc => {
          const balances = balanceMap[doc.id] || { balance: 0, usdcBalance: 0 };
          return {
            id: doc.id,
            ...doc.data(),
            balance: balances.balance,
            usdcBalance: balances.usdcBalance
          };
        }).filter(u => (u.email || u.displayName || u.username || u.auroryPlayerId) && (!u.isGuest || u.auroryPlayerId));

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

  // Fetch Yggdrasil Events
  useEffect(() => {
    if (!isAdmin) return;
    const eventsRef = collection(db, 'yggdrasil_events');
    const q = query(eventsRef, orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setYggEvents(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
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

  // Fetch Wallet History (Unified: AURY/USDC + Valcoins)
  useEffect(() => {
    if (activeTab !== 'walletHistory' || !selectedWalletHistoryUser || !isSuperAdminUser) {
      setWalletHistoryTransactions([]);
      return;
    }

    setWalletHistoryLoading(true);
    const userId = selectedWalletHistoryUser.id;

    // 1. Listen to AURY/USDC wallet transactions
    const walletTxRef = collection(db, 'wallets', userId, 'transactions');
    const walletQ = query(walletTxRef, orderBy('timestamp', 'desc'));

    // 2. Listen to Valcoin pointsHistory
    const pointsTxRef = collection(db, 'users', userId, 'pointsHistory');
    const pointsQ = query(pointsTxRef, orderBy('timestamp', 'desc'));

    let walletTxs = [];
    let pointsTxs = [];
    let walletLoaded = false;
    let pointsLoaded = false;

    const mergeAndSet = () => {
      if (!walletLoaded || !pointsLoaded) return;

      // Normalize pointsHistory entries to match wallet transaction format
      const normalizedPoints = pointsTxs.map(tx => ({
        ...tx,
        source: 'points',
        currency: tx.currency || 'Valcoins',
        // For display: pointsHistory stores raw amounts, no smallest-unit conversion needed
        displayAmount: tx.amount
      }));

      const normalizedWallet = walletTxs.map(tx => ({
        ...tx,
        source: 'wallet'
      }));

      // Merge and sort by timestamp descending
      const combined = [...normalizedWallet, ...normalizedPoints]
        .sort((a, b) => {
          const tsA = a.timestamp?.toMillis?.() || 0;
          const tsB = b.timestamp?.toMillis?.() || 0;
          return tsB - tsA;
        });

      setWalletHistoryTransactions(combined);
      setWalletHistoryLoading(false);
    };

    const unsub1 = onSnapshot(walletQ, (snapshot) => {
      walletTxs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      walletLoaded = true;
      mergeAndSet();
    }, (error) => {
      console.error('Error fetching wallet transactions:', error);
      walletLoaded = true;
      mergeAndSet();
    });

    const unsub2 = onSnapshot(pointsQ, (snapshot) => {
      pointsTxs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      pointsLoaded = true;
      mergeAndSet();
    }, (error) => {
      console.error('Error fetching points history:', error);
      pointsLoaded = true;
      mergeAndSet();
    });

    return () => { unsub1(); unsub2(); };
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

  // Fetch Economy Data
  useEffect(() => {
    if (!isGeneralAdmin || activeTab !== 'economy') return;

    setEconomyLoading(true);

    // 1. Fetch Processed Deposits
    const qDeposits = query(
      collection(db, 'depositNotifications'),
      where('status', '==', 'processed'),
      orderBy('processedAt', 'desc'),
      limit(500)
    );

    // 2. Fetch Completed Withdrawals
    const qWithdrawals = query(
      collection(db, 'withdrawals'),
      where('status', '==', 'completed'),
      orderBy('processedAt', 'desc'),
      limit(500)
    );

    // 3. Fetch Shop Sales
    const qSales = query(
      collection(db, 'cosmetic_sales'),
      orderBy('timestamp', 'desc'),
      limit(500)
    );

    const unsubDeposits = onSnapshot(qDeposits, (snap) => {
      setEconomyDeposits(snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(d => (d.currency || 'AURY').toUpperCase() === 'AURY')
      );
    });

    const unsubWithdrawals = onSnapshot(qWithdrawals, (snap) => {
      setEconomyWithdrawals(snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(w => (w.currency || 'AURY').toUpperCase() === 'AURY')
      );
    });

    const unsubSales = onSnapshot(qSales, (snap) => {
      setEconomyShopSales(snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(s => (s.currency || 'AURY').toUpperCase() === 'AURY')
      );
      setEconomyLoading(false);
    });

    // Listener for all Burn transactions
    const qBurns = query(
      collectionGroup(db, 'transactions'),
      orderBy('timestamp', 'desc'),
      limit(1000)
    );
    const unsubBurns = onSnapshot(qBurns, (snap) => {
      const burnTypes = ['raffle_entry', 'raffle_fee', 'entry_fee', 'cosmetic_purchase', 'manual_deduction', 'ygg_event_entry', 'shop_purchase', 'deduction'];
      const list = snap.docs
        .map(d => {
          const data = d.data();
          const path = d.ref.path.split('/');
          const userId = path[1];
          return { 
            id: d.id, 
            userId, 
            ...data,
            // Ensure timestamp is present for sorting if missing from raw data
            timestamp: data.timestamp || { seconds: 0 } 
          };
        })
        .filter(tx => {
          const currency = (tx.currency || 'AURY').toUpperCase();
          return currency === 'AURY' && burnTypes.includes(tx.type);
        });
      
      setEconomyBurns(list);
      const total = list.reduce((sum, tx) => sum + (tx.amount || 0), 0);
      setTotalAuryBurned(total);

      // Category breakdown
      const matchups = list.filter(tx => tx.type === 'entry_fee').reduce((sum, tx) => sum + (tx.amount || 0), 0);
      const raffles = list.filter(tx => ['raffle_entry', 'raffle_fee'].includes(tx.type)).reduce((sum, tx) => sum + (tx.amount || 0), 0);
      const shop = list.filter(tx => ['cosmetic_purchase', 'shop_purchase'].includes(tx.type)).reduce((sum, tx) => sum + (tx.amount || 0), 0);
      setBurnBreakdown({ matchups, raffles, shop });
      setEconomyError(null);
    }, (error) => {
      console.error("Error fetching burns:", error);
      setEconomyError(error.message);
    });

    return () => {
      unsubDeposits();
      unsubWithdrawals();
      unsubSales();
      unsubBurns();
    };
  }, [activeTab, isGeneralAdmin]);

  // Aggregate Economy Taxes
  useEffect(() => {
    if (activeTab !== 'economy') return;

    const withdrawalTaxes = economyWithdrawals.map(w => {
      const currency = w.currency?.toUpperCase() || 'AURY';
      const divisor = currency === 'USDC' ? 1e6 : 1e9;
      return {
        id: `wd-${w.id}`,
        source: 'Withdrawal Fee (2.5%)',
        details: `${currency} Withdrawal`,
        user: w.userId,
        userEmail: w.email || '',
        originalAmount: w.amount / divisor,
        taxAmount: (w.amount * 0.025) / divisor,
        currency: currency,
        timestamp: w.processedAt,
        isSmallestUnit: false
      };
    });

    const shopTaxes = economyShopSales.map(sale => {
      const price = sale.price || 0;
      const commission = sale.commission || 0; // creator share (60%)
      const taxAmount = price - commission; // platform share (40%)

      return {
        id: `shop-${sale.id}`,
        source: 'Shop Fee (40%)',
        details: sale.cosmeticName,
        user: sale.buyerName || sale.buyerId,
        originalAmount: price,
        taxAmount: taxAmount,
        currency: sale.currency || 'valcoins',
        timestamp: sale.timestamp,
        isSmallestUnit: false // Shop sales are stored in display units
      };
    });

    const combined = [...withdrawalTaxes, ...shopTaxes].sort((a, b) => {
      const tA = a.timestamp?.seconds || 0;
      const tB = b.timestamp?.seconds || 0;
      return tB - tA;
    });

    setEconomyTaxes(combined);
  }, [economyWithdrawals, economyShopSales, activeTab]);


  // Fetch all riddles for management
  useEffect(() => {
    if (activeTab === 'mini_games' && activeGameType === 'odinsRiddle') {
      const fetchRiddles = async () => {
        setRiddlesLoading(true);
        try {
          const riddlesRef = collection(db, 'riddles');
          const snapshot = await getDocs(riddlesRef);
          const riddles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          // Sort by category then difficulty
          riddles.sort((a, b) => a.category.localeCompare(b.category) || a.difficulty.localeCompare(b.difficulty));
          setAllRiddles(riddles);
        } catch (error) {
          console.error("Error fetching riddles:", error);
        }
        setRiddlesLoading(false);
      };
      fetchRiddles();
    }
  }, [activeTab, activeGameType]);

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

  // Economy CRUD Functions
  const handleDeleteEconomyRecord = async (record) => {
    if (!isSuperAdminUser) return;

    // Determine collection from ID prefix or source
    let collectionName = 'depositNotifications';
    let realId = record.id;
    if (record.id.startsWith('wd-')) {
      collectionName = 'withdrawals';
      realId = record.id.replace('wd-', '');
    } else if (record.id.startsWith('shop-')) {
      collectionName = 'cosmetic_sales';
      realId = record.id.replace('shop-', '');
    }

    if (!window.confirm(`Are you sure you want to delete this ${collectionName} record?`)) return;

    try {
      await deleteDoc(doc(db, collectionName, realId));
      alert('Record deleted successfully.');
      logActivity({
        user,
        type: 'ADMIN',
        action: 'delete_economy_record',
        metadata: { collection: collectionName, id: realId }
      });
    } catch (error) {
      console.error('Error deleting record:', error);
      alert('Failed to delete record: ' + error.message);
    }
  };

  const handleOpenEconomyEdit = (record = null) => {
    if (record) {
      // Determine type
      let type = 'deposit';
      let realId = record.id;
      if (record.id.startsWith('wd-')) {
        type = 'withdrawal';
        realId = record.id.replace('wd-', '');
      } else if (record.id.startsWith('shop-')) {
        type = 'sale';
        realId = record.id.replace('shop-', '');
      }

      setEditingEconomyRecord({ ...record, realId, type });
      setEconomyForm({
        type: type,
        amount: record.amount || record.originalAmount || 0,
        currency: record.currency || 'AURY',
        userEmail: record.userEmail || record.email || '',
        userId: record.userId || record.user || '',
        txSignature: record.txSignature || '',
        details: record.details || '',
        status: record.status || 'processed',
        timestamp: record.timestamp?.toDate()?.toISOString()?.slice(0, 16) || ''
      });
    } else {
      setEditingEconomyRecord(null);
      setEconomyForm({
        type: 'deposit',
        amount: '',
        currency: 'AURY',
        userEmail: '',
        userId: '',
        txSignature: '',
        details: '',
        status: 'processed',
        timestamp: new Date().toISOString().slice(0, 16)
      });
    }
    setShowEconomyModal(true);
  };

  const handleSaveEconomyRecord = async () => {
    if (!isSuperAdminUser) return;
    setProcessingId('save_economy');

    try {
      const collectionMapping = {
        'deposit': 'depositNotifications',
        'withdrawal': 'withdrawals',
        'sale': 'cosmetic_sales'
      };

      const collectionName = collectionMapping[economyForm.type];
      const data = {
        amount: parseFloat(economyForm.amount),
        currency: economyForm.currency,
        status: economyForm.status,
        updatedAt: serverTimestamp()
      };

      // Add collection-specific fields
      if (economyForm.type === 'deposit') {
        data.userEmail = economyForm.userEmail;
        data.userId = economyForm.userId;
        data.txSignature = economyForm.txSignature;
        data.processedAt = economyForm.timestamp ? Timestamp.fromDate(new Date(economyForm.timestamp)) : serverTimestamp();
      } else if (economyForm.type === 'withdrawal') {
        data.email = economyForm.userEmail;
        data.userId = economyForm.userId;
        data.processedAt = economyForm.timestamp ? Timestamp.fromDate(new Date(economyForm.timestamp)) : serverTimestamp();
      } else if (economyForm.type === 'sale') {
        data.buyerName = economyForm.userEmail;
        data.buyerId = economyForm.userId;
        data.cosmeticName = economyForm.details;
        data.timestamp = economyForm.timestamp ? Timestamp.fromDate(new Date(economyForm.timestamp)) : serverTimestamp();
        // Recalculate commission if it's a sale (60/40 split)
        data.commission = data.amount * 0.6;
      }

      if (editingEconomyRecord) {
        await updateDoc(doc(db, collectionName, editingEconomyRecord.realId), data);
      } else {
        data.createdAt = serverTimestamp();
        await addDoc(collection(db, collectionName), data);
      }

      alert(`Record ${editingEconomyRecord ? 'updated' : 'added'} successfully.`);
      setShowEconomyModal(false);
      logActivity({
        user,
        type: 'ADMIN',
        action: editingEconomyRecord ? 'update_economy_record' : 'add_economy_record',
        metadata: { type: economyForm.type, amount: data.amount }
      });
    } catch (error) {
      console.error('Error saving economy record:', error);
      alert('Failed to save record: ' + error.message);
    } finally {
      setProcessingId(null);
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

  const handleSaveDiscordSettings = async () => {
    setProcessingId('save_discord');
    try {
      await setDoc(doc(db, 'settings', 'discord_bot'), {
        enabled: discordCommandsEnabled,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
        updatedByName: resolveDisplayName(user)
      }, { merge: true });

      alert('Discord settings saved successfully!');

      logActivity({
        user,
        type: 'ADMIN',
        action: 'update_discord_settings',
        metadata: { enabled: discordCommandsEnabled }
      });
    } catch (error) {
      console.error('Error saving discord settings:', error);
      alert('Failed to save discord settings.');
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
    if (!isSeniorAdminUser) return;
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

  // Chatbot Knowledge Handlers
  const handleSaveChatbotKnowledge = async () => {
    if (!cbResponse) return alert('Response is required');
    if (!cbLabel && !cbKeywords) return alert('At least a Label or Keywords are required so Runie knows when to use this response.');

    setProcessingId('chatbot');
    try {
      const data = {
        label: cbLabel,
        keywords: cbKeywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean),
        response: cbResponse,
        order: parseInt(cbOrder) || 0,
        showAsBadge: cbShowAsBadge,
        updatedAt: serverTimestamp()
      };

      if (editingKnowledgeId) {
        await updateDoc(doc(db, 'chatbot_knowledge', editingKnowledgeId), data);
        alert('Knowledge item updated!');
      } else {
        await addDoc(collection(db, 'chatbot_knowledge'), {
          ...data,
          createdAt: serverTimestamp()
        });
        alert('Knowledge item added!');
      }
      resetChatbotForm();
    } catch (error) {
      console.error('Error saving chatbot knowledge:', error);
      alert('Error saving: ' + error.message);
    }
    setProcessingId(null);
  };

  const resetChatbotForm = () => {
    setCbLabel('');
    setCbKeywords('');
    setCbResponse('');
    setCbOrder(0);
    setCbShowAsBadge(true);
    setEditingKnowledgeId(null);
  };

  const handleEditKnowledge = (item) => {
    setCbLabel(item.label || '');
    setCbKeywords(item.keywords ? item.keywords.join(', ') : '');
    setCbResponse(item.response || '');
    setCbOrder(item.order || 0);
    setCbShowAsBadge(item.showAsBadge !== false);
    setEditingKnowledgeId(item.id);

    // Scroll to form
    const formElement = document.querySelector('.chatbot-form-card');
    if (formElement) formElement.scrollIntoView({ behavior: 'smooth' });
  };

  const handleDeleteKnowledge = async (id) => {
    if (!window.confirm('Are you sure you want to delete this knowledge item?')) return;
    try {
      await deleteDoc(doc(db, 'chatbot_knowledge', id));
      alert('Deleted successfully!');
    } catch (error) {
      console.error('Error deleting knowledge:', error);
      alert('Error deleting: ' + error.message);
    }
  };

  const handleDeleteUnansweredQuery = async (id) => {
    try {
      await deleteDoc(doc(db, 'chatbot_unanswered', id));
    } catch (error) {
      console.error('Error deleting unanswered query:', error);
    }
  };

  const handleResolveUnansweredQuery = (queryItem) => {
    setCbLabel(queryItem.query);
    setCbKeywords(queryItem.query);
    setCbResponse('');
    setEditingKnowledgeId(null);

    // Jump to form
    const formElement = document.querySelector('.chatbot-form-card');
    if (formElement) formElement.scrollIntoView({ behavior: 'smooth' });
  };

  // Greeting Handlers
  const handleSaveGreeting = async () => {
    if (!cbGreetingText) return alert('Greeting text is required');

    setProcessingId('greeting');
    try {
      const data = {
        text: cbGreetingText,
        order: parseInt(cbGreetingOrder) || 0,
        updatedAt: serverTimestamp()
      };

      if (editingGreetingId) {
        await updateDoc(doc(db, 'chatbot_greetings', editingGreetingId), data);
        alert('Greeting updated!');
      } else {
        await addDoc(collection(db, 'chatbot_greetings'), {
          ...data,
          createdAt: serverTimestamp()
        });
        alert('Greeting added!');
      }
      resetGreetingForm();
    } catch (error) {
      console.error('Error saving greeting:', error);
      alert('Error saving: ' + error.message);
    }
    setProcessingId(null);
  };

  const handleToggleChatbot = async (enabled) => {
    try {
      await updateDoc(doc(db, 'settings', 'chatbot'), {
        enabled,
        updatedAt: serverTimestamp()
      });
      logActivity({
        user,
        type: 'ADMIN',
        action: 'toggle_chatbot',
        metadata: { enabled }
      });
    } catch (error) {
      console.error('Error toggling chatbot:', error);
      alert('Error: ' + error.message);
    }
  };

  const handleToggleDamageCalc = async (enabled) => {
    try {
      await updateDoc(doc(db, 'settings', 'chatbot'), {
        damageCalcEnabled: enabled,
        updatedAt: serverTimestamp()
      });
      logActivity({
        user,
        type: 'ADMIN',
        action: 'toggle_damage_calc',
        metadata: { enabled }
      });
    } catch (error) {
      console.error('Error toggling damage calculator:', error);
      alert('Error: ' + error.message);
    }
  };

  const resetGreetingForm = () => {
    setCbGreetingText('');
    setCbGreetingOrder(0);
    setEditingGreetingId(null);
  };

  const handleEditGreeting = (item) => {
    setCbGreetingText(item.text || '');
    setCbGreetingOrder(item.order || 0);
    setEditingGreetingId(item.id);

    // Scroll to form
    const formElement = document.querySelector('.greetings-form-card');
    if (formElement) formElement.scrollIntoView({ behavior: 'smooth' });
  };

  const handleDeleteGreeting = async (id) => {
    if (!window.confirm('Are you sure you want to delete this greeting?')) return;
    try {
      await deleteDoc(doc(db, 'chatbot_greetings', id));
      alert('Greeting deleted!');
    } catch (error) {
      console.error('Error deleting greeting:', error);
      alert('Error deleting: ' + error.message);
    }
  };

  const handleSeedDefaultKnowledge = async () => {
    if (chatbotKnowledge.length > 0) {
      if (!window.confirm('You already have some knowledge items. Importing defaults will add them to the list. Proceed?')) return;
    } else {
      if (!window.confirm('This will initialize Runie with her core knowledge base. This makes her default answers editable. Proceed?')) return;
    }

    setProcessingId('seed_chatbot');
    try {
      const batch = writeBatch(db);

      DEFAULT_KNOWLEDGE.forEach((item, index) => {
        const newDocRef = doc(collection(db, 'chatbot_knowledge'));
        batch.set(newDocRef, {
          label: item.label || '',
          keywords: item.keywords || [],
          response: item.response || '',
          order: index + 1,
          showAsBadge: item.showAsBadge !== false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      });

      await batch.commit();
      alert('✅ Runie core knowledge initialized successfully!');

      logActivity({
        user,
        type: 'ADMIN',
        action: 'seed_chatbot_knowledge',
        metadata: { count: DEFAULT_KNOWLEDGE.length }
      });
    } catch (error) {
      console.error('Error seeding chatbot knowledge:', error);
      alert('Error: ' + error.message);
    } finally {
      setProcessingId(null);
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

  // Handle cleanup of inactive guest accounts
  const handleCleanupInactiveGuests = async () => {
    if (!isSuperAdminUser || (activeTab === 'users' && wipeAllConfirmText !== 'WIPE ALL')) return;

    const confirmMessage = activeTab === 'visitors'
      ? '🧹 Are you sure you want to delete all anonymous Guest accounts that have been inactive for over 1 minute? This is irreversible.'
      : '🧹 Are you sure you want to delete all anonymous Guest accounts that have been inactive for over 1 minute? This is irreversible.';

    if (!window.confirm(confirmMessage)) return;

    setIsWiping(true);
    setProcessingId('cleanup_guests');
    try {
      const cleanupFn = httpsCallable(functions, 'cleanupInactiveGuests');
      const { data: result } = await cleanupFn({});

      if (result?.success) {
        alert(result.message);
        setWipeAllConfirmText('');

        logActivity({
          user,
          type: 'ADMIN',
          action: 'cleanup_inactive_guests',
          metadata: { deletedCount: result.count }
        });
      } else {
        throw new Error(result?.message || 'Cleanup failed');
      }
    } catch (error) {
      console.error('Cleanup error:', error);
      alert('Error: ' + error.message);
    } finally {
      setIsWiping(false);
      setProcessingId(null);
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

  // Targeted Valcoin Reset (Only points field)
  const handleResetAllValcoinBalances = async () => {
    if (!isSuperAdminUser || wipeAllConfirmText !== 'WIPE ALL') return;
    if (!window.confirm('🚨 WARNING: This will permanently reset ALL user Valcoin balances to 0. AURY and USDC balances will remain untouched. Proceed?')) return;

    setIsWiping(true);
    setProcessingId('reset_valcoins');
    try {
      const resetFn = httpsCallable(functions, 'resetAllValcoinBalances');
      const { data: result } = await resetFn({});

      if (result?.success) {
        alert(result.message);
        setWipeAllConfirmText('');

        logActivity({
          user,
          type: 'ADMIN',
          action: 'reset_all_valcoins',
          metadata: { userCount: result.count }
        });

        // Refresh users in local state if needed
        setAllUsers(prev => prev.map(u => ({ ...u, points: 0 })));
      } else {
        throw new Error(result?.message || 'Reset failed');
      }
    } catch (error) {
      console.error('Valcoin reset error:', error);
      alert('Error: ' + error.message);
    } finally {
      setIsWiping(false);
      setProcessingId(null);
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

  // Firestore Editor Helpers
  const handleOpenUserEditor = (u) => {
    if (!isSuperAdminUser) return;
    setUserToEditFirestore(u);
    // Deep clone the user data (simple JSON clone works for primary data types)
    const data = JSON.parse(JSON.stringify(u));
    setLocalEditingData(data);
  };

  const handleUpdateLocalData = (path, value) => {
    setLocalEditingData(prev => {
      const newData = { ...prev };
      let current = newData;
      const parts = path.split('.');
      for (let i = 0; i < parts.length - 1; i++) {
        current = current[parts[i]];
      }
      current[parts[parts.length - 1]] = value;
      return newData;
    });
  };

  const handleDeleteLocalDataField = (path) => {
    setLocalEditingData(prev => {
      const newData = { ...prev };
      let current = newData;
      const parts = path.split('.');
      for (let i = 0; i < parts.length - 1; i++) {
        current = current[parts[i]];
      }
      delete current[parts[parts.length - 1]];
      return newData;
    });
  };

  const handleAddFieldToLocalData = (path, key, type) => {
    if (!key) return;
    setLocalEditingData(prev => {
      const newData = { ...prev };
      let current = newData;
      if (path) {
        const parts = path.split('.');
        for (let i = 0; i < parts.length; i++) {
          current = current[parts[i]];
        }
      }

      if (current[key] !== undefined) {
        alert('Field already exists');
        return prev;
      }

      let defaultValue;
      switch (type) {
        case 'number': defaultValue = 0; break;
        case 'boolean': defaultValue = false; break;
        case 'object': defaultValue = {}; break;
        case 'array': defaultValue = []; break;
        default: defaultValue = '';
      }

      current[key] = defaultValue;
      return newData;
    });
    setNewFieldKey('');
  };

  const handleSaveFirestoreUser = async () => {
    if (!userToEditFirestore || !localEditingData) return;
    if (!window.confirm('Are you sure you want to SAVE these changes directly to Firestore? This is absolute "God Mode" and can break accounts if values are incorrect.')) return;

    setIsSavingEditingDoc(true);
    try {
      const userRef = doc(db, 'users', userToEditFirestore.id);

      // We don't want to save some fields that shouldn't be touched or are metadata from the fetch
      const { id, ...dataToSave } = localEditingData;

      await setDoc(userRef, dataToSave, { merge: false }); // Overwrite with merge: false to allow deletions

      logActivity({
        user,
        type: 'ADMIN',
        action: 'god_mode_user_update',
        metadata: { userId: id, changedFields: Object.keys(dataToSave) }
      });

      alert('✅ User document updated successfully!');
      setUserToEditFirestore(null);
      setLocalEditingData(null);
    } catch (error) {
      console.error('Error saving Firestore document:', error);
      alert('❌ Error: ' + error.message);
    } finally {
      setIsSavingEditingDoc(false);
    }
  };

  const renderFirestoreField = (key, value, path = '') => {
    const fullPath = path ? `${path}.${key}` : key;
    // Fix: Handle null explicitly because typeof null is "object"
    const type = value === null ? 'null' : (Array.isArray(value) ? 'array' : (value && typeof value === 'object' ? 'object' : typeof value));

    if (type === 'object' || type === 'array') {
      return (
        <div key={fullPath} className="firestore-nested-group">
          <div className="nested-header">
            <span className="field-key">{key} <span className="type-tag">{type}</span></span>
            <button className="del-btn-mini" onClick={() => handleDeleteLocalDataField(fullPath)}>×</button>
          </div>
          <div className="nested-body">
            {Object.entries(value).map(([childKey, childValue]) => renderFirestoreField(childKey, childValue, fullPath))}
            <div className="add-field-mini">
              <input
                type="text"
                placeholder="New key..."
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.target.value) {
                    handleAddFieldToLocalData(fullPath, e.target.value, 'string');
                    e.target.value = '';
                  }
                }}
              />
              <span>(Enter to Add)</span>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div key={fullPath} className="firestore-field-row">
        <div className="key-section">
          <span className="field-key">{key}</span>
          <span className="type-tag">{type}</span>
        </div>
        <div className="value-section">
          {type === 'boolean' ? (
            <input
              type="checkbox"
              checked={value}
              onChange={(e) => handleUpdateLocalData(fullPath, e.target.checked)}
            />
          ) : type === 'number' ? (
            <input
              type="number"
              value={value}
              onChange={(e) => handleUpdateLocalData(fullPath, parseFloat(e.target.value))}
            />
          ) : (
            <input
              type="text"
              value={value ?? ''}
              placeholder={value === null ? 'NULL' : ''}
              onChange={(e) => handleUpdateLocalData(fullPath, e.target.value)}
            />
          )}
          <button className="del-btn-mini" onClick={() => handleDeleteLocalDataField(fullPath)}>×</button>
        </div>
      </div>
    );
  };


  // Handle Leaderboard Migration (Firestore -> RTDB)
  const handleMigrateLeaderboards = async () => {
    if (!isSeniorAdminUser || wipeAllConfirmText !== 'WIPE ALL') {
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

  const handleRepairPvpLeaderboards = async () => {
    if (!window.confirm('🛠 This will scan all users and synchronize PvP wins/earnings with correct name priority. Proceed?')) return;

    setIsRepairingPvp(true);
    setProcessingId('repair_pvp_leaderboards');
    try {
      const repairFn = httpsCallable(functions, 'repairPvpLeaderboards');
      const { data: result } = await repairFn({});

      if (result?.success) {
        alert(result.message);
        logActivity({
          user,
          type: 'ADMIN',
          action: 'repair_pvp_leaderboards',
          metadata: { repairedCount: result.count }
        });
      } else {
        throw new Error(result?.message || 'Repair failed');
      }
    } catch (error) {
      console.error('Repair error:', error);
      alert('Error: ' + error.message);
    } finally {
      setIsRepairingPvp(false);
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

  const processPrizeClaim = async (claimId, userId, prizeId, action) => {
    setProcessingId(claimId);
    try {
      const claimRef = doc(db, 'prize_claims', claimId);
      const userPrizeRef = doc(db, 'users', userId, 'prizes', prizeId);

      await runTransaction(db, async (transaction) => {
        // 1. Update claim status
        transaction.update(claimRef, {
          status: action === 'approve' ? 'claimed' : 'rejected',
          processedAt: serverTimestamp(),
          processedBy: getUserEmail(user) || user.displayName || user.uid
        });

        // 2. Update user's prize status
        transaction.update(userPrizeRef, {
          status: action === 'approve' ? 'claimed' : 'available',
          processedAt: serverTimestamp()
        });
      });

      // Notify User
      await createNotification(userId, {
        type: 'gift',
        title: action === 'approve' ? '🎁 Prize Claim Approved!' : '❌ Prize Claim Rejected',
        message: action === 'approve'
          ? `Your claim for the prize has been approved and processed by an admin.`
          : `Your claim for the prize was rejected. Please contact support for more info.`,
        link: '/armory'
      });

      alert(`Prize claim ${action}d successfully!`);
    } catch (error) {
      console.error("Error processing prize claim:", error);
      alert("Failed to process prize claim: " + error.message);
    } finally {
      setProcessingId(null);
    }
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
        if (isValcoins) {
          // awardPoints handles everything: clamping, exp, history, and notifications
          return await awardPoints(
            selectedUser.id,
            amountInSmallestUnit,
            'manual_credit',
            creditReason || 'Valcoins credited by admin'
          );
        }

        const walletRef = doc(db, 'wallets', selectedUser.id);

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

          if (selectedCreditCurrency === 'USDC') {
            updateData.usdcBalance = currentBalance + amountInSmallestUnit;
          } else {
            updateData.balance = currentBalance + amountInSmallestUnit;
          }
          transaction.set(walletRef, updateData, { merge: true });
        });

        // Add transaction to user's history for AURY/USDC
        const txRef = collection(db, 'wallets', selectedUser.id, 'transactions');
        await addDoc(txRef, {
          type: 'deposit',
          amount: amountInSmallestUnit,
          currency: selectedCreditCurrency,
          reason: creditReason || 'Credit by admin',
          timestamp: serverTimestamp(),
          processedBy: getUserEmail(user) || user.displayName || user.uid
        });

        // Notify User for AURY/USDC
        await createNotification(selectedUser.id, {
          type: 'deposit',
          title: 'Balance Notification',
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

  const renderEconomyTab = () => {
    if (economyLoading) {
      return (
        <div className="economy-loading">
          <div className="spinner"></div>
          <p>Analyzing financial data...</p>
        </div>
      );
    }

    // Totals (Normalize to display units - AURY ONLY)
    const auryDeposits = economyDeposits.filter(d => (d.currency || 'AURY').toUpperCase() === 'AURY');
    const auryWithdrawals = economyWithdrawals.filter(w => (w.currency || 'AURY').toUpperCase() === 'AURY');
    const auryTaxes = economyTaxes.filter(t => (t.currency || 'AURY').toUpperCase() === 'AURY');

    const totalAuryDeposited = auryDeposits.reduce((acc, d) => acc + (d.amount || 0), 0);
    const totalAuryWithdrawn = auryWithdrawals.reduce((acc, w) => {
      return acc + (w.amount / 1e9); // Always AURY here due to filter
    }, 0);
    const totalTax = auryTaxes.reduce((acc, t) => acc + (t.taxAmount || 0), 0);

    // Helper to format chart data based on timeframe
    const getChartData = () => {
      const dataMap = {};

      const processList = (list, key, timeField = 'timestamp') => {
        list.forEach(item => {
          const ts = item[timeField]?.toDate ? item[timeField].toDate() : (item[timeField] ? new Date(item[timeField]) : null);
          if (!ts) return;

          let dateKey;
          if (economyTimeframe === 'daily') {
            dateKey = ts.toISOString().split('T')[0];
          } else if (economyTimeframe === 'weekly') {
            // Simple week grouping
            const d = new Date(ts);
            d.setHours(0, 0, 0, 0);
            d.setDate(d.getDate() + 4 - (d.getDay() || 7));
            const yearStart = new Date(d.getFullYear(), 0, 1);
            const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
            dateKey = `${d.getFullYear()}-W${weekNo}`;
          } else {
            dateKey = ts.toISOString().slice(0, 7); // YYYY-MM
          }

          if (!dataMap[dateKey]) {
            dataMap[dateKey] = { date: dateKey, deposited: 0, withdrawn: 0, tax: 0, burned: 0 };
          }
          
          let amount = item.amount || item.taxAmount || item.originalAmount || 0;
          
          // Auto-detect if amount is in smallest units (large integers) or already scaled
          // Threshold of 1,000,000 is safe as 1 AURY = 1,000,000,000 units
          // Use Math.abs to handle negative adjustment records
          if (key !== 'tax' && Math.abs(amount) > 1000000) {
            amount = amount / 1e9;
          }

          dataMap[dateKey][key] += amount;
        });
      };

      processList(auryDeposits, 'deposited', 'processedAt');
      processList(auryWithdrawals, 'withdrawn', 'processedAt');
      processList(auryTaxes, 'tax', 'timestamp');
      processList(economyBurns, 'burned', 'timestamp');

      // 5. Back-calculate historical circulation
      const sortedDates = Object.keys(dataMap).sort((a, b) => b.localeCompare(a)); // Newest to oldest
      let currentCirc = totalCirculatingAury / 1e9; // Convert to AURY

      sortedDates.forEach(date => {
        const day = dataMap[date];
        day.circulation = currentCirc;
        // Yesterday's circulation = Today's - (Today's Net Change)
        // Net Change = Deposits - Withdrawals - Burns
        const netChange = day.deposited - day.withdrawn - day.burned;
        currentCirc -= netChange;
      });

      return Object.values(dataMap).sort((a, b) => a.date.localeCompare(b.date)).slice(-15);
    };

    const chartData = getChartData();

    return (
      <div className="economy-management">
        {economyError && (
          <div className="admin-error-banner" style={{ marginBottom: '20px', padding: '15px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--status-danger)', borderRadius: '8px', color: 'var(--status-danger)' }}>
            <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>⚠️ Firestore Query Error</div>
            <p style={{ fontSize: '0.9em', margin: 0 }}>{economyError}</p>
            {economyError.includes('https://') && (
              <div style={{ marginTop: '10px' }}>
                <a 
                  href={economyError.match(/https:\/\/console\.firebase\.google\.com[^\s]*/)?.[0]} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="primary-btn-mini"
                  style={{ display: 'inline-block', background: 'var(--status-danger)', color: 'white', padding: '8px 12px', borderRadius: '4px', textDecoration: 'none', fontSize: '0.85em' }}
                >
                  Click Here to Create Index
                </a>
              </div>
            )}
          </div>
        )}

        <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2>💹 Platform Economy</h2>
            <p className="section-description">Monitor and manage financial flows and tax collections.</p>
          </div>
          {isSuperAdminUser && (
            <button
              className="add-manual-btn"
              onClick={() => handleOpenEconomyEdit()}
            >
              ➕ Add Manual Log
            </button>
          )}
        </div>

        {/* Sub-Navigation */}
        <div className="economy-sub-nav">
          <button className={`sub-nav-btn ${economySubTab === 'dashboard' ? 'active' : ''}`} onClick={() => setEconomySubTab('dashboard')}>📊 Dashboard</button>
          <button className={`sub-nav-btn ${economySubTab === 'deposits' ? 'active' : ''}`} onClick={() => setEconomySubTab('deposits')}>📬 Deposits</button>
          <button className={`sub-nav-btn ${economySubTab === 'withdrawals' ? 'active' : ''}`} onClick={() => setEconomySubTab('withdrawals')}>💸 Withdrawals</button>
          <button className={`sub-nav-btn ${economySubTab === 'burns' ? 'active' : ''}`} onClick={() => setEconomySubTab('burns')}>🔥 Burns</button>
          <button className={`sub-nav-btn ${economySubTab === 'revenue' ? 'active' : ''}`} onClick={() => setEconomySubTab('revenue')}>🛡️ Revenue & Taxes</button>
        </div>

        {economySubTab === 'dashboard' && (
          <>
            <div className="stats-grid">
              <div className="stat-card economy-card-deposited">
                <span className="stat-label">Total AURY Deposited</span>
                <span className="stat-value">+{formatAmount(totalAuryDeposited, 'AURY', false)} AURY</span>
                <span className="stat-hint">{economyDeposits.length} processed deposits</span>
              </div>
              <div className="stat-card economy-card-withdrawn">
                <span className="stat-label">Total AURY Withdrawn (Gross)</span>
                <span className="stat-value">-{formatAmount(totalAuryWithdrawn, 'AURY', false)} AURY</span>
                <span className="stat-hint">{economyWithdrawals.length} completed withdrawals</span>
              </div>
              <div className="stat-card economy-card-tax">
                <span className="stat-label">Total Platform Tax/Fees</span>
                <span className="stat-value">+{formatAmount(totalTax, 'AURY', false)} AURY</span>
                <span className="stat-hint">Derived from withdrawal & shop fees</span>
              </div>
              <div className="stat-card economy-card-circulation">
                <span className="stat-label">Total AURY Circulation</span>
                <span className="stat-value">{formatAmount(totalCirculatingAury, 'AURY', true)} AURY</span>
                <span className="stat-hint">Sum of all user wallet balances</span>
              </div>
              <div className="stat-card economy-card-burned">
                <span className="stat-label">Total AURY Burned</span>
                <span className="stat-value">{formatAmount(totalAuryBurned, 'AURY', true)} AURY</span>
                <span className="stat-hint">{economyBurns.length} spending records</span>
              </div>
            </div>

            {/* Economy Charts Row */}
            <div className="economy-charts-grid">
              {/* Chart 1: Platform Cashflow */}
              <div className="admin-card">
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3>📈 Platform Cashflow</h3>
                  <div className="chart-controls">
                    <select value={economyTimeframe} onChange={(e) => setEconomyTimeframe(e.target.value)} className="timeframe-select">
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </div>
                </div>
                <div style={{ width: '100%', height: '300px', padding: '10px' }}>
                  <ResponsiveContainer width="99%" height={300} minHeight={300}>
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="colorDep" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/><stop offset="95%" stopColor="#10b981" stopOpacity={0}/></linearGradient>
                        <linearGradient id="colorWd" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#ef4444" stopOpacity={0.3}/><stop offset="95%" stopColor="#ef4444" stopOpacity={0}/></linearGradient>
                        <linearGradient id="colorTax" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#facc15" stopOpacity={0.3}/><stop offset="95%" stopColor="#facc15" stopOpacity={0}/></linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                      <XAxis dataKey="date" stroke="rgba(255,255,255,0.4)" fontSize={10} tickLine={false} axisLine={false} />
                      <YAxis 
                        stroke="rgba(255,255,255,0.4)" 
                        fontSize={10} 
                        tickLine={false} 
                        axisLine={false} 
                        width={45}
                        tickFormatter={(val) => {
                          if (val >= 1000000) return `${(val/1000000).toFixed(1)}M`;
                          if (val >= 1000) return `${(val/1000).toFixed(0)}k`;
                          return val.toFixed(0);
                        }}
                      />
                      <Tooltip 
                        contentStyle={{ background: '#1e1e2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }} 
                        itemStyle={{ fontSize: '11px' }} 
                        formatter={(val) => {
                          const absVal = Math.abs(val);
                          if (absVal >= 1000000000) return [`${(val/1000000000).toFixed(2)}B`, ''];
                          if (absVal >= 1000000) return [`${(val/1000000).toFixed(2)}M`, ''];
                          if (absVal >= 1000) return [`${(val/1000).toFixed(2)}k`, ''];
                          return [val.toFixed(2), ''];
                        }}
                      />
                      <Legend iconType="circle" />
                      <Area type="monotone" dataKey="deposited" name="Deposits" stroke="#10b981" fillOpacity={1} fill="url(#colorDep)" strokeWidth={2} />
                      <Area type="monotone" dataKey="withdrawn" name="Withdrawals" stroke="#ef4444" fillOpacity={1} fill="url(#colorWd)" strokeWidth={2} />
                      <Area type="monotone" dataKey="tax" name="Revenue/Tax" stroke="#facc15" fillOpacity={1} fill="url(#colorTax)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Chart 2: Market Economy */}
              <div className="admin-card">
                <div className="card-header">
                  <h3>🌍 Market Economy</h3>
                </div>
                <div style={{ width: '100%', height: '300px', padding: '10px' }}>
                  <ResponsiveContainer width="99%" height={300} minHeight={300}>
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="colorCirc" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/><stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/></linearGradient>
                        <linearGradient id="colorBurn" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#a855f7" stopOpacity={0.3}/><stop offset="95%" stopColor="#a855f7" stopOpacity={0}/></linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                      <XAxis dataKey="date" stroke="rgba(255,255,255,0.4)" fontSize={10} tickLine={false} axisLine={false} />
                      <YAxis 
                        stroke="rgba(255,255,255,0.4)" 
                        fontSize={10} 
                        tickLine={false} 
                        axisLine={false} 
                        width={45}
                        tickFormatter={(val) => {
                          if (val >= 1000000) return `${(val/1000000).toFixed(1)}M`;
                          if (val >= 1000) return `${(val/1000).toFixed(0)}k`;
                          return val.toFixed(0);
                        }}
                      />
                      <Tooltip 
                        contentStyle={{ background: '#1e1e2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }} 
                        itemStyle={{ fontSize: '11px' }} 
                        formatter={(val) => {
                          const absVal = Math.abs(val);
                          if (absVal >= 1000000000) return [`${(val/1000000000).toFixed(2)}B`, ''];
                          if (absVal >= 1000000) return [`${(val/1000000).toFixed(2)}M`, ''];
                          if (absVal >= 1000) return [`${(val/1000).toFixed(2)}k`, ''];
                          return [val.toFixed(2), ''];
                        }}
                      />
                      <Legend iconType="circle" />
                      <Area type="monotone" dataKey="circulation" name="Total Circulation" stroke="#3b82f6" fillOpacity={1} fill="url(#colorCirc)" strokeWidth={2} />
                      <Area type="monotone" dataKey="burned" name="Daily Burned/Spent" stroke="#a855f7" fillOpacity={1} fill="url(#colorBurn)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </>
        )}

        {economySubTab === 'revenue' && (
          <>
            {/* Taxes Table */}
            <div className="admin-card">
              <div className="card-header">
                <h3>🛡️ Tax Collections</h3>
                <span className="count-badge">{economyTaxes.length}</span>
              </div>
              <div className="table-responsive">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Source</th>
                      <th>User/Buyer</th>
                      <th>Original Amount</th>
                      <th>Tax/Fee</th>
                      {isSuperAdminUser && <th>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {auryTaxes.length === 0 ? (
                      <tr><td colSpan="6" className="text-center">No AURY tax collections recorded yet.</td></tr>
                    ) : (
                      auryTaxes.map(tax => (
                        <tr key={tax.id}>
                          <td>{tax.timestamp?.toDate() ? tax.timestamp.toDate().toLocaleString() : 'N/A'}</td>
                          <td>
                            <span className={`type-badge ${tax.source.includes('Withdrawal') ? 'withdrawal' : 'shop'}`}>
                              {tax.source}
                            </span>
                            <div className="small-hint">{tax.details}</div>
                          </td>
                          <td>
                            <div className="user-info-cell">
                              <span className="user-name">{tax.user}</span>
                              {tax.userEmail && <span className="user-email">{tax.userEmail}</span>}
                            </div>
                          </td>
                          <td>{formatAmount(tax.originalAmount, 'AURY', false)} AURY</td>
                          <td className="gold-text">+{formatAmount(tax.taxAmount, 'AURY', false)} AURY</td>
                          {isSuperAdminUser && (
                            <td>
                              <div className="action-btns-mini">
                                <button onClick={() => handleOpenEconomyEdit(tax)} className="edit-btn-mini">Edit</button>
                                <button onClick={() => handleDeleteEconomyRecord(tax)} className="delete-btn-mini">Delete</button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Shop Sales Table */}
            <div className="admin-card mt-4">
              <div className="card-header">
                <h3>🛒 Recent Shop Sales</h3>
                <span className="count-badge">{economyShopSales.length}</span>
              </div>
              <div className="table-responsive">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Item</th>
                      <th>Buyer</th>
                      <th>Price</th>
                      <th>Tax (3%)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {economyShopSales.length === 0 ? (
                      <tr><td colSpan="5" className="text-center">No recent AURY shop sales.</td></tr>
                    ) : (
                      economyShopSales.map(sale => {
                        const price = sale.price || 0;
                        const tax = sale.commission || (price * 0.03);
                        return (
                          <tr key={sale.id}>
                            <td>{sale.timestamp?.toDate() ? sale.timestamp.toDate().toLocaleString() : 'N/A'}</td>
                            <td>{sale.itemName}</td>
                            <td>{sale.buyerEmail || sale.buyerId}</td>
                            <td>{formatAmount(price, 'AURY', false)} AURY</td>
                            <td className="gold-text">+{formatAmount(tax, 'AURY', false)}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {economySubTab === 'deposits' && (
          <div className="admin-card">
            <div className="card-header">
              <h3>📬 Processed Deposits</h3>
              <span className="count-badge">{economyDeposits.length}</span>
            </div>
            <div className="table-responsive">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>User</th>
                    <th>Amount</th>
                    <th>Tx Signature</th>
                    {isSuperAdminUser && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {auryDeposits.length === 0 ? (
                    <tr><td colSpan="5" className="text-center">No processed AURY deposits found.</td></tr>
                  ) : (
                    auryDeposits.map(dep => (
                      <tr key={dep.id}>
                        <td>{dep.processedAt?.toDate() ? dep.processedAt.toDate().toLocaleString() : 'N/A'}</td>
                        <td>{dep.userEmail || dep.userId}</td>
                        <td className="received">+{formatAmount(dep.amount, 'AURY', false)} AURY</td>
                        <td>
                          <div className="tx-sig-cell">
                            <span className="tx-sig-short" title={dep.txSignature}>{dep.txSignature?.substring(0, 10)}...</span>
                          </div>
                        </td>
                        {isSuperAdminUser && (
                          <td>
                            <div className="action-btns-mini">
                              <button onClick={() => handleOpenEconomyEdit(dep)} className="edit-btn-mini">Edit</button>
                              <button onClick={() => handleDeleteEconomyRecord(dep)} className="delete-btn-mini">Delete</button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {economySubTab === 'withdrawals' && (
          <div className="admin-card">
            <div className="card-header">
              <h3>📤 Completed Withdrawals</h3>
              <span className="count-badge">{economyWithdrawals.length}</span>
            </div>
            <div className="table-responsive">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>User</th>
                    <th>Gross Amount</th>
                    <th>Tax (2.5%)</th>
                    <th>Net Received</th>
                    {isSuperAdminUser && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {auryWithdrawals.length === 0 ? (
                    <tr><td colSpan="6" className="text-center">No completed AURY withdrawals found.</td></tr>
                  ) : (
                    auryWithdrawals.map(wd => {
                      const amount = wd.amount / 1e9;
                      const tax = amount * 0.025;
                      const net = amount - tax;
                      return (
                        <tr key={wd.id}>
                          <td>{wd.processedAt?.toDate() ? wd.processedAt.toDate().toLocaleString() : 'N/A'}</td>
                          <td>{wd.email || wd.userId}</td>
                          <td>{formatAmount(amount, 'AURY', false)} AURY</td>
                          <td className="spent">-{formatAmount(tax, 'AURY', false)}</td>
                          <td className="received">{formatAmount(net, 'AURY', false)} AURY</td>
                          {isSuperAdminUser && (
                            <td>
                              <div className="action-btns-mini">
                                <button onClick={() => handleOpenEconomyEdit({ ...wd, id: `wd-${wd.id}` })} className="edit-btn-mini">Edit</button>
                                <button onClick={() => handleDeleteEconomyRecord({ ...wd, id: `wd-${wd.id}` })} className="delete-btn-mini">Delete</button>
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {economySubTab === 'burns' && (
          <div className="admin-card">
            <div className="card-header">
              <h3>🔥 AURY Burns (Spending History)</h3>
              <span className="count-badge">{economyBurns.length}</span>
            </div>

            {/* Burn Breakdown Summary */}
            <div className="tab-stats-summary">
              <div className="mini-stat">
                <span className="mini-label">Matchup Entry Fees</span>
                <span className="mini-value">{formatAmount(burnBreakdown.matchups, 'AURY', true)}</span>
              </div>
              <div className="mini-stat">
                <span className="mini-label">Raffle Entry Fees</span>
                <span className="mini-value">{formatAmount(burnBreakdown.raffles, 'AURY', true)}</span>
              </div>
              <div className="mini-stat">
                <span className="mini-label">Shop Purchases</span>
                <span className="mini-value">{formatAmount(burnBreakdown.shop, 'AURY', true)}</span>
              </div>
              <div className="mini-stat">
                <span className="mini-label">Other Spends</span>
                <span className="mini-value">{formatAmount(totalAuryBurned - (burnBreakdown.matchups + burnBreakdown.raffles + burnBreakdown.shop), 'AURY', true)}</span>
              </div>
            </div>

            <div className="table-responsive">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>User</th>
                    <th>Type</th>
                    <th>Amount</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {economyBurns.length === 0 ? (
                    <tr><td colSpan="5" style={{ textAlign: 'center', padding: '30px', opacity: 0.5 }}>No burn records found</td></tr>
                  ) : (
                    economyBurns
                      .sort((a, b) => {
                        const timeA = a.timestamp?.seconds || (a.timestamp ? new Date(a.timestamp).getTime() / 1000 : 0);
                        const timeB = b.timestamp?.seconds || (b.timestamp ? new Date(b.timestamp).getTime() / 1000 : 0);
                        return timeB - timeA;
                      })
                      .slice(0, 100)
                      .map(burn => {
                        const userObj = allUsers.find(u => u.id === burn.userId);
                        const displayName = userObj ? resolveDisplayName(userObj) : (burn.displayName || burn.userId);
                        return (
                          <tr key={burn.id}>
                            <td className="log-time">{formatTime(burn.timestamp)}</td>
                            <td>
                              <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <span style={{ fontWeight: 600 }}>{displayName}</span>
                                <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>{burn.userId}</span>
                              </div>
                            </td>
                            <td>
                              <span className={`type-tag tag-${(burn.type || 'unknown').toLowerCase()}`}>
                                {burn.type}
                              </span>
                            </td>
                            <td className="spent" style={{ fontWeight: 'bold' }}>
                              -{formatAmount(burn.amount, 'AURY', true)} AURY
                            </td>
                            <td style={{ fontSize: '0.85em', opacity: 0.8 }}>
                              {burn.itemName || burn.reason || burn.description || burn.draftTitle || '-'}
                            </td>
                          </tr>
                        );
                      })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="admin-wallet">
      <div className="admin-wallet-header">
        <button className="back-btn" onClick={() => navigate('/')}>
          ← Back
        </button>
        <h1>Admin Panel</h1>
      </div>

      {isSeniorAdminUser && (depositNotifications.length > 0 || pendingWithdrawals.length > 0 || pendingPrizeClaims.length > 0) && (
        <div className="admin-notification-alert">
          <div className="alert-content">
            <span className="alert-icon">⚠️</span>
            <div className="alert-text">
              <strong>Action Required:</strong>
              {depositNotifications.length > 0 && <span> {depositNotifications.length} pending deposit{depositNotifications.length > 1 ? 's' : ''}</span>}
              {depositNotifications.length > 0 && (pendingWithdrawals.length > 0 || pendingPrizeClaims.length > 0) && ', '}
              {pendingWithdrawals.length > 0 && <span>{pendingWithdrawals.length} withdrawal request{pendingWithdrawals.length > 1 ? 's' : ''}</span>}
              {pendingWithdrawals.length > 0 && pendingPrizeClaims.length > 0 && ', and '}
              {pendingPrizeClaims.length > 0 && <span>{pendingPrizeClaims.length} prize claim{pendingPrizeClaims.length > 1 ? 's' : ''}</span>}
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
                {isSeniorAdminUser && (
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
                  {(depositNotifications.length + pendingWithdrawals.length + pendingPrizeClaims.length) > 0 && (
                    <span className="category-badge">
                      {depositNotifications.length + pendingWithdrawals.length + pendingPrizeClaims.length}
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
                  className={`admin-tab ${activeTab === 'prize_claims' ? 'active' : ''}`}
                  onClick={() => setActiveTab('prize_claims')}
                >
                  🎁 Prize Claims {pendingPrizeClaims.length > 0 && <span className="tab-badge gold">{pendingPrizeClaims.length}</span>}
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

          {/* Games Category (All Admins & Games Manager) */}
          {isAdminUser && (
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
                <button
                  className={`admin-tab ${activeTab === 'pvp_rewards' ? 'active' : ''}`}
                  onClick={() => setActiveTab('pvp_rewards')}
                >
                  ⚔️ PvP Rewards
                </button>
              </div>
            </div>
          )}

          {/* Website Management Category */}
          {(isGeneralAdmin || isMerchantUser) && (
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
                {isGeneralAdmin && (
                  <button
                    className={`admin-tab ${activeTab === 'website_mgmt' ? 'active' : ''}`}
                    onClick={() => setActiveTab('website_mgmt')}
                  >
                    🌐 Website Management
                  </button>
                )}
                {(isGeneralAdmin || isMerchantUser) && (
                  <button
                    className={`admin-tab ${activeTab === 'shop_mgmt' ? 'active' : ''}`}
                    onClick={() => setActiveTab('shop_mgmt')}
                  >
                    🛍️ Shop
                  </button>
                )}
                {isGeneralAdmin && (
                  <button
                    className={`admin-tab ${activeTab === 'chatbot' ? 'active' : ''}`}
                    onClick={() => setActiveTab('chatbot')}
                  >
                    🤖 Runie Chatbot
                  </button>
                )}
                {isGeneralAdmin && (
                  <button
                    className={`admin-tab ${activeTab === 'economy' ? 'active' : ''}`}
                    onClick={() => setActiveTab('economy')}
                  >
                    💹 Economy
                  </button>
                )}
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

          {activeTab === 'prize_claims' && (
            <div className="prize-claims-section">
              <div className="section-info">
                <p>🎁 Review and fulfill prize claims from Yggdrasil events. Once the manual fulfillment is complete, click Approve.</p>
              </div>

              {loading ? (
                <LoadingScreen message="Loading prize claims..." />
              ) : pendingPrizeClaims.length === 0 ? (
                <div className="empty-state">
                  <p>✅ No pending prize claims</p>
                </div>
              ) : (
                <div className="withdrawal-list">
                  {pendingPrizeClaims.map(claim => (
                    <div key={claim.id} className="withdrawal-card">
                      <div className="withdrawal-header">
                        <div>
                          <span className="user-name">{claim.userName || 'Unknown User'}</span>
                          <span className="user-email">{claim.userEmail}</span>
                        </div>
                        <span className={`rarity-badge rarity-${claim.rarity}`}>
                          {claim.rarity}
                        </span>
                      </div>

                      <div className="withdrawal-details">
                        <div className="detail-row">
                          <span className="label">Prize Name:</span>
                          <span className="value">{claim.prizeName}</span>
                        </div>
                        <div className="detail-row">
                          <span className="label">Requested:</span>
                          <span className="value">{formatTime(claim.createdAt)}</span>
                        </div>
                        <div className="prize-preview-admin">
                          <img src={claim.prizeImage} alt={claim.prizeName} style={{ width: '64px', height: '64px', borderRadius: '8px', marginTop: '10px' }} />
                        </div>
                      </div>

                      <div className="withdrawal-actions">
                        <div className="action-buttons">
                          <button
                            className="approve-btn"
                            onClick={() => processPrizeClaim(claim.id, claim.userId, claim.prizeId, 'approve')}
                            disabled={processingId === claim.id}
                          >
                            {processingId === claim.id ? '...' : '✅ Approve & Fulfill'}
                          </button>
                          <button
                            className="reject-btn"
                            onClick={() => processPrizeClaim(claim.id, claim.userId, claim.prizeId, 'reject')}
                            disabled={processingId === claim.id}
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

          {activeTab === 'chatbot' && (
            <div className="chatbot-management">
              <div className="section-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px', paddingBottom: '20px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <div>
                  <h2>🤖 Runie Chatbot Manager</h2>
                  <p>Manage Runie's knowledge base and floating greetings.</p>
                  <button
                    className="seed-btn"
                    onClick={handleSeedDefaultKnowledge}
                    disabled={processingId === 'seed_chatbot'}
                    style={{ marginTop: '10px', padding: '6px 12px', fontSize: '12px' }}
                  >
                    {processingId === 'seed_chatbot' ? 'Initializing...' : '📥 Seed Core Knowledge'}
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '30px' }}>
                  <div className="chatbot-enable-toggle" style={{ textAlign: 'right' }}>
                    <label style={{ display: 'block', fontSize: '13px', color: '#94a3b8', marginBottom: '8px' }}>Chatbot Status</label>
                    <div className="currency-toggle-group">
                      <button
                        className={`toggle-btn ${cbEnabled ? 'active' : ''}`}
                        onClick={() => handleToggleChatbot(true)}
                      >ON</button>
                      <button
                        className={`toggle-btn ${!cbEnabled ? 'active' : ''}`}
                        onClick={() => handleToggleChatbot(false)}
                      >OFF</button>
                    </div>
                    <p style={{ fontSize: '12px', marginTop: '5px', color: cbEnabled ? '#10b981' : '#f43f5e' }}>
                      {cbEnabled ? '● Global System Online' : '○ Global System Offline'}
                    </p>
                  </div>

                  <div className="chatbot-enable-toggle" style={{ textAlign: 'right' }}>
                    <label style={{ display: 'block', fontSize: '13px', color: '#94a3b8', marginBottom: '8px' }}>Damage Calculator</label>
                    <div className="currency-toggle-group">
                      <button
                        className={`toggle-btn ${calcEnabled ? 'active' : ''}`}
                        onClick={() => handleToggleDamageCalc(true)}
                      >ON</button>
                      <button
                        className={`toggle-btn ${!calcEnabled ? 'active' : ''}`}
                        onClick={() => handleToggleDamageCalc(false)}
                      >OFF</button>
                    </div>
                    <p style={{ fontSize: '12px', marginTop: '5px', color: calcEnabled ? '#10b981' : '#f43f5e' }}>
                      {calcEnabled ? '● Calculator Online' : '○ Calculator Offline'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="chatbot-form-card card">
                <h3>{editingKnowledgeId ? 'Edit Knowledge Item' : 'Add New Knowledge Item'}</h3>
                <div className="chatbot-form">
                  <div className="form-row">
                    <div className="form-group flex-2">
                      <label>Button Label (Quick Reply)</label>
                      <input
                        type="text"
                        value={cbLabel}
                        onChange={(e) => setCbLabel(e.target.value)}
                        placeholder="e.g. What is Aurory?"
                      />
                    </div>
                    <div className="form-group flex-2">
                      <label>Sort Order</label>
                      <input
                        type="number"
                        value={cbOrder}
                        onChange={(e) => setCbOrder(e.target.value)}
                      />
                    </div>
                    <div className="form-group flex-1">
                      <label>Show as Button?</label>
                      <div className="currency-toggle-group">
                        <button
                          className={`toggle-btn ${cbShowAsBadge ? 'active' : ''}`}
                          onClick={() => setCbShowAsBadge(true)}
                        >YES</button>
                        <button
                          className={`toggle-btn ${!cbShowAsBadge ? 'active' : ''}`}
                          onClick={() => setCbShowAsBadge(false)}
                        >NO</button>
                      </div>
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Keywords (Comma separated for random chat matching)</label>
                    <input
                      type="text"
                      value={cbKeywords}
                      onChange={(e) => setCbKeywords(e.target.value)}
                      placeholder="e.g. aurory, ecosystem, backend"
                    />
                    <p className="field-hint">If a user scrolls or types one of these words, Runie will provide this response.</p>
                  </div>

                  <div className="form-group">
                    <label>Runie's Response</label>
                    <textarea
                      value={cbResponse}
                      onChange={(e) => setCbResponse(e.target.value)}
                      placeholder="Enter what Runie should say..."
                      className="form-textarea"
                      rows="4"
                    />
                    <div className="chatbot-formatting-help">
                      <p><strong>💡 Formatting Guide:</strong></p>
                      <div className="help-grid">
                        <div className="help-item">
                          <span>🔗 Links:</span>
                          <code>[Title](https://...)</code>
                        </div>
                        <div className="help-item">
                          <span>🖼️ Images:</span>
                          <code>![Alt](https://...)</code>
                        </div>
                        <div className="help-item">
                          <span>🎥 YouTube:</span>
                          <code>Paste YouTube URL</code>
                        </div>
                        <div className="help-item">
                          <span>🎬 Video:</span>
                          <code>Paste .mp4 link</code>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="form-actions">
                    <button
                      className="save-btn"
                      onClick={handleSaveChatbotKnowledge}
                      disabled={processingId === 'chatbot'}
                    >
                      {processingId === 'chatbot' ? 'Saving...' : editingKnowledgeId ? 'Update Item' : 'Add to Knowledge'}
                    </button>
                    {editingKnowledgeId && (
                      <button className="cancel-btn" onClick={resetChatbotForm}>Cancel</button>
                    )}
                  </div>
                </div>
              </div>

              {/* UNANSWERED QUERIES (Warrior Discovery) */}
              <div className="chatbot-discovery-card card" style={{ marginBottom: '30px', borderLeft: '4px solid #3b82f6' }}>
                <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                  <div>
                    <h3>⚔️ Warrior Discovery (Unanswered)</h3>
                    <p className="text-sm opacity-70">These are things users asked that Runie didn't know yet. Teach her!</p>
                  </div>
                  <span className="count-badge">{unansweredQueries.length} New</span>
                </div>

                {unansweredLoading ? (
                  <LoadingScreen message="Scanning records..." />
                ) : unansweredQueries.length === 0 ? (
                  <p className="empty-msg" style={{ padding: '20px', textAlign: 'center' }}>✨ All quiet! Runie appears to be handling Midgard well.</p>
                ) : (
                  <div className="unanswered-list scroll-container" style={{ maxHeight: '250px', overflowY: 'auto', background: 'rgba(0,0,0,0.1)', borderRadius: '8px' }}>
                    {unansweredQueries.map((q) => (
                      <div key={q.id} className="unanswered-item" style={{ padding: '12px 15px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div className="query-text">
                          <code style={{ color: '#ffd700', fontSize: '1.1em' }}>"{q.query}"</code>
                          <span style={{ fontSize: '0.75em', opacity: 0.5, marginLeft: '10px' }}>
                            {q.timestamp?.toDate() ? q.timestamp.toDate().toLocaleString() : 'Just now'}
                          </span>
                        </div>
                        <div className="query-actions" style={{ display: 'flex', gap: '8px' }}>
                          <button
                            className="resolve-btn small-btn"
                            onClick={() => handleResolveUnansweredQuery(q)}
                            title="Add to Knowledge"
                          >
                            🎓 Teach
                          </button>
                          <button
                            className="dismiss-btn small-btn negative"
                            onClick={() => handleDeleteUnansweredQuery(q.id)}
                            title="Dismiss"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="chatbot-list-card card">
                <div className="list-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                  <h3>Existing Knowledge</h3>
                  <div className="list-search">
                    <input
                      type="text"
                      placeholder="🔍 Search labels or keywords..."
                      value={knowledgeSearchQuery}
                      onChange={(e) => setKnowledgeSearchQuery(e.target.value)}
                      className="admin-compact-input"
                      style={{ minWidth: '250px' }}
                    />
                  </div>
                </div>
                {chatbotKnowledge.length === 0 ? (
                  <p className="empty-msg">No custom knowledge found. Runie is using her defaults.</p>
                ) : (
                  <div className="chatbot-knowledge-grid scroll-container" style={{ maxHeight: '500px', overflowY: 'auto' }}>
                    <table className="admin-table sticky-header">
                      <thead>
                        <tr>
                          <th>Order</th>
                          <th style={{ minWidth: '150px' }}>Label</th>
                          <th style={{ minWidth: '200px' }}>Keywords</th>
                          <th>Response Snippet</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {chatbotKnowledge.filter(item =>
                          (item.label || '').toLowerCase().includes(knowledgeSearchQuery.toLowerCase()) ||
                          (item.keywords || []).some(k => k.toLowerCase().includes(knowledgeSearchQuery.toLowerCase()))
                        ).map((item) => (
                          <tr key={item.id}>
                            <td className="text-center">{item.order}</td>
                            <td className="font-bold">{item.label}</td>
                            <td>
                              <div className="keyword-badges">
                                {item.keywords?.map((k, i) => (
                                  <span key={i} className="keyword-badge">{k}</span>
                                ))}
                              </div>
                            </td>
                            <td className="response-snippet">
                              {item.response?.substring(0, 60)}...
                            </td>
                            <td className="admin-actions">
                              <button className="edit-btn" onClick={() => handleEditKnowledge(item)}>📝</button>
                              <button className="delete-btn" onClick={() => handleDeleteKnowledge(item.id)}>🗑️</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Floating Greetings Section */}
              <div className="chatbot-form-card card greetings-form-card" style={{ marginTop: '40px' }}>
                <div className="section-header" style={{ marginBottom: '20px' }}>
                  <h3>💭 Floating Greeting Bubbles</h3>
                  <p>These messages pop up briefly above Runie when the chat is closed.</p>
                </div>

                <div className="chatbot-form">
                  <div className="form-row">
                    <div className="form-group flex-2">
                      <label>Greeting Text</label>
                      <input
                        type="text"
                        value={cbGreetingText}
                        onChange={(e) => setCbGreetingText(e.target.value)}
                        placeholder="e.g. Need help with tournaments?"
                      />
                    </div>
                    <div className="form-group flex-1">
                      <label>Sort Order</label>
                      <input
                        type="number"
                        value={cbGreetingOrder}
                        onChange={(e) => setCbGreetingOrder(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="form-actions">
                    <button
                      className="save-btn"
                      onClick={handleSaveGreeting}
                      disabled={processingId === 'greeting'}
                    >
                      {processingId === 'greeting' ? 'Saving...' : editingGreetingId ? 'Update Greeting' : 'Add Greeting'}
                    </button>
                    {editingGreetingId && (
                      <button className="cancel-btn" onClick={resetGreetingForm}>Cancel</button>
                    )}
                  </div>
                </div>
              </div>

              <div className="chatbot-list-card card">
                <h3>Existing Greetings</h3>
                {cbGreetings.length === 0 ? (
                  <p className="empty-msg">No custom greetings found. Add some above!</p>
                ) : (
                  <div className="chatbot-knowledge-grid">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Order</th>
                          <th>Greeting Text</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cbGreetings.map((item) => (
                          <tr key={item.id}>
                            <td className="text-center">{item.order}</td>
                            <td className="font-bold" style={{ color: 'var(--accent-gold)' }}>{item.text}</td>
                            <td className="admin-actions">
                              <button className="edit-btn" onClick={() => handleEditGreeting(item)}>📝</button>
                              <button className="delete-btn" onClick={() => handleDeleteGreeting(item.id)}>🗑️</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'shop_mgmt' && (
            <div className="shop-mgmt-section" style={{ width: '100%' }}>
              <div className="section-info">
                <p>🛍️ Manage the Valhalla Vault inventory. Add new cosmetics, update prices, and manage animated auras.</p>
              </div>

              {isMerchantUser && (
                <div className="merchant-commission-card card" style={{ marginBottom: '20px', padding: '20px', background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(5, 150, 105, 0.1) 100%)', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                  <h3 style={{ margin: '0 0 15px 0', color: '#10b981', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    💰 Merchant Dashboard
                  </h3>
                  <div className="merchant-stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '15px' }}>
                    <div className="stat-item">
                      <span style={{ fontSize: '12px', opacity: 0.7, display: 'block', marginBottom: '5px' }}>Your Items</span>
                      <span style={{ fontSize: '20px', fontWeight: 'bold' }}>{shopCosmetics.filter(c => c.createdBy === user.uid).length}</span>
                    </div>
                    <div className="stat-item">
                      <span style={{ fontSize: '12px', opacity: 0.7, display: 'block', marginBottom: '5px' }}>Total Sales</span>
                      <span style={{ fontSize: '20px', fontWeight: 'bold' }}>{shopCosmetics.filter(c => c.createdBy === user.uid).reduce((acc, c) => acc + (c.saleCount || 0), 0)}</span>
                    </div>
                    <div className="stat-item">
                      <span style={{ fontSize: '12px', opacity: 0.7, display: 'block', marginBottom: '5px' }}>Total Commission (60%)</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <span style={{ fontSize: '20px', fontWeight: 'bold', color: '#10b981' }}>
                          {shopHistory.filter(s => s.creatorId === user.uid).reduce((acc, s) => acc + (s.commission || 0), 0).toLocaleString()}
                        </span>
                        <img src="/valcoin-icon.jpg" alt="" style={{ width: '16px', height: '16px', borderRadius: '50%' }} />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Sub-tab Pill Selector */}
              <div className="config-card" style={{ marginBottom: '20px', padding: '15px', background: 'rgba(10, 10, 15, 0.4)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)' }}>
                <div className="game-type-selector">
                  <button
                    className={`selector-btn ${shopSubTab === 'settings' ? 'active' : ''}`}
                    onClick={() => setShopSubTab('settings')}
                  >
                    Shop Settings
                  </button>
                  <button
                    className={`selector-btn ${shopSubTab === 'cosmetics' ? 'active' : ''}`}
                    onClick={() => {
                      setShopSubTab('cosmetics');
                      setEditingCosmetic(null);
                      setCosmeticForm({
                        name: '', type: 'aura', rarity: 'common', price: 1000, currency: 'valcoins',
                        description: '', placement: 'behind', gifUrl: '', pngUrl: '', cssClass: '', style: {}
                      });
                    }}
                  >
                    Cosmetics
                  </button>
                  <button
                    className={`selector-btn ${shopSubTab === 'amikos' ? 'active' : ''}`}
                    onClick={() => setShopSubTab('amikos')}
                  >
                    Amikos
                  </button>
                  <button
                    className={`selector-btn ${shopSubTab === 'items' ? 'active' : ''}`}
                    onClick={() => setShopSubTab('items')}
                  >
                    Items
                  </button>
                  <button
                    className={`selector-btn ${['ygg_themes', 'ygg_theme_form'].includes(shopSubTab) ? 'active' : ''}`}
                    onClick={() => {
                      setShopSubTab('ygg_themes');
                      setEditingCosmetic(null);
                      setCosmeticForm({
                        name: '', type: 'ygg_theme', rarity: 'common', price: 10, currency: 'runes',
                        description: '', assets: {}
                      });
                    }}
                  >
                    Yggdrasil
                  </button>
                  <button
                    className={`selector-btn ${shopSubTab === 'tickets' ? 'active' : ''}`}
                    onClick={() => setShopSubTab('tickets')}
                  >
                    Tickets
                  </button>
                </div>
              </div>

              {shopSubTab === 'settings' && (
                <>
                  <div className="credit-form" style={{ maxWidth: '500px', margin: '0 auto' }}>
                    <div className="form-group">
                      <label>Valhalla's Vault Status</label>
                      <div className="currency-toggle-group">
                        <button
                          className={`toggle-btn ${shopEnabled ? 'active' : ''}`}
                          onClick={() => setShopEnabled(true)}
                        >ON</button>
                        <button
                          className={`toggle-btn ${!shopEnabled ? 'active' : ''}`}
                          onClick={() => setShopEnabled(false)}
                        >OFF</button>
                      </div>
                      <p className="helper-text" style={{ marginTop: '8px', fontSize: '13px', color: shopEnabled ? '#10b981' : '#ef4444' }}>
                        {shopEnabled
                          ? "✅ Shop is visible to all users."
                          : "⚠️ Shop is HIDDEN from the homepage. (Super Admins can still see it for testing)."}
                      </p>
                    </div>

                    <button
                      className="approve-btn"
                      onClick={handleSaveShopSettings}
                      disabled={processingId === 'save_shop'}
                      style={{ marginTop: '30px', width: '100%' }}
                    >
                      {processingId === 'save_shop' ? 'Saving...' : '💾 Save Shop Settings'}
                    </button>
                  </div>

                  <div className="shop-history-card" style={{ width: '100%', marginTop: '40px' }}>
                    <div className="shop-history-header">
                      <div>
                        <h3 style={{ margin: 0, color: 'var(--accent-gold)', textTransform: 'uppercase', letterSpacing: '1px' }}>🛒 Purchase History</h3>
                        <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#94a3b8' }}>Audit logs of all shop transactions across the realms.</p>
                      </div>
                    </div>

                    <div style={{ width: '100%', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                      {shopHistoryLoading ? (
                        <div style={{ padding: '60px', textAlign: 'center' }}>
                          <div className="cosmetic-card-spinner" style={{ margin: '0 auto 15px' }}></div>
                          <span style={{ color: 'var(--text-muted)' }}>Summoning logs...</span>
                        </div>
                      ) : shopHistory.length === 0 ? (
                        <div style={{ padding: '60px', textAlign: 'center', color: '#94a3b8' }}>
                          <div style={{ fontSize: '2rem', marginBottom: '10px' }}>📦</div>
                          <span>No purchases recorded in the annals yet.</span>
                        </div>
                      ) : (
                        <table className="shop-history-table">
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>Buyer</th>
                              <th>Item</th>
                              <th>Creator</th>
                              <th style={{ textAlign: 'right' }}>Price</th>
                              <th style={{ textAlign: 'right' }}>Commission (60%)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {shopHistory.map(sale => {
                              const date = sale.timestamp?.toDate ? sale.timestamp.toDate() : new Date(sale.timestamp);
                              const currency = (sale.currency || 'valcoins').toLowerCase();
                              const currencyIcon = currency === 'aury' ? '/aury-icon.png' : currency === 'usdc' ? '/usdc-icon.png' : '/valcoin-icon.jpg';
                              return (
                                <tr key={sale.id}>
                                  <td>
                                    <div className="history-date">
                                      {date.toLocaleDateString()} <br />
                                      <span className="history-time">{date.toLocaleTimeString()}</span>
                                    </div>
                                  </td>
                                  <td>
                                    <div className="history-user-info">
                                      <span className="history-username">{sale.buyerName || 'Unknown'}</span>
                                      <span className="history-uid">{sale.buyerId}</span>
                                    </div>
                                  </td>
                                  <td>
                                    <div className="history-item-name">{sale.cosmeticName}</div>
                                  </td>
                                  <td>
                                    <div className="history-user-info">
                                      <span className="history-username">{sale.creatorName || 'System'}</span>
                                      <span className="history-uid">{sale.creatorId}</span>
                                    </div>
                                  </td>
                                  <td style={{ textAlign: 'right' }}>
                                    <div className="history-price-cell" style={{ justifyContent: 'flex-end' }}>
                                      <span>{sale.price?.toLocaleString()}</span>
                                      <img src={currencyIcon} alt="" className={`history-currency-icon ${sale.currency === 'valcoins' ? 'valcoin' : ''}`} />
                                    </div>
                                  </td>
                                  <td style={{ textAlign: 'right' }}>
                                    <div className="history-commission" style={{ justifyContent: 'flex-end' }}>
                                      +{sale.commission?.toLocaleString()}
                                      <img src={currencyIcon} alt="" className={`history-currency-icon ${currency === 'valcoins' ? 'valcoin' : ''}`} style={{ marginLeft: '8px' }} />
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                </>
              )}

              {shopSubTab === 'cosmetics' && (
                <div className="inventory-mgmt-container">
                  {/* Item List / Dashboard */}
                  <div className="admin-table-container card" style={{ marginBottom: '30px', padding: '15px' }}>
                    <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                      <div>
                        <h3 style={{ margin: 0 }}>Current Cosmetics</h3>
                        <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>{shopCosmetics.filter(item => isSuperAdminUser || !isMerchantUser || item.createdBy === user.uid).length} Items found in the vault.</p>
                      </div>
                      {isSuperAdminUser && (
                        <button
                          className="admin-badge-btn"
                          disabled={processingId === 'recount_sales'}
                          style={{
                            padding: '8px 16px',
                            fontSize: '12px',
                            background: processingId === 'recount_sales' ? '#6b7280' : 'linear-gradient(135deg, #f59e0b, #d97706)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            cursor: processingId === 'recount_sales' ? 'not-allowed' : 'pointer',
                            fontWeight: 700,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px'
                          }}
                          onClick={async () => {
                            if (!window.confirm('This will scan ALL users and recount actual sales for every cosmetic. Continue?')) return;
                            setProcessingId('recount_sales');
                            try {
                              // 1. Fetch all users
                              const usersSnap = await getDocs(collection(db, 'users'));

                              // 2. Build ownership count map: cosmeticId -> count
                              const ownershipCounts = {};
                              const creatorOwnedIds = new Set(); // Track items owned by their creators (free claims)

                              usersSnap.docs.forEach(userDoc => {
                                const userData = userDoc.data();
                                const owned = userData.ownedCosmetics || [];
                                owned.forEach(cosmeticId => {
                                  // Check if this user is the creator of this cosmetic (shouldn't count as a sale)
                                  const cosmetic = shopCosmetics.find(c => c.id === cosmeticId);
                                  if (cosmetic && cosmetic.createdBy === userDoc.id) {
                                    creatorOwnedIds.add(`${userDoc.id}_${cosmeticId}`);
                                    return; // Skip creator's own claim
                                  }
                                  ownershipCounts[cosmeticId] = (ownershipCounts[cosmeticId] || 0) + 1;
                                });
                              });

                              // 3. Update each cosmetic's saleCount
                              const batch = writeBatch(db);
                              let updatedCount = 0;

                              shopCosmetics.forEach(cosmetic => {
                                const actualCount = ownershipCounts[cosmetic.id] || 0;
                                if (cosmetic.saleCount !== actualCount) {
                                  const ref = doc(db, 'cosmetics', cosmetic.id);
                                  batch.update(ref, { saleCount: actualCount });
                                  updatedCount++;
                                }
                              });

                              if (updatedCount > 0) {
                                await batch.commit();
                                alert(`✅ Recount complete! Updated ${updatedCount} cosmetic(s). Scanned ${usersSnap.size} users.`);
                              } else {
                                alert(`✅ All sale counts are already accurate! Scanned ${usersSnap.size} users.`);
                              }
                            } catch (error) {
                              console.error('Error recounting sales:', error);
                              alert('Error recounting sales: ' + error.message);
                            } finally {
                              setProcessingId(null);
                            }
                          }}
                        >
                          {processingId === 'recount_sales' ? '⏳ Scanning...' : '🔄 Recount Sales'}
                        </button>
                      )}
                    </div>

                    {cosmeticsLoading ? (
                      <div style={{ padding: '40px', textAlign: 'center' }}>Loading items...</div>
                    ) : (
                      <table className="admin-table">
                        <thead>
                          <tr>
                            <th>Preview</th>
                            <th>Name</th>
                            <th>Rarity</th>
                            <th>Price</th>
                            <th>Creator</th>
                            <th>Sales</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {shopCosmetics
                            .filter(item => (isSuperAdminUser || !isMerchantUser || item.createdBy === user.uid) && item.type !== 'ygg_theme')
                            .map(item => (
                            <tr key={item.id}>
                              <td>
                                <AvatarWithAura
                                  user={null}
                                  size={36}
                                  auraData={item.type === 'aura' ? item : null}
                                />
                              </td>
                              <td>
                                <div style={{ fontWeight: '600' }}>{item.name}</div>
                                <div style={{ fontSize: '11px', color: '#94a3b8' }}>{item.type}</div>
                              </td>
                              <td>
                                <span className="rarity-badge" style={{ background: RARITY_CONFIG[item.rarity]?.color || '#ccc', fontSize: '10px', padding: '2px 6px' }}>
                                  {item.rarity.toUpperCase()}
                                </span>
                              </td>
                              <td>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <img
                                    src={(item.currency || 'valcoins').toLowerCase() === 'aury' ? '/aury-icon.png' : (item.currency || 'valcoins').toLowerCase() === 'usdc' ? '/usdc-icon.png' : '/valcoin-icon.jpg'}
                                    alt=""
                                    style={{ width: '12px', height: '12px', borderRadius: (item.currency || 'valcoins').toLowerCase() === 'valcoins' ? '50%' : '0' }}
                                  />
                                  {item.discountPrice !== undefined && item.discountPrice !== null && item.discountPrice < item.price ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1' }}>
                                      <span style={{ textDecoration: 'line-through', fontSize: '10px', opacity: 0.5 }}>{item.price.toLocaleString()}</span>
                                      <span style={{ color: '#4ade80', fontWeight: 'bold', fontSize: '12px' }}>{item.discountPrice.toLocaleString()}</span>
                                    </div>
                                  ) : (
                                    item.price.toLocaleString()
                                  )}
                                </div>
                              </td>
                              <td>
                                <div style={{ fontSize: '12px', color: '#cbd5e1' }}>
                                  {item.createdByName || 'System'}
                                </div>
                              </td>
                              <td>
                                <span style={{ color: '#10b981', fontWeight: 'bold' }}>{item.saleCount || 0}</span>
                              </td>
                              <td className="admin-actions">
                                {(isSuperAdminUser || item.createdBy === user.uid) ? (
                                  <>
                                    <button className="edit-btn" onClick={() => {
                                      setEditingCosmetic(item);
                                      setCosmeticForm({
                                        ...item,
                                        discountDays: 0,
                                        discountHours: 0
                                      });
                                      setShopSubTab('cosmetics_form');
                                    }}>📝 Edit</button>
                                    <button className="delete-btn" onClick={() => handleDeleteCosmetic(item.id)}>🗑️</button>
                                  </>
                                ) : (
                                  <span style={{ fontSize: '11px', color: '#64748b' }}>No Permission</span>
                                )}
                              </td>
                            </tr>
                          ))}
                          {shopCosmetics.length === 0 && (
                            <tr><td colSpan="6" style={{ textAlign: 'center', padding: '20px' }}>Your shop is currently empty. Add your first item below!</td></tr>
                          )}
                        </tbody>
                      </table>
                    )}

                    <button
                      className="selector-btn active"
                      style={{ marginTop: '15px', width: '100%', padding: '10px' }}
                      onClick={() => {
                        setEditingCosmetic(null);
                        setCosmeticForm({
                          name: '', type: 'aura', rarity: 'common', price: 1000,
                          description: '', placement: 'behind', gifUrl: '', pngUrl: '', cssClass: '', style: {}
                        });
                        setShopSubTab('cosmetics_form');
                      }}
                    >
                      + Add New Cosmetic
                    </button>
                  </div>
                </div>
              )}

              {shopSubTab === 'cosmetics_form' && (
                <div className="credit-form card">
                  <div className="section-header" style={{ marginBottom: '20px' }}>
                    <h3>{editingCosmetic ? `Editing: ${editingCosmetic.name}` : '✨ Create New Cosmetic'}</h3>
                    <button className="back-btn" onClick={() => setShopSubTab('cosmetics')}>← Back to List</button>
                  </div>

                  <form onSubmit={handleSaveCosmetic}>
                    <div className="form-row">
                      <div className="form-group flex-2">
                        <label>Display Name</label>
                        <input
                          type="text"
                          value={cosmeticForm.name}
                          onChange={(e) => setCosmeticForm(prev => ({ ...prev, name: e.target.value }))}
                          placeholder="e.g. Phoenix Pulse"
                          required
                        />
                      </div>
                      <div className="form-group flex-1">
                        <label>Category</label>
                        <select
                          value={cosmeticForm.type}
                          onChange={(e) => setCosmeticForm(prev => ({ ...prev, type: e.target.value }))}
                        >
                          <option value="aura">Aura (Avatar Overlay)</option>
                          <option value="banner">Banner (Profile Background)</option>
                        </select>
                      </div>
                    </div>

                    <div className="form-row">
                      <div className="form-group flex-1">
                        <label>Style Presets (Optional)</label>
                        <select
                          onChange={(e) => {
                            const preset = e.target.value;
                            if (preset === 'solar_flare') {
                              setCosmeticForm(prev => ({
                                ...prev,
                                cssClass: 'aura-solar-flare',
                                style: { filter: 'drop-shadow(0 0 15px #f59e0b) brightness(1.2)', animation: 'pulse 2s infinite ease-in-out' }
                              }));
                            } else if (preset === 'void_pulse') {
                              setCosmeticForm(prev => ({
                                ...prev,
                                cssClass: 'aura-void-pulse',
                                style: { filter: 'drop-shadow(0 0 20px #8b5cf6) contrast(1.5)', animation: 'float 4s infinite ease-in-out' }
                              }));
                            } else if (preset === 'neon_flicker') {
                              setCosmeticForm(prev => ({
                                ...prev,
                                cssClass: 'aura-neon-flicker',
                                style: { filter: 'hue-rotate(90deg) drop-shadow(0 0 10px #06b6d4)', opacity: '0.9' }
                              }));
                            } else if (preset === 'standard') {
                              setCosmeticForm(prev => ({
                                ...prev,
                                cssClass: '',
                                style: { filter: 'drop-shadow(0 0 8px rgba(255,255,255,0.4))' }
                              }));
                            }
                          }}
                          className="credit-input"
                          style={{ background: 'rgba(255,255,255,0.05)', color: 'white', borderRadius: '8px' }}
                        >
                          <option value="">-- Choose a Preset --</option>
                          <option value="standard">Standard Glow</option>
                          <option value="solar_flare">🔥 Solar Flare (Gold Pulse)</option>
                          <option value="void_pulse">✨ Void Pulse (Purple Float)</option>
                          <option value="neon_flicker">⚡ Neon Flicker (Cyan)</option>
                        </select>
                      </div>
                      <div className="form-group flex-1">
                        <label>Item Creator</label>
                        <div style={{
                          padding: '12px',
                          background: 'rgba(255,255,255,0.05)',
                          borderRadius: '8px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center'
                        }}>
                          <span style={{ fontSize: '14px', color: '#888' }}>
                            {editingCosmetic ? (editingCosmetic.createdByName || 'System') : (resolveDisplayName(user) || 'You')}
                          </span>
                          {editingCosmetic && !editingCosmetic.createdBy && (
                            <button
                              type="button"
                              className="admin-badge-btn"
                              style={{ padding: '4px 8px', fontSize: '11px', background: 'var(--accent-purple)' }}
                              onClick={() => {
                                // This will be saved when they click the main Save button
                                setEditingCosmetic(prev => ({
                                  ...prev,
                                  createdBy: user.uid,
                                  createdByName: resolveDisplayName(user) || 'Admin'
                                }));
                                alert('Creator updated to you! (Will be saved upon submit)');
                              }}
                            >
                              Claim Item
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="form-row">
                      <div className="form-group flex-1">
                        <label>Rarity</label>
                        <select
                          value={cosmeticForm.rarity}
                          onChange={(e) => setCosmeticForm(prev => ({ ...prev, rarity: e.target.value }))}
                        >
                          {RARITY_ORDER.map(r => <option key={r} value={r}>{r.toUpperCase()}</option>)}
                        </select>
                      </div>
                      <div className="form-group flex-1">
                        <label>Currency</label>
                        <select
                          value={cosmeticForm.currency || 'valcoins'}
                          onChange={(e) => setCosmeticForm(prev => ({ ...prev, currency: e.target.value }))}
                        >
                          <option value="valcoins">Valcoins (Points)</option>
                          <option value="aury">AURY (Wallet)</option>
                          <option value="usdc">USDC (Wallet)</option>
                        </select>
                      </div>
                      <div className="form-group flex-1">
                        <label>Price {editingCosmetic && <span style={{ color: '#ef4444', fontSize: '10px' }}>(Locked)</span>}</label>
                        <input
                          type="number"
                          value={cosmeticForm.price}
                          onChange={(e) => setCosmeticForm(prev => ({ ...prev, price: parseInt(e.target.value) || 0 }))}
                          required
                          disabled={!!editingCosmetic}
                          style={editingCosmetic ? { opacity: 0.6, cursor: 'not-allowed', background: 'rgba(0,0,0,0.2)' } : {}}
                        />
                      </div>
                      <div className="form-group flex-1">
                        <label>Discount Price</label>
                        <input
                          type="number"
                          value={cosmeticForm.discountPrice || ''}
                          onChange={(e) => setCosmeticForm(prev => ({ ...prev, discountPrice: e.target.value === '' ? null : parseInt(e.target.value) || 0 }))}
                          placeholder="Sale price..."
                        />
                      </div>
                      <div className="form-group flex-1">
                        <label>Duration (Days)</label>
                        <input
                          type="number"
                          value={cosmeticForm.discountDays || 0}
                          onChange={(e) => setCosmeticForm(prev => ({ ...prev, discountDays: parseInt(e.target.value) || 0 }))}
                          min="0"
                        />
                      </div>
                      <div className="form-group flex-1">
                        <label>Duration (Hours)</label>
                        <input
                          type="number"
                          value={cosmeticForm.discountHours || 0}
                          onChange={(e) => setCosmeticForm(prev => ({ ...prev, discountHours: parseInt(e.target.value) || 0 }))}
                          min="0"
                          max="23"
                        />
                      </div>
                    </div>

                    <div className="form-group">
                      <label>Description</label>
                      <textarea
                        value={cosmeticForm.description}
                        onChange={(e) => setCosmeticForm(prev => ({ ...prev, description: e.target.value }))}
                        placeholder="Enter a legendary description for this item..."
                        style={{ minHeight: '80px' }}
                      />
                    </div>


                    {cosmeticForm.type === 'aura' && (
                      <>
                        {/* ── Live Aura Preview ── */}
                        <div className="form-group" style={{
                          background: 'rgba(255,255,255,0.03)',
                          borderRadius: '12px',
                          padding: '20px',
                          border: '1px solid var(--border-subtle)',
                          marginBottom: '8px'
                        }}>
                          <label style={{ marginBottom: '12px', display: 'block', fontSize: '13px', fontWeight: 600 }}>Live Preview</label>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '24px', flexWrap: 'wrap' }}>
                            {/* Preview at multiple sizes */}
                            {[120, 72, 40].map(previewSize => (
                              <div key={previewSize} style={{ textAlign: 'center' }}>
                                <div style={{
                                  width: `${previewSize + 40}px`,
                                  height: `${previewSize + 40}px`,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  background: 'rgba(0,0,0,0.3)',
                                  borderRadius: '12px',
                                  border: '1px dashed rgba(255,255,255,0.1)',
                                  position: 'relative',
                                  overflow: 'visible'
                                }}>
                                  {/* Wrapper for avatar + aura */}
                                  <div style={{
                                    position: 'relative',
                                    width: `${previewSize}px`,
                                    height: `${previewSize}px`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                  }}>
                                    {/* Aura layer */}
                                    {(cosmeticForm.gifUrl || cosmeticForm.pngUrl) && (
                                      <img
                                        src={cosmeticForm.gifUrl || cosmeticForm.pngUrl}
                                        alt=""
                                        style={{
                                          position: 'absolute',
                                          width: `${(cosmeticForm.auraScale || 100)}%`,
                                          height: `${(cosmeticForm.auraScale || 100)}%`,
                                          left: `${50 + (cosmeticForm.auraOffsetX || 0) * (100 / previewSize)}%`,
                                          top: `${50 + (cosmeticForm.auraOffsetY || 0) * (100 / previewSize)}%`,
                                          transform: 'translate(-50%, -50%)',
                                          objectFit: cosmeticForm.placement === 'border' ? 'contain' : 'cover',
                                          borderRadius: cosmeticForm.placement === 'border' ? '0' : '50%',
                                          zIndex: cosmeticForm.placement === 'behind' ? 1 : 4,
                                          pointerEvents: 'none',
                                          opacity: 0.95
                                        }}
                                      />
                                    )}
                                    {/* Profile picture */}
                                    <img
                                      src={resolveAvatar(user)}
                                      alt=""
                                      style={{
                                        width: `${cosmeticForm.profileScale || 100}%`,
                                        height: `${cosmeticForm.profileScale || 100}%`,
                                        borderRadius: '50%',
                                        objectFit: 'cover',
                                        position: 'relative',
                                        zIndex: 2,
                                        border: '2px solid transparent'
                                      }}
                                      onError={(e) => { e.target.onerror = null; e.target.src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }}
                                    />
                                  </div>
                                </div>
                                <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>{previewSize}px</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* ── Placement Mode ── */}
                        <div className="form-group">
                          <label>Placement Mode</label>
                          <div className="currency-toggle-group">
                            <button type="button" className={`toggle-btn ${cosmeticForm.placement === 'behind' ? 'active' : ''}`} onClick={() => setCosmeticForm(prev => ({ ...prev, placement: 'behind' }))}>Behind (Behind Icon)</button>
                            <button type="button" className={`toggle-btn ${cosmeticForm.placement === 'overlay' ? 'active' : ''}`} onClick={() => setCosmeticForm(prev => ({ ...prev, placement: 'overlay' }))}>Overlay (Top Layer)</button>
                            <button type="button" className={`toggle-btn ${cosmeticForm.placement === 'border' ? 'active' : ''}`} onClick={() => setCosmeticForm(prev => ({ ...prev, placement: 'border' }))}>On Border</button>
                          </div>
                          <p className="helper-text" style={{ fontSize: '11px', marginTop: '5px' }}>Determines where the GIF/Animation is rendered relative to the user picture.</p>
                        </div>

                        {/* ── Profile Picture Scale ── */}
                        <div className="form-group">
                          <label>Profile Picture Scale: {cosmeticForm.profileScale || 100}%</label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <input type="range" min="50" max="100" step="5"
                              value={cosmeticForm.profileScale || 100}
                              onChange={(e) => setCosmeticForm(prev => ({ ...prev, profileScale: parseInt(e.target.value) }))}
                              style={{ flex: 1, accentColor: 'var(--accent-gold)' }}
                            />
                            <span style={{ fontSize: '13px', color: 'var(--text-muted)', minWidth: '40px' }}>{cosmeticForm.profileScale || 100}%</span>
                          </div>
                          <p className="helper-text" style={{ fontSize: '11px', marginTop: '5px' }}>Shrink the profile picture to fit inside auras with smaller transparent circles.</p>
                        </div>

                        {/* ── Aura Position & Scale ── */}
                        <div className="form-row" style={{ gap: '16px' }}>
                          <div className="form-group flex-1">
                            <label>Aura X Offset: {cosmeticForm.auraOffsetX || 0}px</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>L</span>
                              <input type="range" min="-50" max="50" step="1"
                                value={cosmeticForm.auraOffsetX || 0}
                                onChange={(e) => setCosmeticForm(prev => ({ ...prev, auraOffsetX: parseInt(e.target.value) }))}
                                style={{ flex: 1, accentColor: 'var(--accent-gold)' }}
                              />
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>R</span>
                            </div>
                          </div>
                          <div className="form-group flex-1">
                            <label>Aura Y Offset: {cosmeticForm.auraOffsetY || 0}px</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>U</span>
                              <input type="range" min="-50" max="50" step="1"
                                value={cosmeticForm.auraOffsetY || 0}
                                onChange={(e) => setCosmeticForm(prev => ({ ...prev, auraOffsetY: parseInt(e.target.value) }))}
                                style={{ flex: 1, accentColor: 'var(--accent-gold)' }}
                              />
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>D</span>
                            </div>
                          </div>
                          <div className="form-group flex-1">
                            <label>Aura Scale: {cosmeticForm.auraScale || 100}%</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <input type="range" min="50" max="200" step="5"
                                value={cosmeticForm.auraScale || 100}
                                onChange={(e) => setCosmeticForm(prev => ({ ...prev, auraScale: parseInt(e.target.value) }))}
                                style={{ flex: 1, accentColor: 'var(--accent-gold)' }}
                              />
                              <span style={{ fontSize: '13px', color: 'var(--text-muted)', minWidth: '40px' }}>{cosmeticForm.auraScale || 100}%</span>
                            </div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
                          <button type="button"
                            style={{ background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', padding: '4px 12px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer' }}
                            onClick={() => setCosmeticForm(prev => ({ ...prev, profileScale: 100, auraOffsetX: 0, auraOffsetY: 0, auraScale: 100 }))}
                          >Reset All to Default</button>
                        </div>
                      </>
                    )}

                    <div className="form-group">
                      <label>🎬 Animated Asset (AVIF / GIF / WebP)</label>
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <input
                          type="text"
                          value={cosmeticForm.gifUrl}
                          onChange={(e) => setCosmeticForm(prev => ({ ...prev, gifUrl: e.target.value }))}
                          placeholder="https://... (animated asset URL)"
                          className="flex-3"
                        />
                        <div className="file-upload-wrapper flex-1">
                          <label className="file-upload-btn" style={{ padding: '8px', fontSize: '12px' }}>
                            📁 Upload Animated
                            <input type="file" onChange={handleCosmeticImageUpload} accept="image/avif,image/gif,image/webp,image/*" />
                          </label>
                        </div>
                      </div>
                      {cosmeticFile && <p style={{ fontSize: '11px', color: '#10b981' }}>Animated: {cosmeticFile.name}</p>}
                      <p className="helper-text" style={{ fontSize: '11px', marginTop: '4px' }}>Plays on mouse hover. Leave empty for static-only cosmetics.</p>
                    </div>

                    <div className="form-group">
                      <label>🖼️ Static Preview (PNG / JPG)</label>
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <input
                          type="text"
                          value={cosmeticForm.pngUrl}
                          onChange={(e) => setCosmeticForm(prev => ({ ...prev, pngUrl: e.target.value }))}
                          placeholder="https://... (static preview URL)"
                          className="flex-3"
                        />
                        <div className="file-upload-wrapper flex-1">
                          <label className="file-upload-btn" style={{ padding: '8px', fontSize: '12px' }}>
                            📁 Upload Static
                            <input type="file" onChange={handleCosmeticStaticUpload} accept="image/png,image/jpeg,image/webp,image/*" />
                          </label>
                        </div>
                      </div>
                      {cosmeticStaticFile && <p style={{ fontSize: '11px', color: '#10b981' }}>Static: {cosmeticStaticFile.name}</p>}
                      <p className="helper-text" style={{ fontSize: '11px', marginTop: '4px' }}>Default display image. Shown when not hovered.</p>
                    </div>


                    <button
                      type="submit"
                      className="approve-btn"
                      disabled={processingId === 'save_cosmetic' || !cosmeticForm.name}
                      style={{ width: '100%', marginTop: '20px' }}
                    >
                      {processingId === 'save_cosmetic' ? 'Processing Transaction...' : (editingCosmetic ? '💾 Update Cosmetic' : '✨ Publish to Shop')}
                    </button>
                  </form>
                </div>
              )}

              {shopSubTab === 'amikos' && (
                <div className="placeholder-section" style={{ padding: '40px', textAlign: 'center', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px dashed rgba(255,255,255,0.1)' }}>
                  <div style={{ fontSize: '48px', marginBottom: '20px' }}>🐾</div>
                  <h3>Amikos Management</h3>
                  <p style={{ color: '#94a3b8' }}>This section is coming soon. You will be able to manage Amiko listings and traits here.</p>
                </div>
              )}

              {shopSubTab === 'items' && (
                <div className="placeholder-section" style={{ padding: '40px', textAlign: 'center', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px dashed rgba(255,255,255,0.1)' }}>
                  <div style={{ fontSize: '48px', marginBottom: '20px' }}>📦</div>
                  <h3>Items Management</h3>
                  <p style={{ color: '#94a3b8' }}>This section is coming soon. You will be able to manage shop items and power-ups here.</p>
                </div>
              )}

              {shopSubTab === 'ygg_themes' && (
                <div className="inventory-mgmt-container">
                  <div className="admin-table-container card" style={{ padding: '15px' }}>
                    <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                      <div>
                        <h3 style={{ margin: 0 }}>Yggdrasil Themes</h3>
                        <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>{shopCosmetics.filter(item => item.type === 'ygg_theme').length} Themes found.</p>
                      </div>
                    </div>

                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Preview</th>
                          <th>Name</th>
                          <th>Rarity</th>
                          <th>Price</th>
                          <th>Sales</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shopCosmetics
                          .filter(item => item.type === 'ygg_theme')
                          .map(item => (
                          <tr key={item.id}>
                            <td>
                              <div style={{ 
                                width: '60px', height: '36px', 
                                backgroundImage: `url(${item.assets?.background || '/icons/minigames/yggdrasil/background.png'})`,
                                backgroundSize: 'cover', backgroundPosition: 'center', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.1)'
                              }} />
                            </td>
                            <td>
                              <div style={{ fontWeight: '600' }}>{item.name}</div>
                            </td>
                            <td>
                              <span className="rarity-badge" style={{ background: RARITY_CONFIG[item.rarity]?.color || '#ccc', fontSize: '10px', padding: '2px 6px' }}>
                                {item.rarity.toUpperCase()}
                              </span>
                            </td>
                            <td>{item.price.toLocaleString()} {item.currency || 'Valcoins'}</td>
                            <td>{item.saleCount || 0}</td>
                            <td className="admin-actions">
                              <button className="edit-btn" onClick={() => {
                                setEditingCosmetic(item);
                                setCosmeticForm({ ...item, discountDays: 0, discountHours: 0 });
                                setShopSubTab('ygg_theme_form');
                              }}>📝 Edit</button>
                              <button className="delete-btn" onClick={() => handleDeleteCosmetic(item.id)}>🗑️</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <button
                      className="selector-btn active"
                      style={{ marginTop: '15px', width: '100%', padding: '10px' }}
                      onClick={() => {
                        setEditingCosmetic(null);
                        setCosmeticForm({
                          name: '', type: 'ygg_theme', rarity: 'common', price: 10, currency: 'runes',
                          description: '', assets: {}
                        });
                        setShopSubTab('ygg_theme_form');
                      }}
                    >
                      + Add New Theme
                    </button>
                  </div>
                </div>
              )}

              {shopSubTab === 'ygg_theme_form' && (
                <div className="cosmetic-form-container card" style={{ padding: '20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <h3>{editingCosmetic ? '📝 Edit Yggdrasil Theme' : '✨ Create New Theme'}</h3>
                    <button className="back-btn" onClick={() => setShopSubTab('ygg_themes')}>  Back to List</button>
                  </div>

                  <form onSubmit={handleSaveCosmetic}>
                    <div className="form-row">
                      <div className="form-group flex-2">
                        <label>Theme Name</label>
                        <input
                          type="text"
                          value={cosmeticForm.name}
                          onChange={(e) => setCosmeticForm(prev => ({ ...prev, name: e.target.value }))}
                          placeholder="e.g., Cyberpunk Yggdrasil"
                          required
                        />
                      </div>
                      <div className="form-group flex-1">
                        <label>Rarity</label>
                        <select
                          value={cosmeticForm.rarity}
                          onChange={(e) => setCosmeticForm(prev => ({ ...prev, rarity: e.target.value }))}
                        >
                          {RARITY_ORDER.map(r => <option key={r} value={r}>{r.toUpperCase()}</option>)}
                        </select>
                      </div>
                    </div>

                    <div className="form-row">
                      <div className="form-group flex-1">
                        <label>Currency</label>
                        <select
                          value={cosmeticForm.currency || 'valcoins'}
                          onChange={(e) => setCosmeticForm(prev => ({ ...prev, currency: e.target.value }))}
                        >
                          <option value="valcoins">Valcoins (Points)</option>
                          <option value="aury">AURY (Wallet)</option>
                          <option value="usdc">USDC (Wallet)</option>
                        </select>
                      </div>
                      <div className="form-group flex-1">
                        <label>Price</label>
                        <input
                          type="number"
                          value={cosmeticForm.price}
                          onChange={(e) => setCosmeticForm(prev => ({ ...prev, price: parseInt(e.target.value) || 0 }))}
                          required
                        />
                      </div>
                    </div>

                    <div className="form-group">
                      <label>Description</label>
                      <textarea
                        value={cosmeticForm.description}
                        onChange={(e) => setCosmeticForm(prev => ({ ...prev, description: e.target.value }))}
                        placeholder="Describe the theme..."
                        style={{ minHeight: '60px' }}
                      />
                    </div>

                    <div className="ygg-theme-config" style={{ background: 'rgba(0,0,0,0.2)', padding: '20px', borderRadius: '12px', marginBottom: '20px', border: '1px solid rgba(255,255,255,0.05)' }}>
                      <h4 style={{ marginBottom: '15px', color: 'var(--accent-gold)' }}>🎭 Yggdrasil Asset URLs</h4>
                      <p style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '20px' }}>Leave empty to use default assets.</p>
                      
                      <div className="form-row">
                        <div className="form-group flex-1">
                          <label>Character Stand</label>
                          <input type="text" placeholder="/icons/..." value={cosmeticForm.assets?.hero_stand || ''} onChange={(e) => setCosmeticForm(prev => ({ ...prev, assets: { ...(prev.assets || {}), hero_stand: e.target.value } }))} />
                        </div>
                        <div className="form-group flex-1">
                          <label>Character Jump</label>
                          <input type="text" placeholder="/icons/..." value={cosmeticForm.assets?.hero_jump || ''} onChange={(e) => setCosmeticForm(prev => ({ ...prev, assets: { ...(prev.assets || {}), hero_jump: e.target.value } }))} />
                        </div>
                        <div className="form-group flex-1">
                          <label>Character Turbo</label>
                          <input type="text" placeholder="/icons/..." value={cosmeticForm.assets?.hero_turbo || ''} onChange={(e) => setCosmeticForm(prev => ({ ...prev, assets: { ...(prev.assets || {}), hero_turbo: e.target.value } }))} />
                        </div>
                      </div>

                      <div className="form-row">
                        <div className="form-group flex-1">
                          <label>Platform 1 (Solid)</label>
                          <input type="text" placeholder="/icons/..." value={cosmeticForm.assets?.platform_1 || ''} onChange={(e) => setCosmeticForm(prev => ({ ...prev, assets: { ...(prev.assets || {}), platform_1: e.target.value } }))} />
                        </div>
                        <div className="form-group flex-1">
                          <label>Platform 2 (Fragile)</label>
                          <input type="text" placeholder="/icons/..." value={cosmeticForm.assets?.platform_2 || ''} onChange={(e) => setCosmeticForm(prev => ({ ...prev, assets: { ...(prev.assets || {}), platform_2: e.target.value } }))} />
                        </div>
                      </div>

                      <div className="form-group">
                        <label>Background Image</label>
                        <input type="text" placeholder="/icons/..." value={cosmeticForm.assets?.background || ''} onChange={(e) => setCosmeticForm(prev => ({ ...prev, assets: { ...(prev.assets || {}), background: e.target.value } }))} />
                      </div>

                      <div className="form-row">
                        <div className="form-group flex-1">
                          <label>Rune (Normal)</label>
                          <input type="text" placeholder="/icons/..." value={cosmeticForm.assets?.rune || ''} onChange={(e) => setCosmeticForm(prev => ({ ...prev, assets: { ...(prev.assets || {}), rune: e.target.value } }))} />
                        </div>
                        <div className="form-group flex-1">
                          <label>Red Rune</label>
                          <input type="text" placeholder="/icons/..." value={cosmeticForm.assets?.red_rune || ''} onChange={(e) => setCosmeticForm(prev => ({ ...prev, assets: { ...(prev.assets || {}), red_rune: e.target.value } }))} />
                        </div>
                        <div className="form-group flex-1">
                          <label>Ratatoskr</label>
                          <input type="text" placeholder="/icons/..." value={cosmeticForm.assets?.ratatoskr || ''} onChange={(e) => setCosmeticForm(prev => ({ ...prev, assets: { ...(prev.assets || {}), ratatoskr: e.target.value } }))} />
                        </div>
                      </div>

                      <div className="form-row">
                        <div className="form-group flex-1">
                          <label>Magnet</label>
                          <input type="text" placeholder="/icons/..." value={cosmeticForm.assets?.magnet || ''} onChange={(e) => setCosmeticForm(prev => ({ ...prev, assets: { ...(prev.assets || {}), magnet: e.target.value } }))} />
                        </div>
                        <div className="form-group flex-1">
                          <label>Idunn's Apple</label>
                          <input type="text" placeholder="/icons/..." value={cosmeticForm.assets?.apple || ''} onChange={(e) => setCosmeticForm(prev => ({ ...prev, assets: { ...(prev.assets || {}), apple: e.target.value } }))} />
                        </div>
                        <div className="form-group flex-1">
                          <label>Death Spirit</label>
                          <input type="text" placeholder="/icons/..." value={cosmeticForm.assets?.spirit || ''} onChange={(e) => setCosmeticForm(prev => ({ ...prev, assets: { ...(prev.assets || {}), spirit: e.target.value } }))} />
                        </div>
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="approve-btn"
                      disabled={processingId === 'save_cosmetic' || !cosmeticForm.name}
                      style={{ width: '100%', marginTop: '10px' }}
                    >
                      {processingId === 'save_cosmetic' ? 'Processing...' : (editingCosmetic ? '💾 Update Theme' : '✨ Publish Theme')}
                    </button>
                  </form>
                </div>
              )}

              {shopSubTab === 'tickets' && (
                <div className="placeholder-section" style={{ padding: '40px', textAlign: 'center', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px dashed rgba(255,255,255,0.1)' }}>
                  <div style={{ fontSize: '48px', marginBottom: '20px' }}>🎫</div>
                  <h3>Tickets Management</h3>
                  <p style={{ color: '#94a3b8' }}>This section is coming soon. You will be able to manage raffle and event tickets here.</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'website_mgmt' && (
            <div className="credit-section website-mgmt-section">
              <div className="section-info">
                <p>🌐 Manage global website settings, including maintenance mode and the Cosmetics Shop.</p>
              </div>

              {/* Sub-tab Pill Selector */}
              <div className="config-card" style={{ marginBottom: '20px', padding: '15px', background: 'rgba(10, 10, 15, 0.4)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)' }}>
                <div className="game-type-selector">
                  <button
                    className={`selector-btn ${websiteSubTab === 'maintenance' ? 'active' : ''}`}
                    onClick={() => setWebsiteSubTab('maintenance')}
                  >
                    Maintenance
                  </button>
                  <button
                    className={`selector-btn ${websiteSubTab === 'discord' ? 'active' : ''}`}
                    onClick={() => setWebsiteSubTab('discord')}
                  >
                    Discord
                  </button>
                </div>
              </div>

              {websiteSubTab === 'maintenance' && (
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
              )}



              {websiteSubTab === 'discord' && (
                <div className="credit-form">
                  <div className="section-header" style={{ marginBottom: '25px', paddingBottom: '15px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <h3 style={{ margin: 0, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '24px' }}>🤖</span> Runie Discord Bot
                    </h3>
                    <p style={{ margin: '8px 0 0 0', color: '#94a3b8', fontSize: '14px' }}>
                      Manage the Runie Discord bot integration and slash commands.
                    </p>
                  </div>

                  <div className="form-group">
                    <label>Slash Commands Status</label>
                    <div className="currency-toggle-group">
                      <button
                        className={`toggle-btn ${discordCommandsEnabled ? 'active' : ''}`}
                        onClick={() => setDiscordCommandsEnabled(true)}
                        style={{ background: discordCommandsEnabled ? '#5865F2' : '' }}
                      >ENABLED</button>
                      <button
                        className={`toggle-btn ${!discordCommandsEnabled ? 'active' : ''}`}
                        onClick={() => setDiscordCommandsEnabled(false)}
                        style={{ background: !discordCommandsEnabled ? '#ef4444' : '' }}
                      >DISABLED</button>
                    </div>
                    <p className="helper-text" style={{ marginTop: '10px', fontSize: '13px', color: discordCommandsEnabled ? '#10b981' : '#ef4444', background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '8px' }}>
                      {discordCommandsEnabled
                        ? "✅ Runie will respond to /balance, /wealth, and /leaderboard commands in Discord."
                        : "⚠️ Runie is currently OFFLINE. Users will receive a 'Disabled' message when attempting to use slash commands."}
                    </p>
                  </div>

                  <div className="info-box" style={{ marginTop: '20px', padding: '15px', background: 'rgba(88, 101, 242, 0.1)', border: '1px solid rgba(88, 101, 242, 0.2)', borderRadius: '12px' }}>
                    <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#5865F2' }}>Bot Integration Details</h4>
                    <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', color: '#cbd5e1', lineHeight: '1.6' }}>
                      <li>Public Key Verified: <code style={{ color: 'var(--accent)' }}>d97d2332...4f9e</code></li>
                      <li>Region: us-central1 (Cloud Functions v2)</li>
                      <li>Sync Status: Connected to Production Firestore</li>
                    </ul>
                  </div>

                  <button
                    className="admin-submit-btn"
                    onClick={handleSaveDiscordSettings}
                    disabled={processingId === 'save_discord'}
                    style={{ marginTop: '30px', width: '100%', background: 'linear-gradient(135deg, #5865F2 0%, #4752c4 100%)' }}
                  >
                    {processingId === 'save_discord' ? 'Saving...' : '💾 Save Discord Settings'}
                  </button>
                </div>
              )}


            </div>
          )}

          {activeTab === 'credit' && isSeniorAdminUser && (
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
                        <AvatarWithAura user={u} size={24} />
                        <span>{resolveDisplayName(u)}</span>
                        <button
                          onClick={() => setSelectedCreditUsers(prev => prev.filter(user => user.id !== u.id))}
                          className="remove-tag"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                      </div>
                    ))}
                    <button
                      className="add-user-btn"
                      onClick={() => setIsSelectingCreditUser(!isSelectingCreditUser)}
                    >
                      {isSelectingCreditUser ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                      )}
                      {isSelectingCreditUser ? ' Close' : ' Add User'}
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
                              <AvatarWithAura user={u} size={32} />
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

          {activeTab === 'deduct' && isSeniorAdminUser && (
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
                        <AvatarWithAura user={u} size={24} />
                        <span>{resolveDisplayName(u)}</span>
                        <button
                          onClick={() => setSelectedDeductUsers(prev => prev.filter(user => user.id !== u.id))}
                          className="remove-tag"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                      </div>
                    ))}
                    <button
                      className="add-user-btn"
                      onClick={() => setIsSelectingDeductUser(!isSelectingDeductUser)}
                    >
                      {isSelectingDeductUser ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                      )}
                      {isSelectingDeductUser ? ' Close' : ' Add User'}
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
                              <AvatarWithAura user={u} size={32} />
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
                        onChange={(e) => setValcoinConfig({ ...valcoinConfig, dailyCheckIn: parseInt(e.target.value) || 0 })}
                      />
                    </div>

                    <div className="input-group">
                      <label>Link Aurory Profile</label>
                      <input
                        type="number"
                        min="0"
                        className="credit-input"
                        value={valcoinConfig.linkAurory}
                        onChange={(e) => setValcoinConfig({ ...valcoinConfig, linkAurory: parseInt(e.target.value) || 0 })}
                      />
                    </div>

                    <div className="input-group">
                      <label>Join a Raffle</label>
                      <input
                        type="number"
                        min="0"
                        className="credit-input"
                        value={valcoinConfig.joinRaffle}
                        onChange={(e) => setValcoinConfig({ ...valcoinConfig, joinRaffle: parseInt(e.target.value) || 0 })}
                      />
                    </div>

                    <div className="input-group">
                      <label>Join a Tournament</label>
                      <input
                        type="number"
                        min="0"
                        className="credit-input"
                        value={valcoinConfig.joinTournament}
                        onChange={(e) => setValcoinConfig({ ...valcoinConfig, joinTournament: parseInt(e.target.value) || 0 })}
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

          {activeTab === 'economy' && isGeneralAdmin && renderEconomyTab()}

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
                    onClick={handleResetAllValcoinBalances}
                    disabled={isWiping || wipeAllConfirmText !== 'WIPE ALL'}
                    style={{ padding: '8px 15px', fontSize: '0.85em', background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' }}
                  >
                    💰 Reset All Valcoin Balances
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

              {/* Maintenance Tools and Sorting Row */}
              <div className="users-controls-row" style={{
                display: 'flex',
                gap: '15px',
                marginBottom: '20px',
                alignItems: 'center'
              }}>
                {/* Search Bar (Relocated) */}
                <div className="search-bar" style={{ flex: 1 }}>
                  <input
                    type="text"
                    placeholder="🔍 Search users by name, email, or UID..."
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

                {/* Sorting Controls */}
                <div className="sorting-controls" style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  background: 'rgba(255, 255, 255, 0.03)',
                  padding: '6px 15px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255, 255, 255, 0.05)'
                }}>
                  <span style={{ fontSize: '0.85em', opacity: 0.6 }}>Sort By:</span>
                  <select
                    value={usersSortKey}
                    onChange={(e) => setUsersSortKey(e.target.value)}
                    className="balance-type-select"
                    style={{ background: 'transparent', border: 'none', fontSize: '0.9em' }}
                  >
                    <option value="name">Name</option>
                    <option value="balance">Balance ({userBalanceType})</option>
                    <option value="streak">Streak</option>
                    <option value="superAdmin">Rank (Admins First)</option>
                  </select>
                  <button
                    onClick={() => setUsersSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'white',
                      cursor: 'pointer',
                      fontSize: '1.1em',
                      padding: '0 5px'
                    }}
                    title="Toggle Direction"
                  >
                    {usersSortDirection === 'asc' ? '↑' : '↓'}
                  </button>
                </div>
              </div>

              <div className="admin-user-list">
                <div className="user-list-header">
                  <div className="col-user">User</div>
                  <div className="col-email">
                    <select
                      value={userContactType}
                      onChange={(e) => setUserContactType(e.target.value)}
                      className="balance-type-select"
                      style={{ padding: '2px 5px', fontSize: '11px', height: '24px' }}
                    >
                      <option value="email">Email Address</option>
                      <option value="uid">User UID</option>
                    </select>
                  </div>
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
                      if (u.isAnonymous) return false; // Remove guests completely
                      if (!usersSearchQuery) return true;
                      const query = usersSearchQuery.toLowerCase();
                      const name = resolveDisplayName(u).toLowerCase();
                      const email = (u.email || '').toLowerCase();
                      const uid = (u.id || '').toLowerCase();
                      return name.includes(query) || email.includes(query) || uid.includes(query);
                    })
                    .sort((a, b) => {
                      const isSuperA = isSuperAdmin(getUserEmail(a));
                      const isSuperB = isSuperAdmin(getUserEmail(b));

                      // Secondary sort logic based on config
                      let comparison = 0;
                      if (usersSortKey === 'name') {
                        const nameA = resolveDisplayName(a).toLowerCase();
                        const nameB = resolveDisplayName(b).toLowerCase();
                        comparison = nameA.localeCompare(nameB);
                      } else if (usersSortKey === 'balance') {
                        const balA = userBalanceType === 'AURY' ? (a.balance || 0) :
                          userBalanceType === 'USDC' ? (a.usdcBalance || 0) : (a.points || 0);
                        const balB = userBalanceType === 'AURY' ? (b.balance || 0) :
                          userBalanceType === 'USDC' ? (b.usdcBalance || 0) : (b.points || 0);
                        comparison = balA - balB;
                      } else if (usersSortKey === 'streak') {
                        comparison = (a.checkInStreak || 0) - (b.checkInStreak || 0);
                      } else if (usersSortKey === 'superAdmin') {
                        comparison = (isSuperA === isSuperB) ? 0 : isSuperA ? -1 : 1;
                        return comparison; // Rank sort ignores direction state for the superadmin tiering
                      }

                      return usersSortDirection === 'asc' ? comparison : -comparison;
                    })
                    .map(u => {
                      const userIsSuper = isSuperAdmin(getUserEmail(u));
                      return (
                        <div
                          key={u.id}
                          className={`user-list-item ${userIsSuper ? 'super-admin' : ''} ${isSuperAdminUser ? 'clickable' : ''}`}
                          onClick={() => handleOpenUserEditor(u)}
                        >
                          <div className="col-user">
                            <img src={resolveAvatar(u)} alt="" />
                            <span>{resolveDisplayName(u)}</span>
                          </div>
                          <div className="col-email">
                            {userContactType === 'email' ? (u.email || 'No email') : u.id}
                          </div>
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
                                  onClick={(e) => e.stopPropagation()}
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
                                  onClick={async (e) => {
                                    e.stopPropagation();
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
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={async (e) => {
                                    e.stopPropagation();
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
                                  <option value="merchant">Merchant</option>
                                  <option value="senior_admin">Senior Admin</option>
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
                                    <button
                                      className="manage-btn"
                                      onClick={() => {
                                        setSelectedUserForArmory(u);
                                      }}
                                      style={{ background: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', border: '1px solid rgba(245, 158, 11, 0.2)' }}
                                    >
                                      🛡️ Armory
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
              <div className="section-info visitors-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <p>🌐 Users who visited the website in the last 3 days.</p>
                {isSuperAdminUser && (
                  <button
                    className="clear-btn-admin risky"
                    onClick={handleCleanupInactiveGuests}
                    disabled={isWiping}
                    style={{
                      padding: '8px 15px',
                      fontSize: '0.85em',
                      background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                      margin: 0
                    }}
                  >
                    🧹 Clear Inactive Guest Accounts (1 min)
                  </button>
                )}
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
                  <p style={{ margin: 0, opacity: 0.8 }}>Unified view of all user transactions — AURY, USDC, and Valcoins (purchases, winnings, fees, rewards, and admin adjustments).</p>
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
                        const name = (resolveDisplayName(u) || '').toLowerCase();
                        const email = (u.email || '').toLowerCase();
                        const auroryId = (u.auroryPlayerId || '').toLowerCase();
                        return name.includes(query) || email.includes(query) || auroryId.includes(query);
                      })
                      .filter(u => !u.isGuest || u.auroryPlayerId) // Show guests if they have linked Aurory
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
                      <div style={{ fontSize: '0.9em', color: '#fbbf24' }}>{(selectedWalletHistoryUser.points || 0).toLocaleString()} Valcoins</div>
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
                            <th>Source</th>
                            <th>Type</th>
                            <th>Amount</th>
                            <th>Currency</th>
                            <th>Details</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {walletHistoryTransactions.map(tx => {
                            const isPoints = tx.source === 'points';
                            const currencyLabel = isPoints
                              ? 'Valcoins'
                              : (tx.currency || 'AURY');

                            let displayAmount;
                            if (isPoints) {
                              displayAmount = tx.amount?.toLocaleString() || '0';
                            } else {
                              displayAmount = tx.amount ? formatAuryAmount(tx.amount) : 'N/A';
                            }

                            // Determine if it's a credit or debit
                            const isCredit = isPoints
                              ? (tx.amount > 0)
                              : ['raffle_win', 'raffle_refund', 'withdrawal_rejected', 'cosmetic_revenue'].includes(tx.type) || (tx.type === 'admin_adjust' && tx.amount > 0);

                            return (
                              <tr key={`${tx.source}-${tx.id}`}>
                                <td className="log-time">{formatTime(tx.timestamp)}</td>
                                <td>
                                  <span style={{
                                    fontSize: '10px',
                                    padding: '2px 6px',
                                    borderRadius: '4px',
                                    background: isPoints ? 'rgba(251, 191, 36, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                                    color: isPoints ? '#fbbf24' : '#ef4444',
                                    fontWeight: 700
                                  }}>
                                    {isPoints ? '💰 Points' : '🪙 Wallet'}
                                  </span>
                                </td>
                                <td className="log-type">
                                  <span className={`type-tag tag-${(tx.type || 'unknown').toLowerCase()}`}>
                                    {tx.type}
                                  </span>
                                </td>
                                <td className="log-action" style={{ color: isCredit ? '#4ade80' : '#f87171', fontWeight: 'bold' }}>
                                  {isCredit ? '+' : '-'}{displayAmount}
                                </td>
                                <td>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <img
                                      src={currencyLabel === 'AURY' ? '/aury-icon.png' : currencyLabel === 'USDC' ? '/usdc-icon.png' : '/valcoin-icon.jpg'}
                                      alt=""
                                      style={{ width: '14px', height: '14px', borderRadius: currencyLabel === 'Valcoins' ? '50%' : '0' }}
                                    />
                                    {currencyLabel}
                                  </div>
                                </td>
                                <td className="log-details">
                                  <div style={{ fontSize: '12px' }}>
                                    {tx.status && <span style={{ marginRight: '8px', opacity: 0.8 }}>[{tx.status.toUpperCase()}]</span>}
                                    {tx.description || tx.reason || tx.txSignature || 'N/A'}
                                  </div>
                                </td>
                                <td>
                                  {tx.source === 'wallet' && (
                                    <button
                                      className="delete-btn"
                                      onClick={() => handleDeleteWalletTransaction(tx.id, selectedWalletHistoryUser.id)}
                                      disabled={processingId === `del-tx-${tx.id}`}
                                      style={{ padding: '6px 12px', fontSize: '0.85em', background: '#dc2626', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', opacity: processingId === `del-tx-${tx.id}` ? 0.5 : 1 }}
                                    >
                                      {processingId === `del-tx-${tx.id}` ? 'Deleting...' : 'Delete'}
                                    </button>
                                  )}
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

                    <button
                      className={`selector-btn ${activeGameType === 'odinsRiddle' ? 'active' : ''}`}
                      onClick={() => setActiveGameType('odinsRiddle')}
                    >
                      Odin's Riddle
                    </button>
                    <button
                      className={`selector-btn ${activeGameType === 'yggdrasilAscender' ? 'active' : ''}`}
                      onClick={() => setActiveGameType('yggdrasilAscender')}
                    >
                      Yggdrasil
                    </button>
                  </div>
                </div>
              </div>


              {activeGameType !== 'drakkarRace' && activeGameType !== 'odinsRiddle' && activeGameType !== 'yggdrasilAscender' && (
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

                      {activeGameType === 'odinsRiddle' ? (
                        <>
                          <div className="form-group">
                            <label>Timer Limit (Seconds)</label>
                            <input
                              type="number"
                              value={miniGamesConfig[activeGameType]?.timerLimit ?? 15}
                              onChange={(e) => handleUpdateMiniGameConfig(activeGameType, { timerLimit: parseInt(e.target.value) })}
                              min="5"
                              max="60"
                            />
                          </div>
                          <div className="form-group">
                            <label>Max Wrong Answers / Day</label>
                            <input
                              type="number"
                              value={miniGamesConfig[activeGameType]?.maxWrongPerDay ?? 3}
                              onChange={(e) => handleUpdateMiniGameConfig(activeGameType, { maxWrongPerDay: parseInt(e.target.value) || 0 })}
                              min="1"
                              max="10"
                            />
                          </div>
                        </>
                      ) : activeGameType !== 'yggdrasilAscender' ? (
                        <div className="form-group">
                          <label>Cost Per Play (Valcoins)</label>
                          <input
                            type="number"
                            value={miniGamesConfig[activeGameType]?.costPerPlay ?? 50}
                            onChange={(e) => handleUpdateMiniGameConfig(activeGameType, { costPerPlay: parseInt(e.target.value) || 0 })}
                            min="0"
                          />
                        </div>
                      ) : null}
                      {(activeGameType === 'slotMachine' || activeGameType === 'treasureChest') && (
                        <>
                          <div className="form-group">
                            <label>Jackpot Min AURY (Base Reward)</label>
                            <input
                              type="number"
                              step="0.01"
                              value={miniGamesConfig[activeGameType]?.jackpotMinAury ?? 0}
                              onChange={(e) => handleUpdateMiniGameConfig(activeGameType, { jackpotMinAury: parseFloat(e.target.value) || 0 })}
                              min="0"
                              title="The starting AURY reward when the gauge is empty"
                            />
                          </div>
                          <div className="form-group">
                            <label>Jackpot Max AURY (Full Gauge Reward)</label>
                            <input
                              type="number"
                              step="0.01"
                              value={miniGamesConfig[activeGameType]?.jackpotMaxAury ?? (activeGameType === 'slotMachine' ? 10 : 5)}
                              onChange={(e) => handleUpdateMiniGameConfig(activeGameType, { jackpotMaxAury: parseFloat(e.target.value) || 0 })}
                              min="0"
                            />
                          </div>
                          <div className="form-group">
                            <label>Jackpot Max Losses (Gauge Size)</label>
                            <input
                              type="number"
                              value={miniGamesConfig[activeGameType]?.jackpotMaxCount ?? 500}
                              onChange={(e) => handleUpdateMiniGameConfig(activeGameType, { jackpotMaxCount: parseInt(e.target.value) || 500 })}
                              min="10"
                              title="How many 'Better Luck Next Time' results to fill the gauge"
                            />
                          </div>
                        </>
                      )}
                    </div>

                    {activeGameType === 'drakkarRace' && (
                      <>
                        <div className="form-row">
                          <div className="form-group">
                            <label>House Factor (0.9 = 10% Cut)</label>
                            <input
                              type="number"
                              step="0.01"
                              value={miniGamesConfig[activeGameType]?.multiplierFactor ?? 0.9}
                              onChange={(e) => handleUpdateMiniGameConfig(activeGameType, { multiplierFactor: parseFloat(e.target.value) })}
                              min="0"
                              max="2"
                            />
                          </div>
                          <div className="form-group">
                            <label>House Seed Amount</label>
                            <input
                              type="number"
                              value={miniGamesConfig[activeGameType]?.houseSeed ?? 500}
                              onChange={(e) => handleUpdateMiniGameConfig(activeGameType, { houseSeed: parseInt(e.target.value) })}
                              min="0"
                            />
                          </div>
                        </div>

                        <div className="admin-section-divider">Bot Management (Ghost Bots)</div>
                        <div className="form-group">
                          <label className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={miniGamesConfig[activeGameType]?.botsEnabled !== false}
                              onChange={(e) => handleUpdateMiniGameConfig(activeGameType, { botsEnabled: e.target.checked })}
                            />
                            Enable Ghost Bots
                          </label>
                        </div>
                        <div className="form-row">
                          <div className="form-group">
                            <label>Min Bot Count</label>
                            <input
                              type="number"
                              value={miniGamesConfig[activeGameType]?.minBots ?? 10}
                              onChange={(e) => handleUpdateMiniGameConfig(activeGameType, { minBots: parseInt(e.target.value) })}
                              min="0"
                            />
                          </div>
                          <div className="form-group">
                            <label>Max Bot Count</label>
                            <input
                              type="number"
                              value={miniGamesConfig[activeGameType]?.maxBots ?? 20}
                              onChange={(e) => handleUpdateMiniGameConfig(activeGameType, { maxBots: parseInt(e.target.value) })}
                              min="0"
                            />
                          </div>
                        </div>
                      </>
                    )}

                    {activeGameType === 'yggdrasilAscender' && (
                      <div className="config-card card" style={{ marginTop: '20px' }}>
                        <h3>ᚠ Rune Shop & Economy Settings</h3>

                        <div className="admin-section-divider">Daily Rewards & Multiplier</div>
                        <div className="form-row">
                          <div className="form-group">
                            <label>Max Rewarded Runs / Day</label>
                            <input
                              type="number"
                              value={miniGamesConfig[activeGameType]?.maxDailyRuns ?? 5}
                              onChange={(e) => handleUpdateMiniGameConfig(activeGameType, { maxDailyRuns: parseInt(e.target.value) || 0 })}
                              min="0"
                              max="50"
                            />
                          </div>
                          <div className="form-group">
                            <label>Rune Multiplier</label>
                            <input
                              type="number"
                              step="0.1"
                              value={miniGamesConfig[activeGameType]?.runeMultiplier ?? 1.0}
                              onChange={(e) => handleUpdateMiniGameConfig(activeGameType, { runeMultiplier: parseFloat(e.target.value) || 0 })}
                              min="0"
                              max="10"
                            />
                          </div>
                        </div>

                        <div className="admin-section-divider">Shop Item Costs (Runes)</div>
                        <div className="form-row">
                          <div className="form-group">
                            <label>Magnetism Lv1</label>
                            <input
                              type="number"
                              value={miniGamesConfig[activeGameType]?.shopCosts?.magnetismLv1 ?? 100}
                              onChange={(e) => {
                                const costs = { ...(miniGamesConfig[activeGameType]?.shopCosts || {}) };
                                costs.magnetismLv1 = parseInt(e.target.value) || 0;
                                handleUpdateMiniGameConfig(activeGameType, { shopCosts: costs });
                              }}
                            />
                          </div>
                          <div className="form-group">
                            <label>Magnetism Lv2</label>
                            <input
                              type="number"
                              value={miniGamesConfig[activeGameType]?.shopCosts?.magnetismLv2 ?? 250}
                              onChange={(e) => {
                                const costs = { ...(miniGamesConfig[activeGameType]?.shopCosts || {}) };
                                costs.magnetismLv2 = parseInt(e.target.value) || 0;
                                handleUpdateMiniGameConfig(activeGameType, { shopCosts: costs });
                              }}
                            />
                          </div>
                          <div className="form-group">
                            <label>Magnetism Lv3</label>
                            <input
                              type="number"
                              value={miniGamesConfig[activeGameType]?.shopCosts?.magnetismLv3 ?? 500}
                              onChange={(e) => {
                                const costs = { ...(miniGamesConfig[activeGameType]?.shopCosts || {}) };
                                costs.magnetismLv3 = parseInt(e.target.value) || 0;
                                handleUpdateMiniGameConfig(activeGameType, { shopCosts: costs });
                              }}
                            />
                          </div>
                          <div className="form-group" style={{ maxWidth: '120px' }}>
                            <label>Currency</label>
                            <select
                              value={miniGamesConfig[activeGameType]?.shopCosts?.magnetismCurrency || 'runes'}
                              onChange={(e) => {
                                const costs = { ...(miniGamesConfig[activeGameType]?.shopCosts || {}) };
                                costs.magnetismCurrency = e.target.value;
                                handleUpdateMiniGameConfig(activeGameType, { shopCosts: costs });
                              }}
                            >
                              <option value="runes">Runes</option>
                              <option value="redRunes">Red Runes</option>
                            </select>
                          </div>
                        </div>
                        <div className="form-row" style={{ marginTop: '10px' }}>
                          <div className="form-group">
                            <label>Extra Turbo Charge</label>
                            <input
                              type="number"
                              value={miniGamesConfig[activeGameType]?.shopCosts?.extraTurbo ?? 50}
                              onChange={(e) => {
                                const costs = { ...(miniGamesConfig[activeGameType]?.shopCosts || {}) };
                                costs.extraTurbo = parseInt(e.target.value) || 0;
                                handleUpdateMiniGameConfig(activeGameType, { shopCosts: costs });
                              }}
                            />
                          </div>
                          <div className="form-group">
                            <label>Extra High Jump</label>
                            <input
                              type="number"
                              value={miniGamesConfig[activeGameType]?.shopCosts?.extraJump ?? 50}
                              onChange={(e) => {
                                const costs = { ...(miniGamesConfig[activeGameType]?.shopCosts || {}) };
                                costs.extraJump = parseInt(e.target.value) || 0;
                                handleUpdateMiniGameConfig(activeGameType, { shopCosts: costs });
                              }}
                            />
                          </div>
                          <div className="form-group">
                            <label>Iðunn’s Apple</label>
                            <input
                              type="number"
                              value={miniGamesConfig[activeGameType]?.shopCosts?.idunApple ?? 500}
                              onChange={(e) => {
                                const costs = { ...(miniGamesConfig[activeGameType]?.shopCosts || {}) };
                                costs.idunApple = parseInt(e.target.value) || 0;
                                handleUpdateMiniGameConfig(activeGameType, { shopCosts: costs });
                              }}
                            />
                          </div>
                        </div>
                        <div className="form-row" style={{ marginTop: '10px' }}>
                          <div className="form-group">
                            <label>Turbo Currency</label>
                            <select
                              value={miniGamesConfig[activeGameType]?.shopCosts?.extraTurboCurrency || 'runes'}
                              onChange={(e) => {
                                const costs = { ...(miniGamesConfig[activeGameType]?.shopCosts || {}) };
                                costs.extraTurboCurrency = e.target.value;
                                handleUpdateMiniGameConfig(activeGameType, { shopCosts: costs });
                              }}
                            >
                              <option value="runes">Runes</option>
                              <option value="redRunes">Red Runes</option>
                            </select>
                          </div>
                          <div className="form-group">
                            <label>Jump Currency</label>
                            <select
                              value={miniGamesConfig[activeGameType]?.shopCosts?.extraJumpCurrency || 'runes'}
                              onChange={(e) => {
                                const costs = { ...(miniGamesConfig[activeGameType]?.shopCosts || {}) };
                                costs.extraJumpCurrency = e.target.value;
                                handleUpdateMiniGameConfig(activeGameType, { shopCosts: costs });
                              }}
                            >
                              <option value="runes">Runes</option>
                              <option value="redRunes">Red Runes</option>
                            </select>
                          </div>
                          <div className="form-group">
                            <label>Apple Currency</label>
                            <select
                              value={miniGamesConfig[activeGameType]?.shopCosts?.idunAppleCurrency || 'runes'}
                              onChange={(e) => {
                                const costs = { ...(miniGamesConfig[activeGameType]?.shopCosts || {}) };
                                costs.idunAppleCurrency = e.target.value;
                                handleUpdateMiniGameConfig(activeGameType, { shopCosts: costs });
                              }}
                            >
                              <option value="runes">Runes</option>
                              <option value="redRunes">Red Runes</option>
                            </select>
                          </div>
                        </div>

                        <div className="admin-section-divider">Currency Exchange Rates (1 Rune = X)</div>
                        <div className="form-row">
                          <div className="form-group">
                            <label>Valcoins Rate</label>
                            <input
                              type="number"
                              step="0.001"
                              value={miniGamesConfig[activeGameType]?.exchangeRates?.valcoins ?? 0.5}
                              onChange={(e) => {
                                const rates = { ...(miniGamesConfig[activeGameType]?.exchangeRates || {}) };
                                rates.valcoins = parseFloat(e.target.value) || 0;
                                handleUpdateMiniGameConfig(activeGameType, { exchangeRates: rates });
                              }}
                            />
                          </div>
                          <div className="form-group">
                            <label>AURY Rate</label>
                            <input
                              type="number"
                              step="0.0001"
                              value={miniGamesConfig[activeGameType]?.exchangeRates?.aury ?? 0.01}
                              onChange={(e) => {
                                const rates = { ...(miniGamesConfig[activeGameType]?.exchangeRates || {}) };
                                rates.aury = parseFloat(e.target.value) || 0;
                                handleUpdateMiniGameConfig(activeGameType, { exchangeRates: rates });
                              }}
                            />
                          </div>
                        </div>

                        <div className="admin-section-divider">Global Ascension Goal</div>
                        <div className="form-group">
                          <label>Global Goal Target (Meters)</label>
                          <input
                            type="number"
                            value={miniGamesConfig[activeGameType]?.globalGoalTarget ?? 5000000}
                            onChange={(e) => handleUpdateMiniGameConfig(activeGameType, { globalGoalTarget: parseInt(e.target.value) || 0 })}
                          />
                        </div>

                        <div className="form-group" style={{ marginTop: '10px' }}>
                          <label>🐿️ Ratatoskr Rune Reward</label>
                          <input
                            type="number"
                            value={miniGamesConfig[activeGameType]?.ratatoskrReward ?? 5}
                            onChange={(e) => handleUpdateMiniGameConfig(activeGameType, { ratatoskrReward: parseInt(e.target.value) || 0 })}
                          />
                          <p style={{ fontSize: '0.8em', color: '#94a3b8', marginTop: '4px' }}>Runes granted when catching Ratatoskr during a run.</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {activeGameType === 'odinsRiddle' ? (
                    <>
                      <div style={{ marginTop: '20px' }}>
                        <h4 style={{ color: '#e2e8f0', marginBottom: '10px' }}>📖 Base Riddles (must answer all correctly to unlock streak)</h4>
                        <div className="admin-table-container">
                          <table className="admin-table" style={{ fontSize: '0.9em' }}>
                            <thead>
                              <tr>
                                <th>#</th>
                                <th>Difficulty</th>
                                <th>Reward (Valcoins)</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(miniGamesConfig[activeGameType]?.baseRiddles || [
                                { difficulty: 'easy', reward: 20 },
                                { difficulty: 'easy', reward: 20 },
                                { difficulty: 'medium', reward: 30 },
                                { difficulty: 'medium', reward: 30 },
                                { difficulty: 'hard', reward: 50 },
                              ]).map((slot, idx) => (
                                <tr key={`base-${idx}`}>
                                  <td style={{ textAlign: 'center', fontWeight: 'bold' }}>{idx + 1}</td>
                                  <td>
                                    <select
                                      value={slot.difficulty}
                                      onChange={(e) => {
                                        const arr = [...(miniGamesConfig[activeGameType]?.baseRiddles || [])];
                                        arr[idx] = { ...arr[idx], difficulty: e.target.value };
                                        handleUpdateMiniGameConfig(activeGameType, { baseRiddles: arr });
                                      }}
                                      style={{ width: '100%' }}
                                    >
                                      <option value="easy">Easy</option>
                                      <option value="medium">Medium</option>
                                      <option value="hard">Hard</option>
                                    </select>
                                  </td>
                                  <td>
                                    <input
                                      type="number"
                                      value={slot.reward}
                                      onChange={(e) => {
                                        const arr = [...(miniGamesConfig[activeGameType]?.baseRiddles || [])];
                                        arr[idx] = { ...arr[idx], reward: parseInt(e.target.value) || 0 };
                                        handleUpdateMiniGameConfig(activeGameType, { baseRiddles: arr });
                                      }}
                                      min="0"
                                      style={{ width: '80px' }}
                                    />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      <div style={{ marginTop: '20px' }}>
                        <h4 style={{ color: '#fbbf24', marginBottom: '10px' }}>🔥 Streak Bonus Riddles (unlocked after perfect base round)</h4>
                        <div className="admin-table-container">
                          <table className="admin-table" style={{ fontSize: '0.9em' }}>
                            <thead>
                              <tr>
                                <th>#</th>
                                <th>Difficulty</th>
                                <th>Reward (Valcoins)</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(miniGamesConfig[activeGameType]?.streakRiddles || [
                                { difficulty: 'easy', reward: 50 },
                                { difficulty: 'easy', reward: 50 },
                                { difficulty: 'easy', reward: 50 },
                                { difficulty: 'medium', reward: 50 },
                                { difficulty: 'hard', reward: 50 },
                              ]).map((slot, idx) => (
                                <tr key={`streak-${idx}`}>
                                  <td style={{ textAlign: 'center', fontWeight: 'bold', color: '#fbbf24' }}>{idx + 6}</td>
                                  <td>
                                    <select
                                      value={slot.difficulty}
                                      onChange={(e) => {
                                        const arr = [...(miniGamesConfig[activeGameType]?.streakRiddles || [])];
                                        arr[idx] = { ...arr[idx], difficulty: e.target.value };
                                        handleUpdateMiniGameConfig(activeGameType, { streakRiddles: arr });
                                      }}
                                      style={{ width: '100%' }}
                                    >
                                      <option value="easy">Easy</option>
                                      <option value="medium">Medium</option>
                                      <option value="hard">Hard</option>
                                    </select>
                                  </td>
                                  <td>
                                    <input
                                      type="number"
                                      value={slot.reward}
                                      onChange={(e) => {
                                        const arr = [...(miniGamesConfig[activeGameType]?.streakRiddles || [])];
                                        arr[idx] = { ...arr[idx], reward: parseInt(e.target.value) || 0 };
                                        handleUpdateMiniGameConfig(activeGameType, { streakRiddles: arr });
                                      }}
                                      min="0"
                                      style={{ width: '80px' }}
                                    />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </>
                  ) : activeGameType !== 'yggdrasilAscender' ? (
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
                  ) : null}


                  {activeGameType !== 'drakkarRace' && activeGameType !== 'yggdrasilAscender' && (
                    <div className="prizes-management-card card">
                      {activeGameType === 'odinsRiddle' ? (
                        <div className="riddle-management-section">
                          <h3>{newRiddle.id ? '📝 Edit Riddle' : '➕ Add New Riddle'}</h3>
                          <div className="riddle-form-card">
                            <div className="form-group">
                              <label>Question</label>
                              <textarea
                                value={newRiddle.question}
                                onChange={(e) => setNewRiddle({ ...newRiddle, question: e.target.value })}
                                placeholder="Enter the riddle question..."
                                rows="3"
                              />
                            </div>
                            <div className="form-group">
                              <label>🖼️ Riddle Image (Optional - Used for 'Who Am I?')</label>
                              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                <input
                                  type="text"
                                  value={newRiddle.imageUrl}
                                  onChange={(e) => setNewRiddle(prev => ({ ...prev, imageUrl: e.target.value }))}
                                  placeholder="https://... (image URL)"
                                  className="flex-3"
                                />
                                <div className="file-upload-wrapper flex-1">
                                  <label className="file-upload-btn" style={{ padding: '8px', fontSize: '12px' }}>
                                    📁 Upload
                                    <input type="file" onChange={handleRiddleImageUpload} accept="image/*" />
                                  </label>
                                </div>
                              </div>
                              {(riddlePreview || newRiddle.imageUrl) && (
                                <div className="image-preview-mini" style={{ marginTop: '10px' }}>
                                  <img src={riddlePreview || newRiddle.imageUrl} alt="Preview" style={{ maxHeight: '120px', borderRadius: '4px' }} />
                                  <button onClick={() => { setRiddleFile(null); setRiddlePreview(''); setNewRiddle(prev => ({ ...prev, imageUrl: '' })); }} type="button">Remove</button>
                                </div>
                              )}
                            </div>
                            <div className="form-row">
                              <div className="form-group">
                                <label>Option A (Correct? <input type="radio" checked={newRiddle.correctIndex === 0} onChange={() => setNewRiddle({ ...newRiddle, correctIndex: 0 })} />)</label>
                                <input type="text" value={newRiddle.options[0]} onChange={(e) => {
                                  const opts = [...newRiddle.options];
                                  opts[0] = e.target.value;
                                  setNewRiddle({ ...newRiddle, options: opts });
                                }} />
                              </div>
                              <div className="form-group">
                                <label>Option B (Correct? <input type="radio" checked={newRiddle.correctIndex === 1} onChange={() => setNewRiddle({ ...newRiddle, correctIndex: 1 })} />)</label>
                                <input type="text" value={newRiddle.options[1]} onChange={(e) => {
                                  const opts = [...newRiddle.options];
                                  opts[1] = e.target.value;
                                  setNewRiddle({ ...newRiddle, options: opts });
                                }} />
                              </div>
                            </div>
                            <div className="form-row">
                              <div className="form-group">
                                <label>Option C (Correct? <input type="radio" checked={newRiddle.correctIndex === 2} onChange={() => setNewRiddle({ ...newRiddle, correctIndex: 2 })} />)</label>
                                <input type="text" value={newRiddle.options[2]} onChange={(e) => {
                                  const opts = [...newRiddle.options];
                                  opts[2] = e.target.value;
                                  setNewRiddle({ ...newRiddle, options: opts });
                                }} />
                              </div>
                              <div className="form-group">
                                <label>Option D (Correct? <input type="radio" checked={newRiddle.correctIndex === 3} onChange={() => setNewRiddle({ ...newRiddle, correctIndex: 3 })} />)</label>
                                <input type="text" value={newRiddle.options[3]} onChange={(e) => {
                                  const opts = [...newRiddle.options];
                                  opts[3] = e.target.value;
                                  setNewRiddle({ ...newRiddle, options: opts });
                                }} />
                              </div>
                            </div>
                            <div className="form-row">
                              <div className="form-group">
                                <label>Category</label>
                                <select value={newRiddle.category} onChange={(e) => setNewRiddle({ ...newRiddle, category: e.target.value })}>
                                  <option value="norse">Norse Mythology</option>
                                  <option value="crypto">Crypto & Blockchain</option>
                                  <option value="aurory">Aurory</option>
                                  <option value="gaming">Gaming</option>
                                  <option value="asgard">Asgard Duels</option>
                                </select>
                              </div>
                              <div className="form-group">
                                <label>Difficulty</label>
                                <select value={newRiddle.difficulty} onChange={(e) => setNewRiddle({ ...newRiddle, difficulty: e.target.value })}>
                                  <option value="easy">Easy</option>
                                  <option value="medium">Medium</option>
                                  <option value="hard">Hard</option>
                                </select>
                              </div>
                              <div className="form-group toggle-group">
                                <label className="toggle-label">
                                  <span>Enabled</span>
                                  <input type="checkbox" checked={newRiddle.enabled} onChange={(e) => setNewRiddle({ ...newRiddle, enabled: e.target.checked })} />
                                </label>
                              </div>
                            </div>
                            <div className="form-actions-admin" style={{ marginTop: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div style={{ display: 'flex', gap: '10px' }}>
                                <button
                                  className="admin-primary-btn"
                                  onClick={handleSaveRiddle}
                                  disabled={processingId === 'save_riddle'}
                                >
                                  {processingId === 'save_riddle' ? 'Saving...' : newRiddle.id ? 'Update Riddle' : 'Add Riddle to Database'}
                                </button>
                                {newRiddle.id && (
                                  <button
                                    className="admin-secondary-btn"
                                    onClick={() => {
                                      setNewRiddle({ id: '', question: '', options: ['', '', '', ''], correctIndex: 0, category: 'norse', difficulty: 'easy', enabled: true, imageUrl: '' });
                                      setRiddleFile(null);
                                      setRiddlePreview('');
                                    }}
                                  >
                                    Cancel Edit
                                  </button>
                                )}
                              </div>

                              {!newRiddle.id && (
                                <button
                                  className="admin-secondary-btn"
                                  onClick={handleSeedExpandedRiddles}
                                  disabled={processingId === 'seed_riddles'}
                                  style={{ background: 'rgba(16, 185, 129, 0.1)', borderColor: '#10b981', color: '#10b981', margin: 0 }}
                                >
                                  {processingId === 'seed_riddles' ? '🌱 Seeding...' : '🌱 Seed 40 New Riddles'}
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="riddles-list-section" style={{ marginTop: '40px' }}>
                            <h4>📚 Registered Riddles ({allRiddles.length})</h4>
                            {riddlesLoading ? (
                              <p>Loading riddles...</p>
                            ) : (
                              <div className="admin-table-container">
                                <table className="admin-table">
                                  <thead>
                                    <tr>
                                      <th>Category</th>
                                      <th>Difficulty</th>
                                      <th>Question Snippet</th>
                                      <th>Actions</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {allRiddles.map(r => (
                                      <tr key={r.id}>
                                        <td><span className={`category-tag ${r.category}`}>{r.category}</span></td>
                                        <td><span className={`difficulty-tag ${r.difficulty}`}>{r.difficulty}</span></td>
                                        <td className="question-cell">{r.question.substring(0, 60)}...</td>
                                        <td>
                                          <div className="action-btns">
                                            <button className="edit-btn" onClick={() => handleEditRiddle(r)}>📝</button>
                                            <button className="delete-btn" onClick={() => handleDeleteRiddle(r.id)}>🗑️</button>
                                          </div>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <>
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
                                  {getRecommendedIcons(newPrize.rarity, newPrize.isJackpot).map(emoji => (
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
                              <div className="form-group toggle-group" style={{ minWidth: '120px' }}>
                                <label className="toggle-label" style={{ padding: '4px 0' }}>
                                  <span>Is Jackpot?</span>
                                  <input
                                    type="checkbox"
                                    checked={newPrize.isJackpot || false}
                                    onChange={(e) => setNewPrize({ ...newPrize, isJackpot: e.target.checked })}
                                    className="admin-checkbox"
                                  />
                                </label>
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
                                      <span className="prize-name-admin">
                                        {prize.name}
                                        {prize.isJackpot && <span className="jackpot-badge-admin">JACKPOT</span>}
                                      </span>
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
                        </>
                      )}
                    </div>
                  )}

                  {activeGameType === 'yggdrasilAscender' && (
                    <>
                      <div className="prizes-management-card card" style={{ marginBottom: '20px' }}>
                        <div className="ygg-shop-management">
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                            <h3>🛒 Rune Shop Inventory</h3>
                            <button
                              className={editingRuneShopItemId ? "admin-secondary-btn" : "admin-primary-btn"}
                              onClick={() => {
                                if (editingRuneShopItemId) {
                                  setEditingRuneShopItemId(null);
                                  setIsCreatingRuneShopItem(false);
                                  setNewRuneShopItem({ name: '', description: '', icon: '🎁', image: '', price: 10, currency: 'runes', stock: 50, rarity: 'common' });
                                } else {
                                  setIsCreatingRuneShopItem(!isCreatingRuneShopItem);
                                }
                              }}
                            >
                              {editingRuneShopItemId ? '✕ Cancel Edit' : isCreatingRuneShopItem ? '✕ Cancel' : '➕ Add Custom Item'}
                            </button>
                          </div>

                          {isCreatingRuneShopItem && (
                            <div className="new-prize-form card" style={{ marginBottom: '30px', padding: '20px', background: 'rgba(0,0,0,0.2)', border: editingRuneShopItemId ? '1px solid #3b82f6' : 'none' }}>
                              <h4>{editingRuneShopItemId ? '📝 Edit Item' : '✨ New Shop Item'}</h4>
                              <div className="form-row">
                                <div className="form-group flex-2">
                                  <label>Item Name</label>
                                  <input
                                    type="text"
                                    placeholder="e.g. 500 Amiko Pack"
                                    value={newRuneShopItem.name}
                                    onChange={(e) => setNewRuneShopItem({ ...newRuneShopItem, name: e.target.value })}
                                  />
                                </div>
                                <div className="form-group flex-1">
                                  <label>Icon (Emoji)</label>
                                  <input
                                    type="text"
                                    value={newRuneShopItem.icon}
                                    onChange={(e) => setNewRuneShopItem({ ...newRuneShopItem, icon: e.target.value })}
                                  />
                                </div>
                              </div>
                              <div className="form-group">
                                <label>Description</label>
                                <input
                                  type="text"
                                  placeholder="What does this item give?"
                                  value={newRuneShopItem.description}
                                  onChange={(e) => setNewRuneShopItem({ ...newRuneShopItem, description: e.target.value })}
                                />
                              </div>
                              <div className="form-group">
                                <label>🖼 Image URL (for Armory display)</label>
                                <input
                                  type="text"
                                  placeholder="https://..."
                                  value={newRuneShopItem.image}
                                  onChange={(e) => setNewRuneShopItem({ ...newRuneShopItem, image: e.target.value })}
                                />
                              </div>
                              <div className="form-row">
                                <div className="form-group">
                                  <label>Price</label>
                                  <div style={{ display: 'flex', gap: '5px' }}>
                                    <input
                                      type="number"
                                      value={newRuneShopItem.price}
                                      onChange={(e) => setNewRuneShopItem({ ...newRuneShopItem, price: parseInt(e.target.value) || 0 })}
                                      style={{ flex: 1 }}
                                    />
                                    <select
                                      value={newRuneShopItem.currency || 'runes'}
                                      onChange={(e) => setNewRuneShopItem({ ...newRuneShopItem, currency: e.target.value })}
                                      style={{ flex: 1 }}
                                    >
                                      <option value="runes">Runes</option>
                                      <option value="redRunes">Red Runes</option>
                                    </select>
                                  </div>
                                </div>
                                <div className="form-group">
                                  <label>Stock</label>
                                  <input
                                    type="number"
                                    value={newRuneShopItem.stock}
                                    onChange={(e) => setNewRuneShopItem({ ...newRuneShopItem, stock: parseInt(e.target.value) || 0 })}
                                  />
                                </div>
                                <div className="form-group">
                                  <label>Rarity</label>
                                  <select
                                    value={newRuneShopItem.rarity}
                                    onChange={(e) => setNewRuneShopItem({ ...newRuneShopItem, rarity: e.target.value })}
                                  >
                                    <option value="common">Common</option>
                                    <option value="uncommon">Uncommon</option>
                                    <option value="rare">Rare</option>
                                    <option value="epic">Epic</option>
                                    <option value="legendary">Legendary</option>
                                    <option value="mythic">Mythic</option>
                                  </select>
                                </div>
                              </div>
                              <button
                                className="admin-primary-btn"
                                style={{ width: '100%', marginTop: '10px' }}
                                onClick={() => {
                                  if (!newRuneShopItem.name) return alert('Name is required');
                                  const currentItems = miniGamesConfig.yggdrasilAscender?.customShopItems || [];
                                  let updatedItems;
                                  if (editingRuneShopItemId) {
                                    updatedItems = currentItems.map(item => item.id === editingRuneShopItemId ? { ...newRuneShopItem, id: item.id } : item);
                                  } else {
                                    updatedItems = [...currentItems, { ...newRuneShopItem, id: `custom_${Date.now()}` }];
                                  }
                                  handleUpdateMiniGameConfig('yggdrasilAscender', { customShopItems: updatedItems });
                                  setIsCreatingRuneShopItem(false);
                                  setEditingRuneShopItemId(null);
                                  setNewRuneShopItem({ name: '', description: '', icon: '🎁', image: '', price: 10, currency: 'runes', stock: 50, rarity: 'common' });
                                }}
                              >
                                {editingRuneShopItemId ? '💾 Save Changes' : '✅ Add to Shop'}
                              </button>
                            </div>
                          )}

                          <div className="shop-items-list" style={{ display: 'grid', gap: '10px' }}>
                            {(miniGamesConfig.yggdrasilAscender?.customShopItems || []).length === 0 ? (
                              <p style={{ opacity: 0.5, textAlign: 'center', padding: '20px' }}>No custom items in shop.</p>
                            ) : (
                              miniGamesConfig.yggdrasilAscender.customShopItems.map(item => (
                                <div key={item.id} className="admin-prize-item" style={{ background: 'rgba(255,255,255,0.05)', padding: '12px', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                                    <div style={{ fontSize: '24px' }}>{item.icon}</div>
                                    <div>
                                      <div style={{ fontWeight: 'bold' }}>{item.name} <span style={{ fontSize: '11px', opacity: 0.7, textTransform: 'uppercase' }}>({item.rarity})</span></div>
                                      <div style={{ fontSize: '12px', opacity: 0.7 }}>
                                        Price: {item.price} {item.currency === 'redRunes' ? 'Red Runes' : 'Runes'} | Stock: {item.stock}
                                      </div>
                                    </div>
                                  </div>
                                  <div style={{ display: 'flex', gap: '8px' }}>
                                    <button className="admin-edit-btn" onClick={() => {
                                      setNewRuneShopItem(item);
                                      setEditingRuneShopItemId(item.id);
                                      setIsCreatingRuneShopItem(true);
                                    }}>Edit</button>
                                    <button className="admin-delete-btn" onClick={() => {
                                      if (window.confirm('Remove this item from shop?')) {
                                        const updated = miniGamesConfig.yggdrasilAscender.customShopItems.filter(i => i.id !== item.id);
                                        handleUpdateMiniGameConfig('yggdrasilAscender', { customShopItems: updated });
                                      }
                                    }}>Remove</button>
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="prizes-management-card card">
                        <div className="yggdrasil-events-management">
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                            <h3>🏆 Yggdrasil Events</h3>
                            <button
                              className={editingYggEventId ? "admin-secondary-btn" : "admin-primary-btn"}
                              onClick={() => {
                                if (editingYggEventId) {
                                  setEditingYggEventId(null);
                                  setIsCreatingYggEvent(false);
                                  setNewYggEvent({
                                    name: '',
                                    entryFee: 5,
                                    currency: 'AURY',
                                    prizeName: '',
                                    prizeImage: '',
                                    prizeRarity: 'epic',
                                    altitudeFrom: 5000,
                                    altitudeTo: 15000,
                                    targetPool: 60,
                                    status: 'open',
                                    redRunesEnabled: false
                                  });
                                  setYggEventPrizePreview('');
                                } else {
                                  setIsCreatingYggEvent(!isCreatingYggEvent);
                                }
                              }}
                            >
                              {editingYggEventId ? '✕ Cancel Edit' : isCreatingYggEvent ? '✕ Cancel' : '➕ Create New Event'}
                            </button>
                          </div>

                          {isCreatingYggEvent && (
                            <div className="new-prize-form ygg-event-form card" style={{ marginBottom: '30px', padding: '20px', background: 'rgba(0,0,0,0.2)', border: editingYggEventId ? '1px solid #3b82f6' : 'none' }}>
                              <h4>{editingYggEventId ? '📝 Edit Event Run' : '✨ Create Event Run'}</h4>
                              <div className="form-row">
                                <div className="form-group flex-2">
                                  <label>Event Name</label>
                                  <input
                                    type="text"
                                    placeholder="e.g. The Amiko Hunt"
                                    value={newYggEvent.name}
                                    onChange={(e) => setNewYggEvent({ ...newYggEvent, name: e.target.value })}
                                  />
                                </div>
                                <div className="form-group flex-1">
                                  <label>Entry Fee</label>
                                  <div style={{ display: 'flex', gap: '5px' }}>
                                    <input
                                      type="number"
                                      value={newYggEvent.entryFee}
                                      onChange={(e) => setNewYggEvent({ ...newYggEvent, entryFee: parseFloat(e.target.value) || 0 })}
                                      style={{ width: '70px' }}
                                    />
                                    <select
                                      value={newYggEvent.currency}
                                      onChange={(e) => setNewYggEvent({ ...newYggEvent, currency: e.target.value })}
                                    >
                                      <option value="AURY">AURY</option>
                                      <option value="Valcoins">Valcoins</option>
                                    </select>
                                  </div>
                                </div>
                              </div>

                              <div className="form-row">
                                <div className="form-group flex-2">
                                  <label>Prize Name</label>
                                  <input
                                    type="text"
                                    placeholder="e.g. Legendary Amiko"
                                    value={newYggEvent.prizeName}
                                    onChange={(e) => setNewYggEvent({ ...newYggEvent, prizeName: e.target.value })}
                                  />
                                </div>
                                <div className="form-group flex-1">
                                  <label>Prize Rarity</label>
                                  <select
                                    value={newYggEvent.prizeRarity}
                                    onChange={(e) => setNewYggEvent({ ...newYggEvent, prizeRarity: e.target.value })}
                                  >
                                    <option value="common">Common</option>
                                    <option value="uncommon">Uncommon</option>
                                    <option value="rare">Rare</option>
                                    <option value="epic">Epic</option>
                                    <option value="legendary">Legendary</option>
                                    <option value="mythic">Mythic</option>
                                  </select>
                                </div>
                              </div>

                              <div className="form-row">
                                <div className="form-group flex-2">
                                  <label>Spawn Altitude Range (Meters)</label>
                                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                    <input
                                      type="number"
                                      placeholder="From"
                                      value={newYggEvent.altitudeFrom}
                                      onChange={(e) => setNewYggEvent({ ...newYggEvent, altitudeFrom: parseInt(e.target.value) || 0 })}
                                      style={{ flex: 1 }}
                                    />
                                    <span>to</span>
                                    <input
                                      type="number"
                                      placeholder="To"
                                      value={newYggEvent.altitudeTo}
                                      onChange={(e) => setNewYggEvent({ ...newYggEvent, altitudeTo: parseInt(e.target.value) || 0 })}
                                      style={{ flex: 1 }}
                                    />
                                  </div>
                                </div>
                                <div className="form-group">
                                  <label>Entry Pool Target (Runs)</label>
                                  <input
                                    type="number"
                                    value={newYggEvent.targetPool}
                                    onChange={(e) => setNewYggEvent({ ...newYggEvent, targetPool: parseInt(e.target.value) || 0 })}
                                  />
                                </div>
                              </div>

                              <div className="form-group">
                                <label>Prize Image (Visible when caught)</label>
                                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                  <input
                                    type="text"
                                    value={newYggEvent.prizeImage}
                                    onChange={(e) => setNewYggEvent(prev => ({ ...prev, prizeImage: e.target.value }))}
                                    placeholder="https://... (image URL)"
                                    className="flex-3"
                                  />
                                  <div className="file-upload-wrapper flex-1">
                                    <label className="file-upload-btn" style={{ padding: '8px', fontSize: '12px' }}>
                                      📁 Upload
                                      <input type="file" onChange={handleYggPrizeUpload} accept="image/*" />
                                    </label>
                                  </div>
                                </div>
                                {yggEventPrizePreview && (
                                  <div className="image-preview-mini" style={{ marginTop: '10px' }}>
                                    <img src={yggEventPrizePreview} alt="Prize Preview" style={{ maxHeight: '100px', borderRadius: '4px' }} />
                                  </div>
                                )}
                              </div>

                              <div className="form-group toggle-group" style={{ marginTop: '10px' }}>
                                <label className="toggle-label" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', background: 'rgba(239, 68, 68, 0.08)', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                                  <input
                                    type="checkbox"
                                    checked={newYggEvent.redRunesEnabled || false}
                                    onChange={(e) => setNewYggEvent({ ...newYggEvent, redRunesEnabled: e.target.checked })}
                                    className="admin-checkbox"
                                  />
                                  <div>
                                    <span style={{ color: '#ef4444', fontWeight: 'bold' }}>🔴 Enable Red Runes</span>
                                    <div style={{ fontSize: '11px', opacity: 0.7, marginTop: '2px' }}>Red Runes are a rare, separate currency (~2-3 per 1000m). Each player sees them at different spots.</div>
                                  </div>
                                </label>
                              </div>

                              <button
                                className="admin-primary-btn"
                                style={{ width: '100%', marginTop: '10px' }}
                                onClick={handleSaveYggEvent}
                                disabled={processingId === 'save_ygg_event'}
                              >
                                {processingId === 'save_ygg_event' ? (editingYggEventId ? 'Updating...' : 'Creating...') : (editingYggEventId ? '💾 Update Event' : '🚀 Launch Event')}
                              </button>
                            </div>
                          )}

                          <div className="ygg-events-list">
                            <h4>Active Events</h4>
                            <div className="admin-table-container">
                              <table className="admin-table">
                                <thead>
                                  <tr>
                                    <th>Event</th>
                                    <th>Fee</th>
                                    <th>Prize</th>
                                    <th>Pool (Admin Only)</th>
                                    <th>Target</th>
                                    <th>Red Runes</th>
                                    <th>Status</th>
                                    <th>Actions</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {yggEvents.length === 0 ? (
                                    <tr><td colSpan="7" style={{ textAlign: 'center', padding: '20px' }}>No events found.</td></tr>
                                  ) : (
                                    yggEvents.map(ev => (
                                      <tr key={ev.id}>
                                        <td><strong>{ev.name}</strong></td>
                                        <td>{ev.entryFee} {ev.currency}</td>
                                        <td>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <img src={ev.prizeImage} alt="" style={{ width: '24px', height: '24px', borderRadius: '4px', objectFit: 'contain' }} />
                                            <span>{ev.prizeName}</span>
                                          </div>
                                        </td>
                                        <td>
                                          <div className="pool-bar-container" style={{ width: '100px', height: '8px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden' }}>
                                            <div
                                              className="pool-bar-fill"
                                              style={{
                                                width: `${Math.min(100, (ev.currentPool / ev.targetPool) * 100)}%`,
                                                height: '100%',
                                                background: ev.currentPool >= ev.targetPool ? '#10b981' : '#3b82f6'
                                              }}
                                            />
                                          </div>
                                          <div style={{ fontSize: '10px', marginTop: '4px' }}>{ev.currentPool} / {ev.targetPool} runs</div>
                                        </td>
                                        <td>{ev.targetAltitude}m</td>
                                        <td style={{ textAlign: 'center' }}>
                                          {ev.redRunesEnabled ? <span style={{ color: '#ef4444', fontWeight: 'bold' }}>🔴 ON</span> : <span style={{ opacity: 0.4 }}>OFF</span>}
                                        </td>
                                        <td>
                                          <span className={`status-badge ${ev.status}`}>
                                            {ev.status === 'open' ? '🟢 Open' : '🔴 Closed'}
                                          </span>
                                        </td>
                                        <td>
                                          <div className="action-btns">
                                            <button className="edit-btn" onClick={() => handleStartEditYggEvent(ev)} title="Edit Event">📝</button>
                                            {ev.status === 'open' && (
                                              <button className="edit-btn" onClick={() => handleCloseYggEvent(ev.id)} title="Close Event">🛑</button>
                                            )}
                                            {ev.status === 'closed' && (
                                              <button className="edit-btn" onClick={() => handleReopenYggEvent(ev.id)} title="Reopen Event">🔓</button>
                                            )}
                                            <button className="delete-btn" onClick={() => handleDeleteYggEvent(ev.id)} title="Delete Event">🗑️</button>
                                          </div>
                                        </td>
                                      </tr>
                                    ))
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>
                      </div>
                    </>
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
                  {isSeniorAdminUser && (
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

                      <button
                        className="admin-secondary-btn"
                        onClick={handleRepairPvpLeaderboards}
                        disabled={isRepairingPvp || processingId === 'repair_pvp_leaderboards'}
                        style={{ marginLeft: '10px', background: '#3b82f6', color: 'white', borderColor: '#2563eb' }}
                      >
                        {isRepairingPvp ? 'Repairing...' : '🛠 Repair PvP Leaderboards'}
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
                {!earnersSelectedUser && isSeniorAdminUser && (
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

          {activeTab === 'pvp_rewards' && (
            <div className="mini-games-section">
              <div className="section-header">
                <h2>⚔️ PvP Win Rewards</h2>
                <div className="header-actions">
                  <p className="text-sm">Manage Valcoins earned from real PvP matches in Aurory.</p>
                </div>
              </div>

              {pvpRewardsLoading ? (
                <LoadingScreen message="Loading PvP config..." />
              ) : !pvpRewardsConfig ? (
                <div className="empty-state card"><p>No config found. Admin settings may be missing.</p></div>
              ) : (
                <div className="pvp-rewards-card">
                  {/* Timer Bar */}
                  <div className="pvp-timer-bar" style={{ position: 'relative' }}>
                    <span className="pvp-timer-icon">🕒</span>
                    <span className="pvp-timer-label">NEXT REWARDS SCAN:</span>
                    <span className="pvp-timer-countdown">{pvpCountdown}</span>

                    {isSeniorAdminUser && (
                      <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                        <button
                          className="admin-secondary-btn"
                          onClick={() => handleTriggerPvpScan(false)}
                          disabled={isScanningPvp}
                          style={{
                            padding: '6px 14px',
                            fontSize: '0.8rem',
                            background: 'rgba(168, 85, 247, 0.2)',
                            borderColor: 'var(--accent-purple)',
                            color: 'var(--accent-purple)'
                          }}
                        >
                          {isScanningPvp ? '⌛ Scanning...' : '🚀 Quick Scan'}
                        </button>
                        <button
                          className="admin-secondary-btn"
                          onClick={() => handleTriggerPvpScan(true)}
                          disabled={isScanningPvp}
                          style={{
                            padding: '6px 14px',
                            fontSize: '0.8rem',
                            background: 'rgba(239, 68, 68, 0.15)',
                            borderColor: '#ef4444',
                            color: '#ef4444'
                          }}
                        >
                          {isScanningPvp ? '⌛ Scanning...' : '🔄 Reset & Full Scan'}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Enable/Disable Toggle */}
                  <div className="pvp-toggle-row">
                    <label className="pvp-label">Enabled</label>
                    <label className="pvp-switch">
                      <input
                        type="checkbox"
                        checked={!!pvpRewardsConfig.enabled}
                        onChange={(e) => {
                          const val = e.target.checked;
                          setPvpRewardsConfig(prev => ({ ...prev, enabled: val }));
                        }}
                      />
                      <span className="pvp-slider" />
                    </label>
                    <span className={`pvp-status-text ${pvpRewardsConfig.enabled ? 'active' : 'paused'}`}>
                      {pvpRewardsConfig.enabled ? '🟢 Active — system is awarding wins' : '🔘 Paused — rewards are currently disabled'}
                    </span>
                  </div>

                  {/* Reward Per Win */}
                  <div className="pvp-field-row">
                    <label>Valcoins per Win</label>
                    <input
                      type="number"
                      min={1}
                      max={1000}
                      className="pvp-field-input"
                      value={pvpRewardsConfig.rewardPerWin ?? 20}
                      onChange={(e) => {
                        const val = Math.max(1, parseInt(e.target.value) || 1);
                        setPvpRewardsConfig(prev => ({ ...prev, rewardPerWin: val }));
                      }}
                    />
                    <span className="pvp-field-hint">(EXP matches this amount)</span>
                  </div>

                  {/* Minimum Match Duration */}
                  <div className="pvp-field-row">
                    <label>Min Match Duration</label>
                    <input
                      type="number"
                      min={0}
                      max={3600}
                      className="pvp-field-input"
                      value={pvpRewardsConfig.minMatchDuration ?? 120}
                      onChange={(e) => {
                        const val = Math.max(0, parseInt(e.target.value) || 0);
                        setPvpRewardsConfig(prev => ({ ...prev, minMatchDuration: val }));
                      }}
                    />
                    <span className="pvp-field-hint">seconds (skip short disconnected games)</span>
                  </div>

                  {/* Save Button */}
                  <button
                    className="save-banner-btn"
                    disabled={pvpSaving}
                    onClick={async () => {
                      setPvpSaving(true);
                      try {
                        await updateDoc(doc(db, 'settings', 'pvp_rewards'), {
                          rewardPerWin: pvpRewardsConfig.rewardPerWin,
                          minMatchDuration: pvpRewardsConfig.minMatchDuration,
                          enabled: pvpRewardsConfig.enabled,
                        });
                        logActivity({
                          user,
                          type: 'ADMIN',
                          action: 'update_pvp_rewards',
                          metadata: { ...pvpRewardsConfig }
                        });
                        alert('✅ PvP Rewards settings saved!');
                      } catch (err) {
                        alert('❌ Error saving: ' + err.message);
                      } finally {
                        setPvpSaving(false);
                      }
                    }}
                  >
                    {pvpSaving ? 'Saving...' : '💾 Save Overall Settings'}
                  </button>

                  {/* Info box */}
                  <div className="pvp-info-box">
                    <strong>⚔️ PvP System Logic:</strong><br />
                    • Scans linked Aurory players every 10 minutes.<br />
                    • Skips private matches (handled by Tournament system).<br />
                    • Skips <strong>CPU/Bot</strong> matches automatically.<br />
                    • Only awards wins that meet the duration requirement.
                  </div>

                  {/* Activity Log Section */}
                  <div className="pvp-activity-section" style={{ marginTop: '32px' }}>
                    <div className="section-header" style={{ marginBottom: '16px' }}>
                      <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--accent-purple)' }}>📜 Recent Reward Activity</h3>
                      <p className="pvp-field-hint">The most recent reward distributions across all users.</p>
                    </div>

                    {rewardLogsLoading ? (
                      <div className="empty-state"><p>Loading recent logs...</p></div>
                    ) : pvpRewardLogs.length === 0 ? (
                      <div className="empty-state card" style={{ padding: '20px' }}>
                        <p>📭 No reward activity recorded yet.</p>
                      </div>
                    ) : (
                      <div className="logs-table-container">
                        <table className="logs-table">
                          <thead>
                            <tr>
                              <th>Time</th>
                              <th>User</th>
                              <th>Matches & Amikos</th>
                              <th>Battle Details</th>
                              <th>Reward</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pvpRewardLogs.map(log => {
                              const userObj = allUsers.find(u => u.id === log.userId);
                              const displayName = userObj ? resolveDisplayName(userObj) : log.displayName;

                              return (
                                <tr key={log.id}>
                                  <td className="log-time">{formatTime(log.timestamp)}</td>
                                  <td className="log-action">
                                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                                      <span style={{ fontWeight: 600 }}>{displayName}</span>
                                      <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>{log.userId}</span>
                                    </div>
                                  </td>
                                  <td>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                      <span className="badge-mini" style={{ background: 'rgba(168, 85, 247, 0.15)', color: 'var(--accent-purple)', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600, alignSelf: 'flex-start' }}>
                                        {log.matchCount} Win{log.matchCount > 1 ? 's' : ''}
                                      </span>
                                      {log.amikos && (
                                        <div style={{ fontSize: '0.7rem', opacity: 0.8, color: 'var(--accent-teal)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '150px' }} title={log.amikos}>
                                          🐾 {log.amikos}
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                  <td style={{ fontSize: '0.75rem', opacity: 0.8 }}>
                                    {log.metadata ? (
                                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                                        <span style={{ fontWeight: 500 }}>vs {log.metadata.opponent}</span>
                                        <div style={{ display: 'flex', gap: '8px', opacity: 0.7 }}>
                                          {log.metadata.duration && <span>⏱️ {log.metadata.duration}s</span>}
                                          {log.metadata.battleCode && <span title={log.metadata.battleCode}>🔗 {log.metadata.battleCode.substring(0, 6)}...</span>}
                                        </div>
                                      </div>
                                    ) : (
                                      <span style={{ opacity: 0.5 }}>—</span>
                                    )}
                                  </td>
                                  <td>
                                    <span className="log-amount positive">+{log.amount} VAL</span>
                                  </td>
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

      {/* Firestore Document Editor Modal (God Mode) */}
      {userToEditFirestore && localEditingData && (
        <div className="admin-modal-overlay firestore-editor-overlay">
          <div className="admin-modal firestore-editor-modal">
            <div className="modal-header firestore-header-compact">
              <div className="header-left">
                <div className="title-area">
                  <h2>🛠️ God Mode: {resolveDisplayName(userToEditFirestore)}</h2>
                  <span className="user-id">UID: {userToEditFirestore.id}</span>
                </div>
              </div>

              <div className="header-add-field-group">
                <input
                  type="text"
                  placeholder="New field key..."
                  value={newFieldKey}
                  onChange={(e) => setNewFieldKey(e.target.value)}
                  className="header-compact-input"
                />
                <select
                  value={newFieldType}
                  onChange={(e) => setNewFieldType(e.target.value)}
                  className="header-compact-select"
                >
                  <option value="string">String</option>
                  <option value="number">Number</option>
                  <option value="boolean">Boolean</option>
                  <option value="object">Object { }</option>
                  <option value="array">Array []</option>
                </select>
                <button
                  className="header-add-btn"
                  onClick={() => handleAddFieldToLocalData('', newFieldKey, newFieldType)}
                >
                  + Add Root Field
                </button>
              </div>

              <button className="close-btn" onClick={() => setUserToEditFirestore(null)}>×</button>
            </div>
            <div className="modal-body">
              <div className="fields-container">
                {Object.entries(localEditingData)
                  .filter(([key]) => key !== 'id') // UID is read-only
                  .map(([key, value]) => renderFirestoreField(key, value))}
              </div>
            </div>

            <div className="modal-footer firestore-footer-custom">
              <div className="editor-warning-compact">
                ⚠️ <strong>CAUTION:</strong> God Mode. Changes are direct and absolute.
              </div>
              <div className="footer-actions">
                <button className="secondary-btn" onClick={() => setUserToEditFirestore(null)}>Cancel</button>
                <button
                  className="save-btn-admin primary"
                  onClick={handleSaveFirestoreUser}
                  disabled={isSavingEditingDoc}
                >
                  {isSavingEditingDoc ? 'Saving...' : '💾 Save Changes to Firestore'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Economy Management Modal */}
      {showEconomyModal && (
        <div className="admin-modal-overlay">
          <div className="admin-modal" style={{ maxWidth: '600px' }}>
            <div className="modal-header">
              <h2>{editingEconomyRecord ? '📝 Edit' : '➕ Add'} Economy Log</h2>
              <button className="close-btn" onClick={() => setShowEconomyModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="admin-form">
                <div className="form-group">
                  <label>Transaction Type</label>
                  <select
                    value={economyForm.type}
                    onChange={(e) => setEconomyForm({ ...economyForm, type: e.target.value })}
                    disabled={!!editingEconomyRecord}
                  >
                    <option value="deposit">Deposit Notification</option>
                    <option value="withdrawal">Withdrawal Record</option>
                    <option value="sale">Shop Sale / Tax Entry</option>
                  </select>
                </div>

                <div className="form-grid">
                  <div className="form-group">
                    <label>Amount (Display Units)</label>
                    <input
                      type="number"
                      value={economyForm.amount}
                      onChange={(e) => setEconomyForm({ ...economyForm, amount: e.target.value })}
                      placeholder="e.g. 10.5"
                    />
                  </div>
                  <div className="form-group">
                    <label>Currency</label>
                    <select
                      value={economyForm.currency}
                      onChange={(e) => setEconomyForm({ ...economyForm, currency: e.target.value })}
                    >
                      <option value="AURY">AURY</option>
                      <option value="VALCOINS">VALCOINS</option>
                      <option value="USDC">USDC</option>
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label>User Email / Display Name</label>
                  <input
                    type="text"
                    value={economyForm.userEmail}
                    onChange={(e) => setEconomyForm({ ...economyForm, userEmail: e.target.value })}
                    placeholder="User identification..."
                  />
                </div>

                <div className="form-group">
                  <label>User ID (UID)</label>
                  <input
                    type="text"
                    value={economyForm.userId}
                    onChange={(e) => setEconomyForm({ ...economyForm, userId: e.target.value })}
                    placeholder="Firebase UID..."
                  />
                </div>

                {economyForm.type === 'deposit' && (
                  <div className="form-group">
                    <label>Transaction Signature</label>
                    <input
                      type="text"
                      value={economyForm.txSignature}
                      onChange={(e) => setEconomyForm({ ...economyForm, txSignature: e.target.value })}
                      placeholder="Solana Tx Signature..."
                    />
                  </div>
                )}

                {economyForm.type === 'sale' && (
                  <div className="form-group">
                    <label>Item Details</label>
                    <input
                      type="text"
                      value={economyForm.details}
                      onChange={(e) => setEconomyForm({ ...economyForm, details: e.target.value })}
                      placeholder="Cosmetic name, etc."
                    />
                  </div>
                )}

                <div className="form-grid">
                  <div className="form-group">
                    <label>Status</label>
                    <select
                      value={economyForm.status}
                      onChange={(e) => setEconomyForm({ ...economyForm, status: e.target.value })}
                    >
                      <option value="processed">Processed / Completed</option>
                      <option value="pending">Pending</option>
                      <option value="failed">Failed</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Date/Time</label>
                    <input
                      type="datetime-local"
                      value={economyForm.timestamp}
                      onChange={(e) => setEconomyForm({ ...economyForm, timestamp: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="secondary-btn" onClick={() => setShowEconomyModal(false)}>Cancel</button>
              <button
                className="primary-btn"
                onClick={handleSaveEconomyRecord}
                disabled={processingId === 'save_economy'}
              >
                {processingId === 'save_economy' ? 'Saving...' : 'Save Record'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* User Armory Modal */}
      {selectedUserForArmory && (
        <ArmoryModal
          isOpen={!!selectedUserForArmory}
          onClose={() => setSelectedUserForArmory(null)}
          user={{ ...selectedUserForArmory, uid: selectedUserForArmory.id }}
        />
      )}
    </div>
  );
}

export default AdminPanel;