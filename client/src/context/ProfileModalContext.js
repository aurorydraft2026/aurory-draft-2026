import React, { createContext, useContext, useState, useCallback } from 'react';
import CondensedProfileModal from '../components/profile/CondensedProfileModal';

const ProfileModalContext = createContext();

export function ProfileModalProvider({ children }) {
  const [selectedUser, setSelectedUser] = useState(null);
  const [isOpen, setIsOpen] = useState(false);
  const [statsCache, setStatsCache] = useState({});

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
      updateStatsCache
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
