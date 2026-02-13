import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './LegalPage.css';

const TermsPage = () => {
    const navigate = useNavigate();

    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    return (
        <div className="legal-page">
            <header className="legal-header">
                <button className="back-btn" onClick={() => navigate('/')}>← Back home</button>
                <h1>Terms of Service</h1>
            </header>

            <main className="legal-content">
                <section>
                    <h2>1. Acceptance of Terms</h2>
                    <p>By accessing or using <strong>Aurory Draft</strong>, you agree to be bound by these Terms of Service. If you do not agree, please do not use the application. We reserve the right to modify these terms at any time, and your continued use constitutes acceptance of those changes.</p>
                </section>

                <section>
                    <h2>2. Draft & Tournament Rules</h2>
                    <p>Users participate in automated drafts (1v1, Triad Swiss, or custom modes). <strong>Turn order</strong> is determined by a pre-determined coin roll system or manual selection by the winning team leader of the coin flip.</p>
                    <p>Intentional disconnection, exploiting glitches, or attempting to manipulate draft timers may lead to disqualification and restricted access to future events.</p>
                </section>

                <section>
                    <h2>3. Wallet & AURY Transactions</h2>
                    <p>Aurory Draft facilitates match pools using <strong>AURY</strong> tokens. By depositing tokens to our designated wallet, you acknowledge that these funds are used for tournament entry and prize distribution.</p>
                    <p><strong>Withdrawals</strong> are processed after match verification. While we strive for instant automation, some payouts may require manual verification by an administrator to ensure fair play.</p>
                </section>

                <section>
                    <h2>4. Blockchain & Solana Network</h2>
                    <p>All transactions occur on the <strong>Solana Blockchain</strong>. We are not responsible for network congestion, failed transactions, or fluctuations in token value. You are responsible for ensuring your wallet information is correct.</p>
                </section>

                <section>
                    <h2>5. Fair Play & Conduct</h2>
                    <p>Users are expected to maintain professional conduct in all community chats. Harassment, hate speech, or spam will result in immediate suspension.</p>
                    <p><strong>Multi-accounting</strong> to manipulate tournament seeding or prize pools is strictly prohibited and will result in a permanent ban of all associated accounts.</p>
                </section>

                <section>
                    <h2>6. Disclaimer of Warranties</h2>
                    <p>The service is provided "as is". We make no warranties regarding uptime, the outcome of random mechanics (like coin rolls), or the performance of third-party assets (Amikos/Aurorians).</p>
                </section>

                <section>
                    <h2>7. Limitation of Liability</h2>
                    <p>In no event shall Aurory Draft be liable for any indirect, incidental, or consequential damages resulting from your use of the service, including loss of tokens due to user error or blockchain-related failures.</p>
                </section>

                <section>
                    <h2>8. Governing Law</h2>
                    <p>These terms are governed by the laws of the jurisdiction in which the service operates. Any disputes shall be settled through binding arbitration in that jurisdiction.</p>
                </section>

                <div className="last-updated">Last updated: February 13, 2026</div>
            </main>
        </div>
    );
};

export default TermsPage;
