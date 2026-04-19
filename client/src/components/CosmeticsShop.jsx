import React, { useState, useEffect } from 'react';
import { getAllCosmetics, purchaseCosmetic, equipCosmetic, getEquippedBannerStyle, getBannerStyleFromCosmetic } from '../services/cosmeticsService';
import { RARITY_CONFIG } from '../data/cosmetics';
import { resolveDisplayName } from '../utils/userUtils';
import AvatarWithAura from './AvatarWithAura';
import './CosmeticsShop.css';

const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary', 'mythic'];

const CosmeticsShop = ({ user }) => {
  const [cosmetics, setCosmetics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState('aura');
  const [selectedRarity, setSelectedRarity] = useState('all');
  const [previewSlots, setPreviewSlots] = useState({ aura: null, banner: null });
  const [purchasing, setPurchasing] = useState(null);
  const [actionMessage, setActionMessage] = useState(null);

  const ownedCosmetics = user?.ownedCosmetics || [];
  const equippedAura = user?.equippedCosmetics?.aura || null;
  const equippedBanner = user?.equippedCosmetics?.banner || null;

  // Load cosmetics from database
  useEffect(() => {
    let isMounted = true;
    const loadInventory = async () => {
      setLoading(true);
      const data = await getAllCosmetics();
      if (isMounted) {
        setCosmetics(data);
        setLoading(false);
      }
    };
    loadInventory();
    return () => { isMounted = false; };
  }, []);

  const filteredCosmetics = cosmetics
    .filter(c => c.type === activeCategory)
    .filter(c => selectedRarity === 'all' || c.rarity === selectedRarity)
    .sort((a, b) => (RARITY_CONFIG[a.rarity]?.order || 0) - (RARITY_CONFIG[b.rarity]?.order || 0));

  const showMessage = (msg, type = 'info') => {
    setActionMessage({ text: msg, type });
    setTimeout(() => setActionMessage(null), 3000);
  };

  const handlePurchase = async (cosmeticId) => {
    if (!user || purchasing) return;
    const cosmetic = cosmetics.find(c => c.id === cosmeticId);
    if (!cosmetic) return;

    if (!window.confirm(`⚔️ Purchase "${cosmetic.name}" for ${cosmetic.price.toLocaleString()} Valcoins?`)) return;

    setPurchasing(cosmeticId);
    const result = await purchaseCosmetic(user.uid, cosmeticId);
    setPurchasing(null);

    if (result.success) {
      showMessage(`✅ Acquired "${cosmetic.name}"!`, 'success');
    } else {
      showMessage(`❌ ${result.error}`, 'error');
    }
  };

  const handleEquip = async (cosmetic) => {
    if (!user) return;
    const slot = cosmetic.type; // 'aura' | 'banner'
    const currentEquipped = user?.equippedCosmetics?.[slot] || null;
    const isCurrentlyEquipped = currentEquipped === cosmetic.id;
    
    const result = await equipCosmetic(user.uid, isCurrentlyEquipped ? null : cosmetic.id, slot);

    if (result.success) {
      showMessage(isCurrentlyEquipped ? `${slot.charAt(0).toUpperCase() + slot.slice(1)} removed.` : `✨ Equipped "${cosmetic?.name}"!`, 'success');
    } else {
      showMessage(`❌ ${result.error}`, 'error');
    }
  };

  if (!user) {
    return (
      <div className="cosmetics-shop-section dashboard-widget cosmetics-widget">
        <div className="cosmetics-shop-empty">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
          <p>Log in to browse and purchase cosmetics.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="cosmetics-shop-section dashboard-widget cosmetics-widget">
      {/* Header */}
      <div className="section-header">
        <div className="header-title-group">
          <p className="section-subtitle">
            {activeCategory === 'aura' 
              ? 'Adorn your avatar with mythical auras and custom effects'
              : 'Fly your colors with legendary banners for your warrior profile'}
          </p>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="cosmetics-category-tabs">
        <button 
          className={`category-tab ${activeCategory === 'aura' ? 'active' : ''}`}
          onClick={() => { setActiveCategory('aura'); setSelectedRarity('all'); }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>
          Auras
        </button>
        <button 
          className={`category-tab ${activeCategory === 'banner' ? 'active' : ''}`}
          onClick={() => { setActiveCategory('banner'); setSelectedRarity('all'); }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/></svg>
          Banners
        </button>
      </div>

      {/* Action Message */}
      {actionMessage && (
        <div className={`cosmetics-action-msg ${actionMessage.type}`}>
          {actionMessage.text}
        </div>
      )}

      {/* Preview Section */}
      {(() => {
        const previewBanner = previewSlots.banner ? cosmetics.find(c => c.id === previewSlots.banner) : null;
        const previewStyle = previewBanner ? (getBannerStyleFromCosmetic(previewBanner) || {}) : (getEquippedBannerStyle(user) || {});
        const hasBannerPreview = previewStyle && Object.keys(previewStyle).length > 0;
        return (
          <div 
            className={`cosmetics-preview-bar profile-sample-card ${hasBannerPreview ? 'has-banner' : ''}`}
            style={previewStyle}
          >
        <div className="cosmetics-preview-avatar">
          <div className="preview-pic-wrapper">
            <AvatarWithAura
              user={user}
              size={72}
              auraData={previewSlots.aura ? cosmetics.find(c => c.id === previewSlots.aura) : null}
            />
          </div>
          <div className="preview-user-details">
            <span className="preview-username">{resolveDisplayName(user)}</span>
            <span className="preview-label">
              {previewSlots.aura || previewSlots.banner
                ? (cosmetics.find(c => c.id === (previewSlots.aura || previewSlots.banner))?.name || 'Previewing...')
                : 'Current Setup'}
            </span>
          </div>
        </div>
        <div className="cosmetics-preview-info">
          <div className="preview-balance">
            <img src="/valcoin-icon.jpg" alt="VC" className="valcoin-shop-icon" />
            <span>{(user.points || 0).toLocaleString()}</span>
          </div>
          <span className="preview-owned">{ownedCosmetics.length} / {cosmetics.length} Owned</span>
        </div>
        </div>
        );
      })()}

      {/* Rarity Filter Tabs */}
      <div className="cosmetics-filter-tabs">
        <button
          className={`cosmetics-filter-tab ${selectedRarity === 'all' ? 'active' : ''}`}
          onClick={() => setSelectedRarity('all')}
        >
          All
        </button>
        {RARITY_ORDER.map(rarity => (
          <button
            key={rarity}
            className={`cosmetics-filter-tab ${selectedRarity === rarity ? 'active' : ''}`}
            style={{ '--tab-color': RARITY_CONFIG[rarity].color }}
            onClick={() => setSelectedRarity(rarity)}
          >
            {RARITY_CONFIG[rarity].label}
          </button>
        ))}
      </div>

      {/* Cosmetics Grid */}
      <div className="cosmetics-grid">
        {loading ? (
           <div className="cosmetic-loading-grid">
             <div className="cosmetic-spinner" />
             <p>Polishing the armor...</p>
           </div>
        ) : filteredCosmetics.length === 0 ? (
          <div className="cosmetics-empty-view">
             <p>No {activeCategory}s available in Valhalla's Vault yet.</p>
          </div>
        ) : filteredCosmetics.map(cosmetic => {
          const isOwned = ownedCosmetics.includes(cosmetic.id);
          const isEquipped = (cosmetic.type === 'aura' ? equippedAura : equippedBanner) === cosmetic.id;
          const isPurchasing = purchasing === cosmetic.id;
          const rarityConf = RARITY_CONFIG[cosmetic.rarity];

          return (
            <div
              key={cosmetic.id}
              className={`cosmetic-card ${isOwned ? 'owned' : ''} ${isEquipped ? 'equipped' : ''} type-${cosmetic.type}`}
              style={{ 
                '--rarity-color': rarityConf?.color || '#ccc', 
                '--rarity-glow': rarityConf?.glow || 'none',
                ...(cosmetic.type === 'banner' ? (getBannerStyleFromCosmetic(cosmetic) || {}) : {})
              }}
              onMouseEnter={() => setPreviewSlots(prev => ({ ...prev, [cosmetic.type]: cosmetic.id }))}
              onMouseLeave={() => setPreviewSlots({ aura: null, banner: null })}
            >
              {/* Rarity Badge */}
              <div className="cosmetic-rarity-badge" style={{ background: rarityConf?.color }}>
                {rarityConf?.label}
              </div>

              {isEquipped && (
                <div className="cosmetic-equipped-badge">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  Equipped
                </div>
              )}

              {/* Mini Avatar Preview */}
              <div className="cosmetic-card-preview">
                <AvatarWithAura
                  user={user}
                  size={56}
                  auraData={cosmetic.type === 'aura' ? cosmetic : null}
                />
              </div>

              {/* Info */}
              <div className="cosmetic-card-info">
                <h4 className="cosmetic-card-name">{cosmetic.name}</h4>
                <p className="cosmetic-card-desc">{cosmetic.description}</p>
              </div>

              {/* Action */}
              <div className="cosmetic-card-action">
                {isOwned ? (
                  <button
                    className={`cosmetic-btn equip-btn ${isEquipped ? 'unequip' : ''}`}
                    onClick={() => handleEquip(cosmetic)}
                  >
                    {isEquipped ? (
                      <>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" x2="12" y1="2" y2="12"/></svg>
                        Unequip
                      </>
                    ) : (
                      <>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 8v8"/><path d="M8 12h8"/></svg>
                        Equip
                      </>
                    )}
                  </button>
                ) : (
                  <button
                    className="cosmetic-btn buy-btn"
                    onClick={() => handlePurchase(cosmetic.id)}
                    disabled={isPurchasing || (user.points || 0) < cosmetic.price}
                  >
                    {isPurchasing ? (
                      <span className="cosmetic-spinner" />
                    ) : (
                      <>
                        <img src="/valcoin-icon.jpg" alt="" className="valcoin-btn-icon" />
                        {cosmetic.price.toLocaleString()}
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CosmeticsShop;
