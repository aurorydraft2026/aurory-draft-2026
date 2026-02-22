import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { auth, db } from './firebase';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { doc, updateDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import HomePage from './pages/HomePage';
import TournamentPage from './pages/TournamentPage';
import TermsPage from './pages/TermsPage';
import PrivacyPage from './pages/PrivacyPage';
import MatchupPage from './pages/MatchupPage';
import './App.css';
import AdminPanel from './components/AdminPanel';

function App() {
  const [user, setUser] = useState(null);

  // Listen for authentication state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
      } else {
        // Automatically sign in anonymously if not logged in
        signInAnonymously(auth).catch((error) => {
          console.error("Error signing in anonymously:", error);
        });
      }
    });

    return () => unsubscribe();
  }, []);

  // Track user's last seen timestamp for online visitor tracking
  useEffect(() => {
    // Track for all users (logged-in or anonymous)
    if (!user) return;

    const updateLastSeen = async () => {
      try {
        const userRef = doc(db, 'users', user.uid);

        // Use setDoc with merge for anonymous users to ensure doc exists
        if (user.isAnonymous) {
          await setDoc(userRef, {
            id: user.uid,
            lastSeen: serverTimestamp(),
            isAnonymous: true,
            displayName: 'Guest',
            createdAt: serverTimestamp() // Only sets if doc is new
          }, { merge: true });
        } else {
          // For registered users, just update lastSeen
          await updateDoc(userRef, {
            lastSeen: serverTimestamp()
          });
        }
      } catch (error) {
        console.error('Error updating lastSeen:', error);
      }
    };

    // Update immediately when user loads any page
    updateLastSeen();

    // Update every 2 minutes while user is on the site
    const interval = setInterval(updateLastSeen, 2 * 60 * 1000);

    // Cleanup interval on unmount or user change
    return () => clearInterval(interval);
  }, [user]);

  return (
    <Router>
      <div className="App">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/tournament/:tournamentId" element={<TournamentPage />} />
          <Route path="/admin/panel" element={<AdminPanel />} />
          <Route path="/matchup/:matchupId" element={<MatchupPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;