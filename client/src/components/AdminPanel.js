import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db, auth } from '../firebase';
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
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { isSuperAdmin } from '../config/admins';
import { createNotification } from '../services/notifications';
import { logActivity } from '../services/activityService';
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

// Format AURY amount (9 decimals)
const formatAuryAmount = (amount) => {
  return (amount / 1e9).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4
  });
};

function AdminPanel() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('credit');
  const [pendingWithdrawals, setPendingWithdrawals] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState(null);

  // Online visitors state
  const [onlineVisitors, setOnlineVisitors] = useState([]);

  // Users tab search
  const [usersSearchQuery, setUsersSearchQuery] = useState('');

  const [depositNotifications, setDepositNotifications] = useState([]);
  const [depositError, setDepositError] = useState(null);

  // History state
  const [processedWithdrawals, setProcessedWithdrawals] = useState([]);
  const [processedDeposits, setProcessedDeposits] = useState([]);
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

  // Banner social links (max 3 displayed)
  const [bannerDiscord, setBannerDiscord] = useState('');
  const [bannerTwitter, setBannerTwitter] = useState('');
  const [bannerTwitch, setBannerTwitch] = useState('');
  const [bannerFacebook, setBannerFacebook] = useState('');
  const [bannerInstagram, setBannerInstagram] = useState('');
  const [bannerYoutube, setBannerYoutube] = useState('');

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
  const isSuperAdminUser = user && isSuperAdmin(getUserEmail(user));
  const isAdminUser = user && (isSuperAdminUser || user.role === 'admin');
  const isAdmin = isAdminUser; // Keep for existing checks in the file


  // Fetch pending withdrawals
  useEffect(() => {
    if (!isAdmin) return;

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
  }, [isAdmin]);

  // Fetch pending deposit notifications - FIXED VERSION
  useEffect(() => {
    if (!isAdmin) return;

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
  }, [isAdmin, user]);

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
          balanceMap[doc.id] = doc.data().balance || 0;
        });

        const users = usersSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          balance: balanceMap[doc.id] || 0
        })).filter(u => u.email);

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

  // Fetch History (processed withdrawals and deposits)
  useEffect(() => {
    if (!isAdmin || activeTab !== 'history') return;

    setHistoryLoading(true);

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
      setHistoryLoading(false);
    }, (error) => {
      console.error('Error fetching history:', error);
      setHistoryLoading(false);
    });

    return () => {
      unsubscribeWithdrawals();
      unsubscribeDeposits();
    };
  }, [isAdmin, activeTab]);

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
          message: `Your withdrawal of ${formatAuryAmount(withdrawal.amount)} AURY has been approved.`,
          link: '#'
        });

      } else {
        // REJECT: Refund the balance to the user
        await runTransaction(db, async (transaction) => {
          const walletDoc = await transaction.get(walletRef);

          if (!walletDoc.exists()) {
            throw new Error('User wallet not found');
          }

          const currentBalance = walletDoc.data().balance || 0;

          // Refund the withdrawal amount
          transaction.update(walletRef, {
            balance: currentBalance + withdrawal.amount,
            updatedAt: serverTimestamp()
          });

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
          walletAddress: withdrawal.walletAddress,
          reason: 'Rejected by admin - balance refunded',
          timestamp: serverTimestamp()
        });

        alert('Withdrawal rejected and refunded to user.');

        // Notify User
        await createNotification(withdrawal.userId, {
          type: 'withdrawal',
          title: 'Withdrawal Rejected',
          message: `Your withdrawal of ${formatAuryAmount(withdrawal.amount)} AURY was rejected. Balance has been refunded.`,
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
  const processDepositNotification = async (notificationId, userId, amountAury) => {
    setProcessingId(notificationId);

    try {
      // Convert AURY to smallest unit (9 decimals)
      const amountInSmallestUnit = Math.floor(parseFloat(amountAury) * 1e9);

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
          currentBalance = walletDoc.data().balance || 0;
        }

        // Update or create wallet with new balance
        transaction.set(walletRef, {
          balance: currentBalance + amountInSmallestUnit,
          updatedAt: serverTimestamp()
        }, { merge: true });

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
        timestamp: serverTimestamp(),
        processedBy: getUserEmail(user) || user.displayName || user.uid
      });

      alert(`✅ Successfully credited ${amountAury} AURY to user!`);

      // Notify User
      await createNotification(userId, {
        type: 'deposit',
        title: 'Deposit Credited',
        message: `Your deposit of ${amountAury} AURY has been verified and credited!`,
        link: '#'
      });

      logActivity({
        user,
        type: 'ADMIN',
        action: 'deposit_approve',
        metadata: { notificationId, userId, amount: amountAury }
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

    if (!window.confirm(`Are you sure you want to credit ${amount} AURY to ${selectedCreditUsers.length} users?`)) {
      return;
    }

    setProcessingId('credit');

    try {
      // Convert to smallest unit (9 decimals)
      const amountInSmallestUnit = Math.floor(amount * 1e9);

      // Process each user
      const results = await Promise.allSettled(selectedCreditUsers.map(async (selectedUser) => {
        const walletRef = doc(db, 'wallets', selectedUser.id);

        await runTransaction(db, async (transaction) => {
          const walletDoc = await transaction.get(walletRef);

          let currentBalance = 0;
          if (walletDoc.exists()) {
            currentBalance = walletDoc.data().balance || 0;
          }

          transaction.set(walletRef, {
            balance: currentBalance + amountInSmallestUnit,
            updatedAt: serverTimestamp()
          }, { merge: true });
        });

        // Add transaction to user's history
        const txRef = collection(db, 'wallets', selectedUser.id, 'transactions');
        await addDoc(txRef, {
          type: 'deposit',
          amount: amountInSmallestUnit,
          reason: creditReason || 'Credit by admin',
          timestamp: serverTimestamp(),
          processedBy: getUserEmail(user) || user.displayName || user.uid
        });

        // Notify User
        await createNotification(selectedUser.id, {
          type: 'deposit',
          title: 'Balance Notification',
          message: `${amount} credits has been added to your account.`,
          link: '#'
        });
      }));

      const succeeded = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      if (failed === 0) {
        alert(`✅ Successfully credited ${amount} AURY to ${succeeded} users!`);
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

    if (!window.confirm(`Are you sure you want to deduct ${amount} AURY from ${selectedDeductUsers.length} users?`)) {
      return;
    }

    setProcessingId('deduct');

    try {
      // Convert to smallest unit (9 decimals)
      const amountInSmallestUnit = Math.floor(amount * 1e9);

      // Process each user
      const results = await Promise.allSettled(selectedDeductUsers.map(async (selectedUser) => {
        const walletRef = doc(db, 'wallets', selectedUser.id);

        await runTransaction(db, async (transaction) => {
          const walletDoc = await transaction.get(walletRef);

          if (!walletDoc.exists()) {
            throw new Error('User wallet not found');
          }

          const currentBalance = walletDoc.data().balance || 0;

          // Optional: Prevent negative balance
          if (currentBalance < amountInSmallestUnit) {
            if (!window.confirm(`${selectedUser.displayName || selectedUser.email} only has ${formatAuryAmount(currentBalance)} AURY. Deducting this will result in a negative balance. Proceed?`)) {
              throw new Error('Operation cancelled by admin due to insufficient funds.');
            }
          }

          transaction.update(walletRef, {
            balance: currentBalance - amountInSmallestUnit,
            updatedAt: serverTimestamp()
          });
        });

        // Add transaction to user's history
        const txRef = collection(db, 'wallets', selectedUser.id, 'transactions');
        await addDoc(txRef, {
          type: 'withdrawal',
          amount: amountInSmallestUnit,
          reason: deductReason || 'Balance Adjustment by Admin',
          timestamp: serverTimestamp(),
          processedBy: getUserEmail(user) || user.displayName || user.uid,
          status: 'completed'
        });

        // Notify User
        await createNotification(selectedUser.id, {
          type: 'withdrawal',
          title: 'Balance Notification',
          message: 'Your account balance has been adjusted.',
          link: '#'
        });
      }));

      const succeeded = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      if (failed === 0) {
        alert(`✅ Successfully deducted ${amount} AURY from ${succeeded} users!`);
      } else {
        alert(`⚠️ Processed with some issues: ${succeeded} succeeded, ${failed} failed. Check console.`);
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
      if (error.message !== 'Operation cancelled by admin due to insufficient funds.') {
        alert('Error deducting balance: ' + error.message);
      }
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

  if (authLoading) {
    return <div className="loading">Loading...</div>;
  }

  if (!isAdmin) {
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
          {isSuperAdminUser && (
            <div className="admin-category">
              <h3 className="category-title">Balance</h3>
              <div className="category-tabs">
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
              </div>
            </div>
          )}

          {/* Transactions Category */}
          <div className="admin-category">
            <h3 className="category-title">
              Transactions
              {(depositNotifications.length + pendingWithdrawals.length) > 0 && (
                <span className="category-badge">
                  {depositNotifications.length + pendingWithdrawals.length}
                </span>
              )}
            </h3>
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
            </div>
          </div>

          {/* Campaigns Category */}
          <div className="admin-category">
            <h3 className="category-title">Campaigns</h3>
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
            </div>
          </div>

          {/* User Management Category */}
          <div className="admin-category">
            <h3 className="category-title">User Management</h3>
            <div className="category-tabs">
              {isSuperAdminUser && (
                <button
                  className={`admin-tab ${activeTab === 'users' ? 'active' : ''}`}
                  onClick={() => setActiveTab('users')}
                >
                  👥 Assign Users
                </button>
              )}
              {isAdminUser && (
                <button
                  className={`admin-tab ${activeTab === 'visitors' ? 'active' : ''}`}
                  onClick={() => setActiveTab('visitors')}
                >
                  🌐 Online Visitors {onlineVisitors.length > 0 && <span className="tab-badge inline">{onlineVisitors.length}</span>}
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
            </div>
          </div>
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

          {activeTab === 'withdrawals' && (
            <div className="withdrawals-section">
              <div className="section-info">
                <p>📤 Approve or reject withdrawal requests. Send AURY to the user's wallet, then enter the TX signature.</p>
              </div>

              {loading ? (
                <div className="loading">Loading...</div>
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
                          <span className="label">Amount:</span>
                          <span className="value amount">{formatAuryAmount(withdrawal.amount)} AURY</span>
                        </div>
                        <div className="detail-row">
                          <span className="label">Send to:</span>
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
                          placeholder="Enter TX signature after sending AURY..."
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
                <div className="loading">Loading...</div>
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
                          <span className="value amount">{notification.amount} AURY</span>
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
                              notification.amount
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

          {activeTab === 'credit' && (
            <div className="credit-section">
              <div className="section-info">
                <p>📥 Select multiple players to credit AURY simultaneously.</p>
              </div>

              <div className="credit-form">
                <div className="form-group bulk-selection-group">
                  <label>Select Users ({selectedCreditUsers.length})</label>
                  <div className="selected-users-list">
                    {selectedCreditUsers.map(u => (
                      <div key={u.id} className="selected-user-tag">
                        <img src={u.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png'} alt="" />
                        <span>{u.displayName || 'Unknown'}</span>
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
                            (u.displayName?.toLowerCase().includes(creditUserSearch.toLowerCase()) ||
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
                              <img src={u.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png'} alt="" />
                              <div className="participant-info">
                                <span className="participant-name">{u.displayName || 'Unknown'}</span>
                                <span className="participant-email">{u.email}</span>
                              </div>
                              <div className="participant-balance">
                                {formatAuryAmount(u.balance)} AURY
                              </div>
                            </div>
                          ))
                        }
                      </div>
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label>Amount (AURY) - Will be sent to EACH user</label>
                  <input
                    type="number"
                    placeholder="Enter amount to send to each selected user..."
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

          {activeTab === 'deduct' && (
            <div className="credit-section deduct-section">
              <div className="section-info deduct-info">
                <p>📉 Subtract balance from users for corrections or adjustments.</p>
              </div>

              <div className="credit-form">
                <div className="form-group bulk-selection-group">
                  <label>Select Users ({selectedDeductUsers.length})</label>
                  <div className="selected-users-list">
                    {selectedDeductUsers.map(u => (
                      <div key={u.id} className="selected-user-tag">
                        <img src={u.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png'} alt="" />
                        <span>{u.displayName || 'Unknown'}</span>
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
                            (u.displayName?.toLowerCase().includes(deductUserSearch.toLowerCase()) ||
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
                              <img src={u.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png'} alt="" />
                              <div className="participant-info">
                                <span className="participant-name">{u.displayName || 'Unknown'}</span>
                                <span className="participant-email">{u.email}</span>
                              </div>
                              <div className="participant-balance">
                                {formatAuryAmount(u.balance)} AURY
                              </div>
                            </div>
                          ))
                        }
                      </div>
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label>Amount (AURY) - Will be deducted from EACH user</label>
                  <input
                    type="number"
                    placeholder="Enter amount to deduct from each selected user..."
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
                            <img src={u.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png'} alt="" />
                            <span>{u.displayName || 'Unknown'}</span>
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
                            (u.displayName?.toLowerCase().includes(notifyUserSearch.toLowerCase()) ||
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
                              <img src={u.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png'} alt="" />
                              <div className="participant-info">
                                <span className="participant-name">{u.displayName || 'Unknown'}</span>
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

          {activeTab === 'users' && isSuperAdminUser && (
            <div className="users-assignment-section">
              <div className="section-info">
                <p>👥 Manage user roles. Admins can process deposits and withdrawals but cannot manually credit/deduct balance.</p>
              </div>

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

              <div className="admin-user-list">
                <div className="user-list-header">
                  <div className="col-user">User</div>
                  <div className="col-email">Email</div>
                  <div className="col-role">Role</div>
                </div>
                <div className="user-list-body">
                  {allUsers
                    .filter(u => {
                      if (!usersSearchQuery) return true;
                      const query = usersSearchQuery.toLowerCase();
                      const name = (u.displayName || '').toLowerCase();
                      const email = (u.email || '').toLowerCase();
                      return name.includes(query) || email.includes(query);
                    })
                    .sort((a, b) => (isSuperAdmin(getUserEmail(a)) ? -1 : isSuperAdmin(getUserEmail(b)) ? 1 : 0))
                    .map(u => {
                      const userIsSuper = isSuperAdmin(getUserEmail(u));
                      return (
                        <div key={u.id} className={`user-list-item ${userIsSuper ? 'super-admin' : ''}`}>
                          <div className="col-user">
                            <img src={u.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png'} alt="" />
                            <span>{u.displayName || 'Unknown'}</span>
                          </div>
                          <div className="col-email">{u.email}</div>
                          <div className="col-role">
                            {userIsSuper ? (
                              <span className="badge-super">Super Admin</span>
                            ) : (
                              <div className="role-actions">
                                <select
                                  value={u.role || 'user'}
                                  onChange={async (e) => {
                                    const newRole = e.target.value;
                                    try {
                                      setProcessingId(`role-${u.id}`);
                                      const userRef = doc(db, 'users', u.id);
                                      await updateDoc(userRef, {
                                        role: newRole === 'user' ? null : newRole
                                      });
                                      // Update local state
                                      setAllUsers(prev => prev.map(user =>
                                        user.id === u.id ? { ...user, role: newRole === 'user' ? null : newRole } : user
                                      ));
                                      alert(`✅ Role updated for ${u.displayName || u.email}`);
                                    } catch (error) {
                                      console.error('Error updating role:', error);
                                      alert('Error updating role: ' + error.message);
                                    } finally {
                                      setProcessingId(null);
                                    }
                                  }}
                                  disabled={processingId === `role-${u.id}`}
                                  className="role-select"
                                >
                                  <option value="user">User</option>
                                  <option value="admin">Admin</option>
                                </select>
                                <button
                                  className="manage-btn"
                                  onClick={() => {
                                    setSelectedUserForLogs(u);
                                    fetchUserLogs(u.id);
                                  }}
                                >
                                  📊 Logs
                                </button>
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
              <div className="section-info">
                <p>📜 History of processed withdrawals and deposit notifications.</p>
              </div>

              {historyLoading ? (
                <div className="loading">Loading history...</div>
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
                              <th>Processed By</th>
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
                                <td className="amount">{formatAuryAmount(w.amount)} AURY</td>
                                <td>
                                  <span className={`status-badge ${w.status}`}>
                                    {w.status === 'completed' ? 'Approved' : 'Rejected'}
                                  </span>
                                </td>
                                <td className="processor">{w.processedBy || 'System'}</td>
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
                              <th>Processed By</th>
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
                                <td className="amount">{d.amount} AURY</td>
                                <td>
                                  <span className={`status-badge ${d.status}`}>
                                    {d.status === 'processed' ? 'Credited' : 'Dismissed'}
                                  </span>
                                </td>
                                <td className="processor">{d.processedBy || 'System'}</td>
                                <td className="date">{formatTime(d.processedAt)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}
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
                              src={visitor.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png'}
                              alt=""
                              style={{ width: '32px', height: '32px', borderRadius: '50%', marginRight: '8px' }}
                            />
                            <span>{visitor.displayName || 'Unknown'}</span>
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
                <div className="loading">Loading logs...</div>
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
        </div>
      </div>

      {/* Per-User Logs Modal */}
      {selectedUserForLogs && (
        <div className="admin-modal-overlay activity-modal">
          <div className="admin-modal">
            <div className="modal-header">
              <h2>Activity Log: {selectedUserForLogs.displayName || selectedUserForLogs.email}</h2>
              <button className="close-btn" onClick={() => setSelectedUserForLogs(null)}>×</button>
            </div>
            <div className="modal-body">
              {logsLoading ? (
                <div className="loading">Loading logs...</div>
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
      )}
    </div>
  );
}

export default AdminPanel;