import React, { useState, useMemo, useEffect } from 'react';
import { collection, getDocs, doc, addDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { getAllCosmetics, equipCosmetic, getBannerStyleFromCosmetic } from '../services/cosmeticsService';
import { RARITY_CONFIG } from '../data/cosmetics';
import AvatarWithAura from './AvatarWithAura';
import './ArmoryModal.css';

const ArmoryModal = ({ isOpen, onClose, user }) => {
    const [activeTab, setActiveTab] = useState('aura');
    const [actionMessage, setActionMessage] = useState(null);

    const [allCosmetics, setAllCosmetics] = useState([]);
    const [prizes, setPrizes] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (isOpen && user?.uid) {
            setIsLoading(true);

            const fetchAll = async () => {
                try {
                    // Fetch global cosmetics catalog
                    const cosmeticsData = await getAllCosmetics();
                    setAllCosmetics(cosmeticsData);

                    // Fetch user's unique prizes subcollection
                    const prizesRef = collection(db, 'users', user.uid, 'prizes');
                    const prizesSnap = await getDocs(prizesRef);
                    const prizesData = prizesSnap.docs.map(doc => ({
                        id: doc.id,
                        type: 'prize', // Force type for armory filtering
                        ...doc.data()
                    }));
                    setPrizes(prizesData);
                } catch (error) {
                    console.error("Error fetching armory items:", error);
                } finally {
                    setIsLoading(false);
                }
            };

            fetchAll();
        }
    }, [isOpen, user?.uid]);

    const ownedCosmetics = useMemo(() => {
        const ownedIds = user?.ownedCosmetics || [];
        const catalogOwned = allCosmetics.filter(c => ownedIds.includes(c.id));
        // Merge catalog cosmetics with unique prizes
        return [...catalogOwned, ...prizes];
    }, [user?.ownedCosmetics, allCosmetics, prizes]);

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

    const handleClaimPrize = async (item) => {
        if (item.status === 'claimed' || item.status === 'pending') {
            setActionMessage({ type: 'info', text: `This prize is already ${item.status}.` });
            return;
        }

        const confirm = window.confirm(`Are you sure you want to claim "${item.name}"? You will receive your item within 24 hours .`);
        if (!confirm) return;

        try {
            // 1. Create a claim request for the admin
            await addDoc(collection(db, 'prize_claims'), {
                userId: user.uid,
                userName: user.displayName || user.username || 'Anonymous',
                userEmail: user.email || 'N/A',
                prizeId: item.id,
                prizeName: item.name,
                prizeImage: item.image || item.pngUrl || '',
                rarity: item.rarity,
                status: 'pending',
                createdAt: serverTimestamp()
            });

            // 2. Mark the local prize as pending in the user's collection
            const prizeRef = doc(db, 'users', user.uid, 'prizes', item.id);
            await updateDoc(prizeRef, {
                status: 'pending',
                claimedAt: serverTimestamp()
            });

            // Update local state to show pending immediately
            setPrizes(prev => prev.map(p => p.id === item.id ? { ...p, status: 'pending' } : p));

            setActionMessage({ type: 'success', text: 'Claim request sent! Admin will review it soon.' });
            setTimeout(() => setActionMessage(null), 4000);
        } catch (error) {
            console.error("Error claiming prize:", error);
            setActionMessage({ type: 'error', text: 'Failed to send claim request.' });
        }
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="viking-modal armory-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <div className="header-content">
                        <h2 className="viking-modal-title">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '12px', color: 'var(--accent-gold)' }}><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></svg>
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
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px' }}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
                        {actionMessage.text}
                    </div>
                )}

                <div className="armory-tabs">
                    <button
                        className={`armory-tab ${activeTab === 'aura' ? 'active' : ''}`}
                        onClick={() => setActiveTab('aura')}
                    >
                        <span className="tab-icon">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" /></svg>
                        </span>
                        Auras ({ownedCosmetics.filter(c => c.type === 'aura').length})
                    </button>
                    <button
                        className={`armory-tab ${activeTab === 'banner' ? 'active' : ''}`}
                        onClick={() => setActiveTab('banner')}
                    >
                        <span className="tab-icon">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" x2="4" y1="22" y2="15" /></svg>
                        </span>
                        Banners ({ownedCosmetics.filter(c => c.type === 'banner').length})
                    </button>
                    <button
                        className={`armory-tab ${activeTab === 'prize' ? 'active' : ''}`}
                        onClick={() => setActiveTab('prize')}
                    >
                        <span className="tab-icon">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><rect width="12" height="8" x="6" y="4" rx="1" /></svg>
                        </span>
                        Prizes ({ownedCosmetics.filter(c => c.type === 'prize').length})
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
                                                    <AvatarWithAura user={user} size={64} auraData={item} alwaysAnimate />
                                                </div>
                                            ) : item.type === 'banner' ? (
                                                <div className="banner-preview-item" style={getBannerStyleFromCosmetic(item) || {}}></div>
                                            ) : (
                                                <div className="prize-preview-item">
                                                    <img src={item.pngUrl || item.image} alt={item.name} />
                                                </div>
                                            )}
                                            {isEquipped && (
                                                <div className="equipped-badge">
                                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                                                    Equipped
                                                </div>
                                            )}
                                        </div>
                                        <div className="armory-card-info">
                                            <span className="item-rarity-tag" style={{ color: RARITY_CONFIG[item.rarity]?.color || '#8b9db6' }}>
                                                {item.rarity}
                                            </span>
                                            <h4 className="item-name">{item.name}</h4>
                                            {activeTab === 'prize' ? (
                                                <button
                                                    className={`armory-equip-btn ${item.status === 'claimed' ? 'equipped' : item.status === 'pending' ? 'pending' : ''}`}
                                                    onClick={() => handleClaimPrize(item)}
                                                    disabled={item.status === 'claimed' || item.status === 'pending'}
                                                >
                                                    {item.status === 'claimed' ? (
                                                        <>
                                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
                                                            Claimed
                                                        </>
                                                    ) : item.status === 'pending' ? (
                                                        <>
                                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                                                            Pending...
                                                        </>
                                                    ) : (
                                                        <>
                                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><rect width="12" height="8" x="6" y="4" rx="1" /></svg>
                                                            Claim Prize
                                                        </>
                                                    )}
                                                </button>
                                            ) : (
                                                <button
                                                    className={`armory-equip-btn ${isEquipped ? 'equipped' : ''}`}
                                                    onClick={() => handleEquip(item)}
                                                >
                                                    {isEquipped ? (
                                                        <>
                                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0" /><line x1="12" x2="12" y1="2" y2="12" /></svg>
                                                            Unequip
                                                        </>
                                                    ) : (
                                                        <>
                                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M12 8v8" /><path d="M8 12h8" /></svg>
                                                            Equip
                                                        </>
                                                    )}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="armory-empty">
                            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.2, marginBottom: '16px' }}><circle cx="12" cy="12" r="10" /><line x1="12" x2="12" y1="8" y2="12" /><line x1="12" x2="12.01" y1="16" y2="16" /></svg>
                            <p>You haven't claim any {activeTab === 'prize' ? 'prize' : activeTab}s yet, Warrior.</p>
                            <span className="armory-hint">Visit the Cosmetics Shop to acquire legendary relics.</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ArmoryModal;
