import React from 'react';
import { Link } from 'react-router-dom';
import './Footer.css';

const Footer = () => {
    return (
        <footer className="app-footer">
            <div className="footer-content">
                <div className="footer-left">
                    <p className="footer-msg">Built with ❤️ for the Aurory Tournament Community. Happy Playing! 🎮🔴</p>
                    <p className="footer-tagline">Asgard Duels Community 2026</p>
                    <p className="footer-disclaimer">
                        Asgard Duels is an independent, fan-made competitive platform. We are not affiliated with, endorsed by, or associated with Aurory, Syncos, or their subsidiaries. All trademarks belong to their respective owners.
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
                                href="https://discord.gg/GQ4mbtRj"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="footer-link discord aurory"
                                title="Join Aurory Community Discord"
                            >
                                <img src="/aurory-logo.png" alt="Aurory" className="footer-link-logo" />
                                <span>Aurory</span>
                            </a>
                            <a
                                href="https://discord.gg/kFdCJRu7"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="footer-link discord asgard"
                                title="Join Asgard Duels Community Discord"
                            >
                                <img src="/AsgardDuels logos/AD_logo_mobile_colored.svg" alt="Asgard Duels" className="footer-link-logo" />
                                <span>Asgard Duels</span>
                            </a>
                            <a
                                href="https://x.com/AsgardDuels"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="footer-link x-twitter"
                                title="Follow us on X"
                            >
                                <span className="x-icon">𝕏</span>
                                <span>Asgard Duels</span>
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </footer>
    );
};

export default Footer;
