import { db } from '../firebase';
import { 
    doc, 
    updateDoc, 
    collection, 
    addDoc, 
    serverTimestamp, 
    increment
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
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
        const functions = getFunctions();
        const collectReward = httpsCallable(functions, 'collectDailyReward');
        
        const response = await collectReward();
        const result = response.data;

        if (result.success) {
            // Notifications are optional here as the backend could handle them, 
            // but for instant feedback we keep it or rely on the return message.
            return result;
        }
        return { success: false, message: result.message || 'Check-in failed' };
    } catch (error) {
        console.error('Daily check-in error:', error);
        // Extract message from HttpsError
        const message = error.message?.includes('already-exists') 
            ? 'Already checked in today!' 
            : (error.message || 'Check-in failed');
        return { success: false, message };
    }
};
