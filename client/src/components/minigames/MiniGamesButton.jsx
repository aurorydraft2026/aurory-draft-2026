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
        className="viking-arcade-btn"
        onClick={() => setIsHubOpen(true)}
        id="mini-games-floating-btn"
      >
        <div className="viking-btn-inner">
          <svg className="viking-btn-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 22V12"/><path d="M12 12l8-4"/><path d="M12 12L4 8"/></svg>
          <span className="viking-btn-text">Asgard Trials</span>
        </div>
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
