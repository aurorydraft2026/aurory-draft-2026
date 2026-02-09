// AmikoEnhancements.jsx
// UI components for displaying Amiko elements, ranks, and enhanced cards
// Uses the enriched data from amikos.js

import React from 'react';
import { ELEMENTS, SEEKER_RANKS, LOCATIONS, getAmikoElement, getAmikoRank } from '../data/amikos';

// ========================================
// ELEMENT BADGE
// ========================================
export function ElementBadge({ element, size = 'small', showLabel = false }) {
  const config = ELEMENTS[element];
  if (!config) return null;

  const sizeStyles = {
    small: { fontSize: '0.7rem', padding: '2px 6px' },
    medium: { fontSize: '0.85rem', padding: '4px 10px' },
    large: { fontSize: '1rem', padding: '6px 14px' }
  };

  return (
    <span
      className="element-badge"
      style={{
        background: config.bgColor,
        color: config.color,
        borderRadius: '12px',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        fontWeight: 600,
        border: `1px solid ${config.color}30`,
        ...sizeStyles[size]
      }}
    >
      <span>{config.icon}</span>
      {showLabel && <span>{element}</span>}
    </span>
  );
}

// ========================================
// RANK STARS
// ========================================
export function RankStars({ rank, size = 'small' }) {
  const config = SEEKER_RANKS[rank];
  if (!config) return null;

  const starSizes = {
    small: '10px',
    medium: '14px',
    large: '18px'
  };

  return (
    <span
      className="rank-stars"
      style={{
        display: 'inline-flex',
        gap: '1px',
        filter: `drop-shadow(0 0 2px ${config.color}50)`
      }}
      title={config.label}
    >
      {Array.from({ length: config.stars }, (_, i) => (
        <span
          key={i}
          style={{
            color: config.color,
            fontSize: starSizes[size],
            lineHeight: 1
          }}
        >
          ★
        </span>
      ))}
    </span>
  );
}

// ========================================
// LOCATION BADGE
// ========================================
export function LocationBadge({ location, size = 'small' }) {
  const config = LOCATIONS[location];
  if (!config) return null;

  const sizeStyles = {
    small: { fontSize: '0.65rem', padding: '2px 6px' },
    medium: { fontSize: '0.8rem', padding: '3px 8px' },
    large: { fontSize: '0.9rem', padding: '4px 10px' }
  };

  return (
    <span
      className="location-badge"
      style={{
        background: `${config.color}20`,
        color: config.color,
        borderRadius: '8px',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '3px',
        fontWeight: 500,
        ...sizeStyles[size]
      }}
    >
      <span>{config.icon}</span>
      <span>{config.label}</span>
    </span>
  );
}

