import React, { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import RaffleHomeCard from './RaffleHomeCard';
import CreateRaffleModal from './CreateRaffleModal';
import './RafflesSection.css';

const RafflesSection = ({ user, isAdmin }) => {
    const [raffles, setRaffles] = useState([]);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('active');

    useEffect(() => {
        const rafflesRef = collection(db, 'raffles');
        // We show active and waiting raffles, and maybe recent completed ones
        const q = query(rafflesRef, orderBy('createdAt', 'desc'));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const rafflesData = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            // Filter to show only relatively recent or active ones for the homepage
            setRaffles(rafflesData.slice(0, 8)); 
            setLoading(false);
        }, (error) => {
            console.error('Error fetching raffles:', error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    const filterTabs = [
        { key: 'active', label: 'Open', icon: '🟢' },
        { key: 'ended', label: 'Ended', icon: '✅' },
        { key: 'joined', label: 'Joined', icon: '👤' }
    ];

    const getFilteredRaffles = () => {
        return raffles.filter(r => {
            if (filter === 'active') return r.status === 'active' || r.status === 'spinning' || r.status === 'entries_closed';
            if (filter === 'ended') return r.status === 'completed';
            if (filter === 'joined') return user && r.participants?.some(p => p.uid === user.uid);
            return true;
        });
    };

    const getTabCount = (key) => {
        return raffles.filter(r => {
            if (key === 'active') return r.status === 'active' || r.status === 'spinning' || r.status === 'entries_closed';
            if (key === 'ended') return r.status === 'completed';
            if (key === 'joined') return user && r.participants?.some(p => p.uid === user.uid);
            return true;
        }).length;
    };

    const filteredRaffles = getFilteredRaffles();

    return (
        <section className="tournaments-section raffles-section dashboard-widget">
            <div className="section-header">
                <div className="header-title-group">
                    <h3>🎟️ All Raffles</h3>
                    <p className="section-subtitle">Win premium items and tokens in our community raffles</p>
                </div>
                {isAdmin && (
                    <button onClick={() => setShowCreateModal(true)} className="create-raffle-btn-primary">
                        <span className="plus-icon">+</span> Create Raffle
                    </button>
                )}
            </div>

            <div className="tournament-filters">
                <div className="filter-tabs-row">
                    {filterTabs.map(tab => {
                        const count = getTabCount(tab.key);
                        return (
                            <button
                                key={tab.key}
                                className={`filter-tab ${filter === tab.key ? 'active' : ''}`}
                                onClick={() => setFilter(tab.key)}
                            >
                                <span className="filter-tab-icon">{tab.icon}</span>
                                <span className="filter-tab-label">{tab.label}</span>
                                {count > 0 && (
                                    <span className="filter-tab-count">
                                        {count}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>

            {loading ? (
                <div className="raffles-loading">
                    <div className="loader"></div>
                    <span>Loading raffles...</span>
                </div>
            ) : filteredRaffles.length > 0 ? (
                <div className="tournaments-grid raffles-grid">
                    {filteredRaffles.map(raffle => (
                        <RaffleHomeCard
                            key={raffle.id}
                            raffle={raffle}
                        />
                    ))}
                </div>
            ) : (
                <div className="no-raffles">
                    <div className="empty-icon">🎟️</div>
                    <p>
                        {filter === 'active' ? 'No active raffles yet.' : 
                         filter === 'ended' ? 'No ended raffles found.' : 
                         'You haven\'t joined any raffles yet.'}
                    </p>
                    {isAdmin && filter === 'active' && <p className="admin-hint">Click "Create Raffle" to start the first one!</p>}
                </div>
            )}

            {showCreateModal && (
                <CreateRaffleModal
                    isOpen={showCreateModal}
                    onClose={() => setShowCreateModal(false)}
                    user={user}
                />
            )}
        </section>
    );
};

export default RafflesSection;
