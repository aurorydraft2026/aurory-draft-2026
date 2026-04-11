import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import { 
  doc, 
  onSnapshot, 
  collection, 
  addDoc, 
  setDoc,
  query, 
  orderBy, 
  limit, 
  serverTimestamp, 
  runTransaction,
  deleteDoc
} from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { useWallet } from '../hooks/useWallet';
import { useRef } from 'react';
import { 
  joinRaffle, 
  startRaffle, 
  deleteRaffle, 
  shuffleParticipants, 
  completeRaffle,
  closeRaffleEntries,
  addMockParticipants,
  removeRaffleParticipant
} from '../services/raffleService';
import RaffleWheel from '../components/raffles/RaffleWheel';
import RaffleParticipantsModal from '../components/raffles/RaffleParticipantsModal';
import RaffleWinnerModal from '../components/raffles/RaffleWinnerModal';
import CreateRaffleModal from '../components/raffles/CreateRaffleModal';
import RaffleConfirmationModal from '../components/raffles/RaffleConfirmationModal';
import AuroryAccountLink from '../components/AuroryAccountLink';
import { resolveDisplayName, resolveAvatar } from '../utils/userUtils';
import './RafflePage.css';

  const RafflePage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, isAdminUser, setShowLoginModal } = useAuth(navigate);
  const { formatAuryAmount, formatUsdcAmount } = useWallet(user);



  const [raffle, setRaffle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);
  const [showWinner, setShowWinner] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAuroryModal, setShowAuroryModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  
  // Chat State
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [typingUsers, setTypingUsers] = useState({});
  const [showReactionPicker, setShowReactionPicker] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  
  const chatEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const lastReadTimeRef = useRef(Date.now());
  const lastTypingUpdateRef = useRef(0);
  
  const triggerConfirm = (actionConfig) => {
    setConfirmAction(actionConfig);
  };

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

  // ─── CHAT LISTENERS ───
  useEffect(() => {
    if (!id) return;

    const chatRef = collection(db, 'raffles', id, 'chatAll');
    const chatQuery = query(chatRef, orderBy('timestamp', 'asc'), limit(100));

    const unsubscribe = onSnapshot(chatQuery, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp?.toMillis?.() || doc.data().timestamp
      }));
      setMessages(msgs);

      // Handle unread count if chat is closed
      if (!isChatOpen && msgs.length > 0) {
        const lastMsg = msgs[msgs.length - 1];
        if (lastMsg.timestamp > lastReadTimeRef.current && lastMsg.senderUid !== user?.uid) {
          setUnreadCount(prev => prev + 1);
        }
      }
    });

    return () => unsubscribe();
  }, [id, isChatOpen, user?.uid]);

  // Listen to typing indicators
  useEffect(() => {
    if (!id || !isChatOpen) return;

    const typingRef = collection(db, 'raffles', id, 'typingAll');
    const unsubscribe = onSnapshot(typingRef, (snapshot) => {
      const now = Date.now();
      const typers = {};
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        // Only show typers from last 5 seconds
        if (data.timestamp && (now - data.timestamp) < 5000 && doc.id !== user?.uid) {
          typers[doc.id] = { name: data.name, timestamp: data.timestamp };
        }
      });
      setTypingUsers(typers);
    });

    return () => unsubscribe();
  }, [id, isChatOpen, user?.uid]);

  // Auto-scroll chat
  useEffect(() => {
    if (chatEndRef.current && isChatOpen) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
    if (isChatOpen) {
      setUnreadCount(0);
      lastReadTimeRef.current = Date.now();
    }
  }, [messages, isChatOpen]);

  // ─── CHAT HANDLERS ───
  const sendChatMessage = async (e) => {
    e.preventDefault();
    if (!user || !chatInput.trim() || isSendingMessage) return;

    // Permissions check: Must be linked and not anonymous
    if (user.isAnonymous || !user.auroryPlayerId) {
      alert('You must link your Aurory account to participate in the chat.');
      return;
    }

    setIsSendingMessage(true);
    try {
      const chatRef = collection(db, 'raffles', id, 'chatAll');
      await addDoc(chatRef, {
        text: chatInput.trim(),
        senderUid: user.uid,
        senderName: resolveDisplayName(user) || 'Anonymous',
        senderPhoto: resolveAvatar(user) || null,
        senderIsAurorian: user.isAurorian || false,
        timestamp: serverTimestamp(),
        reactions: {}
      });

      // Maintain 100 message limit by deleting oldest
      if (messages.length >= 100) {
        const oldestId = messages[0].id;
        const oldestRef = doc(db, 'raffles', id, 'chatAll', oldestId);
        await deleteDoc(oldestRef);
      }

      setChatInput('');
      
      // Clear typing status immediately
      const typingDocRef = doc(db, 'raffles', id, 'typingAll', user.uid);
      await deleteDoc(typingDocRef);
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      setIsSendingMessage(false);
    }
  };

  const handleTypingInput = async (e) => {
    setChatInput(e.target.value);
    if (!user || user.isAnonymous || !user.auroryPlayerId) return;

    // Throttled update to Firestore (once every 3 seconds)
    const typingDocRef = doc(db, 'raffles', id, 'typingAll', user.uid);
    const now = Date.now();
    
    if (now - lastTypingUpdateRef.current > 3000) {
      lastTypingUpdateRef.current = now;
      try {
        await setDoc(typingDocRef, {
          name: resolveDisplayName(user) || 'Someone',
          timestamp: now
        });
      } catch (err) {}
    }
      
    // Debounce cleanup
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(async () => {
      try {
        await deleteDoc(typingDocRef);
      } catch (e) {}
    }, 3000);
  };

  const deleteChatMessage = async (messageId) => {
    if (!isAdminUser) return;
    
    if (window.confirm('Are you sure you want to delete this message?')) {
      try {
        await deleteDoc(doc(db, 'raffles', id, 'chatAll', messageId));
      } catch (error) {
        console.error('Error deleting message:', error);
      }
    }
  };

  const toggleReaction = async (messageId, emoji) => {
    if (!user || user.isAnonymous || !user.auroryPlayerId) return;

    const messageRef = doc(db, 'raffles', id, 'chatAll', messageId);
    try {
      await runTransaction(db, async (transaction) => {
        const msgDoc = await transaction.get(messageRef);
        if (!msgDoc.exists()) return;

        const data = msgDoc.data();
        const reactions = data.reactions || {};
        const emojiReactions = reactions[emoji] || [];
        
        let newEmojiReactions;
        if (emojiReactions.includes(user.uid)) {
          newEmojiReactions = emojiReactions.filter(uid => uid !== user.uid);
        } else {
          newEmojiReactions = [...emojiReactions, user.uid];
        }

        const newReactions = { ...reactions, [emoji]: newEmojiReactions };
        transaction.update(messageRef, { reactions: newReactions });
      });
    } catch (error) {
      console.error('Error toggling reaction:', error);
    }
    setShowReactionPicker(null);
  };

  const formatChatTime = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

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
    
    triggerConfirm({
        title: "🚀 Start Raffle?",
        message: "This will pick a winner and start the animation. This cannot be undone!",
        confirmText: "Start Spinning",
        type: "warning",
        onConfirm: async () => {
            setIsStarting(true);
            const result = await startRaffle(id, user);
            if (!result.success) {
                alert(result.error);
                setIsStarting(false);
            }
        }
    });
  };

  const handleSpinEnd = async () => {
    if (isAdminUser) {
        await completeRaffle(id);
    }
    setShowWinner(true);
  };

  const handleCloseEntries = async () => {
    if (!isAdminUser) return;
    
    triggerConfirm({
        title: "🔒 Close entries?",
        message: "No more users will be able to join this raffle. You can still spin later.",
        confirmText: "Close Now",
        type: "info",
        onConfirm: async () => {
            const result = await closeRaffleEntries(id, user);
            if (!result.success) {
                alert(result.error);
            }
        }
    });
  };

  const handleDelete = async () => {
    if (!isAdminUser) return;

    triggerConfirm({
        title: "🗑️ Delete Raffle?",
        message: "Are you sure? Participants will be automatically refunded their entry fees.",
        confirmText: "Delete Forever",
        type: "danger",
        onConfirm: async () => {
            setIsDeleting(true);
            const result = await deleteRaffle(id, user);
            if (result.success) {
                navigate('/');
            } else if (result.error === 'Raffle not found') {
                navigate('/');
            } else {
                alert(result.error);
                setIsDeleting(false);
            }
        }
    });
  };

  const handleShuffle = async () => {
    triggerConfirm({
        title: "🔀 Shuffle Participants?",
        message: "This will randomize the order of slices on the wheel.",
        confirmText: "Shuffle",
        type: "info",
        onConfirm: async () => {
            const result = await shuffleParticipants(id, user);
            if (!result.success) {
                alert(result.error);
            }
        }
    });
  };
  
  const handleAddMock = async () => {
      const count = prompt('How many mock participants to add?', '5');
      if (!count || isNaN(count)) return;
      
      triggerConfirm({
          title: "🧪 Add Mock Participants?",
          message: `Add ${count} test accounts to this raffle?`,
          confirmText: "Add Mock",
          type: "info",
          onConfirm: async () => {
              const result = await addMockParticipants(id, parseInt(count));
              if (!result.success) {
                alert(result.error);
              }
          }
      });
  };

  const handleRemoveParticipant = async (participant) => {
    if (!isAdminUser) return;
    
    triggerConfirm({
        title: "🗑️ Remove Participant?",
        message: `Remove ${participant.playerName} from this raffle? Their entry fee will be automatically refunded if they paid one.`,
        confirmText: "Remove User",
        type: "danger",
        onConfirm: async () => {
            const result = await removeRaffleParticipant(id, participant.uid, user);
            if (!result.success) {
                alert(result.error);
            }
        }
    });
  };

  if (loading) return <div className="raffle-loading">Loading Raffle...</div>;
  if (!raffle) return null;

  const isJoined = raffle.participants?.some(p => p.uid === user?.uid);
  const isSpinning = raffle.status === 'spinning';
  const isCompleted = raffle.status === 'completed';
  const isEntriesClosed = raffle.status === 'entries_closed';
  
  const isExpired = raffle.endDate && (raffle.endDate.toDate ? raffle.endDate.toDate() : new Date(raffle.endDate)) < new Date();
  
  const userCreatedAt = user?.createdAt?.toDate ? user.createdAt.toDate() : (user?.createdAt ? new Date(user.createdAt) : null);
  
  // Backward compatibility with registrationDateLimit (acts as "Before")
  const registrationLimitBefore = raffle.registrationDateBefore || raffle.registrationDateLimit;
  const limitDateBefore = registrationLimitBefore?.toDate ? registrationLimitBefore.toDate() : (registrationLimitBefore ? new Date(registrationLimitBefore) : null);
  
  const registrationLimitAfter = raffle.registrationDateAfter;
  const limitDateAfter = registrationLimitAfter?.toDate ? registrationLimitAfter.toDate() : (registrationLimitAfter ? new Date(registrationLimitAfter) : null);

  const isTooNew = limitDateBefore && userCreatedAt && userCreatedAt > limitDateBefore;
  const isTooOld = limitDateAfter && userCreatedAt && userCreatedAt < limitDateAfter;

  const canJoin = !isJoined && !isSpinning && !isCompleted && !isEntriesClosed && !isExpired && !isTooNew && !isTooOld && raffle.participantsCount < raffle.maxParticipants;
  const isAury = raffle.itemType === 'aury';
  const itemType = raffle.itemType;
  const isCurrencyPrize = itemType === 'aury' || itemType === 'usdc';

  return (
    <div className="raffle-page cinematic-page">
      {/* Page Header — matches Tournament/Matchup pages */}
      <header className="viking-page-header">
        <div className="viking-page-title-group">
          <h1 className="viking-page-title">
            <span className="type-prefix">{raffle.itemType?.toUpperCase()}</span>
            <span className="main-title">Fate Draw</span>
          </h1>
        </div>
        <div className="header-actions">
          <button className="viking-btn-secondary" onClick={() => navigate('/')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
            HOME
          </button>
        </div>
      </header>

      <div className="viking-card hero-raffle-card">
        <div className="item-info-top">
          {itemType === 'aury' || itemType === 'usdc' ? (
            <div className={`viking-prize-display ${itemType}`}>
              <div className="prize-amount-group">
                <span className="currency-amount">
                  {itemType === 'aury' ? (raffle.auryAmount || 0) : (raffle.usdcAmount || 0)}
                </span>
                <span className="currency-label">{itemType.toUpperCase()}</span>
              </div>
            </div>
          ) : (
            raffle.itemImage && (
              <div className="item-image-wrapper">
                <img src={raffle.itemImage} alt={raffle.itemType} className="raffle-item-large" />
              </div>
            )
          )}
          <div className="item-text-top">
            <div className="viking-badge-group">
              <span className="viking-badge">{raffle.itemType?.toUpperCase()} PRIZE</span>
              {isExpired && <span className="viking-badge expired">EXPIRED</span>}
              {isCompleted && <span className="viking-badge completed">CONCLUDED</span>}
            </div>
            <p className="raffle-description-main">{raffle.description}</p>
            {!isAury && raffle.itemLink && (
              <a href={raffle.itemLink} target="_blank" rel="noopener noreferrer" className="viking-link">
                Examine Artifact ↗
              </a>
            )}
          </div>
        </div>

        <div className="raffle-stats-grid">
          <div className="raffle-stat-card">
            <span className="stat-label">Total Pool</span>
            <span className="stat-value gold">
              {raffle.entryFeeCurrency === 'USDC' ? formatUsdcAmount(raffle.totalFeesCollected || 0) : 
               raffle.entryFeeCurrency === 'Valcoins' ? (raffle.totalFeesCollected || 0) :
               formatAuryAmount(raffle.totalFeesCollected || 0)} {raffle.entryFeeCurrency || 'AURY'}
            </span>
          </div>
          <div className="raffle-stat-card">
            <span className="stat-label">Entry Tribute</span>
            <span className="stat-value white">
              {raffle.isFree ? 'FREE' : `${raffle.entryFee} ${raffle.entryFeeCurrency || 'AURY'}`}
            </span>
          </div>
          <div className="raffle-stat-card">
            <span className="stat-label">Fellow Participants</span>
            <span className="stat-value cyan">{raffle.participantsCount} / {raffle.maxParticipants}</span>
          </div>
          {raffle.endDate && (
            <div className="raffle-stat-card">
              <span className="stat-label">Norns' Deadline</span>
              <span className="stat-value purple">
                {new Date(raffle.endDate.toDate ? raffle.endDate.toDate() : raffle.endDate).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="raffle-main">
        <div className="wheel-section">
          <RaffleWheel 
            participants={raffle.participants}
            onSpinEnd={handleSpinEnd}
            itemImage={isCurrencyPrize ? null : raffle.itemImage}
            itemLink={isCurrencyPrize ? null : raffle.itemLink}
            auryAmount={isAury ? raffle.auryAmount : null}
            usdcAmount={itemType === 'usdc' ? raffle.usdcAmount : null}
            winnerId={raffle.winner?.uid}
            status={raffle.status}
            isStarting={isStarting}
            minParticipants={raffle.minParticipants}
          />
        </div>

        <div className="raffle-actions-aside">
            {!isSpinning && !isCompleted && !isEntriesClosed && !isExpired && (
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
                        <>
                        <button 
                            className={`join-btn-large ${!canJoin ? 'disabled' : ''}`}
                            onClick={handleJoin}
                            disabled={!canJoin || joining}
                        >
                            {joining ? 'Joining...' : 'Join Raffle'}
                        </button>
                        </>
                    )}
                </div>
            )}

            {(isEntriesClosed || isExpired) && !isSpinning && !isCompleted && (
                <div className="joining-section disabled">
                    <div className="joined-status expired">
                         Entries Closed
                    </div>
                </div>
            )}

            {isCompleted && raffle.winner && (
                <button className="viking-btn-primary prize-celebration-btn" onClick={() => setShowWinner(true)}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>
                    REVEAL VICTOR
                </button>
            )}

            <button className="viking-btn-secondary" onClick={() => setShowParticipants(true)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                PARTICIPANTS
            </button>

            {isAdminUser && (
                <div className="viking-admin-actions">
                    <button className="viking-btn-secondary edit-btn" onClick={() => setShowEditModal(true)}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        EDIT
                    </button>
                    
                    {!isSpinning && !isCompleted && (
                        <>
                            <button className="viking-btn-secondary admin-shuffle" onClick={handleShuffle}>
                                Randomize Participants
                            </button>
                            <button className="viking-btn-secondary admin-mock" onClick={handleAddMock} title="Super Admin Only">
                                Add Mock Participants
                            </button>
                            <button 
                                className={`viking-btn-secondary admin-start ${isStarting || isSpinning || isCompleted ? 'disabled' : ''}`} 
                                onClick={handleStartSpin}
                                disabled={raffle.participantsCount < raffle.minParticipants || isStarting || isSpinning || isCompleted}
                            >
                                {isStarting ? 'Please wait...' : 'Start Raffle (Spin)'}
                            </button>
                            {raffle.status === 'active' && (
                                <button className="viking-btn-secondary admin-close-entries" onClick={handleCloseEntries}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: '6px'}}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                                    Close Entries
                                </button>
                            )}
                        </>
                    )}

                    <button className="viking-btn-danger" onClick={handleDelete}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                        PURGE
                    </button>
                </div>
            )}
        </div>
      </div>

      {showParticipants && (
        <RaffleParticipantsModal 
            participants={raffle.participants} 
            onClose={() => setShowParticipants(false)} 
            isAdmin={isAdminUser}
            onRemoveParticipant={handleRemoveParticipant}
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

      <RaffleConfirmationModal 
        isOpen={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        {...confirmAction}
      />

      {/* ─── CHAT SYSTEM ─── */}
      <div className="raffle-chat-container">
        {isChatOpen && (
          <div className="chat-panel">
            <div className="chat-header-bar">
              <span className="chat-icon">💬</span>
              <h3>Raffle Chat</h3>
            </div>
            
            <div className="chat-messages">
              {messages.length === 0 ? (
                <div className="chat-empty">
                  <p>No messages yet. Be the first to say hello!</p>
                </div>
              ) : (
                messages.map((msg) => (
                  <div key={msg.id} className={`chat-message ${msg.senderUid === user?.uid ? 'own' : ''}`}>
                    <img 
                      src={msg.senderPhoto || 'https://cdn.discordapp.com/embed/avatars/0.png'} 
                      alt="" 
                      className="chat-avatar" 
                      onError={(e) => { 
                        e.target.onerror = null; 
                        e.target.src = 'https://cdn.discordapp.com/embed/avatars/0.png'; 
                      }}
                    />
                    <div className="chat-content">
                      <div className="chat-msg-header">
                        <span className="chat-sender">
                          {msg.senderName}
                          {msg.senderIsAurorian && <span className="aurorian-badge" title="Aurorian NFT Holder"> 🛡️</span>}
                        </span>
                        <span className="chat-time">{formatChatTime(msg.timestamp)}</span>
                      </div>
                      
                      <div className="chat-text-wrapper">
                        <p className="chat-text">{msg.text}</p>
                        
                        <div className="chat-msg-actions">
                          {isAdminUser && (
                            <button 
                              className="delete-msg-btn"
                              onClick={() => deleteChatMessage(msg.id)}
                              title="Delete message"
                            >
                              🗑️
                            </button>
                          )}
                          {(isAdminUser || (user && !user.isAnonymous && user.auroryPlayerId)) && (
                            <button 
                              className="add-reaction-btn"
                              onClick={() => setShowReactionPicker(showReactionPicker === msg.id ? null : msg.id)}
                            >
                              +
                            </button>
                          )}
                          {showReactionPicker === msg.id && (
                            <div className="reaction-picker">
                              {['👍', '❤️', '😂', '😮', '😢'].map(emoji => (
                                <button 
                                  key={emoji} 
                                  className="reaction-option"
                                  onClick={() => toggleReaction(msg.id, emoji)}
                                >
                                  {emoji}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                        <div className="message-reactions">
                          {Object.entries(msg.reactions).map(([emoji, uids]) => (
                            uids.length > 0 && (
                              <div 
                                key={emoji} 
                                className={`reaction-bubble ${uids.includes(user?.uid) ? 'reacted' : ''}`}
                                onClick={() => toggleReaction(msg.id, emoji)}
                              >
                                <span className="reaction-emoji">{emoji}</span>
                                <span className="reaction-count">{uids.length}</span>
                              </div>
                            )
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
              <div ref={chatEndRef} />
            </div>

            {Object.keys(typingUsers).length > 0 && (
              <div className="typing-indicator">
                <div className="typing-dots">
                  <span></span><span></span><span></span>
                </div>
                <span>
                  {Object.values(typingUsers).map(u => u.name).join(', ')} {Object.keys(typingUsers).length === 1 ? 'is' : 'are'} typing...
                </span>
              </div>
            )}

            <div className="chat-input-wrapper">
              {(!user || user.isAnonymous) ? (
                <div className="chat-viewer-notice">Log in to participate in the chat</div>
              ) : !user.auroryPlayerId ? (
                <div className="chat-viewer-notice">Link your Aurory account to chat</div>
              ) : (
                <form className="chat-input-form" onSubmit={sendChatMessage}>
                  <input 
                    type="text" 
                    placeholder="Type a message..." 
                    value={chatInput}
                    onChange={handleTypingInput}
                    maxLength={200}
                  />
                  <button type="submit" className="chat-send-btn" disabled={!chatInput.trim() || isSendingMessage}>
                    {isSendingMessage ? '...' : '✈️'}
                  </button>
                </form>
              )}
            </div>
          </div>
        )}

        <button className="viking-chat-toggle" onClick={() => setIsChatOpen(!isChatOpen)}>
          <div className="toggle-content">
            <span className="chat-icon">{isChatOpen ? 
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg> : 
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
            }</span>
            <span className="chat-label">{isChatOpen ? 'CLOSE CHAT' : 'RAFFLE CHAT'}</span>
            {!isChatOpen && unreadCount > 0 && <span className="viking-badge unread">{unreadCount}</span>}
          </div>
          <span className="toggle-arrow">{isChatOpen ? '▼' : '▲'}</span>
        </button>
      </div>
    </div>
  );
};

export default RafflePage;
