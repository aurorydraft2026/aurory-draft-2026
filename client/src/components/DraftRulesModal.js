import React from 'react';
import { DRAFT_RULES } from '../data/draftRules';
import './DraftRulesModal.css';

const DraftRulesModal = ({ isOpen, onClose, draftType, onAccept, showAcceptButton }) => {
    if (!isOpen) return null;

    const modeData = DRAFT_RULES[draftType] || DRAFT_RULES.mode1;

    return (
        <div className="rules-modal-overlay" onClick={onClose}>
            <div className="rules-modal-content" onClick={e => e.stopPropagation()}>
                <div className="rules-modal-header">
                    <div className="rules-header-icon">📜</div>
                    <div className="rules-header-text">
                        <h2>Draft Rules</h2>
                        <div className="rules-mode-badge">{modeData.title}</div>
                    </div>
                    <button className="rules-close-btn" onClick={onClose}>&times;</button>
                </div>

                <div className="rules-modal-body">
                    <p className="rules-mode-description">{modeData.description}</p>

                    <div className="rules-list">
                        {modeData.rules.map((rule) => (
                            <div key={rule.id} className="rule-item">
                                <div className="rule-number">{rule.id}</div>
                                <div className="rule-details">
                                    <h3>{rule.title}</h3>
                                    <p>{rule.content}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="rules-modal-footer">
                    {showAcceptButton ? (
                        <div className="rules-footer-actions">
                            <button className="rules-cancel-btn" onClick={onClose}>Cancel</button>
                            <button className="rules-accept-btn" onClick={onAccept}>Accept & Join</button>
                        </div>
                    ) : (
                        <button className="rules-got-it-btn" onClick={onClose}>Got it!</button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default DraftRulesModal;
