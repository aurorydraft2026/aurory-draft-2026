import { useState, useEffect } from 'react';
import { db } from '../firebase';
import {
    collection, doc, addDoc, serverTimestamp, runTransaction, query, orderBy, onSnapshot
} from 'firebase/firestore';
import { createNotification } from '../services/notifications';
import { logActivity } from '../services/activityService';

export const useWallet = (user) => {
    const [walletBalance, setWalletBalance] = useState(0);
    const [showWalletModal, setShowWalletModal] = useState(false);
    const [walletTab, setWalletTab] = useState('deposit');
    const [withdrawAmount, setWithdrawAmount] = useState('');
    const [withdrawAddress, setWithdrawAddress] = useState('');
    const [transactions, setTransactions] = useState([]);
    const [walletLoading, setWalletLoading] = useState(false);
    const [copySuccess, setCopySuccess] = useState('');
    const [depositTxSignature, setDepositTxSignature] = useState('');
    const [depositAmount, setDepositAmount] = useState('');
    const [depositNote, setDepositNote] = useState('');

    // Fetch wallet balance and transactions
    useEffect(() => {
        if (!user) {
            setWalletBalance(0);
            setTransactions([]);
            return;
        }

        // 1. Listen to balance
        const walletRef = doc(db, 'wallets', user.uid);
        const unsubscribeBalance = onSnapshot(walletRef, (docSnap) => {
            if (docSnap.exists()) {
                setWalletBalance(docSnap.data().balance || 0);
            } else {
                setWalletBalance(0);
            }
        });

        // 2. Listen to transactions
        const txRef = collection(db, 'wallets', user.uid, 'transactions');
        const q = query(txRef, orderBy('timestamp', 'desc'));
        const unsubscribeTx = onSnapshot(q, (snapshot) => {
            const txs = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setTransactions(txs);
        });

        return () => {
            unsubscribeBalance();
            unsubscribeTx();
        };
    }, [user]);

    const formatAuryAmount = (amount) => {
        return (amount / 1e9).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 4
        });
    };

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

            await runTransaction(db, async (transaction) => {
                const walletDoc = await transaction.get(walletRef);

                if (!walletDoc.exists()) {
                    throw new Error('Wallet not found');
                }

                const currentBalance = walletDoc.data().balance || 0;

                if (currentBalance < amountInSmallestUnit) {
                    throw new Error('Insufficient balance');
                }

                transaction.update(walletRef, {
                    balance: currentBalance - amountInSmallestUnit,
                    updatedAt: serverTimestamp()
                });

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

            const txRef = collection(db, 'wallets', user.uid, 'transactions');
            await addDoc(txRef, {
                type: 'withdrawal_pending',
                amount: amountInSmallestUnit,
                walletAddress: withdrawAddress,
                status: 'pending',
                timestamp: serverTimestamp()
            });

            alert('Withdrawal request submitted! Balance deducted. It will be processed within 24 hours.');

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
            const notificationRef = collection(db, 'depositNotifications');
            await addDoc(notificationRef, {
                userId: user.uid,
                userEmail: user.email,
                userName: user.displayName,
                createdAt: serverTimestamp(),
                amount: amount,
                txSignature: depositTxSignature || '',
                note: depositNote || '',
                status: 'pending'
            });

            alert('✅ Admin has been notified! Your deposit will be credited soon.');

            await createNotification(user.uid, {
                type: 'deposit',
                title: 'Deposit Notified',
                message: `Admin has been notified of your ${amount} AURY deposit. It will be credited soon.`,
                link: '#'
            });

            setDepositTxSignature('');
            setDepositAmount('');
            setDepositNote('');

        } catch (error) {
            console.error('Notification error:', error);
            alert('Failed to send notification. Please try again.');
        }
        setWalletLoading(false);
    };

    const copyToClipboard = async (text, type) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopySuccess(type);
            setTimeout(() => setCopySuccess(''), 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    };

    return {
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
    };
};