// ========================================
// ENHANCED AMIKO CARD
// ========================================
export function EnhancedAmikoCard({
  amiko,
  onClick,
  selected = false,
  disabled = false,
  showDetails = false,
  size = 'medium' // 'small', 'medium', 'large'
}) {
  if (!amiko) return null;

  const elementConfig = getAmikoElement(amiko);
  const rankConfig = getAmikoRank(amiko);

  const sizeConfig = {
    small: { width: '80px', imgSize: '50px', fontSize: '0.7rem' },
    medium: { width: '100px', imgSize: '70px', fontSize: '0.8rem' },
    large: { width: '140px', imgSize: '100px', fontSize: '0.9rem' }
  };

  const config = sizeConfig[size];

  return (
    <div
      className={`enhanced-amiko-card ${selected ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}
      onClick={() => !disabled && onClick?.(amiko)}
      style={{
        width: config.width,
        padding: '8px',
        borderRadius: '12px',
        background: selected
          ? `linear-gradient(135deg, ${elementConfig?.color}30 0%, ${elementConfig?.color}10 100%)`
          : 'rgba(255,255,255,0.05)',
        border: selected
          ? `2px solid ${elementConfig?.color || '#667eea'}`
          : '2px solid transparent',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'all 0.2s ease',
        position: 'relative',
        textAlign: 'center'
      }}
    >
      {/* Element Badge - Top Right */}
      {elementConfig && (
        <div style={{ position: 'absolute', top: '4px', right: '4px' }}>
          <ElementBadge element={amiko.element} size="small" />
        </div>
      )}

      {/* Rank Stars - Top Left */}
      {rankConfig && (
        <div style={{ position: 'absolute', top: '6px', left: '6px' }}>
          <RankStars rank={amiko.seekerRank} size="small" />
        </div>
      )}

      {/* Amiko Image */}
      <div style={{
        marginTop: '16px',
        marginBottom: '8px',
        display: 'flex',
        justifyContent: 'center'
      }}>
        <img
          src={amiko.image}
          alt={amiko.name}
          style={{
            width: config.imgSize,
            height: config.imgSize,
            objectFit: 'contain',
            filter: disabled ? 'grayscale(100%)' : 'none'
          }}
          onError={(e) => {
            e.target.src = '/amikos/placeholder.png';
          }}
        />
      </div>

      {/* Amiko Name */}
      <div style={{
        fontSize: config.fontSize,
        fontWeight: 600,
        color: 'white',
        marginBottom: showDetails ? '8px' : '0'
      }}>
        {amiko.name}
      </div>

      {/* Additional Details (optional) */}
      {showDetails && amiko.location && (
        <div style={{ marginTop: '4px' }}>
          <LocationBadge location={amiko.location} size="small" />
        </div>
      )}
    </div>
  );
}

// ========================================
// ELEMENT FILTER BAR
// ========================================
export function ElementFilterBar({ selectedElement, onSelect, showAll = true }) {
  const elements = Object.keys(ELEMENTS);

  return (
    <div
      className="element-filter-bar"
      style={{
        display: 'flex',
        gap: '8px',
        flexWrap: 'wrap',
        padding: '8px',
        background: 'rgba(0,0,0,0.2)',
        borderRadius: '12px'
      }}
    >
      {showAll && (
        <button
          onClick={() => onSelect(null)}
          style={{
            padding: '6px 12px',
            borderRadius: '8px',
            border: 'none',
            background: selectedElement === null
              ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
              : 'rgba(255,255,255,0.1)',
            color: 'white',
            cursor: 'pointer',
            fontWeight: 600,
            transition: 'all 0.2s ease'
          }}
        >
          All
        </button>
      )}
      {elements.map(element => {
        const config = ELEMENTS[element];
        const isSelected = selectedElement === element;

        return (
          <button
            key={element}
            onClick={() => onSelect(element)}
            style={{
              padding: '6px 12px',
              borderRadius: '8px',
              border: `1px solid ${isSelected ? config.color : 'transparent'}`,
              background: isSelected ? config.bgColor : 'rgba(255,255,255,0.1)',
              color: isSelected ? config.color : 'rgba(255,255,255,0.7)',
              cursor: 'pointer',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              transition: 'all 0.2s ease'
            }}
          >
            <span>{config.icon}</span>
            <span>{element}</span>
          </button>
        );
      })}
    </div>
  );
}

// ========================================
// AMIKO COMPARISON VIEW
// ========================================
export function AmikoComparison({ amikoA, amikoB }) {
  if (!amikoA || !amikoB) return null;

  return (
    <div
      className="amiko-comparison"
      style={{
        display: 'flex',
        gap: '24px',
        padding: '16px',
        background: 'rgba(0,0,0,0.3)',
        borderRadius: '16px'
      }}
    >
      <ComparisonCard amiko={amikoA} />
      <div style={{
        display: 'flex',
        alignItems: 'center',
        fontSize: '1.5rem',
        color: 'rgba(255,255,255,0.3)'
      }}>
        VS
      </div>
      <ComparisonCard amiko={amikoB} />
    </div>
  );
}

function ComparisonCard({ amiko }) {
  return (
    <div style={{ flex: 1, textAlign: 'center' }}>
      <img
        src={amiko.image}
        alt={amiko.name}
        style={{ width: '80px', height: '80px', objectFit: 'contain' }}
      />
      <h4 style={{ margin: '8px 0 4px' }}>{amiko.name}</h4>
      <ElementBadge element={amiko.element} showLabel />
      <div style={{ marginTop: '8px' }}>
        <RankStars rank={amiko.seekerRank} size="medium" />
      </div>
      {amiko.location && (
        <div style={{ marginTop: '8px' }}>
          <LocationBadge location={amiko.location} />
        </div>
      )}
    </div>
  );
}

// ========================================
// CSS STYLES (add to your CSS file)
// ========================================
export const amikoEnhancementStyles = `
.enhanced-amiko-card:hover:not(.disabled) {
  transform: translateY(-4px);
  box-shadow: 0 8px 24px rgba(0,0,0,0.3);
}

.enhanced-amiko-card.selected {
  animation: selectedPulse 2s ease-in-out infinite;
}

@keyframes selectedPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(102, 126, 234, 0.4); }
  50% { box-shadow: 0 0 0 8px rgba(102, 126, 234, 0); }
}

.element-filter-bar button:hover {
  transform: scale(1.05);
}
`;

const AmikoEnhancements = {
  ElementBadge,
  RankStars,
  LocationBadge,
  EnhancedAmikoCard,
  ElementFilterBar,
  AmikoComparison
};

export default AmikoEnhancements;
