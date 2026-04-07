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
    <div className="raffle-page">
      {/* Page Header — matches Tournament/Matchup pages */}
      <header className="raffle-page-header">
        <div className="raffle-page-title">
          <h1>{raffle.itemType?.toUpperCase()} Raffle</h1>
          <span className="raffle-page-subtitle">{raffle.description}</span>
        </div>
        <button className="back-home-btn" onClick={() => navigate('/')}>
          ← Back to Home
        </button>
      </header>

      <div className="raffle-header">
        <div className="item-info-top">
          {itemType === 'aury' || itemType === 'usdc' ? (
            <div className={`currency-prize-badge ${itemType}`}>
              <span className="currency-amount">
                {itemType === 'aury' ? (raffle.auryAmount || 0) : (raffle.usdcAmount || 0)}
              </span>
              <span className="currency-label">{itemType.toUpperCase()}</span>
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
            <span className="raffle-stat-value">
              {raffle.entryFeeCurrency === 'USDC' ? formatUsdcAmount(raffle.totalFeesCollected || 0) : 
               raffle.entryFeeCurrency === 'Valcoins' ? (raffle.totalFeesCollected || 0) :
               formatAuryAmount(raffle.totalFeesCollected || 0)} {raffle.entryFeeCurrency || 'AURY'}
            </span>
          </div>
          <div className="raffle-stat-box">
            <span className="raffle-stat-label">Entry Fee</span>
            <span className="raffle-stat-value">
              {raffle.isFree ? 'FREE' : `${raffle.entryFee} ${raffle.entryFeeCurrency || 'AURY'}`}
            </span>
          </div>
          <div className="raffle-stat-box">
            <span className="raffle-stat-label">Participants</span>
            <span className="raffle-stat-value">{raffle.participantsCount} / {raffle.maxParticipants}</span>
          </div>
          {raffle.endDate && (
            <div className="raffle-stat-box">
              <span className="raffle-stat-label">Ends At</span>
              <span className="raffle-stat-value">
                {new Date(raffle.endDate.toDate ? raffle.endDate.toDate() : raffle.endDate).toLocaleString()}
              </span>
            </div>
          )}
          {(limitDateBefore || limitDateAfter) && (
            <div className="raffle-stat-box restriction-box">
              <span className="raffle-stat-label">
                🛡️ {limitDateBefore && limitDateAfter ? 'Accounts between' : 
                    limitDateBefore ? 'Old accounts only' : 'New accounts only'}
              </span>
              <span className="raffle-stat-value restriction">
                {limitDateBefore && limitDateAfter ? (
                  `${limitDateAfter.toLocaleDateString()} - ${limitDateBefore.toLocaleDateString()}`
                ) : limitDateBefore ? (
                  `Before ${limitDateBefore.toLocaleDateString()}`
                ) : (
                  `After ${limitDateAfter.toLocaleDateString()}`
                )}
              </span>
            </div>
          )}
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
                {raffle.status === 'active' && (
                    <button className="raffle-btn admin-close-entries" onClick={handleCloseEntries}>
                        🔒 Close Entries
                    </button>
                )}
            </div>
          )}

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

        <button className="chat-toggle-btn" onClick={() => setIsChatOpen(!isChatOpen)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span className="chat-icon">{isChatOpen ? '❌' : '💬'}</span>
            <span className="chat-label">{isChatOpen ? 'Close Chat' : 'Raffle Chat'}</span>
            {!isChatOpen && unreadCount > 0 && <span className="chat-badge">{unreadCount}</span>}
          </div>
          <span className="toggle-icon">{isChatOpen ? '▼' : '▲'}</span>
        </button>
      </div>
    </div>
  );
};

export default RafflePage;
