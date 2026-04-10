import React, { useEffect, useState } from 'react';
import { db } from '../firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import './MaintenancePage.css';

const MaintenancePage = () => {
    const [maintenance, setMaintenance] = useState({
        enabled: true,
        scheduledDate: 'TBD',
        announcement: 'We are currently performing scheduled maintenance to improve your experience. Please check back soon!'
    });

    useEffect(() => {
        const unsubscribe = onSnapshot(doc(db, 'settings', 'maintenance'), (docSnap) => {
            if (docSnap.exists()) {
                setMaintenance(docSnap.data());
            }
        });

        return () => unsubscribe();
    }, []);

    return (
        <div className="maintenance-container">
            <div className="maintenance-overlay"></div>
            <div className="maintenance-glow"></div>
            <div className="maintenance-content">
                <div className="logo-section" onClick={() => window.location.href = '/'} style={{ cursor: 'pointer' }}>
                    <div className="logo-themed logo-desktop maintenance-logo" aria-label="Asgard" />
                    <div className="logo-shadow"></div>
                </div>
                
                <h1 className="maintenance-title">System <span className="highlight">Maintenance</span></h1>
                
                <div className="maintenance-status-card">
                    <div className="status-badge-container">
                        <span className="status-badge pulse">🛠️ SYSTEM UPDATING</span>
                    </div>
                    
                    <p className="maintenance-announcement">
                        {maintenance.announcement}
                    </p>
                    
                    <div className="maintenance-details">
                        <div className="detail-item">
                            <span className="detail-label">ESTIMATED COMPLETION</span>
                            <span className="detail-value">{maintenance.scheduledDate} <small>(UTC)</small></span>
                        </div>
                    </div>
                </div>

                <div className="social-links">
                    <p>Stay updated via our official channels:</p>
                    <div className="link-grid">
                        <a href="https://discord.gg/asgard" target="_blank" rel="noreferrer" className="social-link discord">
                            <span className="link-icon">💬</span> Discord
                        </a>
                        <a href="https://x.com/asgard" target="_blank" rel="noreferrer" className="social-link twitter">
                            <span className="link-icon">𝕏</span> Twitter
                        </a>
                    </div>
                </div>

                <footer className="maintenance-footer">
                    &copy; {new Date().getFullYear()} Asgard. All glory to the winners.
                </footer>
            </div>
        </div>
    );
};

export default MaintenancePage;
