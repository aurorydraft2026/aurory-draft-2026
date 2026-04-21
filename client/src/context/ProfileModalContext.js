import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import CondensedProfileModal from '../components/profile/CondensedProfileModal';

const ProfileModalContext = createContext();

export function ProfileModalProvider({ children }) {
  const [selectedUser, setSelectedUser] = useState(null);
  const [isOpen, setIsOpen] = useState(false);
  const [statsCache, setStatsCache] = useState({});
  const [viewerData, setViewerData] = useState(null);

  // Social state moved to context for stability
  const [likeCount, setLikeCount] = useState(0);
  const [commentCount, setCommentCount] = useState(0);
  const [liked, setLiked] = useState(false);

  // centralized social listener
  useEffect(() => {
    const uid = selectedUser?.uid;
    if (!isOpen || !uid) {
      setLikeCount(0);
      setCommentCount(0);
      setLiked(false);
      return;
    }

    const interactionRef = doc(db, 'profileInteractions', uid);
    
    // Add brief stabilization delay to resolve transient permission errors during auth transitions
    let unsub;
    const timer = setTimeout(() => {
      unsub = onSnapshot(interactionRef, (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setLikeCount(data.likeCount || 0);
          setCommentCount(data.commentCount || 0);
          const currentUid = auth.currentUser?.uid;
          setLiked(currentUid ? (data.likedBy || []).includes(currentUid) : false);
        } else {
          setLikeCount(0);
          setCommentCount(0);
          setLiked(false);
        }
      }, (err) => {
        console.warn('Profile Social Listener Error:', err);
      });
    }, 200);

    return () => {
      clearTimeout(timer);
      if (unsub) unsub();
    };
  }, [isOpen, selectedUser?.uid]);

  // Listener for viewer's own data to track unread notifications
  useEffect(() => {
    const unsubAuth = auth.onAuthStateChanged(user => {
      if (user && !user.isAnonymous) {
        return onSnapshot(doc(db, 'users', user.uid), (snap) => {
          if (snap.exists()) setViewerData(snap.data());
        });
      } else {
        setViewerData(null);
      }
    });
    return () => unsubAuth();
  }, []);

  const markCommentsAsRead = useCallback(async (count) => {
    const currentUser = auth.currentUser;
    if (!currentUser || currentUser.isAnonymous) return;
    try {
      await setDoc(doc(db, 'users', currentUser.uid), {
        lastSeenSocialCount: count
      }, { merge: true });
    } catch (err) {
      console.error('Error marking social as read:', err);
    }
  }, []);

  const updateStatsCache = useCallback((uid, data) => {
    setStatsCache(prev => ({
      ...prev,
      [uid]: {
        ...data,
        timestamp: Date.now()
      }
    }));
  }, []);

  const openProfile = useCallback((userData) => {
    if (!userData) return;
    
    // Normalize user data - various leaderboard formats use different ID keys
    const normalizedUser = {
      ...userData,
      uid: userData.uid || userData.id || userData.leader
    };
    
    if (!normalizedUser.uid) {
        console.warn('ProfileModal: No identifier found for user', userData);
        return;
    }

    setSelectedUser(normalizedUser);
    setIsOpen(true);
  }, []);

  const closeProfile = useCallback(() => {
    setIsOpen(false);
    // Keep user state briefly to avoid content flashing during transition
    setTimeout(() => setSelectedUser(null), 300);
  }, []);

  return (
    <ProfileModalContext.Provider value={{ 
      openProfile, 
      closeProfile, 
      selectedUser, 
      isOpen,
      statsCache,
      updateStatsCache,
      // Social stats
      likeCount,
      commentCount,
      liked,
      // Viewer specific
      viewerData,
      markCommentsAsRead
    }}>
      {children}
      {selectedUser && (
        <CondensedProfileModal
          isOpen={isOpen}
          onClose={closeProfile}
          user={selectedUser}
          joinedAt={selectedUser.joinedAt}
        />
      )}
    </ProfileModalContext.Provider>
  );
}

export function useProfileModal() {
  const context = useContext(ProfileModalContext);
  if (!context) {
    throw new Error('useProfileModal must be used within a ProfileModalProvider');
  }
  return context;
}
