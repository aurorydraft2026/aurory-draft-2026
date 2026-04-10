import React from 'react';
import './LoadingScreen.css';

/**
 * Reusable Loading Screen component featuring the Asgard logo GIF
 * @param {Object} props
 * @param {boolean} props.fullScreen - Whether to show the loader as a full-page overlay
 * @param {string} props.message - Optional message to show below the loader
 */
const LoadingScreen = ({ fullScreen = false, message = 'Loading...' }) => {
    return (
        <div className={`loading-container ${fullScreen ? 'full-screen' : ''}`}>
            <div className="loading-content">
                <div className="loading-orbit-container">
                    <img src="/Asgard_logo_white_mobile.svg" alt="Asgard" className="loading-logo-themed" />
                    <div className="spinning-icon icon-1">⚔️</div>
                    <div className="spinning-icon icon-2">🛡️</div>
                    <div className="spinning-icon icon-3">⚡</div>
                    <div className="spinning-icon icon-4">🔥</div>
                </div>
                {message && <p className="loading-message">{message}</p>}
            </div>
        </div>
    );
};

export default LoadingScreen;
