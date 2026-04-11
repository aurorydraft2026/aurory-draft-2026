import React, { useState, useEffect, useRef } from 'react';
import { auth, db, discordProvider, googleProvider } from '../firebase';
import { signInWithPopup, signInWithRedirect, getRedirectResult, getAdditionalUserInfo, signOut, onAuthStateChanged } from 'firebase/auth';
import { doc, setDoc, getDocs, collection, onSnapshot } from 'firebase/firestore';
import { isSuperAdmin } from '../config/admins';
import { logActivity } from '../services/activityService';
import { dailyCheckIn } from '../services/pointsService';
import { syncAuroryName } from '../services/auroryProfileService';
import { TIER_CONFIG, getTierProgress, getNextTier, upgradeTier as upgradeTierCall, applyReferralCode as applyReferralCodeCall, generateReferralLink } from '../services/tierService';
import './CheckInBonus.css';

export const useAuth = (navigate) => {
    const [user, setUser] = useState(null);
    const [showUserModal, setShowUserModal] = useState(false);
    const [showLoginModal, setShowLoginModal] = useState(false);
    const [showLoginSuccessModal, setShowLoginSuccessModal] = useState(false);
    const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
    const [showLogoutSuccessModal, setShowLogoutSuccessModal] = useState(false);
    const [isAuthenticating, setIsAuthenticating] = useState(false);
    const [registeredUsers, setRegisteredUsers] = useState([]);
    const [bonusEffect, setBonusEffect] = useState(null);
    const [isSyncing, setIsSyncing] = useState(false);
    const [isUpgradingTier, setIsUpgradingTier] = useState(false);
    const [showTierUpgradeAnim, setShowTierUpgradeAnim] = useState(false);
    const [unlockedTierData, setUnlockedTierData] = useState(null);
    const [referralInput, setReferralInput] = useState('');
    const [isApplyingReferral, setIsApplyingReferral] = useState(false);
    const [referralCopied, setReferralCopied] = useState(false);
    const profileMenuRef = useRef(null);

    // Auth state listener and redirect result handler
    useEffect(() => {
        const handleRedirectResult = async () => {
            try {
                const result = await getRedirectResult(auth);
                if (result && result.user) {
                    console.log('✅ Auth result from redirect capture');
                    const additionalInfo = getAdditionalUserInfo(result);
                    const providerId = additionalInfo?.providerId || result.providerId || (result.user.providerData && result.user.providerData[0]?.providerId);

                    let userEmail = result.user.email;
                    if (!userEmail && result.user.providerData && result.user.providerData.length > 0) {
                        userEmail = result.user.providerData[0].email;
                    }

                    let displayName = result.user.displayName;
                    if (!displayName && result.user.providerData && result.user.providerData.length > 0) {
                        displayName = result.user.providerData[0].displayName || userEmail?.split('@')[0] || 'User';
                    }

                    if (providerId === 'discord.com') {
                        const discordData = additionalInfo?.profile;
                        const discordId = discordData?.id || result.user.providerData[0]?.uid || '';
                        const username = discordData?.username || displayName;

                        await setDoc(doc(db, 'users', result.user.uid), {
                            uid: result.user.uid,
                            username: username,
                            discordUsername: discordData?.username || displayName,
                            discordId: discordId,
                            avatar: discordData?.avatar && discordId
                                ? `https://cdn.discordapp.com/avatars/${discordId}/${discordData.avatar}.png`
                                : result.user.photoURL || null,
                            discriminator: discordData?.discriminator || '',
                            email: userEmail || '',
                            displayName: displayName,
                            lastLogin: new Date()
                        }, { merge: true });
                    } else {
                        await setDoc(doc(db, 'users', result.user.uid), {
                            uid: result.user.uid,
                            email: userEmail || '',
                            displayName: displayName,
                            photoURL: result.user.photoURL || null,
                            lastLogin: new Date()
                        }, { merge: true });
                    }
                    setShowLoginSuccessModal(true);
                }
            } catch (error) {
                console.error('Redirect result error:', error);
            }
        };

        handleRedirectResult();

        let unsubProfile = null;

        const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
            if (firebaseUser) {
                setUser(firebaseUser);

                if (unsubProfile) {
                    unsubProfile();
                    unsubProfile = null;
                }

                const userRef = doc(db, 'users', firebaseUser.uid);
                unsubProfile = onSnapshot(userRef, (docSnap) => {
                    if (docSnap.exists()) {
                        const userData = docSnap.data();

                        // Permanent Ban Enforcement
                        if (userData.role === 'blocked') {
                            console.warn('🚫 User is blocked. Signing out...');
                            signOut(auth);
                            alert('❌ YOUR ACCOUNT HAS BEEN PERMANENTLY BLOCKED.\n\nPlease contact an administrator if you believe this is an error.');
                            return;
                        }

                        setUser(prevUser => {
                            if (!prevUser || prevUser.uid !== firebaseUser.uid) return prevUser;
                            return { ...prevUser, ...userData };
                        });
                    }
                }, (error) => {
                    console.error('Error listening to user profile:', error);
                });
            } else {
                setUser(null);
                if (unsubProfile) {
                    unsubProfile();
                    unsubProfile = null;
                }
            }
        });

        return () => {
            unsubscribe();
            if (unsubProfile) unsubProfile();
        };
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
    const isGamesManagerUser = user && user.role === 'games_manager';
    const isGeneralAdmin = user && (isSuperAdminUser || user.role === 'admin');
    const isAdminUser = user && (isGeneralAdmin || isGamesManagerUser);

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

            const discordId = discordData?.id || result.user.providerData[0]?.uid || '';

            try {
                await setDoc(doc(db, 'users', result.user.uid), {
                    uid: result.user.uid,
                    username: username,
                    discordUsername: discordData?.username || displayName,
                    discordId: discordId,
                    avatar: discordData?.avatar && discordId
                        ? `https://cdn.discordapp.com/avatars/${discordId}/${discordData.avatar}.png`
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

    // Handle Daily Check-in
    const handleDailyCheckIn = async () => {
        if (!user || isAuthenticating) return;

        setIsAuthenticating(true);
        try {
            const result = await dailyCheckIn(user.uid);

            if (result.success) {
                // If there's a bonus, trigger the animation
                if (result.bonusAmount > 0) {
                    setBonusEffect({
                        amount: result.bonusAmount,
                        id: Date.now()
                    });
                    // Auto-clear after animation
                    setTimeout(() => setBonusEffect(null), 3000);
                }

                logActivity({
                    user,
                    type: 'POINTS',
                    action: 'daily_checkin',
                    metadata: {
                        amount: result.points,
                        baseAmount: result.baseAmount,
                        bonusAmount: result.bonusAmount,
                        streak: result.streak
                    }
                });
            } else {
                alert(result.message);
            }
        } catch (error) {
            console.error('Daily check-in error:', error);
            alert(error.message || 'Check-in failed');
        } finally {
            setIsAuthenticating(false);
        }
    };

    // Handle Profile Sync
    const handleSyncProfile = async () => {
        if (!user || !user.auroryPlayerId || isSyncing) return;

        setIsSyncing(true);
        try {
            const result = await syncAuroryName(user.uid, user.auroryPlayerId);
            if (result.success) {
                // The firestore onSnapshot handles updating the user state automatically
                console.log('✅ Profile sync completed for:', result.playerName);
            } else {
                alert('Profile sync failed: ' + result.error);
            }
        } catch (error) {
            console.error('Profile sync error:', error);
            alert('An error occurred while syncing your profile.');
        } finally {
            setIsSyncing(false);
        }
    };


    const renderUserProfileContent = ({ setShowAuroryModal }) => {
        if (!user) return null;

        const userTier = user.tier || 1;
        const userPoints = user.points || 0;
        const tierConfig = TIER_CONFIG[userTier] || TIER_CONFIG[1];
        const tierProgress = getTierProgress(userPoints, userTier);
        const nextTier = getNextTier(userTier);
        const isCheckedIn = user.lastDailyCheckIn === new Date().toISOString().split('T')[0];

        const handleUpgradeTier = async () => {
            if (isUpgradingTier) return;
            const next = getNextTier(userTier);
            if (!next) return;
            if (!window.confirm(`⚔️ Upgrade to ${next.name} for ${next.upgradeCost.toLocaleString()} Valcoins?\n\nThis will increase your max balance to ${next.max.toLocaleString()} Valcoins.`)) return;
            setIsUpgradingTier(true);
            try {
                const result = await upgradeTierCall();
                if (result.success) {
                    setUnlockedTierData(next);
                    setShowTierUpgradeAnim(true);
                    setTimeout(() => setShowTierUpgradeAnim(false), 4000);
                }
            } catch (error) {
                alert('❌ ' + (error.message || 'Upgrade failed'));
            } finally {
                setIsUpgradingTier(false);
            }
        };

        const handleApplyReferral = async () => {
            if (isApplyingReferral || !referralInput.trim()) return;
            setIsApplyingReferral(true);
            try {
                const result = await applyReferralCodeCall(referralInput.trim());
                if (result.success) {
                    alert(`✅ ${result.message}`);
                    setReferralInput('');
                }
            } catch (error) {
                alert('❌ ' + (error.message || 'Failed to apply referral code'));
            } finally {
                setIsApplyingReferral(false);
            }
        };

        const handleCopyCode = () => {
            const code = user.referralCode;
            if (!code) return;
            navigator.clipboard.writeText(code);
            setReferralCopied(true);
            setTimeout(() => setReferralCopied(false), 2000);
        };

        const handleShareLink = () => {
            const code = user.referralCode;
            if (!code) return;
            const link = generateReferralLink(code);
            if (navigator.share) {
                navigator.share({ title: 'Join Asgard Duels!', text: 'Use my referral code to earn bonus Valcoins!', url: link });
            } else {
                navigator.clipboard.writeText(link);
                setReferralCopied(true);
                setTimeout(() => setReferralCopied(false), 2000);
            }
        };

        const displayCode = user.referralCode || '------';

        return (
            <div
                className="profile-modal-overlay"
                onClick={() => setShowUserModal(false)}
            >
                <div
                    className="user-profile-modal"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                >
                    <div className="modal-header profile-modal-header">
                        <h4>Warrior's Profile</h4>
                        <button className="close-modal" onClick={() => setShowUserModal(false)}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                    </div>

                    {/* ── TIER UPGRADE PREMIUM ANIMATION OVERLAY ── */}
                    {showTierUpgradeAnim && unlockedTierData && (
                        <div className="tier-upgrade-anim-overlay">
                            <div className="viking-runes-bg">
                                <span>ᚠ</span><span>ᚢ</span><span>ᚦ</span><span>ᚨ</span><span>ᚱ</span><span>ᚲ</span>
                                <span>ᚷ</span><span>ᚹ</span><span>ᚺ</span><span>ᚻ</span><span>ᛁ</span><span>ᛃ</span>
                            </div>
                            <div className="tier-slam-content">
                                <span className="unlock-label">SAGA UNLOCKED</span>
                                <div className={`slam-badge tier-${unlockedTierData.roman.toLowerCase()}`}>
                                    {unlockedTierData.name}
                                </div>
                                <span className="unlock-subtext">Your power grows, Warrior!</span>
                            </div>
                        </div>
                    )}

                    <div className="user-modal-content">
                        {/* ── PROFILE HEADER ROW ── */}
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
                                    {user.isAurorian && (
                                        <span className="aurorian-badge-outlined" title="Aurorian NFT Holder">
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
                                        </span>
                                    )}
                                    {user.auroryPlayerId && (
                                        <button
                                            className={`sync-profile-mini-btn ${isSyncing ? 'syncing' : ''}`}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleSyncProfile();
                                            }}
                                            title="Sync Profile Data"
                                            disabled={isSyncing}
                                        >
                                            {isSyncing ? (
                                                <svg className="sync-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>
                                            ) : (
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                                            )}
                                        </button>
                                    )}
                                </span>
                                <span className="modal-email">{user.email}</span>
                                <div className="modal-badges-row">
                                    {isSuperAdminUser ? (
                                        <span className="modal-admin-badge">⭐Super Admin</span>
                                    ) : user.role === 'admin' ? (
                                        <span className="modal-admin-badge admin-staff">⭐Admin</span>
                                    ) : isGamesManagerUser ? (
                                        <span className="modal-admin-badge games-manager-badge">🎮Games Manager</span>
                                    ) : null}
                                    {user.isAurorian && <span className="aurorian-tag">Aurorian Holder</span>}
                                </div>
                            </div>
                            {/* ── DAILY CHECK-IN (right side) ── */}
                            <div className="profile-checkin-area">
                                {bonusEffect && (
                                    <div key={bonusEffect.id} className="bonus-bubble-effect">
                                        +{bonusEffect.amount} Bonus
                                    </div>
                                )}
                                <button
                                    className={`daily-checkin-btn compact ${isCheckedIn ? 'checked-in' : ''}`}
                                    onClick={handleDailyCheckIn}
                                    disabled={isCheckedIn || !user.auroryPlayerId || isAuthenticating}
                                    style={!user.auroryPlayerId ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
                                    title={!user.auroryPlayerId ? 'Connect Aurory account first' : isCheckedIn ? 'Already checked in today' : 'Claim daily reward'}
                                >
                                    <span>
                                        {isCheckedIn ? (
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                        ) : (
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                                        )}
                                    </span>
                                    {user.checkInStreak > 0 && (
                                        <span className="streak-badge-mini">
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mini-flame-icon"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.256 1.189-3.103.111-.124.32-.303.486-.411.5-.327 1.056-.628 1.639-.815"></path></svg>
                                            {user.checkInStreak}d
                                        </span>
                                    )}
                                </button>
                            </div>
                        </div>

                        {/* ── VALCOINS BALANCE ── */}
                        <div className="profile-valcoins-section">
                            <div className="valcoins-display">
                                <img src="/valcoin-icon.jpg" alt="" className="valcoin-icon profile-points-icon" />
                                <span className="valcoins-amount">{userPoints.toLocaleString()}</span>
                                <span className="valcoins-label">Valcoins</span>
                            </div>
                        </div>

                        {/* ── TIER GAUGE ── */}
                        <div className="tier-gauge-section">
                            <div className="tier-gauge-header">
                                <span className={`tier-badge tier-${userTier}`}>{tierConfig.name}</span>
                                <span className="tier-limit">{userPoints.toLocaleString()} / {tierConfig.max.toLocaleString()}</span>
                            </div>
                            <div className="tier-gauge-bar">
                                <div
                                    className={`tier-gauge-fill tier-${userTier}-fill`}
                                    style={{ width: `${tierProgress}%` }}
                                ></div>
                            </div>

                            {/* --- NEW: Limit Reached Warning --- */}
                            {userPoints >= tierConfig.max && (
                                <div className="tier-limit-warning small">
                                    <span className="warning-icon-outlined">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                                    </span>
                                    <p className="warning-text">
                                        Tier limit reached! Upgrade to earn more Valcoins.
                                    </p>
                                </div>
                            )}

                            {nextTier && (
                                <div className="tier-upgrade-row">
                                    <span className="tier-upgrade-info">
                                        Upgrade to {nextTier.name} — Max {nextTier.max.toLocaleString()}
                                    </span>
                                    <button
                                        className="tier-upgrade-btn"
                                        onClick={handleUpgradeTier}
                                        disabled={isUpgradingTier || userPoints < nextTier.upgradeCost}
                                        title={userPoints < nextTier.upgradeCost ? `Need ${nextTier.upgradeCost.toLocaleString()} Valcoins` : `Upgrade for ${nextTier.upgradeCost.toLocaleString()} Valcoins`}
                                    >
                                        {isUpgradingTier ? (
                                            <svg className="sync-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>
                                        ) : (
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="upgrade-arrow-icon"><polyline points="18 15 12 9 6 15"></polyline></svg>
                                        )}
                                        <span className="btn-cost-text">{nextTier.upgradeCost.toLocaleString()}</span>
                                        <span className="valcoin-icon-tiny-outlined">
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8"></circle><line x1="12" y1="12" x2="12.01" y2="12"></line></svg>
                                        </span>
                                    </button>
                                </div>
                            )}
                            {userTier >= 3 && (
                                <div className="tier-max-label">🏆 Maximum Tier Reached</div>
                            )}
                        </div>

                        {/* ── REFERRAL SECTION ── */}
                        <div className="referral-section">
                            <div className="referral-main-row">
                                <div className="referral-code-area">
                                    <span className="referral-label">Your Referral Code</span>
                                    <div className="referral-code-display">
                                        <span className="referral-code-text">{displayCode}</span>
                                        <button className="referral-copy-btn" onClick={handleCopyCode} title="Copy Code">
                                            {referralCopied ? (
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="success-icon"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                            ) : (
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                            )}
                                        </button>
                                        <button className="referral-share-btn" onClick={handleShareLink} title="Share Link">
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
                                        </button>
                                    </div>
                                </div>
                                <div className="referral-stats">
                                    <div className="referral-stat">
                                        <span className="referral-stat-value">{user.validReferralCount || 0}</span>
                                        <span className="referral-stat-label">Valid</span>
                                    </div>
                                    <div className="referral-stat-divider"></div>
                                    <div className="referral-stat">
                                        <span className="referral-stat-value">{user.referralCount || 0}</span>
                                        <span className="referral-stat-label">Total</span>
                                    </div>
                                </div>
                            </div>
                            {!user.referredBy && (
                                <div className="referral-input-row">
                                    <input
                                        type="text"
                                        className="referral-input"
                                        placeholder="Enter referral code"
                                        value={referralInput}
                                        onChange={(e) => setReferralInput(e.target.value.toUpperCase())}
                                        maxLength={6}
                                    />
                                    <button
                                        className="referral-apply-btn"
                                        onClick={handleApplyReferral}
                                        disabled={isApplyingReferral || referralInput.length !== 6}
                                    >
                                        {isApplyingReferral ? '⏳' : 'Apply'}
                                    </button>
                                </div>
                            )}
                            {user.referredBy && (
                                <div className="referral-applied-tag">
                                    ✅ Referral applied {!user.referralBonusClaimed && <span className="referral-pending">· Bonus pending (need Aurory + Tier II)</span>}
                                </div>
                            )}
                        </div>

                        {/* ── ACTION BUTTONS ── */}
                        <div className="user-modal-actions">
                            <button
                                className="modal-action-btn aurory"
                                onClick={() => {
                                    setShowUserModal(false);
                                    setShowAuroryModal(true);
                                }}
                            >
                                <span className="btn-icon">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"></rect><path d="M6 12h.01"></path><path d="M9 12h.01"></path><path d="M15 12h.01"></path><path d="M18 12h.01"></path></svg>
                                </span>
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
                                    <span className="btn-icon">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
                                    </span>
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
                                <span className="btn-icon">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
                                </span>
                                <div className="btn-text">
                                    <span className="btn-title">Logout</span>
                                    <span className="btn-desc">Sign out of your account</span>
                                </div>
                            </button>
                        </div>
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
                        <h3>🔐 Login to Asgard</h3>
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
                        <p>Are you sure you want to log out of Asgard?</p>
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
        isGamesManagerUser,
        isGeneralAdmin,
        renderUserProfileContent,
        renderLoginModalContent,
        renderLoginSuccessModal,
        renderLogoutSuccessModal,
        renderLogoutConfirmModal,
        handleSyncProfile,
        isSyncing,
        profileMenuRef
    };
};
