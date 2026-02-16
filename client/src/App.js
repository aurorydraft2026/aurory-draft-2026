import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { auth, db } from './firebase';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { doc, updateDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import HomePage from './pages/HomePage';
import TournamentPage from './pages/TournamentPage';
import TermsPage from './pages/TermsPage';
import PrivacyPage from './pages/PrivacyPage';
import './App.css';
import AdminPanel from './components/AdminPanel';
import MaintenancePage from './components/MaintenancePage';
import { onSnapshot } from 'firebase/firestore';
import { isStaff } from './config/admins';

function App() {
  const [user, setUser] = useState(null);
  const [maintenance, setMaintenance] = useState({ enabled: false, message: '' });
  const [isStaffMember, setIsStaffMember] = useState(false);

  // Listen for authentication state changes and fetch extra user info
  useEffect(() => {
    let unsubscribeUserDoc = null;
    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        // Listen for user role/profile updates
        const userRef = doc(db, 'users', currentUser.uid);
        unsubscribeUserDoc = onSnapshot(userRef, (docSnap) => {
          if (docSnap.exists()) {
            const userData = docSnap.data();
            setUser(prev => ({ ...prev, ...userData }));
            setIsStaffMember(isStaff({ ...currentUser, ...userData }));
          } else {
            setIsStaffMember(isStaff(currentUser));
          }
        });
      } else {
        setUser(null);
        setIsStaffMember(false);
        if (unsubscribeUserDoc) unsubscribeUserDoc();
        // Automatically sign in anonymously if not logged in
        signInAnonymously(auth).catch((error) => {
          console.error("Error signing in anonymously:", error);
        });
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeUserDoc) unsubscribeUserDoc();
    };
  }, []);

  // Listen for maintenance status
  useEffect(() => {
    const maintenanceRef = doc(db, 'settings', 'maintenance');
    const unsubscribe = onSnapshot(maintenanceRef, (docSnap) => {
      if (docSnap.exists()) {
        setMaintenance(docSnap.data());
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
        {maintenance.enabled && !isStaffMember ? (
          <Routes>
            <Route path="*" element={<MaintenancePage message={maintenance.message} />} />
          </Routes>
        ) : (
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/tournament/:tournamentId" element={<TournamentPage />} />
            <Route path="/admin/panel" element={<AdminPanel />} />
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
          </Routes>
        )}
      </div>
    </Router>
  );
}

export default App;