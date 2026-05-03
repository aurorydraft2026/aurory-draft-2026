// AuroryAccountLink.jsx
// Component for linking Aurory game account
// Simplified: account linking only, no stats/matches/eggs tabs

import React, { useState, useEffect, useCallback } from 'react';
import {
  validateAuroryAccount,
  linkAuroryAccount,
  getLinkedAuroryAccount,
  syncAuroryName,
  syncAuthPhoto
} from '../services/auroryProfileService';
import { auth } from '../firebase';

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function AuroryAccountLink({ user, isOpen, onClose }) {
  const [linkedAccount, setLinkedAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState(null);
  const [searchInput, setSearchInput] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);

  const loadLinkedAccount = useCallback(async () => {
    if (!user) return;

    setLoading(true);
    try {
      const account = await getLinkedAuroryAccount(user.uid);
      setLinkedAccount(account);
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

    // Warning alert as requested
    if (!window.confirm('Warning: This action cannot be undone. You can only link one Aurory account to your profile. Are you sure you want to continue?')) {
      setLinking(false);
      return;
    }

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
        profilePicture: validation.profilePicture || null,
        isAurorian: validation.isAurorian || false
      });

      if (result.success) {
        setLinkedAccount({
          playerId: validation.playerId,
          playerName: validation.playerName,
          wallet: validation.wallet,
          profilePicture: validation.profilePicture || null,
          isAurorian: validation.isAurorian || false,
          linkedAt: new Date()
        });
        setSearchInput('');
      } else {
        setError(result.error || 'Failed to link account');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLinking(false);
    }
  };

  const handleManualSync = async () => {
    if (!linkedAccount || isSyncing) return;
    
    setIsSyncing(true);
    setError(null);
    
    try {
      const result = await syncAuroryName(user.uid, linkedAccount.playerId);
      if (result.success) {
        setLinkedAccount({
          ...linkedAccount,
          playerName: result.playerName,
          profilePicture: result.profilePicture,
          isAurorian: result.isAurorian,
          lastSync: new Date()
        });
      } else {
        setError(result.error || 'Sync failed');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSyncAuthPhoto = async () => {
    const currentUser = auth.currentUser;
    const photoURL = currentUser?.photoURL;
    
    if (!photoURL || isSyncing) {
      if (!photoURL) setError('No profile picture found on your Google/Discord account.');
      return;
    }

    setIsSyncing(true);
    setError(null);

    try {
      const result = await syncAuthPhoto(user.uid, photoURL);
      if (result.success) {
        // Update local state if needed (optional since parent might re-fetch)
        if (linkedAccount) {
          setLinkedAccount({
            ...linkedAccount,
            profilePicture: photoURL
          });
        }
      } else {
        setError(result.error || 'Failed to sync photo');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSyncing(false);
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
          <p>Connect your game account to verify matches</p>
          <div className="safety-disclaimer" style={{
            fontSize: '0.75rem',
            color: 'rgba(255, 255, 255, 0.4)',
            marginTop: '8px',
            padding: '4px 8px',
            background: 'rgba(0,0,0,0.2)',
            borderRadius: '4px'
          }}>
            🛡️ Independent community-made platform. We will never ask for your password or private keys.
          </div>
        </div>

        {loading ? (
          <div className="aurory-loading">
            <div className="spinner"></div>
            <p>Loading...</p>
          </div>
        ) : linkedAccount ? (
          // Linked Account — Success View
          <div className="aurory-linked-view">
            <div className="aurory-linked-success">
              <div className="linked-profile">
                <div className="linked-avatar-wrapper">
                  <img
                    src={linkedAccount.profilePicture || '/aurory-logo.png'}
                    alt={linkedAccount.playerName}
                    className="linked-avatar"
                    onError={(e) => { e.target.onerror = null; e.target.src = '/aurory-logo.png'; }}
                  />
                  {linkedAccount.isAurorian && (
                    <span className="aurorian-badge" title="Aurorian Holder">✦</span>
                  )}
                </div>
                <div className="linked-name">{linkedAccount.playerName}</div>
                <div className="linked-id">{linkedAccount.playerId}</div>
              </div>

              <div className="linked-status">
                <span className="linked-check">✓</span>
                <span>Account linked permanent</span>
              </div>



              <div className="sync-actions-group" style={{ display: 'flex', gap: '8px', width: '100%' }}>
                <button
                  className={`sync-btn ${isSyncing ? 'syncing' : ''}`}
                  onClick={handleManualSync}
                  disabled={isSyncing}
                  style={{ flex: 1 }}
                >
                  {isSyncing ? '⌛ Syncing...' : '🔄 Sync Aurory'}
                </button>

                <button
                  className={`sync-btn auth-sync-btn ${isSyncing ? 'syncing' : ''}`}
                  onClick={handleSyncAuthPhoto}
                  disabled={isSyncing}
                  style={{ width: 'auto', padding: '0 15px' }}
                  title={`Sync from ${auth.currentUser?.providerData[0]?.providerId === 'google.com' ? 'Google' : 'Discord'}`}
                >
                  {auth.currentUser?.providerData[0]?.providerId === 'google.com' ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-1 .67-2.28 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 12-4.53z" />
                    </svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 127.14 96.36" fill="currentColor">
                      <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.71,32.65-1.82,56.6.39,80.21a105.73,105.73,0,0,0,32.88,16.15,83,83,0,0,0,7.22-11.73,67.42,67.42,0,0,1-11.58-5.54,53,53,0,0,0,1.17-.9c21,9.7,43.83,9.7,64.55,0a54.34,54.34,0,0,0,1.17.9,67.58,67.58,0,0,1-11.59,5.54,82.84,82.84,0,0,0,7.22,11.73,105.41,105.41,0,0,0,32.89-16.15C129.58,52.87,124.4,29.12,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5.09-12.73,11.41-12.73S54,45.92,53.86,53,48.77,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5.09-12.73,11.44-12.73S96.23,45.92,96.08,53,91,65.69,84.69,65.69Z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        ) : (
          // Link Account View
          <div className="aurory-link-view">
            <div className="method-content">
              <p className="method-desc">Enter your <strong>Aurory Player ID</strong> (e.g., p-12345) to link your in-game profile. <strong>This action is permanent and cannot be undone.</strong></p>
              <div className="search-input-group">
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Aurory ID (e.g. p-12345)"
                  className="link-input"
                  onKeyDown={(e) => e.key === 'Enter' && handleSearchAndLink()}
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
  z-index: 2000;
  padding: 20px;
}

.aurory-modal {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  border-radius: 20px;
  width: 100%;
  max-width: 440px;
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

.aurory-loading p {
  color: rgba(255, 255, 255, 0.6);
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

.method-desc strong {
  color: rgba(255, 255, 255, 0.85);
}

.search-input-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
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

/* Linked Success View */
.aurory-linked-view {
  display: flex;
  flex-direction: column;
}

.aurory-linked-success {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px;
  gap: 24px;
}

.linked-profile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.linked-avatar-wrapper {
  position: relative;
  width: 80px;
  height: 80px;
}

.linked-avatar {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  object-fit: cover;
  border: 3px solid rgba(102, 126, 234, 0.5);
  background: rgba(0, 0, 0, 0.3);
}

.aurorian-badge {
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 26px;
  height: 26px;
  background: linear-gradient(135deg, #f59e0b, #d97706);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  color: white;
  border: 2px solid #1a1a2e;
  box-shadow: 0 2px 8px rgba(245, 158, 11, 0.4);
}

.linked-name {
  font-size: 1.2rem;
  font-weight: 700;
  color: white;
}

.linked-id {
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.4);
  font-family: monospace;
}

.linked-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  background: rgba(16, 185, 129, 0.1);
  border: 1px solid rgba(16, 185, 129, 0.25);
  border-radius: 10px;
  color: #6ee7b7;
  font-size: 0.9rem;
  font-weight: 500;
}

.linked-check {
  font-size: 1.1rem;
  font-weight: 700;
}



.sync-btn {
  width: 100%;
  padding: 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px dashed rgba(255, 255, 255, 0.2);
  border-radius: 12px;
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.sync-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  color: white;
  border-style: solid;
  border-color: rgba(255, 255, 255, 0.4);
}

.sync-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.sync-btn.syncing {
  border-color: #667eea;
  color: #a5b4fc;
}

.auth-sync-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.15);
  border-color: rgba(255, 255, 255, 0.6);
  transform: translateY(-1px);
}

@media (max-width: 480px) {
  .aurory-modal {
    max-width: 100%;
    border-radius: 16px;
  }

  .aurory-modal-header {
    padding: 24px 20px 20px;
  }

  .aurory-link-view {
    padding: 20px;
  }

  .aurory-linked-success {
    padding: 24px 20px;
  }
}
`;
