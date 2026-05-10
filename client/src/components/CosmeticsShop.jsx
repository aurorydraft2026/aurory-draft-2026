import React, { useState, useEffect, useRef } from 'react';
import { purchaseCosmetic, equipCosmetic, getEquippedBannerStyle, getBannerStyleFromCosmetic, updateCosmeticsCache } from '../services/cosmeticsService';
import { db } from '../firebase';
import { collection, onSnapshot } from 'firebase/firestore';
import { RARITY_CONFIG } from '../data/cosmetics';
import { resolveDisplayName } from '../utils/userUtils';
import { useWallet } from '../hooks/useWallet';
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
  const [hoveredCardId, setHoveredCardId] = useState(null);
  const [loadingCardId, setLoadingCardId] = useState(null);
  const [equipping, setEquipping] = useState(null);
  const loadedAnimUrls = useRef(new Set());
  
  const { walletBalance, usdcBalance, formatAuryAmount, formatUsdcAmount } = useWallet(user);

  const ownedCosmetics = user?.ownedCosmetics || [];
  const equippedAura = user?.equippedCosmetics?.aura || null;
  const equippedBanner = user?.equippedCosmetics?.banner || null;

  // Load cosmetics from database (Real-time)
  useEffect(() => {
    const cosmeticsRef = collection(db, 'cosmetics');
    const unsubscribe = onSnapshot(cosmeticsRef, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setCosmetics(data);
      setLoading(false);
      
      // Update global cache for sync helpers
      updateCosmeticsCache(data);
    }, (error) => {
      console.error('Error fetching cosmetics:', error);
      setLoading(false);
    });
    
    return () => unsubscribe();
  }, []);

  const isNewItem = (createdAt) => {
    if (!createdAt) return false;
    try {
      const createdDate = createdAt.toDate ? createdAt.toDate() : new Date(createdAt);
      const diffDays = (new Date() - createdDate) / (1000 * 60 * 60 * 24);
      return diffDays <= 7;
    } catch (e) {
      return false;
    }
  };

  const filteredCosmetics = cosmetics
    .filter(c => c.type === activeCategory)
    .filter(c => selectedRarity === 'all' || c.rarity === selectedRarity)
    .sort((a, b) => (RARITY_CONFIG[a.rarity]?.order || 0) - (RARITY_CONFIG[b.rarity]?.order || 0));

  const newItemsCount = cosmetics.filter(c => isNewItem(c.createdAt)).length;

  const getCategoryStats = (type) => {
    const items = cosmetics.filter(c => c.type === type);
    return {
      count: items.length,
      hasNew: items.some(c => isNewItem(c.createdAt))
    };
  };

  const getRarityStats = (rarity) => {
    const items = cosmetics
      .filter(c => c.type === activeCategory)
      .filter(c => rarity === 'all' || c.rarity === rarity);
    return {
      count: items.length,
      hasNew: items.some(c => isNewItem(c.createdAt))
    };
  };

  const showMessage = (msg, type = 'info') => {
    setActionMessage({ text: msg, type });
    setTimeout(() => setActionMessage(null), 3000);
  };

  const handlePurchase = async (cosmeticId) => {
    if (!user || purchasing) return;
    const cosmetic = cosmetics.find(c => c.id === cosmeticId);
    if (!cosmetic) return;

    const rawCurrency = cosmetic.currency || 'valcoins';
    const currency = rawCurrency.toLowerCase();
    const currencyLabel = currency === 'aury' ? 'AURY' : currency === 'usdc' ? 'USDC' : 'Valcoins';
    const isCreator = cosmetic.createdBy === user.uid;
    
    const confirmMsg = isCreator 
      ? `🎁 Claim your creation "${cosmetic.name}" for free?`
      : `⚔️ Purchase "${cosmetic.name}" for ${cosmetic.price.toLocaleString()} ${currencyLabel}?`;

    if (!window.confirm(confirmMsg)) return;

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
    
    setEquipping(cosmetic.id);
    const result = await equipCosmetic(user.uid, isCurrentlyEquipped ? null : cosmetic.id, slot);
    setEquipping(null);

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
            {activeCategory === 'aura' && 'Adorn your avatar with mythical auras and custom effects'}
            {activeCategory === 'banner' && 'Fly your colors with legendary banners for your warrior profile'}
            {activeCategory === 'amiko' && 'Form bonds with mythical creatures to accompany you in your journey'}
            {activeCategory === 'item' && 'Equip powerful artifacts and consumable items for your adventures'}
            {activeCategory === 'ticket' && 'Acquire special access passes and raffle tickets for legendary events'}
            {activeCategory === 'ygg_theme' && 'Transform the World Tree with legendary themes and custom game skins'}
            {activeCategory === 'ygg_background' && 'Customize your ascent with breathtaking backgrounds and mystic sceneries'}
            {activeCategory === 'ygg_character' && 'Equip legendary hero skins and customize your champion\'s appearance'}
            {activeCategory === 'ygg_platforms' && 'Personalize the World Tree with custom platforms and mystical paths'}
            {newItemsCount > 0 && (
              <span className="new-items-highlight">
                ⚡ {newItemsCount} NEW ARRIVAL{newItemsCount > 1 ? 'S' : ''} IN THE VAULT
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="cosmetics-category-container">
        <div className="cosmetics-category-tabs">
          {(() => {
            const auraStats = getCategoryStats('aura');
            const bannerStats = getCategoryStats('banner');
            const amikoStats = getCategoryStats('amiko');
            const itemStats = getCategoryStats('item');
            const ticketStats = getCategoryStats('ticket');
            
            return (
              <>
                <button 
                  className={`category-tab ${activeCategory === 'aura' ? 'active' : ''} ${auraStats.hasNew ? 'has-new' : ''}`}
                  onClick={() => { setActiveCategory('aura'); setSelectedRarity('all'); }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>
                  <span>Auras</span>
                  <span className="tab-count">{auraStats.count}</span>
                  {auraStats.hasNew && <span className="tab-new-indicator">NEW</span>}
                </button>
                <button 
                  className={`category-tab ${activeCategory === 'banner' ? 'active' : ''} ${bannerStats.hasNew ? 'has-new' : ''}`}
                  onClick={() => { setActiveCategory('banner'); setSelectedRarity('all'); }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/></svg>
                  <span>Banners</span>
                  <span className="tab-count">{bannerStats.count}</span>
                  {bannerStats.hasNew && <span className="tab-new-indicator">NEW</span>}
                </button>
                <button 
                  className={`category-tab ${activeCategory === 'amiko' ? 'active' : ''} ${amikoStats.hasNew ? 'has-new' : ''}`}
                  onClick={() => { setActiveCategory('amiko'); setSelectedRarity('all'); }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="20" cy="16" r="2"/><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 18.144 6 15a5 5 0 0 1 3-5Z"/></svg>
                  <span>Amikos</span>
                  <span className="tab-count">{amikoStats.count}</span>
                  {amikoStats.hasNew && <span className="tab-new-indicator">NEW</span>}
                </button>
                <button 
                  className={`category-tab ${activeCategory === 'item' ? 'active' : ''} ${itemStats.hasNew ? 'has-new' : ''}`}
                  onClick={() => { setActiveCategory('item'); setSelectedRarity('all'); }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>
                  <span>Items</span>
                  <span className="tab-count">{itemStats.count}</span>
                  {itemStats.hasNew && <span className="tab-new-indicator">NEW</span>}
                </button>
                <button 
                  className={`category-tab ${activeCategory === 'ticket' ? 'active' : ''} ${ticketStats.hasNew ? 'has-new' : ''}`}
                  onClick={() => { setActiveCategory('ticket'); setSelectedRarity('all'); }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/></svg>
                  <span>Tickets</span>
                  <span className="tab-count">{ticketStats.count}</span>
                  {ticketStats.hasNew && <span className="tab-new-indicator">NEW</span>}
                </button>
                <button 
                  className={`category-tab ${activeCategory.startsWith('ygg_') ? 'active' : ''} ${(() => {
                    const stats = ['ygg_theme', 'ygg_background', 'ygg_character', 'ygg_platforms'].map(getCategoryStats);
                    return stats.some(s => s.hasNew);
                  })() ? 'has-new' : ''}`}
                  onClick={() => { setActiveCategory('ygg_theme'); setSelectedRarity('all'); }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                  <span>Yggdrasil</span>
                  <span className="tab-count">
                    {['ygg_theme', 'ygg_background', 'ygg_character', 'ygg_platforms'].reduce((acc, type) => acc + getCategoryStats(type).count, 0)}
                  </span>
                  {(() => {
                    const stats = ['ygg_theme', 'ygg_background', 'ygg_character', 'ygg_platforms'].map(getCategoryStats);
                    return stats.some(s => s.hasNew);
                  })() && <span className="tab-new-indicator">NEW</span>}
                </button>
              </>
            );
          })()}
        </div>
      </div>

      {/* Yggdrasil Sub-Tabs */}
      {activeCategory.startsWith('ygg_') && (
        <div className="cosmetics-sub-tabs">
          <button 
            className={`sub-tab ${activeCategory === 'ygg_theme' ? 'active' : ''}`}
            onClick={() => { setActiveCategory('ygg_theme'); setSelectedRarity('all'); }}
          >
            <span>Themes</span>
            <span className="sub-tab-count">{getCategoryStats('ygg_theme').count}</span>
          </button>
          <button 
            className={`sub-tab ${activeCategory === 'ygg_background' ? 'active' : ''}`}
            onClick={() => { setActiveCategory('ygg_background'); setSelectedRarity('all'); }}
          >
            <span>Backgrounds</span>
            <span className="sub-tab-count">{getCategoryStats('ygg_background').count}</span>
          </button>
          <button 
            className={`sub-tab ${activeCategory === 'ygg_character' ? 'active' : ''}`}
            onClick={() => { setActiveCategory('ygg_character'); setSelectedRarity('all'); }}
          >
            <span>Heroes</span>
            <span className="sub-tab-count">{getCategoryStats('ygg_character').count}</span>
          </button>
          <button 
            className={`sub-tab ${activeCategory === 'ygg_platforms' ? 'active' : ''}`}
            onClick={() => { setActiveCategory('ygg_platforms'); setSelectedRarity('all'); }}
          >
            <span>Platforms</span>
            <span className="sub-tab-count">{getCategoryStats('ygg_platforms').count}</span>
          </button>
        </div>
      )}

      {/* Action Message */}
      {actionMessage && (
        <div className={`cosmetics-action-msg ${actionMessage.type}`}>
          {actionMessage.text}
        </div>
      )}

      {/* Preview Section */}
      {(() => {
        const isAuraTab = activeCategory === 'aura';
        const isBannerTab = activeCategory === 'banner';
        
        // Hide visual preview entirely for other tabs to keep UI focused
        if (!isAuraTab && !isBannerTab) {
          return (
            <div className="cosmetics-minimal-balance-bar profile-sample-card">
               <div className="minimal-balance-content">
                  <div className="preview-balance">
                    <img src="/valcoin-icon.jpg" alt="valcoins" className="valcoin-shop-icon" style={{ borderRadius: '50%' }} />
                    <span>{(user.points || 0).toLocaleString()}</span>
                  </div>
                  <span className="preview-owned">{ownedCosmetics.length} / {cosmetics.length} Owned</span>
               </div>
            </div>
          );
        }

        const previewBanner = previewSlots.banner ? cosmetics.find(c => c.id === previewSlots.banner) : null;
        const previewStyle = previewBanner ? (getBannerStyleFromCosmetic(previewBanner) || {}) : (getEquippedBannerStyle(user) || {});
        const hasBannerPreview = previewStyle && Object.keys(previewStyle).length > 0;
        return (
          <div 
            className={`cosmetics-preview-bar profile-sample-card ${hasBannerPreview ? 'has-banner' : ''}`}
            style={previewStyle}
          >
        <div className="cosmetics-preview-avatar">
          {isAuraTab && (
            <div className="preview-pic-wrapper">
              <AvatarWithAura
                user={user}
                size={72}
                auraData={previewSlots.aura ? cosmetics.find(c => c.id === previewSlots.aura) : null}
                alwaysAnimate
              />
            </div>
          )}
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
            {(() => {
              const previewItem = previewSlots.aura ? cosmetics.find(c => c.id === previewSlots.aura) : 
                                 (previewSlots.banner ? cosmetics.find(c => c.id === previewSlots.banner) : null);
              const currency = previewItem?.currency || 'valcoins';
              
              let displayBalance = (user.points || 0).toLocaleString();
              let icon = "/valcoin-icon.jpg";
              
              if (currency === 'aury') {
                displayBalance = formatAuryAmount(walletBalance);
                icon = "/aury-icon.png";
              } else if (currency === 'usdc') {
                displayBalance = formatUsdcAmount(usdcBalance);
                icon = "/usdc-icon.png";
              }

              return (
                <div className="preview-balance">
                  <img src={icon} alt={currency} className="valcoin-shop-icon" style={{ borderRadius: currency === 'valcoins' ? '50%' : '0' }} />
                  <span>{displayBalance}</span>
                </div>
              );
            })()}
            <span className="preview-owned">{ownedCosmetics.length} / {cosmetics.length} Owned</span>
          </div>
        </div>
        );
      })()}

      {/* Rarity Filter Tabs */}
      <div className="cosmetics-filter-tabs">
        {(() => {
          const allStats = getRarityStats('all');
          return (
            <button
              className={`cosmetics-filter-tab ${selectedRarity === 'all' ? 'active' : ''} ${allStats.hasNew ? 'has-new' : ''}`}
              onClick={() => setSelectedRarity('all')}
            >
              <span>All</span>
              <span className="tab-count">{allStats.count}</span>
              {allStats.hasNew && <span className="tab-new-indicator">NEW</span>}
            </button>
          );
        })()}
        {RARITY_ORDER.map(rarity => {
          const stats = getRarityStats(rarity);
          return (
            <button
              key={rarity}
              className={`cosmetics-filter-tab ${selectedRarity === rarity ? 'active' : ''} ${stats.hasNew ? 'has-new' : ''}`}
              onClick={() => setSelectedRarity(rarity)}
              style={{ '--rarity-color': RARITY_CONFIG[rarity]?.color }}
            >
              <span>{RARITY_CONFIG[rarity]?.label}</span>
              <span className="tab-count">{stats.count}</span>
              {stats.hasNew && <span className="tab-new-indicator">NEW</span>}
            </button>
          );
        })}
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
             {activeCategory === 'aura' || activeCategory === 'banner' ? (
               <p>No {activeCategory}s available in Valhalla's Vault yet.</p>
             ) : (
               <div className="coming-soon-placeholder">
                 <div className="empty-icon">✨</div>
                 <h3>Magic is brewing...</h3>
                 <p>
                   New {activeCategory.replace('ygg_', 'Ygg ').replace('_', ' ')}s are being crafted by the gods.<br/>
                   <span>Check other tabs or swipe right to see more categories!</span>
                 </p>
                 {activeCategory.startsWith('ygg_') && (
                   <div className="empty-hint">
                     💡 Tip: Switch between <strong>Themes</strong>, <strong>Backgrounds</strong>, etc. using the sub-menu above!
                   </div>
                 )}
               </div>
             )}
          </div>
        ) : filteredCosmetics.map(cosmetic => {
          const isOwned = ownedCosmetics.includes(cosmetic.id);
          const isEquipped = (() => {
            if (cosmetic.type === 'aura') return equippedAura === cosmetic.id;
            if (cosmetic.type === 'banner') return equippedBanner === cosmetic.id;
            if (cosmetic.type === 'ygg_theme') return user?.equippedCosmetics?.ygg_theme === cosmetic.id;
            if (cosmetic.type === 'ygg_background') return user?.equippedCosmetics?.ygg_background === cosmetic.id;
            if (cosmetic.type === 'ygg_character') return user?.equippedCosmetics?.ygg_character === cosmetic.id;
            if (cosmetic.type === 'ygg_platforms') return user?.equippedCosmetics?.ygg_platforms === cosmetic.id;
            return false;
          })();
          const isPurchasing = purchasing === cosmetic.id;
          const rarityConf = RARITY_CONFIG[cosmetic.rarity];

          return (
            <div
              key={cosmetic.id}
              className={`cosmetic-card ${isOwned ? 'owned' : ''} ${isEquipped ? 'equipped' : ''} type-${cosmetic.type}`}
              style={{ 
                '--rarity-color': rarityConf?.color || '#ccc', 
                '--rarity-glow': rarityConf?.glow || 'none',
                ...(cosmetic.type === 'banner' ? (getBannerStyleFromCosmetic(cosmetic, hoveredCardId !== cosmetic.id) || {}) : {}),
                ...((cosmetic.type === 'ygg_theme' || cosmetic.type === 'ygg_background') && cosmetic.assets?.background ? { backgroundImage: `url("${cosmetic.assets.background}")`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}),
                ...(cosmetic.type === 'ygg_character' && cosmetic.assets?.hero_stand ? { backgroundImage: `url("${cosmetic.assets.hero_stand}")`, backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center' } : {}),
                ...(cosmetic.type === 'ygg_platforms' && cosmetic.assets?.platform_1 ? { backgroundImage: `url("${cosmetic.assets.platform_1}")`, backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center' } : {})
              }}
              onMouseEnter={() => {
                setPreviewSlots(prev => ({ ...prev, [cosmetic.type]: cosmetic.id }));
                setHoveredCardId(cosmetic.id);
                // Preload animated asset
                const animUrl = cosmetic.gifUrl;
                if (animUrl && !loadedAnimUrls.current.has(animUrl)) {
                  setLoadingCardId(cosmetic.id);
                  const img = new Image();
                  img.onload = () => { loadedAnimUrls.current.add(animUrl); setLoadingCardId(prev => prev === cosmetic.id ? null : prev); };
                  img.onerror = () => { setLoadingCardId(prev => prev === cosmetic.id ? null : prev); };
                  img.src = animUrl;
                }
              }}
              onMouseLeave={() => { setPreviewSlots({ aura: null, banner: null }); setHoveredCardId(null); setLoadingCardId(prev => prev === cosmetic.id ? null : prev); }}
            >
              {/* Rarity Badge */}
              <div className="cosmetic-rarity-badge" style={{ background: rarityConf?.color }}>
                {rarityConf?.label}
              </div>

              {/* SALE Badge */}
              {(() => {
                let discountPrice = (cosmetic.discountPrice !== undefined && cosmetic.discountPrice !== null) ? Number(cosmetic.discountPrice) : null;
                if (discountPrice !== null && cosmetic.discountExpiry) {
                  const expiry = cosmetic.discountExpiry.toDate ? cosmetic.discountExpiry.toDate() : new Date(cosmetic.discountExpiry);
                  if (new Date() > expiry) discountPrice = null;
                }
                if (discountPrice !== null && discountPrice < cosmetic.price) {
                  return <div className="sale-badge">SALE</div>;
                }
                return null;
              })()}

              {isEquipped && (
                <div className="cosmetic-equipped-badge">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  Equipped
                </div>
              )}

              {/* Mini Avatar Preview - Only for Auras */}
              {cosmetic.type === 'aura' && (
                <div className="cosmetic-card-preview">
                  <AvatarWithAura
                    user={user}
                    size={56}
                    auraData={cosmetic}
                    forceAnimate={hoveredCardId === cosmetic.id}
                  />
                  {(loadingCardId === cosmetic.id || purchasing === cosmetic.id || equipping === cosmetic.id) && (
                    <div className="cosmetic-card-loading">
                      <div className="cosmetic-card-spinner" />
                    </div>
                  )}
                </div>
              )}

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
                    disabled={equipping === cosmetic.id}
                  >
                    {equipping === cosmetic.id ? (
                      'Processing...'
                    ) : isEquipped ? (
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
                    className={`cosmetic-btn ${cosmetic.createdBy === user.uid ? 'claim-btn' : 'buy-btn'}`}
                    onClick={() => handlePurchase(cosmetic.id)}
                    disabled={isPurchasing || equipping === cosmetic.id || (cosmetic.createdBy !== user.uid && (
                      (() => {
                        let discountPrice = (cosmetic.discountPrice !== undefined && cosmetic.discountPrice !== null) ? Number(cosmetic.discountPrice) : null;
                        
                        // Check expiry
                        if (discountPrice !== null && cosmetic.discountExpiry) {
                          const expiry = cosmetic.discountExpiry.toDate ? cosmetic.discountExpiry.toDate() : new Date(cosmetic.discountExpiry);
                          if (new Date() > expiry) {
                            discountPrice = null;
                          }
                        }

                        const effectivePrice = (discountPrice !== null && discountPrice < cosmetic.price) 
                          ? discountPrice 
                          : cosmetic.price;
                        
                        return (cosmetic.currency || 'valcoins').toLowerCase() === 'aury' ? walletBalance < (effectivePrice * 1e9) :
                               (cosmetic.currency || 'valcoins').toLowerCase() === 'usdc' ? usdcBalance < (effectivePrice * 1e6) :
                               (user.points || 0) < effectivePrice;
                      })()
                    ))}
                  >
                    {isPurchasing ? (
                      'Processing...'
                    ) : cosmetic.createdBy === user.uid ? (
                      <>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"/><path d="M4 6v12c0 1.1.9 2 2 2h14v-4"/><path d="M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4h-4z"/></svg>
                        Claim Free
                      </>
                    ) : (
                      <>
                        <img 
                          src={(cosmetic.currency || 'valcoins').toLowerCase() === 'aury' ? '/aury-icon.png' : (cosmetic.currency || 'valcoins').toLowerCase() === 'usdc' ? '/usdc-icon.png' : '/valcoin-icon.jpg'} 
                          alt="" 
                          className="valcoin-btn-icon" 
                          style={{ borderRadius: (cosmetic.currency || 'valcoins').toLowerCase() === 'valcoins' ? '50%' : '0' }}
                        />
                        {(() => {
                          let discountPrice = (cosmetic.discountPrice !== undefined && cosmetic.discountPrice !== null) ? Number(cosmetic.discountPrice) : null;
                          
                          // Check expiry
                          if (discountPrice !== null && cosmetic.discountExpiry) {
                            const expiry = cosmetic.discountExpiry.toDate ? cosmetic.discountExpiry.toDate() : new Date(cosmetic.discountExpiry);
                            if (new Date() > expiry) {
                              discountPrice = null;
                            }
                          }

                          if (discountPrice !== null && discountPrice < cosmetic.price) {
                            return (
                              <div className="cosmetic-price-container">
                                <span className="original-price-strikethrough">{cosmetic.price.toLocaleString()}</span>
                                <span className="discounted-price">{discountPrice.toLocaleString()}</span>
                              </div>
                            );
                          }
                          return cosmetic.price.toLocaleString();
                        })()}
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
