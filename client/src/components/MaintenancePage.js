import React from 'react';
import './MaintenancePage.css';
const MaintenancePage = ({ message }) => {

    return (
        <div className="maintenance-container">
            <div className="maintenance-content">
                <div className="maintenance-icon">🛠️</div>
                <h1>System Maintenance</h1>
                <p className="description">
                    {message || "We're currently performing some essential maintenance to improve your experience. We'll be back online shortly!"}
                </p>

                <div className="maintenance-status-card">
                    <div className="status-label">Current Status</div>
                    <div className="status-value">Soft Lock Initialized</div>
                    <div className="status-subtext">Ongoing drafts are preserved. No new drafts allowed.</div>
                </div>

                <div className="social-links-minimal">
                    <p>Follow us for updates:</p>
                    <div className="icons-row">
                        <a href="https://twitter.com/AuroryProject" target="_blank" rel="noopener noreferrer">Twitter</a>
                        <a href="https://discord.gg/aurory" target="_blank" rel="noopener noreferrer">Discord</a>
                    </div>
                </div>

                <button className="refresh-home-btn" onClick={() => window.location.reload()}>
                    Check Status
                </button>
            </div>
        </div>
    );
};

export default MaintenancePage;
