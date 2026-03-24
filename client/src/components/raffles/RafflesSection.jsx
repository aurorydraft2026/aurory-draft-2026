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

    return (
        <section className="raffles-section">
            <div className="section-header">
                <div className="header-title-group">
                    <h3>🎟️ active Raffles</h3>
                    <p className="section-subtitle">Win premium items and tokens in our community raffles</p>
                </div>
                {isAdmin && (
                    <button onClick={() => setShowCreateModal(true)} className="create-raffle-btn-primary">
                        <span className="plus-icon">+</span> Create Raffle
                    </button>
                )}
            </div>

            {loading ? (
                <div className="raffles-loading">
                    <div className="loader"></div>
                    <span>Loading raffles...</span>
                </div>
            ) : raffles.length > 0 ? (
                <div className="raffles-grid">
                    {raffles.map(raffle => (
                        <RaffleHomeCard
                            key={raffle.id}
                            raffle={raffle}
                        />
                    ))}
                </div>
            ) : (
                <div className="no-raffles">
                    <div className="empty-icon">🎟️</div>
                    <p>No active raffles yet.</p>
                    {isAdmin && <p className="admin-hint">Click "Create Raffle" to start the first one!</p>}
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
