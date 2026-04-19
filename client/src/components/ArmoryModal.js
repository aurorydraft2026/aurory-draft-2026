import React, { useState, useMemo, useEffect } from 'react';
import { getAllCosmetics, equipCosmetic, getBannerStyleFromCosmetic } from '../services/cosmeticsService';
import { RARITY_CONFIG } from '../data/cosmetics';
import AvatarWithAura from './AvatarWithAura';
import './ArmoryModal.css';

const ArmoryModal = ({ isOpen, onClose, user }) => {
    const [activeTab, setActiveTab] = useState('aura');
    const [actionMessage, setActionMessage] = useState(null);

    const [allCosmetics, setAllCosmetics] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (isOpen) {
            setIsLoading(true);
            getAllCosmetics().then(data => {
                setAllCosmetics(data);
                setIsLoading(false);
            });
        }
    }, [isOpen]);

    const ownedCosmetics = useMemo(() => {
        const ownedIds = user?.ownedCosmetics || [];
        return allCosmetics.filter(c => ownedIds.includes(c.id));
    }, [user?.ownedCosmetics, allCosmetics]);

    const activeItems = useMemo(() => {
        return ownedCosmetics.filter(c => c.type === activeTab);
    }, [ownedCosmetics, activeTab]);

    const handleEquip = async (cosmetic) => {
        const isEquipped = user?.equippedCosmetics?.[cosmetic.type] === cosmetic.id;
        try {
            // If already equipped, pass null to unequip
            const result = await equipCosmetic(user.uid, isEquipped ? null : cosmetic.id, cosmetic.type);
            if (result.success) {
                setActionMessage({ 
                    type: 'success', 
                    text: isEquipped ? `${cosmetic.name} unequipped!` : `${cosmetic.name} equipped!` 
                });
                setTimeout(() => setActionMessage(null), 3000);
            }
        } catch (error) {
            setActionMessage({ type: 'error', text: 'Failed to update equipment.' });
        }
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="viking-modal armory-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <div className="header-content">
                        <h2 className="viking-modal-title">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: '12px', color: 'var(--accent-gold)'}}><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                            Warrior's Armory
                        </h2>
                        <p className="viking-modal-subtitle">Manage your legendary relics and battle ornaments</p>
                    </div>
                    <button className="viking-modal-close" onClick={onClose} title="Close Armory">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>

                {actionMessage && (
                    <div className={`armory-action-msg ${actionMessage.type}`}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: '8px'}}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                        {actionMessage.text}
                    </div>
                )}

                <div className="armory-tabs">
                    <button
                        className={`armory-tab ${activeTab === 'aura' ? 'active' : ''}`}
                        onClick={() => setActiveTab('aura')}
                    >
                        <span className="tab-icon">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>
                        </span>
                        Auras ({ownedCosmetics.filter(c => c.type === 'aura').length})
                    </button>
                    <button
                        className={`armory-tab ${activeTab === 'banner' ? 'active' : ''}`}
                        onClick={() => setActiveTab('banner')}
                    >
                        <span className="tab-icon">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/></svg>
                        </span>
                        Banners ({ownedCosmetics.filter(c => c.type === 'banner').length})
                    </button>
                </div>

                <div className="modal-body custom-scrollbar">
                    {isLoading ? (
                        <div className="armory-loading-container">
                            <div className="aura-loader"></div>
                            <p>Fetching legendary relics...</p>
                        </div>
                    ) : activeItems.length > 0 ? (
                        <div className="armory-grid">
                            {activeItems.map(item => {
                                const isEquipped = user?.equippedCosmetics?.[item.type] === item.id;
                                return (
                                    <div key={item.id} className={`armory-card rarity-${item.rarity}`}>
                                        <div className="armory-card-preview">
                                            {item.type === 'aura' ? (
                                                <div className="aura-preview-item">
                                                    <AvatarWithAura user={user} size={64} auraData={item} />
                                                </div>
                                            ) : (
                                                <div className="banner-preview-item" style={getBannerStyleFromCosmetic(item) || {}}></div>
                                            )}
                                            {isEquipped && (
                                                <div className="equipped-badge">
                                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                                                    Equipped
                                                </div>
                                            )}
                                        </div>
                                        <div className="armory-card-info">
                                            <span className="item-rarity-tag" style={{color: RARITY_CONFIG[item.rarity].color}}>
                                                {item.rarity}
                                            </span>
                                            <h4 className="item-name">{item.name}</h4>
                                            <button 
                                                className={`armory-equip-btn ${isEquipped ? 'equipped' : ''}`}
                                                onClick={() => handleEquip(item)}
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
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="armory-empty">
                            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{opacity: 0.2, marginBottom: '16px'}}><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>
                            <p>You haven't claim any {activeTab}s yet, Warrior.</p>
                            <span className="armory-hint">Visit the Cosmetics Shop to acquire legendary relics.</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ArmoryModal;
