import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { auth, db } from './firebase';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { useTheme } from './context/ThemeContext';
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
import { isStaff, isUserSuperAdmin } from './config/admins';
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

// 🛡️ Global Referral Singleton Lock (Outside component to survive all re-renders)
let activeReferralProcessing = null;

function App() {
  const [user, setUser] = useState(null);
  const [maintenance, setMaintenance] = useState({ enabled: false });
  const [loadingMaintenance, setLoadingMaintenance] = useState(true);
  const [referralSuccess, setReferralSuccess] = useState(null);
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

  // Theme Reset: Ensure non-superadmins are forced to dark mode
  const { theme, setTheme } = useTheme();
  useEffect(() => {
    // Only reset if theme is 'light' and user is not a superadmin
    // This also handles guests (user === null)
    if (theme === 'light' && !isUserSuperAdmin(user)) {
      console.log('🌙 Non-superadmin detected in light mode. Resetting to dark mode...');
      setTheme('dark');
    }
  }, [user, theme, setTheme]);

  // Maintenance Bypass Logic via URL parameter
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const testerParam = params.get('tester');
    
    if (testerParam === 'bypass') {
      console.log('🛡️ Maintenance bypass enabled via URL');
      localStorage.setItem('maintenance-bypass', 'true');
      // Clear parameter from URL without reloading
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (testerParam === 'clear') {
      console.log('🚫 Maintenance bypass cleared');
      localStorage.removeItem('maintenance-bypass');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // Central Referral Link Handling (Stabilized & Idempotent)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const refCode = params.get('ref');

    // 1. Exit early if no referral code or no authenticated user
    if (!user || !refCode) return;

    // 2. Clear URL parameters IMMEDIATELY to prevent loop triggers in subsequent re-renders
    const cleanUrl = window.location.pathname + window.location.search.replace(/[?&]ref=[^&]*/, '').replace(/^&/, '?');
    window.history.replaceState({}, document.title, cleanUrl);

    // 3. Persistent Guard: check if this specific user already attempted this specific code
    const storageKey = `ref_applied_${user.uid}_${refCode}`;
    if (localStorage.getItem(storageKey)) {
      console.log(`[Referral] Skipping detected link (already attempted for this user: ${refCode})`);
      return;
    }

    // 4. Memory Guard (Singleton): check if ANY referral is being processed in this session already
    if (activeReferralProcessing === refCode) {
      console.log(`[Referral] Guard blocked parallel attempt for code: ${refCode}`);
      return;
    }
    
    // Set the singleton lock
    activeReferralProcessing = refCode;
    console.log(`[Referral] 🔗 Starting process for code: ${refCode}`);
    localStorage.setItem(storageKey, 'processing');

    // 5. Trigger Cloud Function
    import('./services/tierService').then(({ applyReferralCode }) => {
      applyReferralCode(refCode).then(res => {
        if (res.success) {
          console.log(`[Referral] ✅ Successfully applied: ${refCode}`);
          localStorage.setItem(storageKey, 'success');
          // Replace blocking alert with state-based notification
          setReferralSuccess({ message: res.message, code: refCode });
        }
      }).catch(err => {
        // Suppress expected "already referred" status code (409) to keep console clean
        if (err.message?.includes('already have a referral') || err.code === 'already-exists') {
          console.log(`[Referral] User already has a referral linked. Marking as checked.`);
          localStorage.setItem(storageKey, 'already_set');
          return;
        }
        if (!err.message?.includes('Cannot use your own')) {
          console.error('[Referral] ❌ API Error:', err);
        }
      });
    }).catch(err => {
      console.error('[Referral] ❌ Module Load Error:', err);
    });
    
  }, [user]);

  const isBypassed = localStorage.getItem('maintenance-bypass') === 'true';

  if (!loadingMaintenance && maintenance.enabled && !isStaff(user) && !isBypassed) {
    return <MaintenancePage />;
  }

  return (
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

        {/* --- Referral Success Modal (Singleton Notification) --- */}
        {referralSuccess && (
          <div className="login-success-modal referral-success-modal" style={{ zIndex: 100000 }}>
             <div className="modal-body">
                <div className="success-icon-wrapper">
                    <span style={{ fontSize: '3rem' }}>🎉</span>
                </div>
                <h3>Referral Applied!</h3>
                <p>{referralSuccess.message}</p>
                <button 
                  className="btn-primary awesome-btn" 
                  onClick={() => setReferralSuccess(null)}
                >
                  Great!
                </button>
             </div>
          </div>
        )}
      </div>
    </Router>
  );
}

export default App;