import React from 'react';
import './AmikoInventoryCard.css';

const AmikoInventoryCard = ({ amiko }) => {
    const { stats, rarity, level, element, name, image } = amiko;

    // Stat bars calculation (assuming max value for stats is around 120 for normalization)
    const getStatPercent = (val) => Math.min(100, (val / 120) * 100);

    return (
        <div className={`amiko-inventory-card rarity-${rarity.toLowerCase()}`}>
            <div className="amiko-card-header">
                <div className="amiko-badges">
                    <span className="level-badge">Lvl {level}</span>
                    <span className={`element-badge element-${element.toLowerCase()}`}>{element}</span>
                </div>
                <div className="rarity-indicator">{rarity}</div>
            </div>

            <div className="amiko-image-container">
                <img src={image || '/amikos/missing.png'} alt={name} className="amiko-img" />
                {amiko.skin && <div className="skin-tag">✨ {amiko.skin}</div>}
            </div>

            <div className="amiko-info">
                <h3 className="amiko-name">{name}</h3>

                <div className="amiko-stats-grid">
                    <StatBar label="HP" value={stats.hp} color="#ef4444" percent={getStatPercent(stats.hp)} />
                    <StatBar label="ATK" value={stats.atk} color="#f59e0b" percent={getStatPercent(stats.atk)} />
                    <StatBar label="SPD" value={stats.speed} color="#3b82f6" percent={getStatPercent(stats.speed)} />
                    <StatBar label="DEF" value={stats.def} color="#10b981" percent={getStatPercent(stats.def)} />
                </div>
            </div>
        </div>
    );
};

const StatBar = ({ label, value, color, percent }) => (
    <div className="stat-row">
        <div className="stat-label-row">
            <span className="stat-label">{label}</span>
            <span className="stat-value">{value}</span>
        </div>
        <div className="stat-bar-bg">
            <div
                className="stat-bar-fill"
                style={{ width: `${percent}%`, backgroundColor: color }}
            ></div>
        </div>
    </div>
);

export default AmikoInventoryCard;
