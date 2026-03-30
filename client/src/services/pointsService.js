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
        
        const result = await runTransaction(db, async (transaction) => {
            const userDoc = await transaction.get(userRef);
            
            if (!userDoc.exists()) {
                throw new Error('User document not found');
            }

            const userData = userDoc.data();
            const now = new Date();
            const lastCheckIn = userData.lastCheckIn?.toDate ? userData.lastCheckIn.toDate() : (userData.lastCheckIn ? new Date(userData.lastCheckIn) : null);

            // Check if user already checked in today (UTC time)
            if (lastCheckIn) {
                const isSameDay = 
                    lastCheckIn.getUTCFullYear() === now.getUTCFullYear() &&
                    lastCheckIn.getUTCMonth() === now.getUTCMonth() &&
                    lastCheckIn.getUTCDate() === now.getUTCDate();
                
                if (isSameDay) {
                    return { success: false, message: 'Already checked in today!' };
                }
            }

            // Award points (Dynamic from Settings)
            let amount = 10;
            const configRef = doc(db, 'settings', 'valcoin_rewards');
            const configSnap = await transaction.get(configRef);
            if (configSnap.exists()) {
                amount = configSnap.data().dailyCheckIn ?? 10;
            }

            transaction.update(userRef, {
                points: increment(amount),
                lastDailyCheckIn: serverTimestamp(),
                updatedAt: serverTimestamp()
            });

            // Add history record (using transaction.set/add doesn't work for collections, need to use doc ref)
            const newHistoryRef = doc(historyRef);
            transaction.set(newHistoryRef, {
                amount,
                type: 'daily_checkin',
                description: 'Daily check-in reward',
                timestamp: serverTimestamp()
            });

            return { success: true, message: `Check-in successful! +${amount} Valcoins`, points: amount };
        });

        if (result.success) {
            // Add user notification
            await createNotification(userId, {
                title: 'Daily Reward!',
                message: `You received ${result.points} Valcoins for your daily check-in.`,
                type: 'points'
            });
        }

        return result;
    } catch (error) {
        console.error('Daily check-in error:', error);
        return { success: false, message: error.message || 'Check-in failed' };
    }
};
