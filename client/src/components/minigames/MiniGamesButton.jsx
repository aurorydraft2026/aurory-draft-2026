import React, { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../../firebase';
import { isSuperAdmin } from '../../config/admins';
import MiniGamesHub from './MiniGamesHub';
import './MiniGamesButton.css';

const MiniGamesButton = () => {
  const [isHubOpen, setIsHubOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [userPoints, setUserPoints] = useState(0);

  // Listen to auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser && !firebaseUser.isAnonymous) {
        setUser(firebaseUser);
      } else {
        setUser(null);
        setUserPoints(0);
      }
    });
    return () => unsub();
  }, []);

  // Listen for global open event (from win notifications)
  useEffect(() => {
    const handleOpenEvent = () => setIsHubOpen(true);
    window.addEventListener('openMiniGames', handleOpenEvent);
    return () => window.removeEventListener('openMiniGames', handleOpenEvent);
  }, []);

  // Listen to user's points in real time
  useEffect(() => {
    if (!user) return;

    const userRef = doc(db, 'users', user.uid);
    const unsub = onSnapshot(userRef, (snap) => {
      if (snap.exists()) {
        setUserPoints(snap.data().points || 0);
      }
    });

    return () => unsub();
  }, [user]);

  // Listen to global minigames config for Testing Mode
  const [globalConfig, setGlobalConfig] = useState(null);
  useEffect(() => {
    const configRef = doc(db, 'settings', 'mini_games');
    const unsub = onSnapshot(configRef, (snap) => {
      if (snap.exists()) {
        setGlobalConfig(snap.data().global || {});
      }
    });
    return () => unsub();
  }, []);

  // Helper to extract email securely
  const getUserEmail = (u) => {
    if (!u) return null;
    if (u.email) return u.email;
    if (u.providerData && u.providerData.length > 0) return u.providerData[0].email;
    return null;
  };

  // Don't show for anonymous/guest users
  if (!user) return null;

  // Global Testing Mode (SuperAdmin Only) Restriction
  if (globalConfig?.superAdminOnly) {
    const userEmail = getUserEmail(user);
    if (!isSuperAdmin(userEmail) && user.role !== 'superadmin') {
      return null;
    }
  }

  return (
    <>
      <button
        className="mini-games-fab"
        onClick={() => setIsHubOpen(true)}
        id="mini-games-floating-btn"
      >
        <div className="fab-glass" />
        <div className="fab-scan-line" />
        <span className="fab-icon">🎮</span>
        <span className="fab-text">ARCADE</span>
        <div className="fab-status-dot" />
      </button>

      {isHubOpen && (
        <MiniGamesHub
          user={user}
          userPoints={userPoints}
          onClose={() => setIsHubOpen(false)}
        />
      )}
    </>
  );
};

export default MiniGamesButton;
