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
      <div className="raffles-listing-header">
        <div className="header-text">
            <h1>🛡️ Asgard Raffles</h1>
            <p>Join exclusive raffles for Amikos, Eggs, Skins, and AURY!</p>
        </div>
        
        {isAdminUser && (
            <button className="create-raffle-btn-top" onClick={() => setShowCreateModal(true)}>
                + Create Raffle
            </button>
        )}
      </div>

      <section className="raffles-section">
        <h2 className="section-title">Active Raffles</h2>
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
            <h2 className="section-title">Previous Raffles</h2>
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
