import React, { useState, useEffect } from 'react';
import './MajorAnnouncementModal.css';

const MajorAnnouncementModal = ({ title, content, link, onClose }) => {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        // Animation trigger
        const timer = setTimeout(() => setIsVisible(true), 100);

        // Prevent scrolling while modal is open
        document.body.style.overflow = 'hidden';

        return () => {
            clearTimeout(timer);
            document.body.style.overflow = 'unset';
        };
    }, []);

    const handleClose = () => {
        setIsVisible(false);
        setTimeout(onClose, 300); // Wait for animation
    };

    const handleDonotShowAgain = () => {
        sessionStorage.setItem('major_announcement_dismissed', 'true');
        handleClose();
    };

    // Helper to format content (simple markdown-like replacement)
    const formatContent = (text) => {
        if (!text) return null;

        return text.split('\n').map((line, i) => {
            // Bold
            let formattedLine = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            // Titles (Sections I, II, III etc)
            if (/^[IVX]+\./.test(line)) {
                return (
                    <h3 key={i} className="announcement-section-title">
                        <span dangerouslySetInnerHTML={{ __html: formattedLine }} />
                    </h3>
                );
            }
            // Bullet points
            if (line.trim().startsWith('-') || /^\d+\./.test(line.trim())) {
                return <li key={i} dangerouslySetInnerHTML={{ __html: formattedLine }} />;
            }
            // Empty lines
            if (!line.trim()) return <br key={i} />;

            return <p key={i} dangerouslySetInnerHTML={{ __html: formattedLine }} />;
        });
    };

    return (
        <div className={`major-announcement-overlay ${isVisible ? 'visible' : ''}`} onClick={handleClose}>
            <div className={`major-announcement-content ${isVisible ? 'visible' : ''}`} onClick={e => e.stopPropagation()}>
                <div className="announcement-glass-effect"></div>

                <button className="close-corner-btn" onClick={handleClose}>×</button>

                <div className="announcement-header">
                    <div className="announcement-badge">Major Update</div>
                    <h2>{title}</h2>
                    <div className="header-divider"></div>
                </div>

                <div className="announcement-body custom-scrollbar">
                    {formatContent(content)}
                </div>

                <div className="announcement-footer">
                    <div className="footer-actions">
                        {link && (
                            <a
                                href={link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="announcement-action-btn"
                            >
                                Get Started
                            </a>
                        )}
                        <button className="announcement-dismiss-btn" onClick={handleClose}>
                            Maybe Later
                        </button>
                    </div>
                    <button className="dont-show-btn" onClick={handleDonotShowAgain}>
                        Don't show this again today
                    </button>
                </div>
            </div>
        </div>
    );
};

export default MajorAnnouncementModal;
