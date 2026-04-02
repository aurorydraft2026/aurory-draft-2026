import { db } from '../firebase';
import { 
    doc, 
    updateDoc, 
    collection, 
    addDoc, 
    serverTimestamp, 
    increment,
    runTransaction
} from 'firebase/firestore';
import { createNotification } from './notifications';

/**
 * Award points to a user
 * @param {string} userId - The user ID to award points to
 * @param {number} amount - Number of points to award (can be negative for deductions)
 * @param {string} type - The type of activity (e.g. 'raffle_join', 'tournament_join')
 * @param {string} description - Brief description of why points were awarded
 * @returns {Promise<boolean>} - Success status
 */
export const awardPoints = async (userId, amount, type, description) => {
    if (!userId || amount === 0) return false;

    try {
        const userRef = doc(db, 'users', userId);
        const historyRef = collection(db, 'users', userId, 'pointsHistory');

        // Update total points atomically to avoid race conditions
        await updateDoc(userRef, {
            points: increment(amount),
            updatedAt: serverTimestamp()
        });

        // Add history entry
        await addDoc(historyRef, {
            amount,
            type,
            description,
            timestamp: serverTimestamp()
        });

        // Add user notification
        await createNotification(userId, {
            title: 'Valcoins Awarded!',
            message: `You earned ${amount} Valcoins for: ${description}`,
            type: 'points'
        });

        return true;
    } catch (error) {
        console.error('Error awarding points:', error);
        return false;
    }
};

/**
 * Perform daily check-in for a user
 * Uses a transaction to prevent race conditions (multiple claims in one day)
 * @param {string} userId - The user's ID
 * @returns {Promise<{success: boolean, message: string, points?: number}>}
 */
export const dailyCheckIn = async (userId) => {
    if (!userId) return { success: false, message: 'User not authenticated' };

    try {
        const userRef = doc(db, 'users', userId);
        const historyRef = collection(db, 'users', userId, 'pointsHistory');
        
        const now = new Date();
        const todayStr = now.toISOString().split('T')[0];
        const yesterday = new Date(now);
        yesterday.setUTCDate(now.getUTCDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];

        const result = await runTransaction(db, async (transaction) => {
            const userDoc = await transaction.get(userRef);
            
            if (!userDoc.exists()) {
                throw new Error('User document not found');
            }

            const userData = userDoc.data();
            
            // Check if user already checked in today
            // Note: useAuth stores it as a string YYYY-MM-DD
            if (userData.lastDailyCheckIn === todayStr) {
                return { success: false, message: 'Already checked in today!' };
            }

            // Streak Logic
            let currentStreak = userData.checkInStreak || 0;
            
            // Legacy Data Catch-up: If streak is 0/undefined but they have a lastDailyCheckIn
            if (currentStreak === 0 && userData.lastDailyCheckIn) {
                // We'll trust the lastDailyCheckIn to start a streak of 1 if it was recent
                // Or we can assume they have been claiming if they have a history.
                // For simplicity, if they checked in yesterday, we'll try to find their streak.
                // But since we can't query inside transaction, we'll initialize to 1 or 2 here
                // and let the next check-in handle it, OR we could have queried history outside.
                
                // Let's assume if it was yesterday, we start at 2 (yesterday + today)
                if (userData.lastDailyCheckIn === yesterdayStr) {
                    currentStreak = 1; // It will be incremented to 2 below
                } else {
                    currentStreak = 0; // Will be 1 below
                }
            }

            let newStreak = 1;
            if (userData.lastDailyCheckIn === yesterdayStr) {
                newStreak = currentStreak + 1;
            } else {
                newStreak = 1;
            }

            // Award points (Dynamic from Settings)
            let baseAmount = 10;
            const configRef = doc(db, 'settings', 'valcoin_rewards');
            const configSnap = await transaction.get(configRef);
            if (configSnap.exists()) {
                baseAmount = configSnap.data().dailyCheckIn ?? 10;
            }

            // Bonus Logic: 1-5 Valcoins if streak >= 7
            let bonusAmount = 0;
            if (newStreak >= 7) {
                bonusAmount = Math.floor(Math.random() * 5) + 1;
            }

            const totalAmount = baseAmount + bonusAmount;

            transaction.update(userRef, {
                points: increment(totalAmount),
                lastDailyCheckIn: todayStr,
                checkInStreak: newStreak,
                updatedAt: serverTimestamp()
            });

            // Add history record
            const newHistoryRef = doc(historyRef);
            transaction.set(newHistoryRef, {
                amount: totalAmount,
                baseAmount,
                bonusAmount,
                streak: newStreak,
                type: 'daily_checkin',
                description: bonusAmount > 0 
                    ? `Daily check-in reward (Streak: ${newStreak} days, +${bonusAmount} bonus)` 
                    : `Daily check-in reward (Streak: ${newStreak} days)`,
                timestamp: serverTimestamp()
            });

            return { 
                success: true, 
                message: bonusAmount > 0 
                    ? `Check-in successful! +${baseAmount} Valcoins and +${bonusAmount} bonus!`
                    : `Check-in successful! +${baseAmount} Valcoins`, 
                points: totalAmount,
                baseAmount,
                bonusAmount,
                streak: newStreak
            };
        });

        if (result.success) {
            // Add user notification
            await createNotification(userId, {
                title: result.bonusAmount > 0 ? 'Daily Bonus Reward!' : 'Daily Reward!',
                message: result.bonusAmount > 0 
                    ? `You received ${result.baseAmount} Valcoins + ${result.bonusAmount} bonus for your ${result.streak}-day streak.`
                    : `You received ${result.points} Valcoins for your daily check-in.`,
                type: 'points'
            });
        }

        return result;
    } catch (error) {
        console.error('Daily check-in error:', error);
        return { success: false, message: error.message || 'Check-in failed' };
    }
};
