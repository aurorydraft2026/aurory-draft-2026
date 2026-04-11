import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import RaffleCard from '../components/raffles/RaffleCard';
import CreateRaffleModal from '../components/raffles/CreateRaffleModal';
import './RafflesListingPage.css';

const RafflesListingPage = () => {
  const { user, isAdminUser } = useAuth();
  const [raffles, setRaffles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'raffles'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setRaffles(docs);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const activeRaffles = raffles.filter(r => r.status !== 'completed');
  const pastRaffles = raffles.filter(r => r.status === 'completed');

  return (
    <div className="raffles-listing-page">
      <div className="viking-section-header hero-header">
        <h1 className="viking-section-title">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 9V5.2a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2V9" /><path d="M2 15v3.8a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V15" /><rect x="2" y="9" width="20" height="6" rx="2" /><path d="M15 9v6" /><path d="M9 9v6" /></svg>
          Fate Draw
        </h1>
        <div className="viking-title-line"></div>
        <p className="viking-section-subtitle">Join exclusive draws for Amikos, Eggs, Skins, and AURY!</p>

        {isAdminUser && (
            <button className="create-raffle-btn-primary header-action" onClick={() => setShowCreateModal(true)}>
                <span className="plus-icon">+</span> Create Draw
            </button>
        )}
      </div>

      <section className="raffles-section">
        <div className="viking-section-header">
          <h2 className="viking-section-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
            Active Draws
          </h2>
          <div className="viking-title-line"></div>
        </div>
        {loading ? (
          <div className="raffle-loading">Loading Raffles...</div>
        ) : activeRaffles.length === 0 ? (
          <div className="no-raffles">No active raffles at the moment. Check back soon!</div>
        ) : (
          <div className="raffles-grid">
            {activeRaffles.map(raffle => (
              <RaffleCard key={raffle.id} raffle={raffle} />
            ))}
          </div>
        )}
      </section>

      {pastRaffles.length > 0 && (
        <section className="raffles-section past-raffles">
            <div className="viking-section-header">
              <h2 className="viking-section-title">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                Previous Sagas
              </h2>
              <div className="viking-title-line"></div>
            </div>
            <div className="raffles-grid">
                {pastRaffles.map(raffle => (
                    <RaffleCard key={raffle.id} raffle={raffle} />
                ))}
            </div>
        </section>
      )}

      {showCreateModal && (
        <CreateRaffleModal 
            isOpen={showCreateModal} 
            onClose={() => setShowCreateModal(false)}
            user={user}
        />
      )}
    </div>
  );
};

export default RafflesListingPage;
