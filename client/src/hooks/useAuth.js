import React, { useState, useEffect, useRef } from 'react';
import { auth, db, discordProvider, googleProvider } from '../firebase';
import { signInWithPopup, signInWithRedirect, getRedirectResult, getAdditionalUserInfo, signOut, onAuthStateChanged } from 'firebase/auth';
import { doc, setDoc, getDocs, collection } from 'firebase/firestore';
import { isSuperAdmin } from '../config/admins';
import { logActivity } from '../services/activityService';

export const useAuth = (navigate) => {
    const [user, setUser] = useState(null);
    const [showUserModal, setShowUserModal] = useState(false);
    const [showLoginModal, setShowLoginModal] = useState(false);
    const [showLoginSuccessModal, setShowLoginSuccessModal] = useState(false);
    const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
    const [showLogoutSuccessModal, setShowLogoutSuccessModal] = useState(false);
    const [isAuthenticating, setIsAuthenticating] = useState(false);
    const [registeredUsers, setRegisteredUsers] = useState([]);
    const profileMenuRef = useRef(null);

    // Auth state listener and redirect result handler
    useEffect(() => {
        const handleRedirectResult = async () => {
            try {
                const result = await getRedirectResult(auth);
                if (result) {
                    console.log('✅ Auth result from redirect capture');
                    // Existing logic for saving user would go here if needed, 
                    // but onAuthStateChanged will handle the user state.
                }
            } catch (error) {
                console.error('Redirect result error:', error);
            }
        };

        handleRedirectResult();

        const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
            if (firebaseUser) {
                setUser(firebaseUser);
            } else {
                setUser(null);
            }
        });

        return () => unsubscribe();
    }, []);

    // Fetch registered users for participant selection
    const fetchRegisteredUsers = async () => {
        try {
            const usersCollection = collection(db, 'users');
            const snapshot = await getDocs(usersCollection);
            const users = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }))
                .filter(user => user.uid);

            setRegisteredUsers(users);
        } catch (error) {
            console.error('Error fetching users:', error);
        }
    };

    useEffect(() => {
        if (user) {
            fetchRegisteredUsers();
        }
    }, [user]);

    // Handle click outside for profile dropdown
    useEffect(() => {
        function handleClickOutside(event) {
            if (window.innerWidth <= 768) return;
            if (profileMenuRef.current && !profileMenuRef.current.contains(event.target)) {
                setShowUserModal(false);
            }
        }
        if (showUserModal) {
            document.addEventListener('click', handleClickOutside);
        }
        return () => {
            document.removeEventListener('click', handleClickOutside);
        };
    }, [showUserModal]);

    const getUserEmail = (user) => {
        if (!user) return '';
        if (user.email) return user.email;
        if (user.providerData && user.providerData.length > 0) {
            return user.providerData[0].email || '';
        }
        return '';
    };

    const isSuperAdminUser = user && isSuperAdmin(getUserEmail(user));
    const isAdminUser = user && (isSuperAdminUser || user.role === 'admin');

    // Handle Discord Login
    const handleDiscordLogin = async () => {
        if (isAuthenticating) return;
        setIsAuthenticating(true);
        try {
            const result = await signInWithPopup(auth, discordProvider);
            const additionalInfo = getAdditionalUserInfo(result);
            const discordData = additionalInfo?.profile;

            let userEmail = result.user.email;
            if (!userEmail && result.user.providerData && result.user.providerData.length > 0) {
                userEmail = result.user.providerData[0].email;
            }

            let displayName = result.user.displayName;
            if (!displayName && result.user.providerData && result.user.providerData.length > 0) {
                displayName = result.user.providerData[0].displayName ||
                    result.user.providerData[0].uid ||
                    userEmail?.split('@')[0];
            }

            const username = discordData?.username || displayName || 'Discord User';

            const enhancedUser = {
                ...result.user,
                email: userEmail || '',
                displayName: displayName || 'Discord User'
            };

            try {
                await setDoc(doc(db, 'users', result.user.uid), {
                    uid: result.user.uid,
                    username: username,
                    discordUsername: discordData?.username || displayName,
                    discordId: discordData?.id || '',
                    avatar: discordData?.avatar
                        ? `https://cdn.discordapp.com/avatars/${discordData.id}/${discordData.avatar}.png`
                        : result.user.photoURL || null,
                    discriminator: discordData?.discriminator || '',
                    email: userEmail || '',
                    displayName: displayName || 'Discord User',
                    lastLogin: new Date(),
                    createdAt: new Date()
                }, { merge: true });

                console.log('✅ User saved to Firestore on login:', result.user.uid);
            } catch (firestoreError) {
                console.error('❌ Failed to save user to Firestore:', firestoreError);
            }

            setUser(enhancedUser);
            logActivity({
                user: enhancedUser,
                type: 'AUTH',
                action: 'login_discord'
            });
            setShowLoginModal(false);
            setShowLoginSuccessModal(true);
        } catch (error) {
            if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-by-user') {
                console.log('Login cancelled by user');
            } else if (error.code === 'auth/popup-blocked') {
                console.log('Popup blocked, falling back to redirect...');
                try {
                    await signInWithRedirect(auth, discordProvider);
                } catch (redirectError) {
                    console.error('Redirect login error:', redirectError);
                    alert('Login failed: ' + redirectError.message);
                }
            } else {
                console.error('Login error:', error);
                alert('Login failed: ' + error.message);
            }
        } finally {
            setIsAuthenticating(false);
        }
    };

    // Handle Google Login
    const handleGoogleLogin = async () => {
        if (isAuthenticating) return;
        setIsAuthenticating(true);
        try {
            const result = await signInWithPopup(auth, googleProvider);

            const userEmail = result.user.email;
            const displayName = result.user.displayName || userEmail?.split('@')[0] || 'User';

            const enhancedUser = {
                ...result.user,
                email: userEmail || '',
                displayName: displayName
            };

            try {
                await setDoc(doc(db, 'users', result.user.uid), {
                    uid: result.user.uid,
                    email: userEmail || '',
                    displayName: displayName,
                    photoURL: result.user.photoURL || null,
                    lastLogin: new Date(),
                    createdAt: new Date()
                }, { merge: true });

                console.log('✅ User saved to Firestore on Google login:', result.user.uid);
            } catch (firestoreError) {
                console.error('❌ Failed to save user to Firestore:', firestoreError);
            }

            setUser(enhancedUser);
            logActivity({
                user: enhancedUser,
                type: 'AUTH',
                action: 'login_google'
            });
            setShowLoginModal(false);
            setShowLoginSuccessModal(true);
        } catch (error) {
            if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-by-user') {
                console.log('Google login cancelled by user');
            } else if (error.code === 'auth/popup-blocked') {
                console.log('Google popup blocked, falling back to redirect...');
                try {
                    await signInWithRedirect(auth, googleProvider);
                } catch (redirectError) {
                    console.error('Google redirect login error:', redirectError);
                    alert('Google login failed: ' + redirectError.message);
                }
            } else {
                console.error('Google login error:', error);
                alert('Google login failed: ' + error.message);
            }
        } finally {
            setIsAuthenticating(false);
        }
    };

    // Handle Logout
    const handleLogout = async () => {
        try {
            logActivity({
                user,
                type: 'AUTH',
                action: 'logout'
            });
            await signOut(auth);
            setUser(null);
            setShowLogoutSuccessModal(true);
        } catch (error) {
            console.error('Logout error:', error.message);
        }
    };

    const renderUserProfileContent = ({ setShowAuroryModal }) => {
        if (!user) return null;
        return (
            <div
                className="user-profile-modal"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
            >
                <div className="modal-header">
                    <h3>👤 User Profile</h3>
                    <button className="close-modal" onClick={() => setShowUserModal(false)}>✖</button>
                </div>

                <div className="user-modal-content">
                    <div className="user-header-info">
                        <img
                            src={user.auroryProfilePicture || user.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png'}
                            alt="Profile"
                            className="modal-profile-pic"
                            onError={(e) => { e.target.onerror = null; e.target.src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }}
                        />
                        <div className="user-text-info">
                            <span className="modal-username">
                                {user.displayName}
                                {user.isAurorian && <span className="aurorian-badge" title="Aurorian NFT Holder">🛡️</span>}
                            </span>
                            <span className="modal-email">{user.email}</span>
                            {isSuperAdminUser ? (
                                <span className="modal-admin-badge">⭐Super Admin</span>
                            ) : isAdminUser ? (
                                <span className="modal-admin-badge admin-staff">⭐Admin</span>
                            ) : null}

                            {user.isAurorian && <span className="aurorian-tag">Aurorian Holder</span>}
                        </div>
                    </div>

                    <div className="user-modal-actions">
                        <button
                            className="modal-action-btn aurory"
                            onClick={() => {
                                setShowUserModal(false);
                                setShowAuroryModal(true);
                            }}
                        >
                            <span className="btn-icon">🎮</span>
                            <div className="btn-text">
                                <span className="btn-title">Aurory Account</span>
                                <span className="btn-desc">Link your game account</span>
                            </div>
                        </button>

                        {isAdminUser && (
                            <button
                                className="modal-action-btn admin"
                                onClick={() => {
                                    setShowUserModal(false);
                                    navigate('/admin/panel');
                                }}
                            >
                                <span className="btn-icon">💼</span>
                                <div className="btn-text">
                                    <span className="btn-title">Admin Panel</span>
                                    <span className="btn-desc">Manage wallets & deposits</span>
                                </div>
                            </button>
                        )}

                        <div className="modal-divider"></div>

                        <button
                            className="modal-action-btn logout"
                            onClick={() => {
                                setShowUserModal(false);
                                setShowLogoutConfirm(true);
                            }}
                        >
                            <span className="btn-icon">🚪</span>
                            <div className="btn-text">
                                <span className="btn-title">Logout</span>
                                <span className="btn-desc">Sign out of your account</span>
                            </div>
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    const renderLoginModalContent = () => {
        return (
            <div className="modal-overlay" onClick={() => setShowLoginModal(false)}>
                <div className="login-modal" onClick={(e) => e.stopPropagation()}>
                    <div className="modal-header">
                        <h3>🔐 Login to Asgard Duels</h3>
                        <button className="close-modal" onClick={() => setShowLoginModal(false)}>✖</button>
                    </div>
                    <div className="login-options">
                        <p className="login-intro">Join the ultimate tactical Aurory community. Compete, earn, and dominate!</p>

                        <button className="modal-action-btn discord" onClick={handleDiscordLogin} disabled={isAuthenticating}>
                            <div className="btn-icon">
                                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" /></svg>
                            </div>
                            <div className="btn-text">
                                <span className="btn-title">Continue with Discord</span>
                                <span className="btn-desc">Join our Discord community</span>
                            </div>
                        </button>

                        <button className="modal-action-btn google" onClick={handleGoogleLogin} disabled={isAuthenticating}>
                            <div className="btn-icon">
                                <svg viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" /><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" /><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" /></svg>
                            </div>
                            <div className="btn-text">
                                <span className="btn-title">Continue with Google</span>
                                <span className="btn-desc">Login with your Google account</span>
                            </div>
                        </button>

                        <p className="login-footer">By logging in, you agree to our Terms of Service.</p>
                    </div>
                </div>
            </div>
        );
    };

    const renderLoginSuccessModal = () => {
        return (
            <div className="login-success-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-body">
                    <div className="success-icon-wrapper">
                        <img src="/SwordFight.gif" alt="Success" className="success-gif" />
                    </div>
                    <h3>Welcome Back, {user?.displayName || 'User'}!</h3>
                    <p>Successfully logged in to your account.</p>
                    <button
                        className="btn-primary awesome-btn"
                        onClick={() => setShowLoginSuccessModal(false)}
                    >
                        Let's Duel!
                    </button>
                </div>
            </div>
        );
    };

    const renderLogoutSuccessModal = () => {
        return (
            <div className="login-success-modal logout-success" onClick={(e) => e.stopPropagation()}>
                <div className="modal-body">
                    <div className="success-icon-wrapper">
                        <span className="success-icon">👋</span>
                    </div>
                    <h3>Logged Out Successfully</h3>
                    <p>Hope to see you back soon for another duel!</p>
                    <button
                        className="btn-primary awesome-btn"
                        onClick={() => setShowLogoutSuccessModal(false)}
                    >
                        OK
                    </button>
                </div>
            </div>
        );
    };

    const renderLogoutConfirmModal = () => {
        return (
            <div className="modal-overlay" onClick={() => setShowLogoutConfirm(false)}>
                <div className="confirmation-modal logout-confirm" onClick={(e) => e.stopPropagation()}>
                    <div className="modal-header">
                        <h3>🚪 Confirm Logout</h3>
                        <button className="close-modal" onClick={() => setShowLogoutConfirm(false)}>✖</button>
                    </div>
                    <div className="modal-body">
                        <div className="confirm-icon">🚪</div>
                        <p>Are you sure you want to log out of Asgard Duels?</p>
                        <div className="confirm-actions">
                            <button
                                className="btn-secondary"
                                onClick={() => setShowLogoutConfirm(false)}
                            >
                                Cancel
                            </button>
                            <button
                                className="btn-danger"
                                onClick={() => {
                                    setShowLogoutConfirm(false);
                                    handleLogout();
                                }}
                            >
                                Yes, Log Out
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    return {
        user, setUser,
        showUserModal, setShowUserModal,
        showLoginModal, setShowLoginModal,
        showLoginSuccessModal, setShowLoginSuccessModal,
        showLogoutConfirm, setShowLogoutConfirm,
        showLogoutSuccessModal, setShowLogoutSuccessModal,
        registeredUsers,
        handleDiscordLogin,
        handleGoogleLogin,
        handleLogout,
        fetchRegisteredUsers,
        getUserEmail,
        isSuperAdminUser,
        isAdminUser,
        renderUserProfileContent,
        renderLoginModalContent,
        renderLoginSuccessModal,
        renderLogoutSuccessModal,
        renderLogoutConfirmModal,
        profileMenuRef
    };
};
