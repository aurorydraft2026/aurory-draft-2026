import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { auth, db } from './firebase';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { ThemeProvider } from './context/ThemeContext';
import HomePage from './pages/HomePage';
import TournamentPage from './pages/TournamentPage';
import TermsPage from './pages/TermsPage';
import PrivacyPage from './pages/PrivacyPage';
import MatchupPage from './pages/MatchupPage';
import Footer from './components/Footer';
import './App.css';
import RafflePage from './pages/RafflePage';
import RafflesListingPage from './pages/RafflesListingPage';
import AdminPanel from './components/AdminPanel';
import MaintenancePage from './pages/MaintenancePage';
import MiniGamesButton from './components/minigames/MiniGamesButton';
import GlobalWinNotifier from './components/minigames/GlobalWinNotifier';
import { isStaff } from './config/admins';
import { doc, onSnapshot, updateDoc, serverTimestamp, setDoc } from 'firebase/firestore';

function MaintenanceWarningBanner({ message, onDismiss }) {
  return (
    <div className="maintenance-warning-banner">
      <div className="maintenance-warning-content">
        <span>{message}</span>
      </div>
      <button className="maintenance-warning-close" onClick={onDismiss} title="Dismiss warning">
        ✕
      </button>
    </div>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [maintenance, setMaintenance] = useState({ enabled: false });
  const [loadingMaintenance, setLoadingMaintenance] = useState(true);
  const [isWarningDismissed, setIsWarningDismissed] = useState(
    sessionStorage.getItem('maintenance-warning-dismissed') === 'true'
  );

  const handleDismissWarning = () => {
    setIsWarningDismissed(true);
    sessionStorage.setItem('maintenance-warning-dismissed', 'true');
  };

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

  // Listen for maintenance mode
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'maintenance'), (docSnap) => {
      if (docSnap.exists()) {
        setMaintenance(docSnap.data());
      }
      setLoadingMaintenance(false);
    }, (error) => {
      console.error("Error fetching maintenance settings:", error);
      setLoadingMaintenance(false);
    });

    return () => unsub();
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

  if (!loadingMaintenance && maintenance.enabled && !isStaff(user)) {
    return <MaintenancePage />;
  }

  return (
    <ThemeProvider>
      <Router>
        <div className="App">
          {maintenance.warningEnabled && !maintenance.enabled && !isWarningDismissed && (
            <MaintenanceWarningBanner 
              message={maintenance.warningText} 
              onDismiss={handleDismissWarning} 
            />
          )}
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/tournament/:tournamentId" element={<TournamentPage />} />
            <Route path="/admin/panel" element={<AdminPanel />} />
            <Route path="/matchup/:matchupId" element={<MatchupPage />} />
            <Route path="/raffles" element={<RafflesListingPage />} />
            <Route path="/raffle/:id" element={<RafflePage />} />
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            {/* Fallback for maintenance page if someone tries to access directly */}
            <Route path="/maintenance" element={<MaintenancePage />} />
          </Routes>
          <Footer />
          <MiniGamesButton />
          <GlobalWinNotifier />
        </div>
      </Router>
    </ThemeProvider>
  );
}

export default App;