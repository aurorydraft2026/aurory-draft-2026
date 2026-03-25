import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { useWallet } from '../hooks/useWallet';
import { 
  joinRaffle, 
  startRaffle, 
  deleteRaffle, 
  shuffleParticipants, 
  completeRaffle,
  addMockParticipants
} from '../services/raffleService';
import RaffleWheel from '../components/raffles/RaffleWheel';
import RaffleParticipantsModal from '../components/raffles/RaffleParticipantsModal';
import RaffleWinnerModal from '../components/raffles/RaffleWinnerModal';
import CreateRaffleModal from '../components/raffles/CreateRaffleModal';
import AuroryAccountLink from '../components/AuroryAccountLink';
import './RafflePage.css';

  const RafflePage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, isAdminUser, setShowLoginModal } = useAuth(navigate);
  const { formatAuryAmount } = useWallet(user);

  console.log('🔍 RafflePage Auth State:', { user, isAdminUser });

  const [raffle, setRaffle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);
  const [showWinner, setShowWinner] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAuroryModal, setShowAuroryModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => {
    if (!id) return;

    const unsubscribe = onSnapshot(doc(db, 'raffles', id), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setRaffle({ id: docSnap.id, ...data });
        if (data.status === 'spinning') {
            setIsStarting(false);
        }
      } else {
        if (!isDeleting) {
            alert('Raffle not found');
        }
        navigate('/');
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [id, navigate, isDeleting]);

  const handleJoin = async () => {
    if (!user) {
      setShowLoginModal(true);
      return;
    }

    if (!user.auroryPlayerId) {
        setShowAuroryModal(true);
        return;
    }

    setJoining(true);
    const auroryData = {
        playerName: user.auroryPlayerName,
        playerId: user.auroryPlayerId
    };
    const result = await joinRaffle(id, user, auroryData);
    if (!result.success) {
      alert(result.error);
    }
    setJoining(false);
  };

  const handleStartSpin = async () => {
    if (!isAdminUser || isStarting) return;
    
    setIsStarting(true);
    const result = await startRaffle(id, user);
    if (!result.success) {
      alert(result.error);
      setIsStarting(false);
    }
  };

  const handleSpinEnd = async () => {
    if (isAdminUser) {
        await completeRaffle(id);
    }
    setShowWinner(true);
  };

  const handleDelete = async () => {
    if (!window.confirm('Are you sure you want to delete this raffle? Participants will be refunded.')) return;
    setIsDeleting(true);
    const result = await deleteRaffle(id, user);
    if (result.success) {
      navigate('/');
    } else if (result.error === 'Raffle not found') {
      navigate('/');
    } else {
      alert(result.error);
    }
  };

  const handleShuffle = async () => {
    const result = await shuffleParticipants(id, user);
    if (!result.success) {
      alert(result.error);
    }
  };
  
  const handleAddMock = async () => {
      const count = prompt('How many mock participants to add?', '5');
      if (!count || isNaN(count)) return;
      
      const result = await addMockParticipants(id, parseInt(count));
      if (!result.success) {
        alert(result.error);
      }
  };

  if (loading) return <div className="raffle-loading">Loading Raffle...</div>;
  if (!raffle) return null;

  const isJoined = raffle.participants?.some(p => p.uid === user?.uid);
  const isSpinning = raffle.status === 'spinning';
  const isCompleted = raffle.status === 'completed';
  const canJoin = !isJoined && !isSpinning && !isCompleted && raffle.participantsCount < raffle.maxParticipants;
  const isAury = raffle.itemType === 'aury';

  return (
    <div className="raffle-page">
      {/* Page Header — matches Tournament/Matchup pages */}
      <header className="raffle-page-header">
        <div className="raffle-page-title">
          <h1>{raffle.itemType} Raffle</h1>
          <span className="raffle-page-subtitle">{raffle.description}</span>
        </div>
        <button className="back-home-btn" onClick={() => navigate('/')}>
          ← Back to Home
        </button>
      </header>

      <div className="raffle-header">
        <div className="item-info-top">
          {isAury ? (
            <div className="aury-prize-badge">
              <span className="aury-amount">{raffle.auryAmount || 0}</span>
              <span className="aury-label">AURY</span>
            </div>
          ) : (
            raffle.itemImage && <img src={raffle.itemImage} alt={raffle.itemType} className="raffle-item-large" />
          )}
          <div className="item-text-top">
            <p>{raffle.description}</p>
            {!isAury && raffle.itemLink && (
              <a href={raffle.itemLink} target="_blank" rel="noopener noreferrer" className="raffle-item-link">
                View Item Details ↗
              </a>
            )}
          </div>
        </div>

        <div className="raffle-stats-strip">
          <div className="raffle-stat-box">
            <span className="raffle-stat-label">Total Entry Fees</span>
            <span className="raffle-stat-value">{formatAuryAmount(raffle.totalFeesCollected || 0)} AURY</span>
          </div>
          <div className="raffle-stat-box">
            <span className="raffle-stat-label">Entry Fee</span>
            <span className="raffle-stat-value">{raffle.isFree ? 'FREE' : `${raffle.entryFee} AURY`}</span>
          </div>
          <div className="raffle-stat-box">
            <span className="raffle-stat-label">Participants</span>
            <span className="raffle-stat-value">{raffle.participantsCount} / {raffle.maxParticipants}</span>
          </div>
        </div>
      </div>

      <div className="raffle-main">
        <div className="wheel-section">
          {isAdminUser && !isSpinning && !isCompleted && (
            <div className="admin-wheel-controls">
                <button className="raffle-btn admin-shuffle" onClick={handleShuffle}>
                    Randomize Participants
                </button>
                <button className="raffle-btn admin-mock" onClick={handleAddMock} title="Super Admin Only">
                    Add Mock Participants
                </button>
                <button 
                    className={`raffle-btn admin-start ${isStarting || isSpinning || isCompleted ? 'disabled' : ''}`} 
                    onClick={handleStartSpin}
                    disabled={raffle.participantsCount < raffle.minParticipants || isStarting || isSpinning || isCompleted}
                >
                    {isStarting ? 'Please wait...' : 'Start Raffle (Spin)'}
                </button>
            </div>
          )}

          <RaffleWheel 
            participants={raffle.participants}
            onSpinEnd={handleSpinEnd}
            itemImage={isAury ? null : raffle.itemImage}
            itemLink={isAury ? null : raffle.itemLink}
            auryAmount={isAury ? raffle.auryAmount : null}
            winnerId={raffle.winner?.uid}
            status={raffle.status}
            isStarting={isStarting}
            minParticipants={raffle.minParticipants}
          />
        </div>

        <div className="raffle-actions-aside">
            {!isSpinning && !isCompleted && (
                <div className="joining-section">
                    {isJoined ? (
                        <div className="joined-status">
                            <span className="check">✓</span> You are in this raffle
                        </div>
                    ) : (!user || user.isAnonymous) ? (
                        <div className="guest-join-container">
                            <button 
                                className="join-btn-large disabled"
                                disabled
                            >
                                Join Raffle
                            </button>
                            <p className="login-note">Log in to participate</p>
                        </div>
                    ) : (
                        <button 
                            className={`join-btn-large ${!canJoin ? 'disabled' : ''}`}
                            onClick={handleJoin}
                            disabled={!canJoin || joining}
                        >
                            {joining ? 'Joining...' : 'Join Raffle'}
                        </button>
                    )}
                </div>
            )}

            {isCompleted && raffle.winner && (
                <button className="raffle-btn prize-celebration-btn" onClick={() => setShowWinner(true)}>
                    🎊 Show Winner
                </button>
            )}

            <button className="raffle-btn secondary" onClick={() => setShowParticipants(true)}>
                Show All Participants
            </button>

            {isAdminUser && (
                <div className="admin-danger-zone">
                    <button className="raffle-btn edit-btn" onClick={() => setShowEditModal(true)}>
                        ✏️ Edit Raffle
                    </button>
                    <button className="raffle-btn danger" onClick={handleDelete}>
                        Delete Raffle
                    </button>
                </div>
            )}
        </div>
      </div>

      {showParticipants && (
        <RaffleParticipantsModal 
            participants={raffle.participants} 
            onClose={() => setShowParticipants(false)} 
        />
      )}

      {showWinner && (
        <RaffleWinnerModal 
            winner={raffle.winner} 
            itemType={raffle.itemType}
            itemImage={raffle.itemImage}
            auryAmount={isAury ? raffle.auryAmount : null}
            onClose={() => setShowWinner(false)} 
        />
      )}

      {showEditModal && (
        <CreateRaffleModal
          isOpen={showEditModal}
          onClose={() => setShowEditModal(false)}
          user={user}
          editData={raffle}
        />
      )}

      <AuroryAccountLink
        user={user}
        isOpen={showAuroryModal}
        onClose={() => setShowAuroryModal(false)}
      />
    </div>
  );
};

export default RafflePage;
