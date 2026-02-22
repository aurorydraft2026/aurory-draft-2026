import React, { useState, useEffect } from 'react';
import './JoinTeamModal.css';

const JoinTeamModal = ({ isOpen, onClose, onJoin, registeredUsers, currentUser }) => {
    const [teamName, setTeamName] = useState('');
    const [teamBanner, setTeamBanner] = useState(null);
    const [leader, setLeader] = useState(currentUser?.uid || null);
    const [member1, setMember1] = useState(null);
    const [member2, setMember2] = useState(null);
    const [assigningSlot, setAssigningSlot] = useState(null); // { role: 'leader' | 'member1' | 'member2' }
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        if (isOpen && currentUser) {
            setLeader(currentUser.uid);
            // Default team name to player's name if empty
            if (!teamName) {
                setTeamName(`${currentUser.auroryPlayerName || currentUser.displayName || 'Player'}'s Team`);
            }
        }
    }, [isOpen, currentUser, teamName]);

    if (!isOpen) return null;

    const getUserById = (id) => registeredUsers.find(u => u.id === id);

    const handleBannerUpload = (event) => {
        const file = event.target.files?.[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            alert('Please select an image file');
            return;
        }

        if (file.size > 2 * 1024 * 1024) {
            alert('Image must be smaller than 2MB');
            return;
        }

        const reader = new FileReader();
        reader.onloadend = () => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_SIZE = 256;
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > MAX_SIZE) {
                        height = Math.round((height * MAX_SIZE) / width);
                        width = MAX_SIZE;
                    }
                } else {
                    if (height > MAX_SIZE) {
                        width = Math.round((width * MAX_SIZE) / height);
                        height = MAX_SIZE;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                const compressed = canvas.toDataURL('image/jpeg', 0.8);
                setTeamBanner(compressed);
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    };

    const handleAssign = (userId) => {
        if (!assigningSlot) return;

        const targetUser = getUserById(userId);
        if (!targetUser?.auroryPlayerId) {
            alert('This user has not linked an Aurory account and cannot participate.');
            return;
        }

        if (assigningSlot.role === 'leader') setLeader(userId);
        else if (assigningSlot.role === 'member1') setMember1(userId);
        else if (assigningSlot.role === 'member2') setMember2(userId);

        setAssigningSlot(null);
        setSearchQuery('');
    };

    const handleSubmit = () => {
        if (!teamName.trim()) {
            alert('Please enter a team name');
            return;
        }
        if (!leader || !member1 || !member2) {
            alert('Please select a leader and 2 members');
            return;
        }

        onJoin({
            teamName: teamName.trim(),
            banner: teamBanner,
            leader,
            members: [member1, member2],
            joinedAt: new Date().toISOString()
        });

        onClose();
    };

    const filteredUsers = registeredUsers.filter(u => {
        const search = searchQuery.toLowerCase();
        const matchesSearch = (u.displayName?.toLowerCase().includes(search) ||
            u.auroryPlayerName?.toLowerCase().includes(search) ||
            u.email?.toLowerCase().includes(search));

        // Exclude already selected
        const isSelected = u.id === leader || u.id === member1 || u.id === member2;

        return matchesSearch && !isSelected;
    });

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="join-team-modal create-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>🛡️ Join as Team</h3>
                    <button className="close-modal" onClick={onClose}>✖</button>
                </div>

                <div className="modal-body">
                    <div className="form-group">
                        <label>Team Name *</label>
                        <input
                            type="text"
                            placeholder="Enter team name..."
                            value={teamName}
                            onChange={(e) => setTeamName(e.target.value)}
                            className="form-input"
                        />
                    </div>

                    <div className="team-banner-section">
                        <label>Team Banner / Logo</label>
                        <div className="team-banner-upload">
                            <label className="banner-upload-label">
                                {teamBanner ? (
                                    <div className="banner-preview">
                                        <img src={teamBanner} alt="Team Banner" />
                                        <button
                                            type="button"
                                            className="remove-banner-btn"
                                            onClick={(e) => { e.preventDefault(); setTeamBanner(null); }}
                                        >✖</button>
                                    </div>
                                ) : (
                                    <div className="banner-placeholder">
                                        <span>📷</span>
                                        <span>Upload Team Logo</span>
                                    </div>
                                )}
                                <input
                                    type="file"
                                    accept="image/*"
                                    onChange={handleBannerUpload}
                                    style={{ display: 'none' }}
                                />
                            </label>
                        </div>
                    </div>

                    <div className="team-roster-assignment">
                        <label>Team Roster *</label>

                        {/* Leader Slot */}
                        <div className="assignment-slot">
                            <span className="slot-label">👑 Leader</span>
                            {leader ? (
                                <div className="assigned-user">
                                    <img
                                        src={getUserById(leader)?.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png'}
                                        alt=""
                                    />
                                    <span>{getUserById(leader)?.displayName || 'Unknown'}</span>
                                    {leader !== currentUser.uid && (
                                        <button className="remove-btn" onClick={() => setLeader(null)}>✖</button>
                                    )}
                                </div>
                            ) : (
                                <button className="assign-btn" onClick={() => setAssigningSlot({ role: 'leader' })}>
                                    + Assign Leader
                                </button>
                            )}
                        </div>

                        {/* Members Slots */}
                        <div className="members-grid-slots">
                            <div className="assignment-slot member-slot">
                                <span className="slot-label">👤 Member 1</span>
                                {member1 ? (
                                    <div className="assigned-user mini">
                                        <img src={getUserById(member1)?.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png'} alt="" />
                                        <span className="mini-name">{getUserById(member1)?.displayName || 'Unknown'}</span>
                                        <button className="remove-btn" onClick={() => setMember1(null)}>✖</button>
                                    </div>
                                ) : (
                                    <button className="assign-btn mini" onClick={() => setAssigningSlot({ role: 'member1' })}>
                                        + Assign Member
                                    </button>
                                )}
                            </div>

                            <div className="assignment-slot member-slot">
                                <span className="slot-label">👤 Member 2</span>
                                {member2 ? (
                                    <div className="assigned-user mini">
                                        <img src={getUserById(member2)?.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png'} alt="" />
                                        <span className="mini-name">{getUserById(member2)?.displayName || 'Unknown'}</span>
                                        <button className="remove-btn" onClick={() => setMember2(null)}>✖</button>
                                    </div>
                                ) : (
                                    <button className="assign-btn mini" onClick={() => setAssigningSlot({ role: 'member2' })}>
                                        + Assign Member
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="modal-footer">
                    <button className="cancel-btn" onClick={onClose}>Cancel</button>
                    <button className="create-btn" onClick={handleSubmit}>🚀 Join Matchup</button>
                </div>

                {/* Selection Overlay */}
                {assigningSlot && (
                    <div className="modal-overlay selection-overlay">
                        <div className="participant-selection-modal">
                            <div className="modal-header">
                                <h3>👥 Select {assigningSlot.role === 'leader' ? 'Leader' : 'Team Member'}</h3>
                                <button className="close-modal" onClick={() => setAssigningSlot(null)}>✖</button>
                            </div>
                            <div className="selection-search-container">
                                <input
                                    type="text"
                                    placeholder="Search by name or email..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="form-input selection-search-input"
                                    autoFocus
                                />
                            </div>
                            <div className="selection-modal-content">
                                <div className="participants-list">
                                    {filteredUsers.length === 0 ? (
                                        <p className="no-users">No available users found.</p>
                                    ) : (
                                        filteredUsers.map(u => (
                                            <div
                                                key={u.id}
                                                className={`participant-item hoverable ${!u.auroryPlayerId ? 'unlinked-warning' : ''}`}
                                                onClick={() => handleAssign(u.id)}
                                            >
                                                <img
                                                    src={u.auroryProfilePicture || u.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png'}
                                                    alt=""
                                                    className="participant-avatar"
                                                />
                                                <div className="participant-info">
                                                    <span className="participant-name">{u.displayName || u.username || 'Unknown'}</span>
                                                    {!u.auroryPlayerId && <span className="unlinked-label">⚠️ No Aurory account</span>}
                                                </div>
                                                <div className="plus-indicator">+</div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default JoinTeamModal;
