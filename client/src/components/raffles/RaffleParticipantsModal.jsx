import React from 'react';
import ReactDOM from 'react-dom';
import './RaffleParticipantsModal.css';

const RaffleParticipantsModal = ({ participants = [], onClose, isAdmin, onRemoveParticipant }) => {
  return ReactDOM.createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="viking-modal participants-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="header-content">
            <h2 className="viking-modal-title">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: '10px', color: 'var(--accent-gold)'}}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
              Raffle Participants
            </h2>
            <p className="viking-modal-subtitle">Full list of current entries ({participants.length})</p>
          </div>
          <button className="viking-modal-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        
        <div className="modal-body">
          <div className={`viking-grid-header ${isAdmin ? 'has-admin' : ''}`}>
            <span>RANK</span>
            <span>PLAYER</span>
            <span>AURORY ID</span>
            <span>JOINED</span>
            {isAdmin && <span>ACTION</span>}
          </div>
          <div className="participants-scroll-area">
            {participants.length === 0 ? (
              <div className="no-participants">No participants yet. Be the first to join!</div>
            ) : (
              participants.map((p, i) => (
                <div key={p.uid || i} className={`viking-participant-row ${isAdmin ? 'has-admin' : ''}`}>
                  <span className="p-rank">#{i + 1}</span>
                  <span className="p-name">{p.playerName}</span>
                  <span className="p-id">{p.auroryPlayerId || 'N/A'}</span>
                  <span className="p-date">
                    {new Date(p.joinedAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {isAdmin && (
                    <button 
                      className="viking-remove-btn" 
                      onClick={() => onRemoveParticipant(p)}
                      title="Remove participant"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default RaffleParticipantsModal;
