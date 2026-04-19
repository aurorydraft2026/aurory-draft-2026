import React, { useState, useEffect, useCallback } from 'react';
import { getEquippedBannerStyle } from '../../services/cosmeticsService';
import { ref, onValue } from 'firebase/database';
import { doc, getDoc, collection, query, where, getCountFromServer } from 'firebase/firestore';
import { database, db } from '../../firebase';
import AvatarWithAura from '../AvatarWithAura';
import { resolveDisplayName } from '../../utils/userUtils';
import { useProfileModal } from '../../context/ProfileModalContext';
import './CondensedProfileModal.css';

/**
 * CondensedProfileModal - A privacy-first, high-density profile view
 * for raffle participants.
 */
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const CondensedProfileModal = ({ isOpen, onClose, user, joinedAt }) => {
  const { uid } = user || {};
  const { statsCache, updateStatsCache } = useProfileModal();
  const [pvpWins, setPvpWins] = useState(0);
  const [pvpRank, setPvpRank] = useState(null);
  const [wealthRank, setWealthRank] = useState(null);
  const [loading, setLoading] = useState(false);
  const [liveProfile, setLiveProfile] = useState(null);


  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      
      // 1. Fetch Daily PvP Wins & Rank from RTDB (Promisified)
      const pvpStats = await new Promise((resolve) => {
        const pvpRef = ref(database, `leaderboards/earnings/wins/pvp/daily/${today}`);
        onValue(pvpRef, (snapshot) => {
          const data = snapshot.val();
          if (data && data[uid]) {
            const userEntry = data[uid];
            const participants = Object.values(data);
            const higherScores = participants.filter(p => (p.score || 0) > (userEntry.score || 0)).length;
            resolve({ 
              wins: userEntry.score || 0, 
              rank: higherScores + 1 
            });
          } else {
            resolve({ wins: 0, rank: data ? '100+' : 'N/A' });
          }
        }, { onlyOnce: true });
      });

      setPvpWins(pvpStats.wins);
      setPvpRank(pvpStats.rank);

      // 2. Fetch Total Wealth Rank from Firestore (Total Valcoins)
      const userRef = doc(db, 'users', uid);
      const userSnap = await getDoc(userRef);
      
      if (userSnap.exists()) {
          const data = userSnap.data();
          setLiveProfile(data);
          const currentPoints = data.points || 0;
          const q = query(collection(db, 'users'), where('points', '>', currentPoints));
          const countSnap = await getCountFromServer(q);
          const wealth = countSnap.data().count + 1;
          setWealthRank(wealth);

          // 3. Update Cache
          updateStatsCache(uid, {
            pvpWins: pvpStats.wins,
            pvpRank: pvpStats.rank,
            wealthRank: wealth,
            liveProfile: data
          });
      } else {
          setWealthRank('N/A');
      }

    } catch (error) {
      console.error('Error loading profile statistics:', error);
    } finally {
      setTimeout(() => setLoading(false), 300); // Reduced delay
    }
  }, [uid, updateStatsCache]);

  useEffect(() => {
    if (isOpen && uid) {
      const cached = statsCache[uid];
      const now = Date.now();
      
      if (cached && (now - cached.timestamp < CACHE_TTL)) {
        // Use cached data
        setPvpWins(cached.pvpWins || 0);
        setPvpRank(cached.pvpRank || '...');
        setWealthRank(cached.wealthRank || '...');
        setLiveProfile(cached.liveProfile || null);
        setLoading(false);
      } else {
        // Refresh data
        setLiveProfile(null);
        loadStats();
      }
    }
  }, [isOpen, uid, loadStats, statsCache]);

  if (!isOpen) return null;

  const mergedUser = liveProfile ? { ...user, ...liveProfile } : user;
  const bannerStyle = getEquippedBannerStyle(mergedUser);
  const formattedDate = joinedAt 
    ? new Date(joinedAt).toLocaleDateString(undefined, { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }) 
    : 'Unknown';

  return (
    <div className="condensed-profile-overlay" onClick={onClose}>
      <div className="condensed-profile-card" onClick={e => e.stopPropagation()}>
        <div className="condensed-profile-header" style={bannerStyle}>
          <div className="header-overlay"></div>
          <button className="close-condensed-btn" onClick={onClose}>✕</button>
          
          <div className="header-content">
            <AvatarWithAura user={mergedUser} size={80} className="condensed-avatar" />
            <div className="header-text">
              <h2 className="condensed-name">{resolveDisplayName(mergedUser)}</h2>
              <div className="condensed-badges">
                {mergedUser.role === 'admin' && <span className="condensed-badge admin">ADMIN</span>}
                {mergedUser.isAurorian && <span className="condensed-badge aurorian">AURORIAN</span>}
              </div>
            </div>
          </div>
        </div>

        <div className="condensed-profile-body">
          <div className="info-grid">
            <div className="info-item">
              <span className="info-label">Aurory ID</span>
              <span className="info-value viking-highlight">{mergedUser.auroryPlayerId || 'Not Linked'}</span>
            </div>
            {joinedAt && (
              <div className="info-item">
                <span className="info-label">Joined Raffle</span>
                <span className="info-value">{formattedDate}</span>
              </div>
            )}
          </div>

          <div className="stats-divider">
            <span>Battle Statistics</span>
          </div>

          {loading ? (
            <div className="condensed-stats-loading">
              <div className="spinner-small"></div>
              <span>Fetching Records...</span>
            </div>
          ) : !loading ? (
            <div className="stats-row">
              <div className="stat-box">
                <span className="stat-label">Daily PvP Wins</span>
                <span className="stat-value">{pvpWins}</span>
              </div>
              <div className="stat-box">
                <span className="stat-label">Top Player #</span>
                <span className="stat-value viking-highlight">#{pvpRank || '...'}</span>
              </div>
              <div className="stat-box">
                <span className="stat-label">Wealth #</span>
                <span className="stat-value viking-highlight">#{wealthRank || '...'}</span>
              </div>
            </div>
          ) : (
            <div className="stats-empty">
              No battle records found.
            </div>
          )}
        </div>

        <div className="condensed-profile-footer">
          <p className="privacy-note">More details coming soon.</p>
        </div>
      </div>
    </div>
  );
};

export default CondensedProfileModal;
