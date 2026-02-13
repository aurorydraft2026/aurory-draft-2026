import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './LegalPage.css';

const PrivacyPage = () => {
    const navigate = useNavigate();

    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    return (
        <div className="legal-page">
            <header className="legal-header">
                <button className="back-btn" onClick={() => navigate('/')}>← Back home</button>
                <h1>Privacy Policy</h1>
            </header>

            <main className="legal-content">
                <section>
                    <h2>1. Information Collection</h2>
                    <p>We collect information necessary to provide a secure and fair drafting experience. When you authenticate via <strong>Discord</strong> or <strong>Google</strong>, we receive your public profile information, including your username, unique ID, and profile picture URL.</p>
                    <p>Additionally, we collect your <strong>Public Wallet Address</strong> when you link your account for prize distribution or AURY transactions.</p>
                </section>

                <section>
                    <h2>2. Use of Information</h2>
                    <p>Your data is used to:</p>
                    <ul>
                        <li>Generate and maintain your Aurory Draft profile.</li>
                        <li>Track match history, tournament standings, and win rates.</li>
                        <li>Facilitate secure AURY prize distributions.</li>
                        <li>Monitor for fair play and anti-cheat compliance.</li>
                    </ul>
                </section>

                <section>
                    <h2>3. Data Visibility & Public Records</h2>
                    <p>By using Aurory Draft, you acknowledge that certain information is <strong>publicly visible</strong>. This includes your username, match history, tournament results, and public wallet address for transparency on the Solana blockchain.</p>
                </section>

                <section>
                    <h2>4. Third-Party Services</h2>
                    <p>We use third-party authentication providers (Discord and Google). While we receive profile data from them, we do not have access to your passwords. We also interact with the <strong>Solana Blockchain</strong>; any data sent to the blockchain becomes a permanent, immutable public record.</p>
                </section>

                <section>
                    <h2>5. Data Retention & Security</h2>
                    <p>We implement industry-standard security measures to protect your account data. We retain your information as long as your account is active to provide you with historical match data and maintain leaderboard integrity.</p>
                </section>

                <section>
                    <h2>6. Your Rights</h2>
                    <p>You may request a summary of the data we hold or request account deletion through our official Discord support channel. Please note that blockchain-based transaction records cannot be deleted.</p>
                </section>

                <div className="last-updated">Last updated: February 13, 2026</div>
            </main>
        </div>
    );
};

export default PrivacyPage;
