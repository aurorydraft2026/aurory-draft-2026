import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import ReactDOM from 'react-dom';
import AvatarWithAura from '../AvatarWithAura';
import { useProfileModal } from '../../context/ProfileModalContext';
import { getEquippedBannerStyle, getAllCosmetics } from '../../services/cosmeticsService';
import { doc, getDoc, updateDoc, collection, query, where, documentId, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import './RaffleParticipantsModal.css';

// Persistence Cache (outside component scope to persist between modal opens/closes)
const PARTICIPANT_CACHE = {};

const RaffleParticipantsModal = ({ raffleId, participants = [], currentUser, onClose, isAdmin, onRemoveParticipant }) => {
  const { openProfile } = useProfileModal();
  const [isSyncing, setIsSyncing] = useState(false);
  const hasSynced = useRef(false);

  // Persistence Cache (survives modal unmounts to prevent flickers)
  const [liveUserData, setLiveUserData] = useState(() => {
    // Initialize with only relevant participants from global cache
    const initial = {};
    if (participants && participants.length > 0) {
      participants.forEach(p => {
        if (PARTICIPANT_CACHE[p.uid]) {
          initial[p.uid] = PARTICIPANT_CACHE[p.uid];
        }
      });
    }
    return initial;
  });

  // Lazy migration for legacy participants (Admins only)
  const handleLazySync = useCallback(async () => {
    if (hasSynced.current) return;
    hasSynced.current = true;
    setIsSyncing(true);
    try {
      const updatedParticipants = await Promise.all(participants.map(async (p) => {
        const ec = p.equippedCosmetics;
        const hasRealCosmetics = ec && Object.keys(ec).filter(k => ec[k]).length > 0;
        if (hasRealCosmetics || p.isMock) return p;

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

      const raffleRef = doc(db, 'raffles', raffleId);
      await updateDoc(raffleRef, {
        participants: updatedParticipants
      });
      console.log('[RaffleModal] Successfully synced legacy raffle participants');
    } catch (error) {
      console.error('[RaffleModal] Failed to sync legacy participants:', error);
      hasSynced.current = false;
    } finally {
      setIsSyncing(false);
    }
  }, [participants, raffleId]);

  useEffect(() => {
    if (isAdmin && participants.length > 0 && raffleId && !hasSynced.current) {
      const needsSync = participants.some(p => {
        if (p.isMock) return false;
        const ec = p.equippedCosmetics;
        return !ec || Object.keys(ec).filter(k => ec[k]).length === 0;
      });
      if (needsSync && !isSyncing) {
        handleLazySync();
      }
    }
  }, [isAdmin, participants, raffleId, handleLazySync, isSyncing]);

  // Pre-fetch all cosmetics
  const [cosmeticsReady, setCosmeticsReady] = useState(false);
  useEffect(() => {
    let mounted = true;
    getAllCosmetics().then(() => {
      if (mounted) setCosmeticsReady(true);
    });
    return () => { mounted = false; };
  }, []);

// Pre-calculate which participants need a fresh fetch
  const needsFreshFetch = useMemo(() => {
    const now = Date.now();
    return participants.filter(p => {
      if (p.isMock) return false;
      
      // Always fetch current user live to ensure immediate updates after Armory changes
      if (currentUser && p.uid === currentUser.uid) return true;

      const cached = PARTICIPANT_CACHE[p.uid];
      // Fetch if not in cache OR if cache is older than 5 minutes
      return !cached || (now - (cached.lastFetched || 0)) > 300000;
    });
  }, [participants, currentUser]);

  const hasLoadedLive = useRef(false);
  
  useEffect(() => {
    if (needsFreshFetch.length === 0 || hasLoadedLive.current) return;
    
    const fetchParticipantsLive = async () => {
      hasLoadedLive.current = true;

      try {
        const uids = needsFreshFetch.map(p => p.uid);
        const results = {};
        const batchPromises = [];
        for (let i = 0; i < uids.length; i += 30) {
          const batch = uids.slice(i, i + 30);
          batchPromises.push(
            getDocs(query(collection(db, 'users'), where(documentId(), 'in', batch)))
          );
        }
        
        const snapshots = await Promise.all(batchPromises);
        snapshots.forEach(snap => {
          snap.forEach(doc => {
            const data = doc.data();
            results[doc.id] = { 
              equippedCosmetics: data.equippedCosmetics,
              auroryProfilePicture: data.auroryProfilePicture,
              auroryPlayerName: data.auroryPlayerName,
              displayName: data.displayName,
              photoURL: data.photoURL,
              isAurorian: data.isAurorian,
              lastFetched: Date.now() 
            };
          });
        });

        // Update both local state and global cache
        setLiveUserData(prev => {
          const newState = { ...prev, ...results };
          Object.assign(PARTICIPANT_CACHE, results); // Update global cache too
          return newState;
        });
      } catch (err) {
        console.error("[RaffleModal] Live fetch error:", err);
        hasLoadedLive.current = false;
      }
    };

    fetchParticipantsLive();
  }, [needsFreshFetch]);

  // Pre-calculate duplicates
  const auroryIdCounts = useMemo(() => {
    if (!isAdmin) return {};
    return participants.reduce((acc, p) => {
      if (p.auroryPlayerId) {
        acc[p.auroryPlayerId] = (acc[p.auroryPlayerId] || 0) + 1;
      }
      return acc;
    }, {});
  }, [isAdmin, participants]);

  // Memoize participant rows to stabilize rendering and fix data merging
  const memoizedParticipants = useMemo(() => {
    return participants.map((p, i) => {
      const isDuplicate = isAdmin && p.auroryPlayerId && auroryIdCounts[p.auroryPlayerId] > 1;
      const isMock = isAdmin && (p.isMock || (p.uid && p.uid.startsWith('mock_')));
      const isFlagged = isDuplicate || isMock;
      
      const liveData = liveUserData[p.uid] || {};
      
      // If this is the current user, priority is: Prop > LiveCache > Snapshot
      const isSelf = currentUser && p.uid === currentUser.uid;
      const mergedUser = {
        ...p,
        ...liveData,
        ...(isSelf ? currentUser : {}), // Priority to reactive user object from App state
        equippedCosmetics: (isSelf ? currentUser.equippedCosmetics : null) || liveData.equippedCosmetics || p.equippedCosmetics || {}
      };

      const bannerStyle = cosmeticsReady ? getEquippedBannerStyle(mergedUser) : null;
      const hasBanner = bannerStyle && Object.keys(bannerStyle).length > 0;

      return {
        ...mergedUser,
        isFlagged,
        isDuplicate,
        isMock,
        bannerStyle,
        hasBanner,
        rank: i + 1
      };
    });
  }, [participants, liveUserData, cosmeticsReady, isAdmin, auroryIdCounts, currentUser]);

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
            {memoizedParticipants.length === 0 ? (
              <div className="no-participants">No participants yet. Be the first to join!</div>
            ) : (
              memoizedParticipants.map((p) => (
                <div 
                  key={p.uid || p.rank} 
                  className={`viking-participant-row interactive ${isAdmin ? 'has-admin' : ''} ${p.isFlagged ? 'flagged' : ''} ${p.hasBanner ? 'has-banner' : ''}`}
                  style={p.bannerStyle || {}}
                  onClick={() => openProfile(p)}
                >
                  <span className="p-rank">#{p.rank}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div className="p-avatar-mini">
                      <AvatarWithAura user={p} size={28} />
                    </div>
                    <div className="p-name-col">
                      <span className="p-name">{p.playerName}</span>
                      {p.isDuplicate && <span className="sybil-warning">Duplicate Aurory ID</span>}
                      {p.isMock && <span className="sybil-warning" style={{ color: 'var(--accent-orange)' }}>Mock Participant</span>}
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
              ))
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default RaffleParticipantsModal;
