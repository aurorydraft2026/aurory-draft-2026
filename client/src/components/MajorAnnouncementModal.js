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
            // Check for inline image on its own line
            const imgMatch = line.match(/^!\[(.*?)\]\((.*?)\)$/);
            if (imgMatch) {
                return (
                    <div key={i} style={{ textAlign: 'center', margin: '12px 0' }}>
                        <img src={imgMatch[2]} alt={imgMatch[1]} className="news-body-image" style={{ maxWidth: '100%', borderRadius: '8px' }} />
                    </div>
                );
            }
            // Bold
            let formattedLine = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            // Italic
            formattedLine = formattedLine.replace(/_(.*?)_/g, '<em>$1</em>');
            // Links
            formattedLine = formattedLine.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
            // Inline images within text
            formattedLine = formattedLine.replace(/!\[(.*?)\]\((.*?)\)/g, '<img src="$2" alt="$1" class="news-body-image" style="max-width:100%;border-radius:8px;" />');
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

                <div className="announcement-header">
                    <div className="announcement-badge-pulse">
                        <div className="announcement-badge">Major Update</div>
                    </div>
                    <h2>{title}</h2>
                    <div className="header-divider"></div>
                </div>

                <div className="announcement-body custom-scrollbar">
                    {formatContent(content)}
                </div>

                <div className="announcement-footer">
                    <div className="footer-main-actions">
                        {link && (
                            <a
                                href={link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="announcement-primary-btn"
                            >
                                <span>Get Started</span>
                                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="5" y1="12" x2="19" y2="12"></line>
                                    <polyline points="12 5 19 12 12 19"></polyline>
                                </svg>
                            </a>
                        )}
                        <button className="announcement-secondary-btn" onClick={handleClose}>
                            Maybe Later
                        </button>
                    </div>
                    
                    <button className="announcement-meta-btn" onClick={handleDonotShowAgain}>
                        Don't show this again today
                    </button>
                </div>
            </div>
        </div>
    );
};

export default MajorAnnouncementModal;
