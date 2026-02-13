// AuroryAccountLink.jsx
// Component for linking Aurory game account
// Simplified: account linking only, no stats/matches/eggs tabs

import React, { useState, useEffect, useCallback } from 'react';
import {
  validateAuroryAccount,
  linkAuroryAccount,
  unlinkAuroryAccount,
  getLinkedAuroryAccount,
  clearCache
} from '../services/auroryProfileService';

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function AuroryAccountLink({ user, isOpen, onClose }) {
  const [linkedAccount, setLinkedAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState(null);
  const [searchInput, setSearchInput] = useState('');

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
      }
    } catch (err) {
      setError(err.message);
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
                <span>Account linked successfully</span>
              </div>

              <button className="unlink-btn" onClick={handleUnlink}>
                Unlink Account
              </button>
            </div>
          </div>
        ) : (
          // Link Account View
          <div className="aurory-link-view">
            <div className="method-content">
              <p className="method-desc">Enter your <strong>Aurory Player ID</strong> (e.g., p-12345) to link your in-game profile. Each ID can only be linked to one account.</p>
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

.unlink-btn {
  padding: 10px 24px;
  background: transparent;
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 8px;
  color: rgba(239, 68, 68, 0.7);
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.2s;
}

.unlink-btn:hover {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.5);
  color: #fca5a5;
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
