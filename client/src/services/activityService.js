import { db } from '../firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

/**
 * Logs a user activity to Firestore.
 * @param {Object} params
 * @param {Object} params.user - The user object from Firebase Auth or local state.
 * @param {string} params.type - Category (AUTH, DRAFT, WALLET, ADMIN).
 * @param {string} params.action - Specific action (e.g., 'withdraw_request').
 * @param {Object} [params.metadata] - Optional extra data.
 */
export const logActivity = async ({ user, type, action, metadata = {} }) => {
    if (!user || user.isAnonymous) return;

    try {
        const activityRef = collection(db, 'activity_logs');
        await addDoc(activityRef, {
            userId: user.uid,
            username: user.displayName || user.email?.split('@')[0] || 'Unknown',
            userEmail: user.email || '',
            type,
            action,
            metadata,
            timestamp: serverTimestamp(),
            path: window.location.pathname
        });
    } catch (error) {
        console.error('Error logging activity:', error);
    }
};
