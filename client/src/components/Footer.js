import React from 'react';
import { Link } from 'react-router-dom';
import './Footer.css';

const Footer = () => {
    return (
        <footer className="app-footer">
            <div className="footer-content">
                <div className="footer-left">
                    <p className="footer-msg">Built with ❤️ for the Aurory Tournament Community. Happy Playing! 🎮🔴</p>
                    <p className="footer-tagline">Asgard Community 2026</p>
                    <p className="footer-disclaimer">
                        Asgard is an independent, fan-made competitive platform. We are not affiliated with, endorsed by, or associated with Aurory or their subsidiaries. All trademarks belong to their respective owners.
                    </p>
                    <div className="footer-legal-links">
                        <Link to="/terms">Terms of Service</Link>
                        <span className="dot">•</span>
                        <Link to="/privacy">Privacy Policy</Link>
                    </div>
                </div>
                <div className="footer-right">
                    <div className="footer-links-wrapper">
                        <p className="footer-links-label">Connect with us!</p>
                        <div className="footer-links-container">
                            <a
                                href="https://discord.gg/6EK2jwnM"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="footer-link discord asgard"
                                title="Join Asgard Discord"
                            >
                                <img src="/asgard-guild-logo.jpg" alt="Asgard" className="footer-link-logo" />
                                <span>Asgard</span>
                            </a>
                            <a
                                href="https://x.com/asgardduel"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="footer-link x-twitter"
                                title="Follow us on X"
                            >
                                <span className="x-icon">𝕏</span>
                                <span>Asgard</span>
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </footer>
    );
};

export default Footer;
