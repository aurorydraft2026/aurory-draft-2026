import React from 'react';
import { getEquippedAuraClass } from '../services/cosmeticsService';
import { getCosmeticById, RARITY_CONFIG } from '../data/cosmetics';
import { resolveAvatar } from '../utils/userUtils';
import './AvatarWithAura.css';

/**
 * AvatarWithAura - Global avatar component that renders the user's
 * profile picture with their equipped cosmetic aura effect.
 *
 * Drop-in replacement for naked <img> profile pictures.
 *
 * @param {Object} props
 * @param {Object} props.user - User object (needs equippedCosmetics, photoURL, etc.)
 * @param {number} [props.size=40] - Avatar size in pixels
 * @param {string} [props.className] - Additional CSS class
 * @param {string} [props.overrideAura] - Force a specific aura CSS class (for previews)
 * @param {Function} [props.onClick] - Click handler
 */
const AvatarWithAura = ({ user, size = 40, className = '', overrideAura = null, onClick }) => {
  const auraClass = overrideAura || getEquippedAuraClass(user);
  const avatarUrl = resolveAvatar(user);

  // Determine rarity color for the aura ring
  let rarityColor = null;
  if (auraClass) {
    const equippedId = overrideAura
      ? null // Preview mode - we'll get rarity from cssClass lookup
      : user?.equippedCosmetics?.aura;

    if (equippedId) {
      const cosmetic = getCosmeticById(equippedId);
      if (cosmetic) {
        rarityColor = RARITY_CONFIG[cosmetic.rarity]?.color;
      }
    }
  }

  return (
    <div
      className={`avatar-aura-wrapper ${auraClass || ''} ${className}`}
      style={{
        '--avatar-size': `${size}px`,
        '--aura-color': rarityColor || 'rgba(212,175,55,0.6)',
      }}
      onClick={onClick}
    >
      {/* Aura layers rendered behind the image */}
      {auraClass && (
        <>
          <div className="aura-layer aura-layer-1" />
          <div className="aura-layer aura-layer-2" />
          <div className="aura-layer aura-layer-3" />
        </>
      )}
      <img
        src={avatarUrl}
        alt="Avatar"
        className="avatar-aura-img"
        onError={(e) => {
          e.target.onerror = null;
          e.target.src = 'https://cdn.discordapp.com/embed/avatars/0.png';
        }}
      />
    </div>
  );
};

export default AvatarWithAura;
