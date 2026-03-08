import React from 'react';
import './LeaveConfirmationModal.css';

const LeaveConfirmationModal = ({ isOpen, onClose, onConfirm }) => {
    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="leave-confirmation-modal create-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header leave-modal-header">
                    <h3>⚠️ Leave Tournament?</h3>
                    <button className="close-modal" onClick={onClose}>✖</button>
                </div>

                <div className="modal-body leave-modal-body">
                    <div className="warning-notice">
                        <p className="warning-text">
                            Are you sure you want to leave this tournament?
                        </p>
                        <p className="fee-warning">
                            The <strong>100 AURY</strong> registration fee is <strong>non-refundable</strong> and will not be returned to your wallet.
                        </p>
                    </div>
                </div>

                <div className="modal-footer leave-modal-footer">
                    <button className="cancel-btn" onClick={onClose}>
                        Go Back
                    </button>
                    <button className="create-btn confirm-leave-btn" onClick={() => { onConfirm(); onClose(); }}>
                        Confirm Leave
                    </button>
                </div>
            </div>
        </div>
    );
};

export default LeaveConfirmationModal;
