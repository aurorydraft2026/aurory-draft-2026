// AuroryAccountLink.jsx
// Component for linking Aurory game account and displaying player stats
// Uses /v1/me endpoint data for verification

import React, { useState, useEffect, useCallback } from 'react';
import {
  validateAuroryAccount,
  linkAuroryAccount,
  unlinkAuroryAccount,
  getLinkedAuroryAccount,
  getCachedMatchHistory,
  calculateAmikoStats,
  calculateOverallStats,
  clearCache
} from '../services/auroryProfileService';
import { ELEMENTS, getAmikoByName } from '../data/amikos';

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function AuroryAccountLink({ user, isOpen, onClose }) {
  const [linkedAccount, setLinkedAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState(null);

  const [searchInput, setSearchInput] = useState('');

  // Stats state
  const [matches, setMatches] = useState([]);
  const [amikoStats, setAmikoStats] = useState([]);
  const [overallStats, setOverallStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // Tab state
  const [activeTab, setActiveTab] = useState('overview'); // 'overview', 'matches', 'amikos'
  const [scanProgress, setScanProgress] = useState(null);

  const loadStats = async (playerId, forceRefresh = false) => {
    setStatsLoading(true);
    setScanProgress(null);
    try {
      const matchHistory = await getCachedMatchHistory(playerId, forceRefresh, (progress) => {
        setScanProgress(progress);
      });
      setMatches(matchHistory);
      setAmikoStats(calculateAmikoStats(matchHistory));
      setOverallStats(calculateOverallStats(matchHistory));
    } catch (err) {
      console.error('Error loading stats:', err);
    } finally {
      setStatsLoading(false);
      setScanProgress(null);
    }
  };

  const loadLinkedAccount = useCallback(async () => {
    if (!user) return;

    setLoading(true);
    try {
      const account = await getLinkedAuroryAccount(user.uid);
      setLinkedAccount(account);

      if (account) {
        loadStats(account.playerId);
      }
    } catch (err) {
      console.error('Error loading linked account:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Load linked account on mount
  useEffect(() => {
    if (user && isOpen) {
      loadLinkedAccount();
    }
  }, [user, isOpen, loadLinkedAccount]);

  const handleSearchAndLink = async () => {
    if (!searchInput.trim()) {
      setError('Please enter an Aurory Player ID (e.g. p-123)');
      return;
    }

    setLinking(true);
    setError(null);

    try {
      const validation = await validateAuroryAccount(searchInput.trim());

      if (!validation.valid) {
        setError(validation.error || 'Could not find an account with that ID');
        setLinking(false);
        return;
      }

      // Link the account
      const result = await linkAuroryAccount(user.uid, {
        playerId: validation.playerId,
        playerName: validation.playerName,
        wallet: validation.wallet,
        profilePicture: validation.profilePicture || null
      });

      if (result.success) {
        setLinkedAccount({
          playerId: validation.playerId,
          playerName: validation.playerName,
          wallet: validation.wallet,
          profilePicture: validation.profilePicture || null,
          linkedAt: new Date()
        });
        setSearchInput('');
        loadStats(validation.playerId);
      } else {
        setError(result.error || 'Failed to link account');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLinking(false);
    }
  };


  const handleUnlink = async () => {
    if (!window.confirm('Are you sure you want to unlink your Aurory account?')) {
      return;
    }

    try {
      const result = await unlinkAuroryAccount(user.uid);
      if (result.success) {
        if (linkedAccount?.playerId) {
          clearCache(linkedAccount.playerId);
        }
        setLinkedAccount(null);
        setMatches([]);
        setAmikoStats([]);
        setOverallStats(null);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRefresh = () => {
    if (linkedAccount?.playerId) {
      clearCache(linkedAccount.playerId);
      loadStats(linkedAccount.playerId, true);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="aurory-modal-overlay" onClick={onClose}>
      <div className="aurory-modal" onClick={e => e.stopPropagation()}>
        <button className="aurory-modal-close" onClick={onClose}>×</button>

        <div className="aurory-modal-header">
          <img src="/aurory-logo.png" alt="Aurory" className="aurory-logo" onError={(e) => e.target.style.display = 'none'} />
          <h2>Aurory Account</h2>
          <p>Connect your game account to track stats and verify matches</p>
        </div>

        {loading ? (
          <div className="aurory-loading">
            <div className="spinner"></div>
            <p>Loading...</p>
          </div>
        ) : linkedAccount ? (
          // Linked Account View
          <div className="aurory-linked-view">
            {/* Account Info Bar */}
            <div className="aurory-account-bar">
              <div className="account-info">
                <span className="account-label">Connected as</span>
                <span className="account-name">{linkedAccount.playerName}</span>
                <span className="account-id">{linkedAccount.playerId}</span>
              </div>
              <div className="account-actions">
                <button className="refresh-btn" onClick={handleRefresh} disabled={statsLoading}>
                  🔄 {statsLoading ? 'Syncing...' : 'Refresh'}
                </button>
                <button className="unlink-btn" onClick={handleUnlink}>
                  Unlink
                </button>
              </div>
            </div>

            {/* Tabs */}
            <div className="aurory-tabs">
              <button
                className={`tab ${activeTab === 'overview' ? 'active' : ''}`}
                onClick={() => setActiveTab('overview')}
              >
                Overview
              </button>
              <button
                className={`tab ${activeTab === 'matches' ? 'active' : ''}`}
                onClick={() => setActiveTab('matches')}
              >
                Match History
              </button>
              <button
                className={`tab ${activeTab === 'amikos' ? 'active' : ''}`}
                onClick={() => setActiveTab('amikos')}
              >
                Amiko Stats
              </button>
            </div>

            {/* Tab Content */}
            <div className="aurory-tab-content">
              {activeTab === 'overview' && (
                <OverviewTab stats={overallStats} loading={statsLoading} scanProgress={scanProgress} />
              )}
              {activeTab === 'matches' && (
                <MatchesTab matches={matches} loading={statsLoading} scanProgress={scanProgress} />
              )}
              {activeTab === 'amikos' && (
                <AmikosTab stats={amikoStats} loading={statsLoading} />
              )}
            </div>
          </div>
        ) : (
          // Link Account View with Verification
          <div className="aurory-link-view">
            <div className="method-content">
              <p className="method-desc">Enter your **Aurory Player ID** (e.g., p-12345) to link your in-game profile. Each ID can only be linked to one account.</p>
              <div className="search-input-group">
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Aurory ID (e.g. p-12345)"
                  className="link-input"
                />
                <button
                  className="link-btn"
                  onClick={handleSearchAndLink}
                  disabled={linking || !searchInput.trim()}
                >
                  {linking ? 'Searching...' : 'Link Profile'}
                </button>
              </div>
              {error && <div className="link-error">{error}</div>}
            </div>
          </div>
        )}

        <style>{auroryModalStyles}</style>
      </div>
    </div>
  );
}

// ============================================================================
// TAB COMPONENTS
// ============================================================================

function OverviewTab({ stats, loading, scanProgress }) {
  if (loading) {
    return (
      <div className="tab-loading">
        <div className="spinner"></div>
        {scanProgress && (
          <div className="scan-progress">
            Scanning page {scanProgress.currentPage} of {scanProgress.totalPages}...
            {scanProgress.matchesFound > 0 && ` (${scanProgress.matchesFound} found)`}
          </div>
        )}
      </div>
    );
  }

  if (!stats) {
    return <div className="tab-empty">No match data available</div>;
  }

  return (
    <div className="overview-grid">
      <div className="stat-card highlight">
        <span className="stat-value">{stats.winRate}%</span>
        <span className="stat-label">Win Rate</span>
      </div>
      <div className="stat-card">
        <span className="stat-value">{stats.totalMatches}</span>
        <span className="stat-label">Total Matches</span>
      </div>
      <div className="stat-card wins">
        <span className="stat-value">{stats.wins}</span>
        <span className="stat-label">Wins</span>
      </div>
      <div className="stat-card losses">
        <span className="stat-value">{stats.losses}</span>
        <span className="stat-label">Losses</span>
      </div>
      <div className="stat-card">
        <span className="stat-value">{stats.uniqueOpponents}</span>
        <span className="stat-label">Unique Opponents</span>
      </div>
      <div className="stat-card">
        <span className="stat-value">{stats.uniqueAmikos}</span>
        <span className="stat-label">Amikos Used</span>
      </div>
      <div className="stat-card wide">
        <span className="stat-value">{formatDuration(stats.avgMatchDuration)}</span>
        <span className="stat-label">Avg Match Duration</span>
      </div>
    </div>
  );
}

function MatchesTab({ matches, loading, scanProgress }) {
  if (loading) {
    return (
      <div className="tab-loading">
        <div className="spinner"></div>
        {scanProgress && (
          <div className="scan-progress">
            Scanning page {scanProgress.currentPage} of {scanProgress.totalPages}...
            {scanProgress.matchesFound > 0 && ` (${scanProgress.matchesFound} found)`}
          </div>
        )}
      </div>
    );
  }

  if (!matches.length) {
    return <div className="tab-empty">No private matches found</div>;
  }

  return (
    <div className="matches-list">
      {[...matches]
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, 50)
        .map((match, index) => (
          <div key={index} className={`match-row ${match.result}`}>
            <div className="match-result">
              {match.result === 'win' ? '🏆' : '💀'}
            </div>
            <div className="match-info">
              <div className="match-opponent">vs {match.opponent?.name || 'Unknown'}</div>
              <div className="match-meta">
                {formatDate(match.timestamp)}
                {match.battleCode && <span className="battle-code">Code: {match.battleCode}</span>}
              </div>
            </div>
            <div className="match-amikos">
              {match.playerAmikos?.map((name, i) => {
                const amiko = getAmikoByName(name);
                return (
                  <div key={i} className="mini-amiko" title={name}>
                    {amiko ? (
                      <img src={amiko.image} alt={name} />
                    ) : (
                      <span>{name.charAt(0)}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
    </div>
  );
}

function AmikosTab({ stats, loading }) {
  if (loading) {
    return <div className="tab-loading"><div className="spinner"></div></div>;
  }

  if (!stats.length) {
    return <div className="tab-empty">No Amiko data available</div>;
  }

  return (
    <div className="amiko-stats-list">
      {stats.map((stat, index) => {
        const amiko = getAmikoByName(stat.name);
        const element = amiko?.element;
        const elementConfig = element ? ELEMENTS[element] : null;

        return (
          <div key={index} className="amiko-stat-row">
            <div className="amiko-info">
              {amiko ? (
                <img src={amiko.image} alt={stat.name} className="amiko-img" />
              ) : (
                <div className="amiko-placeholder">{stat.name.charAt(0)}</div>
              )}
              <div className="amiko-details">
                <span className="amiko-name">{stat.name}</span>
                {elementConfig && (
                  <span className="amiko-element" style={{ color: elementConfig.color }}>
                    {elementConfig.icon} {element}
                  </span>
                )}
              </div>
            </div>
            <div className="amiko-record">
              <div className="win-rate" style={{
                color: stat.winRate >= 50 ? '#10b981' : '#ef4444'
              }}>
                {stat.winRate}%
              </div>
              <div className="record-detail">
                <span className="wins">{stat.wins}W</span>
                <span className="separator">-</span>
                <span className="losses">{stat.losses}L</span>
              </div>
              <div className="games-played">{stat.totalGames} games</div>
            </div>
            <div className="win-bar">
              <div
                className="win-fill"
                style={{ width: `${stat.winRate}%` }}
              ></div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function formatDuration(seconds) {
  if (!seconds) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// ============================================================================
// STYLES
// ============================================================================

const auroryModalStyles = `
.aurory-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.aurory-modal {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  border-radius: 20px;
  width: 100%;
  max-width: 600px;
  max-height: 85vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  position: relative;
  border: 1px solid rgba(102, 126, 234, 0.3);
}

.aurory-modal-close {
  position: absolute;
  top: 16px;
  right: 16px;
  background: rgba(255, 255, 255, 0.1);
  border: none;
  color: white;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  cursor: pointer;
  font-size: 1.5rem;
  line-height: 1;
  z-index: 10;
  transition: background 0.2s;
}

.aurory-modal-close:hover {
  background: rgba(255, 255, 255, 0.2);
}

.aurory-modal-header {
  padding: 32px 32px 24px;
  text-align: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.aurory-logo {
  width: 60px;
  height: 60px;
  margin-bottom: 12px;
}

.aurory-modal-header h2 {
  margin: 0 0 8px;
  font-size: 1.5rem;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.aurory-modal-header p {
  margin: 0;
  color: rgba(255, 255, 255, 0.6);
  font-size: 0.9rem;
}

.aurory-loading {
  padding: 60px;
  text-align: center;
}

.aurory-loading .spinner {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(102, 126, 234, 0.2);
  border-top-color: #667eea;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 16px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Link View */
.aurory-link-view {
  padding: 24px 32px 32px;
}


.method-desc {
  color: rgba(255, 255, 255, 0.6);
  font-size: 0.9rem;
  margin-bottom: 16px;
  line-height: 1.5;
}

.search-input-group {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.input-field-wrapper {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.input-field-wrapper label {
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.5);
  font-weight: 500;
  margin-left: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.link-input {
  width: 100%;
  padding: 14px 16px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  color: white;
  font-size: 1rem;
  font-family: monospace;
  box-sizing: border-box;
}

.link-input:focus {
  outline: none;
  border-color: #667eea;
}

.link-input::placeholder {
  color: rgba(255, 255, 255, 0.3);
}

.link-error {
  background: rgba(239, 68, 68, 0.2);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #fca5a5;
  padding: 12px;
  border-radius: 8px;
  font-size: 0.9rem;
}

.link-btn {
  padding: 14px 24px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border: none;
  border-radius: 10px;
  color: white;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.link-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 20px rgba(102, 126, 234, 0.4);
}

.link-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}


/* Linked View */
.aurory-linked-view {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.aurory-account-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  background: rgba(16, 185, 129, 0.1);
  border-bottom: 1px solid rgba(16, 185, 129, 0.2);
}

.account-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.account-label {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.5);
  text-transform: uppercase;
}

.account-name {
  font-weight: 600;
  color: #6ee7b7;
}

.account-id {
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.5);
  font-family: monospace;
}

.account-actions {
  display: flex;
  gap: 8px;
}

.refresh-btn, .unlink-btn {
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.2s;
}

.refresh-btn {
  background: rgba(102, 126, 234, 0.2);
  border: 1px solid rgba(102, 126, 234, 0.3);
  color: #a5b4fc;
}

.refresh-btn:hover:not(:disabled) {
  background: rgba(102, 126, 234, 0.3);
}

.refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.unlink-btn {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.2);
  color: #fca5a5;
}

.unlink-btn:hover {
  background: rgba(239, 68, 68, 0.2);
}

/* Tabs */
.aurory-tabs {
  display: flex;
  padding: 0 24px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.aurory-tabs .tab {
  padding: 14px 20px;
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  position: relative;
  transition: color 0.2s;
}

.aurory-tabs .tab:hover {
  color: rgba(255, 255, 255, 0.8);
}

.aurory-tabs .tab.active {
  color: white;
}

.aurory-tabs .tab.active::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

/* Tab Content */
.aurory-tab-content {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.tab-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  gap: 12px;
}

.tab-loading .spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(102, 126, 234, 0.2);
  border-top-color: #667eea;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

.scan-progress {
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.8rem;
  text-align: center;
}

.tab-empty {
  text-align: center;
  padding: 40px;
  color: rgba(255, 255, 255, 0.4);
}

/* Overview Tab */
.overview-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

.stat-card {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  padding: 20px;
  text-align: center;
}

.stat-card.highlight {
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.2) 0%, rgba(118, 75, 162, 0.2) 100%);
  grid-column: span 2;
}

.stat-card.wide {
  grid-column: span 2;
}

.stat-card.wins .stat-value {
  color: #6ee7b7;
}

.stat-card.losses .stat-value {
  color: #fca5a5;
}

.stat-value {
  display: block;
  font-size: 2rem;
  font-weight: 700;
  color: white;
  margin-bottom: 4px;
}

.stat-card.highlight .stat-value {
  font-size: 3rem;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.stat-label {
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.5);
}

/* Matches Tab */
.matches-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.match-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 16px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 12px;
  border-left: 3px solid transparent;
}

.match-row.win {
  border-left-color: #10b981;
}

.match-row.loss {
  border-left-color: #ef4444;
}

.match-result {
  font-size: 1.5rem;
}

.match-info {
  flex: 1;
}

.match-opponent {
  font-weight: 600;
  margin-bottom: 4px;
}

.match-meta {
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.4);
  display: flex;
  gap: 12px;
}

.battle-code {
  background: rgba(255, 255, 255, 0.1);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: monospace;
}

.match-amikos {
  display: flex;
  gap: 6px;
}

.mini-amiko {
  width: 32px;
  height: 32px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.mini-amiko img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.mini-amiko span {
  font-size: 0.8rem;
  font-weight: 600;
}

/* Amikos Tab */
.amiko-stats-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.amiko-stat-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 12px;
  position: relative;
}

.amiko-info {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 140px;
}

.amiko-img {
  width: 40px;
  height: 40px;
  object-fit: contain;
}

.amiko-placeholder {
  width: 40px;
  height: 40px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
}

.amiko-details {
  display: flex;
  flex-direction: column;
}

.amiko-name {
  font-weight: 600;
  font-size: 0.95rem;
}

.amiko-element {
  font-size: 0.75rem;
}

.amiko-record {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 16px;
}

.win-rate {
  font-size: 1.25rem;
  font-weight: 700;
  min-width: 50px;
}

.record-detail {
  display: flex;
  gap: 4px;
  font-size: 0.85rem;
}

.record-detail .wins {
  color: #6ee7b7;
}

.record-detail .losses {
  color: #fca5a5;
}

.record-detail .separator {
  color: rgba(255, 255, 255, 0.3);
}

.games-played {
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.4);
}

.win-bar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 0 0 12px 12px;
  overflow: hidden;
}

.win-fill {
  height: 100%;
  background: linear-gradient(90deg, #10b981 0%, #6ee7b7 100%);
  transition: width 0.3s ease;
}

/* Responsive */
@media (max-width: 500px) {
  .aurory-modal {
    max-height: 95vh;
    border-radius: 16px 16px 0 0;
    margin-top: auto;
  }
  
  .overview-grid {
    grid-template-columns: 1fr;
  }
  
  .stat-card.highlight,
  .stat-card.wide {
    grid-column: span 1;
  }
  
  .aurory-account-bar {
    flex-direction: column;
    gap: 12px;
    text-align: center;
  }
  
  .match-amikos {
    display: none;
  }
}
`;
