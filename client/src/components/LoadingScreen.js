import React from 'react';
import './LoadingScreen.css';

/**
 * Reusable Loading Screen component featuring the Asgard Duels logo GIF
 * @param {Object} props
 * @param {boolean} props.fullScreen - Whether to show the loader as a full-page overlay
 * @param {string} props.message - Optional message to show below the loader
 */
const LoadingScreen = ({ fullScreen = false, message = 'Loading...' }) => {
    return (
        <div className={`loading-container ${fullScreen ? 'full-screen' : ''}`}>
            <div className="loading-content">
                <div className="loading-logo-container">
                    <img
                        src="/AsgardDuels logos/AsgardDuels logo_loading.gif"
                        alt="Loading..."
                        className="loading-gif"
                    />
                </div>
                {message && <p className="loading-message">{message}</p>}
            </div>
        </div>
    );
};

export default LoadingScreen;
