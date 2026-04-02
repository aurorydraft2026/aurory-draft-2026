import React, { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../../firebase';
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

  // Don't show for anonymous/guest users
  if (!user) return null;

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
