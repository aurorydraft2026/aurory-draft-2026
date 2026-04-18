import React, { useState, useEffect } from 'react';
import { fetchCosmeticById } from '../services/cosmeticsService';
import { RARITY_CONFIG } from '../data/cosmetics';
import { resolveAvatar } from '../utils/userUtils';
import './AvatarWithAura.css';

/**
 * AvatarWithAura - Global avatar component that renders the user's
 * profile picture with their equipped cosmetic aura effect.
 *
 * @param {Object} props
 * @param {Object} props.user - User object
 * @param {Object} [props.auraData] - Optional pre-resolved aura metadata
 * @param {number} [props.size=40] - Avatar size in pixels
 * @param {string} [props.className] - Additional CSS class
 * @param {Function} [props.onClick] - Click handler
 */
const AvatarWithAura = ({ user, auraData: initialAuraData = null, size = 40, className = '', onClick }) => {
  const [auraData, setAuraData] = useState(initialAuraData);
  const avatarUrl = resolveAvatar(user);

  useEffect(() => {
    // If we have initial data (from a list snapshot), use it
    if (initialAuraData) {
      setAuraData(initialAuraData);
      return;
    }

    // Otherwise, if user has an aura ID, fetch the metadata
    const auraId = user?.equippedCosmetics?.aura;
    if (auraId) {
      if (typeof auraId === 'object' && auraId.id) {
         // Handle case where snapshots are nested
         setAuraData(auraId);
      } else {
        fetchCosmeticById(auraId).then(data => {
          if (data) setAuraData(data);
        });
      }
    } else {
      setAuraData(null);
    }
  }, [user?.equippedCosmetics?.aura, initialAuraData]);

  const auraClass = auraData?.cssClass || '';
  const gifUrl = auraData?.gifUrl || null;
  const placement = auraData?.placement || 'behind'; // behind | overlay | border
  const rarityColor = auraData ? RARITY_CONFIG[auraData.rarity]?.color : null;

  return (
    <div
      className={`avatar-aura-wrapper ${auraClass} ${className} placement-${placement}`}
      style={{
        '--avatar-size': `${size}px`,
        '--aura-color': rarityColor || 'rgba(212,175,55,0.6)',
      }}
      onClick={onClick}
    >
      {/* 1. BEHIND Layer (Default) */}
      {(auraClass || (gifUrl && placement === 'behind')) && (
        <div className="aura-container aura-container-behind">
          {gifUrl ? (
            <img src={gifUrl} alt="" className="aura-gif-layer" />
          ) : (
            <>
              <div className="aura-layer aura-layer-1" />
              <div className="aura-layer aura-layer-2" />
              <div className="aura-layer aura-layer-3" />
            </>
          )}
        </div>
      )}

      {/* 2. ON BORDER Layer */}
      {gifUrl && placement === 'border' && (
        <div className="aura-container aura-container-border">
          <img src={gifUrl} alt="" className="aura-gif-layer" />
        </div>
      )}

      {/* Actual Avatar Image */}
      <img
        src={avatarUrl}
        alt="Avatar"
        className="avatar-aura-img"
        onError={(e) => {
          e.target.onerror = null;
          e.target.src = 'https://cdn.discordapp.com/embed/avatars/0.png';
        }}
      />

      {/* 3. OVERLAY Layer (Top) */}
      {gifUrl && placement === 'overlay' && (
        <div className="aura-container aura-container-overlay">
          <img src={gifUrl} alt="" className="aura-gif-layer" />
        </div>
      )}
    </div>
  );
};

export default AvatarWithAura;
