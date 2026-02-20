import React, { useState, useEffect, useRef } from 'react';
import { db } from '../firebase';
import {
    collection, query, orderBy, limit, onSnapshot, updateDoc, doc, getDocs, writeBatch
} from 'firebase/firestore';

export const useNotifications = (user, navigate, formatTransactionTime) => {
    const [notifications, setNotifications] = useState([]);
    const [showNotificationPanel, setShowNotificationPanel] = useState(false);
    const [unreadCount, setUnreadCount] = useState(0);
    const notificationMenuRef = useRef(null);

    // Read User Notifications
    useEffect(() => {
        if (!user) {
            setNotifications([]);
            setUnreadCount(0);
            return;
        }

        const notificationsRef = collection(db, 'users', user.uid, 'notifications');
        const q = query(notificationsRef, orderBy('createdAt', 'desc'), limit(20));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const activeNotifications = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setNotifications(activeNotifications);
            setUnreadCount(activeNotifications.filter(n => !n.read).length);
        }, (error) => {
            console.error("Error fetching notifications:", error);
        });

        return () => unsubscribe();
    }, [user]);

    // Handle click outside for notification panel
    useEffect(() => {
        function handleClickOutside(event) {
            if (window.innerWidth <= 768) return;
            if (notificationMenuRef.current && !notificationMenuRef.current.contains(event.target)) {
                setShowNotificationPanel(false);
            }
        }
        if (showNotificationPanel) {
            document.addEventListener('click', handleClickOutside);
        }
        return () => {
            document.removeEventListener('click', handleClickOutside);
        };
    }, [showNotificationPanel]);

    // Mark notifications as read
    const markAllAsRead = async () => {
        if (!user || unreadCount === 0) return;

        try {
            const unread = notifications.filter(n => !n.read);
            await Promise.all(unread.map(n =>
                updateDoc(doc(db, 'users', user.uid, 'notifications', n.id), { read: true })
            ));
            setUnreadCount(0);
        } catch (error) {
            console.error("Error marking as read:", error);
        }
    };

    // Delete all notifications
    const deleteAllNotifications = async () => {
        if (!user) return;

        if (!window.confirm('Are you sure you want to delete all notifications? This will clear your entire history and cannot be undone.')) {
            return;
        }

        try {
            const notificationsRef = collection(db, 'users', user.uid, 'notifications');
            const snapshot = await getDocs(notificationsRef);

            if (snapshot.empty) return;

            const batch = writeBatch(db);
            snapshot.docs.forEach(notifDoc => {
                batch.delete(notifDoc.ref);
            });

            await batch.commit();
        } catch (error) {
            console.error("Error deleting notifications:", error);
            alert('Failed to delete notifications. Please try again.');
        }
    };

    const renderNotificationPanelContent = () => {
        return (
            <div className="notification-panel" onClick={(e) => e.stopPropagation()}>
                <div className="notification-panel-header">
                    <div className="header-left">
                        <h3>Notifications</h3>
                        {notifications.length > 0 && (
                            <button
                                className="delete-all-btn"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    deleteAllNotifications();
                                }}
                                title="Delete all notifications"
                            >
                                🗑️ Clear All
                            </button>
                        )}
                    </div>
                    <button className="close-panel-btn" onClick={() => setShowNotificationPanel(false)}>✖</button>
                </div>
                <div className="notification-list">
                    {notifications.length === 0 ? (
                        <div className="no-notifications">No new notifications</div>
                    ) : (
                        notifications.map(notif => (
                            <div
                                key={notif.id}
                                className={`notification-item ${!notif.read ? 'unread' : ''} ${notif.type}`}
                                onClick={() => {
                                    if (notif.link && notif.link !== '#') navigate(notif.link);
                                    setShowNotificationPanel(false);
                                }}
                            >
                                <div className="notification-icon">
                                    {notif.type === 'invite' ? '🎮' :
                                        notif.type === 'deposit' ? '📥' :
                                            notif.type === 'withdrawal' ? '📤' : '🔔'}
                                </div>
                                <div className="notification-content">
                                    <div className="notification-title">{notif.title}</div>
                                    <div className="notification-message">{notif.message}</div>
                                    <div className="notification-time">
                                        {formatTransactionTime(notif.createdAt)}
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        );
    };

    return {
        notifications,
        showNotificationPanel,
        setShowNotificationPanel,
        unreadCount,
        notificationMenuRef,
        markAllAsRead,
        deleteAllNotifications,
        renderNotificationPanelContent
    };
};
