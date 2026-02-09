import { db } from '../firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

/**
 * Creates a notification for a specific user
 * @param {string} userId - The unique ID of the user to notify
 * @param {Object} data - Notification data
 * @param {string} data.title - Notification title
 * @param {string} data.message - Short descriptive message
 * @param {string} data.type - 'invite', 'deposit', or 'withdrawal'
 * @param {string} [data.link] - Optional link to navigate to (e.g., tournament path)
 */
export const createNotification = async (userId, data) => {
    if (!userId) return;

    try {
        const notificationsRef = collection(db, 'users', userId, 'notifications');
        await addDoc(notificationsRef, {
            ...data,
            read: false,
            createdAt: serverTimestamp()
        });
    } catch (error) {
        console.error('Error creating notification:', error);
    }
};
