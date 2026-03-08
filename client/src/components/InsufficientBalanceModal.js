import React from 'react';
import './InsufficientBalanceModal.css';

const InsufficientBalanceModal = ({ isOpen, onClose, requiredAmount, currentBalance, onDeposit }) => {
    if (!isOpen) return null;

    const formatAmount = (nanoAury) => {
        return (nanoAury / 1e9).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 9 });
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="insufficient-balance-modal create-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header balance-modal-header">
                    <h3>⚠️ Insufficient Balance</h3>
                    <button className="close-modal" onClick={onClose}>✖</button>
                </div>

                <div className="modal-body balance-modal-body">
                    <p className="error-message">
                        You don't have enough AURY to join this tournament.
                    </p>

                    <div className="balance-comparison">
                        <div className="balance-stat">
                            <span className="stat-label">Entry Fee</span>
                            <span className="stat-value fee">{formatAmount(requiredAmount)} AURY</span>
                        </div>
                        <div className="balance-stat">
                            <span className="stat-label">Your Balance</span>
                            <span className="stat-value current">{formatAmount(currentBalance)} AURY</span>
                        </div>
                    </div>

                    <div className="missing-amount-tag">
                        Missing: {formatAmount(Math.max(0, requiredAmount - currentBalance))} AURY
                    </div>

                    <p className="sub-text">
                        Please deposit more AURY to your wallet to participate in this tournament.
                    </p>
                </div>

                <div className="modal-footer balance-modal-footer">
                    <button className="cancel-btn" onClick={onClose}>
                        Close
                    </button>
                    <button className="create-btn deposit-btn" onClick={onDeposit}>
                        💰 Deposit Now
                    </button>
                </div>
            </div>
        </div>
    );
};

export default InsufficientBalanceModal;
