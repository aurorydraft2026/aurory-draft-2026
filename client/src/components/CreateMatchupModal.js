import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import './CreateMatchupModal.css';

const CreateMatchupModal = ({ isOpen, onClose, user }) => {
    const navigate = useNavigate();
    const [formData, setFormData] = useState({
        title: '',
        description: '',
        poolPrize: '',
        startDate: '',
        draftType: 'mode3',
        maxParticipants: 2,
        format: 'individual',
        tournamentType: 'single_elimination'
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState(null);

    // Sync draft mode when format changes
    useEffect(() => {
        if (formData.format === 'individual') {
            if (formData.draftType !== 'mode3' && formData.draftType !== 'mode4') {
                setFormData(prev => ({ ...prev, draftType: 'mode3' }));
            }
        } else if (formData.format === 'teams') {
            if (formData.draftType !== 'mode1' && formData.draftType !== 'mode2') {
                setFormData(prev => ({ ...prev, draftType: 'mode1' }));
            }
        }
    }, [formData.format, formData.draftType]);

    if (!isOpen) return null;

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: value
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        setError(null);

        try {
            const matchupsRef = collection(db, 'matchups');
            const docRef = await addDoc(matchupsRef, {
                ...formData,
                poolPrize: parseFloat(formData.poolPrize) || 0,
                maxParticipants: parseInt(formData.maxParticipants) || 2,
                participants: [], // List of user UIDs or Team Objects
                participantUids: [], // Flat list of all involved UIDs (for rules/queries)
                status: 'waiting',
                createdBy: user.uid,
                createdAt: serverTimestamp(),
                startDate: formData.startDate ? new Date(formData.startDate) : null
            });
            onClose();
            navigate(`/matchup/${docRef.id}`);
            // Reset form
            setFormData({
                title: '',
                description: '',
                poolPrize: '',
                startDate: '',
                draftType: 'mode3',
                maxParticipants: 2,
                format: 'individual',
                tournamentType: 'single_elimination'
            });
        } catch (err) {
            console.error('Error creating matchup:', err);
            setError('Failed to create tournament. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return ReactDOM.createPortal(
        <div className="modal-overlay">
            <div className="create-modal create-matchup-modal">
                <div className="modal-header">
                    <h3>➕ Create New Tournament</h3>
                    <button className="close-modal" onClick={onClose}>✖</button>
                </div>
                <div className="modal-body">
                    <form onSubmit={handleSubmit}>
                        {error && <div className="error-message">{error}</div>}

                        <div className="form-group">
                            <label>Title *</label>
                            <input
                                type="text"
                                name="title"
                                value={formData.title}
                                onChange={handleChange}
                                placeholder="Tournament Title"
                                className="form-input"
                                required
                            />
                        </div>

                        <div className="form-group">
                            <label>Description</label>
                            <textarea
                                name="description"
                                value={formData.description}
                                onChange={handleChange}
                                placeholder="Description (Format, rules, etc.)"
                                className="form-textarea"
                                rows="3"
                            ></textarea>
                        </div>

                        <div className="form-row">
                            <div className="form-group">
                                <label>Pool Prize (AURY) *</label>
                                <input
                                    type="number"
                                    name="poolPrize"
                                    value={formData.poolPrize}
                                    onChange={handleChange}
                                    placeholder="0.00"
                                    step="0.01"
                                    className="form-input"
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label>Max Participants *</label>
                                <input
                                    type="number"
                                    name="maxParticipants"
                                    value={formData.maxParticipants}
                                    onChange={handleChange}
                                    min="2"
                                    className="form-input"
                                    required
                                />
                            </div>
                        </div>

                        <div className="form-row">
                            <div className="form-group">
                                <label>Format</label>
                                <select
                                    name="format"
                                    value={formData.format}
                                    onChange={handleChange}
                                    className="form-input"
                                >
                                    <option value="individual">Individual</option>
                                    <option value="teams">Teams</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label>Draft Mode</label>
                                <select
                                    name="draftType"
                                    value={formData.draftType}
                                    onChange={handleChange}
                                    className="form-input"
                                >
                                    {formData.format === 'teams' ? (
                                        <>
                                            <option value="mode1">3v3 Triad (3-6-3)</option>
                                            <option value="mode2">3v3 Triad (1-2-1)</option>
                                        </>
                                    ) : (
                                        <>
                                            <option value="mode3">1v1 Deathmatch (3-3)</option>
                                            <option value="mode4">1v1 Ban Draft (1-2-1)</option>
                                        </>
                                    )}
                                </select>
                            </div>
                        </div>

                        <div className="form-row">
                            <div className="form-group">
                                <label>Start Date *</label>
                                <input
                                    type="datetime-local"
                                    name="startDate"
                                    value={formData.startDate}
                                    onChange={handleChange}
                                    className="form-input"
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label>Tournament Type</label>
                                <select
                                    name="tournamentType"
                                    value={formData.tournamentType}
                                    onChange={handleChange}
                                    className="form-input"
                                >
                                    <option value="single_elimination">Single Elimination</option>
                                    <option value="round_robin">Round Robin</option>
                                </select>
                            </div>
                        </div>
                    </form>
                </div>
                <div className="modal-footer">
                    <button type="button" className="cancel-btn" onClick={onClose} disabled={isSubmitting}>
                        Cancel
                    </button>
                    <button type="submit" className="create-btn" onClick={handleSubmit} disabled={isSubmitting}>
                        {isSubmitting ? 'Creating...' : '🚀 Create Tournament'}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default CreateMatchupModal;
