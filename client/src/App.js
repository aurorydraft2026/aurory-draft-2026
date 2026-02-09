import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { auth, db } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import HomePage from './pages/HomePage';
import TournamentPage from './pages/TournamentPage';
import './App.css';
import AdminPanel from './components/AdminPanel';

function App() {
  const [user, setUser] = useState(null);

  // Listen for authentication state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      // Ignore anonymous users
      if (currentUser && currentUser.isAnonymous) {
        setUser(null);
      } else {
        setUser(currentUser);
      }
    });

    return () => unsubscribe();
  }, []);

  // Track user's last seen timestamp for online visitor tracking
  useEffect(() => {
    // Only track for logged-in, non-anonymous users
    if (!user || user.isAnonymous) return;

    const updateLastSeen = async () => {
      try {
        const userRef = doc(db, 'users', user.uid);
        await updateDoc(userRef, {
          lastSeen: serverTimestamp()
        });
      } catch (error) {
        // Silently fail if user doc doesn't exist yet
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
        </Routes>
      </div>
    </Router>
  );
}

export default App;