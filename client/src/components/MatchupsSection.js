import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import MatchupCard from './MatchupCard';
import CreateMatchupModal from './CreateMatchupModal';
import './MatchupsSection.css';

const MatchupsSection = ({ user, isAdmin }) => {
    const [matchups, setMatchups] = useState([]);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const matchupsRef = collection(db, 'matchups');
        const q = query(matchupsRef, orderBy('createdAt', 'desc'));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const matchupsData = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setMatchups(matchupsData);
            setLoading(false);
        }, (error) => {
            console.error('Error fetching matchups:', error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    return (
        <section className="matchups-section">
            <div className="section-header">
                <div className="header-title-group">
                    <h3>🏆 All Matchups</h3>
                    <p className="section-subtitle">Join upcoming matchups and earn rewards</p>
                </div>
                {isAdmin && (
                    <button onClick={() => setShowCreateModal(true)} className="create-matchup-btn-primary">
                        <span className="plus-icon">+</span> Create Matchup
                    </button>
                )}
            </div>

            {loading ? (
                <div className="matchups-loading">
                    <div className="loader"></div>
                    <span>Loading matchups...</span>
                </div>
            ) : matchups.length > 0 ? (
                <div className="matchups-grid">
                    {matchups.map(matchup => (
                        <MatchupCard
                            key={matchup.id}
                            matchup={matchup}
                            user={user}
                            isAdmin={isAdmin}
                        />
                    ))}
                </div>
            ) : (
                <div className="no-matchups">
                    <div className="empty-icon">🎮</div>
                    <p>No active matchups yet.</p>
                    {isAdmin && <p className="admin-hint">Click "Create Matchup" to start the first one!</p>}
                </div>
            )}

            <CreateMatchupModal
                isOpen={showCreateModal}
                onClose={() => setShowCreateModal(false)}
                user={user}
            />
        </section>
    );
};

export default MatchupsSection;
