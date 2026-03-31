import React from 'react';
import ReactDOM from 'react-dom';
import './RaffleParticipantsModal.css';

const RaffleParticipantsModal = ({ participants = [], onClose, isAdmin, onRemoveParticipant }) => {
  return ReactDOM.createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="create-modal participants-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="header-content">
            <h2>👥 Raffle Participants</h2>
            <p>Full list of current entries ({participants.length})</p>
          </div>
          <button className="close-btn" onClick={onClose}>✖</button>
        </div>
        
        <div className="modal-body">
          <div className={`participants-grid-header ${isAdmin ? 'has-admin' : ''}`}>
            <span>Rank</span>
            <span>Player</span>
            <span>Aurory ID</span>
            <span>Joined</span>
            {isAdmin && <span>Action</span>}
          </div>
          <div className="participants-scroll-area">
            {participants.length === 0 ? (
              <div className="no-participants">No participants yet. Be the first to join!</div>
            ) : (
              participants.map((p, i) => (
                <div key={p.uid || i} className={`participant-row ${isAdmin ? 'has-admin' : ''}`}>
                  <span className="p-rank">#{i + 1}</span>
                  <span className="p-name">{p.playerName}</span>
                  <span className="p-id">{p.auroryPlayerId || 'N/A'}</span>
                  <span className="p-date">
                    {new Date(p.joinedAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {isAdmin && (
                    <button 
                      className="p-remove-btn" 
                      onClick={() => onRemoveParticipant(p)}
                      title="Remove participant"
                    >
                      🗑️
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
