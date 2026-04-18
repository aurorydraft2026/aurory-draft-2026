import React, { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import AvatarWithAura from '../AvatarWithAura';
import CondensedProfileModal from '../profile/CondensedProfileModal';
import { getEquippedBannerStyle, getAllCosmetics } from '../../services/cosmeticsService';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import './RaffleParticipantsModal.css';

const RaffleParticipantsModal = ({ raffleId, participants = [], onClose, isAdmin, onRemoveParticipant }) => {
  const [selectedParticipant, setSelectedParticipant] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);

  // Lazy migration for legacy participants (Admins only)
  const handleLazySync = useCallback(async () => {
    setIsSyncing(true);
    try {
      const updatedParticipants = await Promise.all(participants.map(async (p) => {
        // If already has snapshots or is mock, skip
        if (p.equippedCosmetics || p.isMock) return p;

        // Fetch latest user data
        const userRef = doc(db, 'users', p.uid);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists()) {
          const userData = userSnap.data();
          return {
            ...p,
            photoURL: userData.photoURL || p.photoURL || null,
            auroryProfilePicture: userData.auroryProfilePicture || null,
            equippedCosmetics: userData.equippedCosmetics || {},
            role: userData.role || 'user',
            isAurorian: userData.isAurorian || false
          };
        }
        return p;
      }));

      // Update the raffle document
      const raffleRef = doc(db, 'raffles', raffleId);
      await updateDoc(raffleRef, {
        participants: updatedParticipants
      });
      console.log('Successfully synced legacy raffle participants');
    } catch (error) {
      console.error('Failed to sync legacy participants:', error);
    } finally {
      setIsSyncing(false);
    }
  }, [participants, raffleId]);

  useEffect(() => {
    if (isAdmin && participants.length > 0 && raffleId) {
      const needsSync = participants.some(p => !p.equippedCosmetics && !p.isMock);
      if (needsSync && !isSyncing) {
        handleLazySync();
      }
    }
  }, [isAdmin, participants, raffleId, handleLazySync, isSyncing]);

  // Pre-fetch all cosmetics to ensure the cache is populated for banners/auras
  useEffect(() => {
    getAllCosmetics();
  }, []);

  // Helper to get active user data (current) vs snapshot
  // This allows old participants to show new cosmetics
  const [liveUserData, setLiveUserData] = useState({});
  
  useEffect(() => {
    if (participants.length > 0) {
      // Only fetch for participants who don't have snapshots
      const needsLiveFetch = participants.filter(p => !p.equippedCosmetics && !p.isMock);
      needsLiveFetch.forEach(async (p) => {
        // Optimization: check if already in liveUserData
        if (liveUserData[p.uid]) return;
        
        try {
          const userRef = doc(db, 'users', p.uid);
          const snap = await getDoc(userRef);
          if (snap.exists()) {
            setLiveUserData(prev => ({ 
              ...prev, 
              [p.uid]: { ...snap.data(), lastFetched: Date.now() } 
            }));
          }
        } catch (err) {
          console.error("Error fetching live participant data:", err);
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participants]);

  // Pre-calculate duplicates if admin
  const auroryIdCounts = isAdmin ? participants.reduce((acc, p) => {
    if (p.auroryPlayerId) {
      acc[p.auroryPlayerId] = (acc[p.auroryPlayerId] || 0) + 1;
    }
    return acc;
  }, {}) : {};

  return ReactDOM.createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="viking-modal participants-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="header-content">
            <h2 className="viking-modal-title">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: '10px', color: 'var(--accent-gold)'}}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
              Raffle Participants
            </h2>
            <p className="viking-modal-subtitle">
              Full list of current entries ({participants.length})
              {isSyncing && <span className="sync-status"> (Syncing Profile Data...)</span>}
            </p>
          </div>
          <button className="viking-modal-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        
        <div className="modal-body">
          <div className={`viking-grid-header ${isAdmin ? 'has-admin' : ''}`}>
            <span>RANK</span>
            <span style={{ paddingLeft: '40px' }}>PLAYER</span>
            <span>AURORY ID</span>
            <span>JOINED</span>
            {isAdmin && <span>ACTION</span>}
          </div>
          <div className="participants-scroll-area">
            {participants.length === 0 ? (
              <div className="no-participants">No participants yet. Be the first to join!</div>
            ) : (
              participants.map((p, i) => {
                const isDuplicate = isAdmin && p.auroryPlayerId && auroryIdCounts[p.auroryPlayerId] > 1;
                const isMock = isAdmin && (p.isMock || (p.uid && p.uid.startsWith('mock_')));
                const isFlagged = isDuplicate || isMock;
                const bannerStyle = getEquippedBannerStyle(p);

                return (
                  <div 
                    key={p.uid || i} 
                    className={`viking-participant-row ${isAdmin ? 'has-admin' : ''} ${isFlagged ? 'flagged' : ''} ${bannerStyle ? 'has-banner' : ''}`}
                    style={getEquippedBannerStyle(liveUserData[p.uid] || p)}
                    onClick={() => setSelectedParticipant(p)}
                  >
                    <span className="p-rank">#{i + 1}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div className="p-avatar-mini">
                        <AvatarWithAura user={liveUserData[p.uid] || p} size={28} />
                      </div>
                      <div className="p-name-col">
                        <span className="p-name">{p.playerName}</span>
                        {isDuplicate && <span className="sybil-warning">Duplicate Aurory ID</span>}
                        {isMock && <span className="sybil-warning" style={{ color: 'var(--accent-orange)' }}>Mock Participant</span>}
                      </div>
                    </div>
                    <span className="p-id">{p.auroryPlayerId || 'N/A'}</span>
                    <span className="p-date">
                      {new Date(p.joinedAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {isAdmin && (
                      <button 
                        className="viking-remove-btn" 
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveParticipant(p);
                        }}
                        title="Remove participant"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Condensed Profile Modal Overlay */}
        {selectedParticipant && (
          <CondensedProfileModal
            isOpen={!!selectedParticipant}
            onClose={() => setSelectedParticipant(null)}
            user={selectedParticipant}
            joinedAt={selectedParticipant.joinedAt}
          />
        )}
      </div>
    </div>,
    document.body
  );
};

export default RaffleParticipantsModal;
