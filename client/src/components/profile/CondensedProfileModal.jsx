import React, { useState, useEffect, useCallback } from 'react';
import { fetchPlayerMatches, calculateOverallStats } from '../../services/auroryProfileService';
import { getEquippedBannerStyle } from '../../services/cosmeticsService';
import AvatarWithAura from '../AvatarWithAura';
import { resolveDisplayName } from '../../utils/userUtils';
import './CondensedProfileModal.css';

/**
 * CondensedProfileModal - A privacy-first, high-density profile view
 * for raffle participants.
 */
const CondensedProfileModal = ({ isOpen, onClose, user, joinedAt }) => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);

  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      const matches = await fetchPlayerMatches(user.auroryPlayerId);
      if (matches && matches.matches?.data) {
        const processedMatches = matches.matches.data.map(m => ({
          result: m.result,
          duration: m.data?.duration
        }));
        setStats(calculateOverallStats(processedMatches));
      }
    } catch (error) {
      console.error('Error loading public stats:', error);
    } finally {
      setLoading(false);
    }
  }, [user?.auroryPlayerId]);

  useEffect(() => {
    if (isOpen && user?.auroryPlayerId) {
      loadStats();
    }
  }, [isOpen, user?.auroryPlayerId, loadStats]);

  if (!isOpen) return null;

  const bannerStyle = getEquippedBannerStyle(user);
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
            <AvatarWithAura user={user} size={80} className="condensed-avatar" />
            <div className="header-text">
              <h2 className="condensed-name">{resolveDisplayName(user)}</h2>
              <div className="condensed-badges">
                {user.role === 'admin' && <span className="condensed-badge admin">ADMIN</span>}
                {user.isAurorian && <span className="condensed-badge aurorian">AURORIAN</span>}
              </div>
            </div>
          </div>
        </div>

        <div className="condensed-profile-body">
          <div className="info-grid">
            <div className="info-item">
              <span className="info-label">Aurory ID</span>
              <span className="info-value highlight">{user.auroryPlayerId || 'Not Linked'}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Joined Raffle</span>
              <span className="info-value">{formattedDate}</span>
            </div>
          </div>

          <div className="stats-divider">
            <span>Battle Statistics</span>
          </div>

          {loading ? (
            <div className="condensed-stats-loading">
              <div className="spinner-small"></div>
              <span>Fetching Records...</span>
            </div>
          ) : stats ? (
            <div className="stats-row">
              <div className="stat-box">
                <span className="stat-label">Matches</span>
                <span className="stat-value">{stats.totalMatches}</span>
              </div>
              <div className="stat-box">
                <span className="stat-label">Win Rate</span>
                <span className="stat-value highlight">{stats.winRate}%</span>
              </div>
              <div className="stat-box">
                <span className="stat-label">Avg Duration</span>
                <span className="stat-value">{Math.round(stats.avgMatchDuration / 60)}m</span>
              </div>
            </div>
          ) : (
            <div className="stats-empty">
              No battle records found for this player.
            </div>
          )}
        </div>

        <div className="condensed-profile-footer">
          <p className="privacy-note">Only public combat data and raffle entry dates are shown.</p>
        </div>
      </div>
    </div>
  );
};

export default CondensedProfileModal;
