import { useState, useEffect } from 'react';
import { db } from '../firebase';
import {
    collection, doc, addDoc, serverTimestamp, runTransaction, query, orderBy, onSnapshot
} from 'firebase/firestore';
import { createNotification } from '../services/notifications';
import { logActivity } from '../services/activityService';

export const useWallet = (user) => {
    const [walletBalance, setWalletBalance] = useState(0);
    const [usdcBalance, setUsdcBalance] = useState(0);
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
    const [selectedCurrency, setSelectedCurrency] = useState('AURY');

    // Fetch wallet balance and transactions
    useEffect(() => {
        if (!user) {
            setWalletBalance(0);
            setUsdcBalance(0);
            setTransactions([]);
            return;
        }

        // 1. Listen to balance
        const walletRef = doc(db, 'wallets', user.uid);
        const unsubscribeBalance = onSnapshot(walletRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                setWalletBalance(data.balance || 0);
                setUsdcBalance(data.usdcBalance || 0);
            } else {
                setWalletBalance(0);
                setUsdcBalance(0);
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

    const formatUsdcAmount = (amount) => {
        return (amount / 1e6).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
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

        const decimals = selectedCurrency === 'AURY' ? 1e9 : 1e6;
        const currentCurrencyBalance = selectedCurrency === 'AURY' ? walletBalance : usdcBalance;
        const amountInSmallestUnit = Math.floor(amount * decimals);

        const taxRate = 0.025;
        const netAmountCalc = amount * (1 - taxRate);

        logActivity({
            user,
            type: 'WALLET',
            action: `withdraw_request_${selectedCurrency}`,
            metadata: {
                amount: amount,
                currency: selectedCurrency,
                address: withdrawAddress,
                calculation: `${amount} - 2.5% tax = ${netAmountCalc.toFixed(4)} (Available withdrawal)`
            }
        });

        if (amountInSmallestUnit > currentCurrencyBalance) {
            alert(`Insufficient ${selectedCurrency} balance`);
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

                const data = walletDoc.data();
                const currentBal = selectedCurrency === 'AURY' ? (data.balance || 0) : (data.usdcBalance || 0);

                if (currentBal < amountInSmallestUnit) {
                    throw new Error('Insufficient balance');
                }

                const taxAmount = Math.floor(amountInSmallestUnit * taxRate);
                const netAmount = amountInSmallestUnit - taxAmount;

                const updateData = {
                    updatedAt: serverTimestamp()
                };
                if (selectedCurrency === 'AURY') {
                    updateData.balance = currentBal - amountInSmallestUnit;
                } else {
                    updateData.usdcBalance = currentBal - amountInSmallestUnit;
                }

                transaction.update(walletRef, updateData);

                const withdrawalRef = doc(collection(db, 'withdrawals'));
                transaction.set(withdrawalRef, {
                    userId: user.uid,
                    userEmail: user.email,
                    userName: user.displayName,
                    amount: amountInSmallestUnit,
                    currency: selectedCurrency,
                    taxAmount: taxAmount,
                    netAmount: netAmount,
                    walletAddress: withdrawAddress,
                    status: 'pending',
                    createdAt: serverTimestamp()
                });
            });

            const txRef = collection(db, 'wallets', user.uid, 'transactions');
            const taxRateFinal = 0.025;
            const taxAmountFinal = Math.floor(amountInSmallestUnit * taxRateFinal);
            const netAmountFinal = amountInSmallestUnit - taxAmountFinal;

            await addDoc(txRef, {
                type: 'withdrawal_pending',
                amount: amountInSmallestUnit,
                currency: selectedCurrency,
                taxAmount: taxAmountFinal,
                netAmount: netAmountFinal,
                walletAddress: withdrawAddress,
                status: 'pending',
                timestamp: serverTimestamp()
            });

            alert(`Withdrawal request submitted! ${selectedCurrency} balance deducted. It will be processed within 24 hours.`);

            await createNotification(user.uid, {
                type: 'withdrawal',
                title: 'Withdrawal Requested',
                message: `Your withdrawal for ${amount} ${selectedCurrency} has been submitted for approval.`,
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
            action: `deposit_notify_${selectedCurrency}`,
            metadata: {
                amount: amount,
                currency: selectedCurrency,
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
                currency: selectedCurrency,
                txSignature: depositTxSignature || '',
                note: depositNote || '',
                status: 'pending'
            });

            alert(`✅ Admin has been notified! Your ${selectedCurrency} deposit will be credited soon.`);

            await createNotification(user.uid, {
                type: 'deposit',
                title: 'Deposit Notified',
                message: `Admin has been notified of your ${amount} ${selectedCurrency} deposit. It will be credited soon.`,
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
        usdcBalance,
        selectedCurrency, setSelectedCurrency,
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
        formatUsdcAmount,
        formatTransactionTime,
        submitWithdrawal,
        submitDepositNotification,
        copyToClipboard
    };
};

