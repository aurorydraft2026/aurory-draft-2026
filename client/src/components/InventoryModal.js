import React, { useState, useEffect, useMemo } from 'react';
import auroryInventoryService from '../services/auroryInventoryService';
import AmikoInventoryCard from './AmikoInventoryCard';
import './InventoryModal.css';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

const InventoryModal = ({ isOpen, onClose, user }) => {
    const [activeTab, setActiveTab] = useState('amikos');
    const [inventory, setInventory] = useState(null);
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState(null);

    // Listen to Firestore for inventory updates
    useEffect(() => {
        if (!user || !isOpen) return;

        const userRef = doc(db, 'users', user.uid);
        const unsubscribe = onSnapshot(userRef, (snapshot) => {
            if (snapshot.exists()) {
                const userData = snapshot.data();
                setInventory(userData.inventory || { amikos: [], lastSync: null });
            }
        });

        return () => unsubscribe();
    }, [user, isOpen]);

    const handleSync = async () => {
        if (!user) return;
        setSyncing(true);
        setError(null);
        try {
            const result = await auroryInventoryService.syncInventoryToFirestore(user.uid);
            if (!result.success) {
                setError(result.error);
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setSyncing(false);
        }
    };

    const amikos = useMemo(() => {
        return inventory?.amikos || [];
    }, [inventory]);

    if (!isOpen) return null;

    return (
        <div className="inventory-modal-overlay" onClick={onClose}>
            <div className="inventory-modal" onClick={e => e.stopPropagation()}>
                <button className="inventory-modal-close" onClick={onClose}>×</button>

                <div className="inventory-modal-header">
                    <div className="header-left">
                        <h2>🎒 My Inventory</h2>
                        {inventory?.lastSync && (
                            <span className="last-sync">
                                Last synced: {new Date(inventory.lastSync.toDate?.() || inventory.lastSync).toLocaleString()}
                            </span>
                        )}
                    </div>
                    <button
                        className={`sync-button ${syncing ? 'syncing' : ''}`}
                        onClick={handleSync}
                        disabled={syncing}
                    >
                        {syncing ? 'Syncing...' : '🔄 Sync Now'}
                    </button>
                </div>

                <div className="inventory-tabs">
                    <button
                        className={`tab-btn ${activeTab === 'amikos' ? 'active' : ''}`}
                        onClick={() => setActiveTab('amikos')}
                    >
                        Amikos ({amikos.length})
                    </button>
                    <button
                        className={`tab-btn ${activeTab === 'eggs' ? 'active' : ''}`}
                        onClick={() => setActiveTab('eggs')}
                    >
                        Eggs (0)
                    </button>
                </div>

                <div className="inventory-body">
                    {error && <div className="inventory-error">⚠️ {error}</div>}

                    {activeTab === 'amikos' ? (
                        amikos.length > 0 ? (
                            <div className="amikos-grid">
                                {amikos.map(amiko => (
                                    <AmikoInventoryCard key={amiko.id} amiko={amiko} />
                                ))}
                            </div>
                        ) : (
                            <div className="empty-inventory">
                                <p>No Amikos found in your inventory.</p>
                                <p className="hint">Make sure you are logged into <strong>app.aurory.io</strong> and click <strong>Sync Now</strong>.</p>
                            </div>
                        )
                    ) : (
                        <div className="empty-inventory">
                            <p>Eggs tab is currently empty.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default InventoryModal;
