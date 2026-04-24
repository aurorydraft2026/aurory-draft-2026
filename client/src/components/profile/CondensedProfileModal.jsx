import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getEquippedBannerStyle } from '../../services/cosmeticsService';
import { ref, onValue } from 'firebase/database';
import { doc, getDoc, collection, query, where, getCountFromServer, onSnapshot, addDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, orderBy, arrayUnion, arrayRemove, increment } from 'firebase/firestore';
import { database, db, auth } from '../../firebase';
import AvatarWithAura from '../AvatarWithAura';
import { resolveDisplayName } from '../../utils/userUtils';
import { useProfileModal } from '../../context/ProfileModalContext';
import { TIER_CONFIG, getTierExp, getTierProgress } from '../../services/tierService';
import { fetchPlayerProfile } from '../../services/auroryProfileService';
import './CondensedProfileModal.css';

/**
 * CondensedProfileModal - A privacy-first, high-density profile view
 * for raffle participants.
 */
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const CondensedProfileModal = ({ isOpen, onClose, user, joinedAt }) => {
  const { uid } = user || {};
  const { 
    statsCache, 
    updateStatsCache,
    likeCount,
    commentCount,
    liked,
    viewerData,
    markCommentsAsRead
  } = useProfileModal();
  const [pvpWins, setPvpWins] = useState(0);
  const [pvpRank, setPvpRank] = useState(null);
  const [wealthRank, setWealthRank] = useState(null);
  const [dailyValcoins, setDailyValcoins] = useState(0);
  const [displayValcoins, setDisplayValcoins] = useState(0);
  const [loading, setLoading] = useState(false);
  const [liveProfile, setLiveProfile] = useState(null);

  // Social: UI/Interaction state
  const [viewerLinked, setViewerLinked] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState('');
  const [postingComment, setPostingComment] = useState(false);
  const commentInputRef = useRef(null);


  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      const today = new Date().toISOString().split('T')[0];

      // 1. Fetch Daily PvP Wins & Rank from RTDB (Promisified)
      const pvpStats = await new Promise((resolve) => {
        const pvpRef = ref(database, `leaderboards/earnings/wins/pvp/daily/${today}`);
        onValue(pvpRef, (snapshot) => {
          const data = snapshot.val();
          if (data && data[uid]) {
            const userEntry = data[uid];
            const participants = Object.values(data);
            const higherScores = participants.filter(p => (p.score || 0) > (userEntry.score || 0)).length;
            resolve({
              wins: userEntry.score || 0,
              rank: higherScores + 1
            });
          } else {
            resolve({ wins: 0, rank: data ? '100+' : 'N/A' });
          }
        }, { onlyOnce: true });
      });

      setPvpWins(pvpStats.wins);
      setPvpRank(pvpStats.rank);

      // 2. Fetch Daily Valcoins from RTDB
      const dailyValcoinsData = await new Promise((resolve) => {
        const valcoinsRef = ref(database, `leaderboards/earnings/valcoins/all/daily/${today}`);
        onValue(valcoinsRef, (snapshot) => {
          const data = snapshot.val();
          if (data && data[uid]) {
            resolve(data[uid].score || 0);
          } else {
            resolve(0);
          }
        }, { onlyOnce: true });
      });
      setDailyValcoins(dailyValcoinsData);

      // 3. Fetch Total Wealth Rank from Firestore (Total Valcoins)
      const userRef = doc(db, 'users', uid);
      const userSnap = await getDoc(userRef);

      if (userSnap.exists()) {
        const data = userSnap.data();
        setLiveProfile(data);
        const currentPoints = data.points || 0;
        const q = query(collection(db, 'users'), where('points', '>', currentPoints));
        const countSnap = await getCountFromServer(q);
        const wealth = countSnap.data().count + 1;
        const formattedWealth = wealth > 100 ? '100+' : wealth;
        setWealthRank(formattedWealth);

        // 4. Update Cache
        updateStatsCache(uid, {
          pvpWins: pvpStats.wins,
          pvpRank: pvpStats.rank,
          wealthRank: formattedWealth,
          dailyValcoins: dailyValcoinsData,
          liveProfile: data
        });
      } else {
        setWealthRank('N/A');
      }

    } catch (error) {
      console.error('Error loading profile statistics:', error);
    } finally {
      setLoading(false);
    }
  }, [uid, updateStatsCache]);

  useEffect(() => {
    if (isOpen && uid) {
      const cached = statsCache[uid];
      const now = Date.now();

      if (cached && (now - cached.timestamp < CACHE_TTL)) {
        // Use cached data
        setPvpWins(cached.pvpWins || 0);
        setPvpRank(cached.pvpRank || '...');
        setWealthRank(cached.wealthRank || '...');
        setDailyValcoins(cached.dailyValcoins || 0);
        setLiveProfile(cached.liveProfile || null);
        setLoading(false);
      } else {
        // Refresh data
        setLiveProfile(null);
        loadStats();
      }
    }
  }, [isOpen, uid, loadStats, statsCache]);

  // Social: Check if current viewer has a linked account (One-time fetch to reduce listeners)
  useEffect(() => {
    if (!isOpen) return;
    const currentUser = auth.currentUser;
    if (!currentUser || currentUser.isAnonymous) {
      setViewerLinked(false);
      return;
    }
    
    getDoc(doc(db, 'users', currentUser.uid)).then(snap => {
      if (snap.exists()) {
        setViewerLinked(!!snap.data().auroryPlayerId);
      }
    }).catch(err => console.error('Error checking viewer link:', err));
  }, [isOpen]);

  // Social: Load comments list when overlay opens
  useEffect(() => {
    if (!commentsOpen || !uid) return;
    const commentsRef = collection(db, 'profileInteractions', uid, 'comments');
    const q = query(commentsRef, orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setComments(items);
    });

    // Mark as read if viewing own profile
    if (uid === auth.currentUser?.uid) {
      markCommentsAsRead(commentCount);
    }

    return () => unsub();
  }, [commentsOpen, uid, commentCount, markCommentsAsRead]);

  // Social: Toggle like
  const handleToggleLike = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser || !viewerLinked) return;
    const likesRef = doc(db, 'profileInteractions', uid);
    try {
      if (liked) {
        await updateDoc(likesRef, {
          likedBy: arrayRemove(currentUser.uid),
          likeCount: increment(-1)
        });
      } else {
        await setDoc(likesRef, {
          likedBy: arrayUnion(currentUser.uid),
          likeCount: increment(1)
        }, { merge: true });
      }
    } catch (err) {
      console.error('Error toggling like:', err);
    }
  };

  // Social: Post a comment
  const handlePostComment = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser || !viewerLinked || !commentText.trim()) return;
    setPostingComment(true);
    try {
      const userSnap = await getDoc(doc(db, 'users', currentUser.uid));
      const userData = userSnap.exists() ? userSnap.data() : {};
      
      let authorName = userData.displayName || userData.username || 'Anonymous';
      let authorAvatar = userData.photoURL || '';

      // Fetch Aurory profile if linked for "Aurory-first" identification
      if (userData.auroryPlayerId) {
        try {
          const auroryProfile = await fetchPlayerProfile(userData.auroryPlayerId);
          if (auroryProfile && !auroryProfile.error) {
            authorName = auroryProfile.playerName || authorName;
            authorAvatar = auroryProfile.profilePicture || authorAvatar;
          }
        } catch (apErr) {
          console.warn('Could not fetch Aurory profile for comment, using fallback:', apErr);
        }
      }
      
      const interactionRef = doc(db, 'profileInteractions', uid);
      const commentsRef = collection(interactionRef, 'comments');
      
      await addDoc(commentsRef, {
        authorUid: currentUser.uid,
        authorName,
        authorAvatar,
        text: commentText.trim(),
        createdAt: serverTimestamp()
      });

      // Atomically increment comment count in parent doc
      await setDoc(interactionRef, {
        commentCount: increment(1)
      }, { merge: true });

      setCommentText('');
    } catch (err) {
      console.error('Error posting comment:', err);
    } finally {
      setPostingComment(false);
    }
  };

  // Social: Delete a comment
  const handleDeleteComment = async (commentId) => {
    if (!window.confirm('Are you sure you want to delete this comment?')) return;
    try {
      const interactionRef = doc(db, 'profileInteractions', uid);
      const commentRef = doc(interactionRef, 'comments', commentId);
      await deleteDoc(commentRef);
      await updateDoc(interactionRef, {
        commentCount: increment(-1)
      });
      
      // Also update markAsRead count locally if owner just deleted
      if (uid === auth.currentUser?.uid) {
        markCommentsAsRead(commentCount - 1);
      }
    } catch (err) {
      console.error('Error deleting comment:', err);
    }
  };

  // CountUp animation for Daily Earned
  useEffect(() => {
    if (!loading && dailyValcoins > 0) {
      const end = dailyValcoins;
      const duration = 800; // ms
      const startTime = performance.now();

      const animate = (currentTime) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Easing function (easeOutExpo)
        const easeProgress = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
        
        const currentCount = Math.floor(easeProgress * end);
        setDisplayValcoins(currentCount);

        if (progress < 1) {
          requestAnimationFrame(animate);
        }
      };

      requestAnimationFrame(animate);
    } else if (loading) {
      setDisplayValcoins(0);
    }
  }, [loading, dailyValcoins]);

  if (!isOpen) return null;

  const mergedUser = liveProfile ? { ...user, ...liveProfile } : user;
  const bannerStyle = getEquippedBannerStyle(mergedUser);
  const formattedDate = joinedAt
    ? new Date(joinedAt).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
    : 'Unknown';

  return (
    <div className="condensed-profile-overlay" onClick={onClose}>
      <div className="condensed-profile-card" onClick={e => e.stopPropagation()}>
        <div className="condensed-profile-header" style={bannerStyle}>
          <div className="header-overlay"></div>
          <button className="close-condensed-btn" onClick={onClose}>✕</button>

          <div className="header-content">
            <AvatarWithAura user={mergedUser} size={80} className="condensed-avatar" alwaysAnimate />
            <div className="header-text">
              <h2 className="condensed-name">{resolveDisplayName(mergedUser)}</h2>
              <div className="condensed-badges">
                {mergedUser.role === 'superadmin' && <span className="condensed-badge super-admin">SUPER ADMIN</span>}
                {mergedUser.role === 'senior_admin' && <span className="condensed-badge senior-admin">SENIOR ADMIN</span>}
                {mergedUser.role === 'admin' && <span className="condensed-badge admin">ADMIN</span>}
                {mergedUser.isAurorian && <span className="condensed-badge aurorian">AURORIAN</span>}
              </div>

              {/* 🆕 Tier & EXP Gauge */}
              <div className="condensed-tier-section">
                <div className="tier-level-info">
                  <span className="tier-label-text">
                    <img src={TIER_CONFIG[mergedUser.tier || 1].badge} alt="" className="condensed-tier-badge-icon" />
                    <span className="condensed-tier-title">{TIER_CONFIG[mergedUser.tier || 1].name}</span>
                    <span className="condensed-tier-divider"> </span>
                    <span className="condensed-tier-subname">({TIER_CONFIG[mergedUser.tier || 1].subName})</span>
                  </span>
                </div>
                <div className="condensed-gauge-container">
                  <div
                    className={`condensed-gauge-fill tier-${mergedUser.tier || 1}-fill`}
                    style={{ width: `${getTierProgress(mergedUser)}%` }}
                  ></div>
                </div>
                <div className="tier-exp-numbers">
                  {getTierExp(mergedUser).toLocaleString()} / {TIER_CONFIG[mergedUser.tier || 1].gaugeMax.toLocaleString()} EXP
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="condensed-profile-body">
          <div className="info-grid">
            <div className="info-item">
              <span className="info-label">Aurory ID</span>
              <span className="info-value viking-highlight">{mergedUser.auroryPlayerId || 'Not Linked'}</span>
            </div>
            {joinedAt && (
              <div className="info-item">
                <span className="info-label">Joined Raffle</span>
                <span className="info-value">{formattedDate}</span>
              </div>
            )}
          </div>

          <div className="stats-divider">
            <span>Battle Statistics</span>
          </div>

          {loading ? (
            <div className="condensed-stats-loading">
              <div className="spinner-small"></div>
              <span>Fetching Records...</span>
            </div>
          ) : !loading ? (
            <div className="stats-row">
              <div className="stat-box">
                <span className="stat-label">Daily Earned</span>
                <span className="stat-value viking-highlight">{displayValcoins.toLocaleString()}</span>
              </div>
              <div className="stat-box">
                <span className="stat-label">Daily PvP Wins</span>
                <span className="stat-value">{pvpWins}</span>
              </div>
              <div className="stat-box">
                <span className="stat-label">Top Daily Wins</span>
                <span className="stat-value viking-highlight">#{pvpRank || '...'}</span>
              </div>
              <div className="stat-box">
                <span className="stat-label">Wealth #</span>
                <span className="stat-value viking-highlight">#{wealthRank || '...'}</span>
              </div>
            </div>
          ) : (
            <div className="stats-empty">
              No battle records found.
            </div>
          )}
        </div>

        <div className="condensed-profile-footer">
          <div className="social-actions" style={{ gap: '10px' }}>
            <button
              className={`social-btn like-btn ${liked ? 'active' : ''} ${!viewerLinked ? 'disabled' : ''}`}
              onClick={handleToggleLike}
              disabled={!viewerLinked}
              title={viewerLinked ? (liked ? 'Unlike' : 'Give thumbs up') : 'Link your Aurory account to interact'}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill={liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
              </svg>
              <span className="social-count">{likeCount > 0 ? likeCount : ''}</span>
            </button>
            <button
              className={`social-btn comment-btn ${!viewerLinked ? 'disabled' : ''}`}
              onClick={() => viewerLinked && setCommentsOpen(true)}
              disabled={!viewerLinked}
              title={viewerLinked ? 'View & add comments' : 'Link your Aurory account to interact'}
              style={{ position: 'relative' }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              <span className="social-count">{commentCount > 0 ? commentCount : ''}</span>
              
              {/* Unread badge for owner */}
              {uid === auth.currentUser?.uid && commentCount > (viewerData?.lastSeenSocialCount || 0) && (
                <span className="unread-badge">
                  {commentCount - (viewerData?.lastSeenSocialCount || 0)}
                </span>
              )}
            </button>
          </div>
          {!viewerLinked && (
            <p className="social-gate-hint">Link your Aurory account to like & comment</p>
          )}
        </div>

        {/* Comments Overlay */}
        {commentsOpen && (
          <div className="comments-overlay" onClick={() => setCommentsOpen(false)}>
            <div className="comments-modal" onClick={e => e.stopPropagation()}>
              <div className="comments-header">
                <h3>Comments</h3>
                <button className="close-comments-btn" onClick={() => setCommentsOpen(false)}>✕</button>
              </div>
              <div className="comments-list">
                {comments.length === 0 ? (
                  <div className="comments-empty">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                    </svg>
                    <span>No comments yet. Be the first!</span>
                  </div>
                ) : (
                  comments.map(c => (
                    <div key={c.id} className="comment-item">
                      <img
                        src={c.authorAvatar || '/default-avatar.png'}
                        alt=""
                        className="comment-avatar"
                      />
                      <div className="comment-body">
                        <span className="comment-author">{c.authorName}</span>
                        <p className="comment-text">{c.text}</p>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span className="comment-time">
                            {c.createdAt?.toDate ? c.createdAt.toDate().toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '...'}
                          </span>
                          {c.authorUid === auth.currentUser?.uid && (
                            <button 
                              className="delete-comment-btn" 
                              onClick={() => handleDeleteComment(c.id)}
                              title="Delete comment"
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="comments-input-row">
                <input
                  ref={commentInputRef}
                  type="text"
                  placeholder="Write a comment..."
                  value={commentText}
                  onChange={e => setCommentText(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handlePostComment()}
                  maxLength={200}
                  disabled={postingComment}
                />
                <button
                  className="send-comment-btn"
                  onClick={handlePostComment}
                  disabled={postingComment || !commentText.trim()}
                  title="Post comment"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13"/>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CondensedProfileModal;
