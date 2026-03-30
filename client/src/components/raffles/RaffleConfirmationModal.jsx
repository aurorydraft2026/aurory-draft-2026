import React from 'react';
import ReactDOM from 'react-dom';
import './RaffleConfirmationModal.css';

const RaffleConfirmationModal = ({ 
    isOpen, 
    onClose, 
    onConfirm, 
    title = "Confirm Action", 
    message = "Are you sure you want to proceed?", 
    confirmText = "Confirm",
    cancelText = "Cancel",
    type = "info" // info, warning, danger
}) => {
    if (!isOpen) return null;

    return ReactDOM.createPortal(
        <div className="modal-overlay" onClick={onClose}>
            <div className={`raffle-confirmation-modal create-modal ${type}`} onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>{title}</h3>
                    <button className="close-modal" onClick={onClose}>✖</button>
                </div>

                <div className="modal-body">
                    <p className="confirmation-message">{message}</p>
                </div>

                <div className="modal-footer">
                    <button className="cancel-btn" onClick={onClose}>
                        {cancelText}
                    </button>
                    <button 
                        className={`confirm-btn ${type}`} 
                        onClick={() => {
                            onConfirm();
                            onClose();
                        }}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default RaffleConfirmationModal;
