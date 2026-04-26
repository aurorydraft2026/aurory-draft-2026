import React, { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db, database } from '../../firebase';
import { ref, onValue, set, onDisconnect } from 'firebase/database';
import { isSuperAdmin } from '../../config/admins';
import MiniGamesHub from './MiniGamesHub';
import './MiniGamesButton.css';

const MiniGamesButton = () => {
  const [isHubOpen, setIsHubOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [userPoints, setUserPoints] = useState(0);
  const [totalPlayers, setTotalPlayers] = useState(0);

  // Listen to auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser && !firebaseUser.isAnonymous) {
        setUser(firebaseUser);
      } else {
        setUser(null);
        setUserProfile(null);
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

  // Listen to user's profile and points in real time
  useEffect(() => {
    if (!user?.uid) return;

    const userRef = doc(db, 'users', user.uid);
    const unsub = onSnapshot(userRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setUserPoints(data.points || 0);

        // Only update profile state if essential display fields changed
        setUserProfile(prev => {
          if (!prev || prev.auroryPlayerName !== data.auroryPlayerName || prev.role !== data.role) {
            return data;
          }
          return prev;
        });
      }
    });

    return () => unsub();
  }, [user?.uid]);

  // Memoize the merged user object to keep it stable for sub-components
  const fullUser = React.useMemo(() => {
    if (!user) return null;
    return { ...user, ...userProfile };
  }, [user, userProfile]);

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

  // 1. Manage GLOBAL Minigame Presence (Active when logged in)
  useEffect(() => {
    if (!user?.uid) return;

    const presenceRef = ref(database, `mini_games/presence/${user.uid}`);
    
    const updatePresence = () => {
      set(presenceRef, Date.now()).catch(err => console.error("Presence write failed:", err));
    };

    // Initial update
    updatePresence();
    
    // Heartbeat every 30 seconds
    const heartbeat = setInterval(updatePresence, 30000);

    // Cleanup on disconnect or unmount
    onDisconnect(presenceRef).remove();
    
    return () => {
      clearInterval(heartbeat);
      set(presenceRef, null); 
    };
  }, [user?.uid]);

  // 2. Listen to total minigame presence
  useEffect(() => {
    const presenceRef = ref(database, 'mini_games/presence');
    const unsub = onValue(presenceRef, (snap) => {
      if (snap.exists()) {
        const data = snap.val();
        // Count entries that were active in the last 2 minutes
        const now = Date.now();
        const activeCount = Object.values(data).filter(lastActive => (now - lastActive) < 120000).length;
        console.log("Total MiniGame Players:", activeCount);
        setTotalPlayers(activeCount);
      } else {
        console.log("No MiniGame Players data found.");
        setTotalPlayers(0);
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
        {totalPlayers >= 0 && (
          <div className="viking-btn-badge" key={`count-${totalPlayers}`}>
            {totalPlayers}
          </div>
        )}
      </button>

      {isHubOpen && (
        <MiniGamesHub
          user={fullUser}
          userPoints={userPoints}
          onClose={() => setIsHubOpen(false)}
        />
      )}
    </>
  );
};

export default MiniGamesButton;
