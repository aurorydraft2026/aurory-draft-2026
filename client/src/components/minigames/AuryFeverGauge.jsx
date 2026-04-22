import React, { useState, useEffect, useRef } from 'react';
import './AuryFeverGauge.css';

const AuryFeverGauge = ({ count, maxCount = 500, minAury = 0, maxAury = 10, pendingFill = false }) => {
  const [displayedCount, setDisplayedCount] = useState(count);
  const [showParticles, setShowParticles] = useState(false);
  const prevCountRef = useRef(count);
  const gaugeRef = useRef(null);

  useEffect(() => {
    if (!pendingFill && count !== prevCountRef.current) {
      const increased = count > prevCountRef.current;
      prevCountRef.current = count;

      if (increased) {
        setShowParticles(true);
        setTimeout(() => {
          setDisplayedCount(count);
        }, 600);
        setTimeout(() => {
          setShowParticles(false);
        }, 1200);
      } else {
        setDisplayedCount(count);
      }
    } else if (!pendingFill && count === prevCountRef.current) {
      setDisplayedCount(count);
    }
  }, [count, pendingFill]);

  useEffect(() => {
    setDisplayedCount(count);
    prevCountRef.current = count;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const safeMaxCount = Math.max(1, maxCount || 500);
  const percentage = Math.min(100, (displayedCount / safeMaxCount) * 100);
  const currentAury = (minAury || 0) + (displayedCount / safeMaxCount) * ((maxAury || 0) - (minAury || 0));
  const feverClass = percentage >= 100 ? 'full-fever' : percentage >= 75 ? 'high-fever' : '';

  return (
    <div className={`aury-fever-container ${feverClass}`} ref={gaugeRef}>
      <div className="aury-fever-header">
        <span className="aury-fever-prize">{currentAury.toFixed(2)} AURY</span>
        <span className="aury-fever-label">AURY FEVER</span>
        
        {showParticles && (
          <div className="fever-particles-container">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="fever-particle" style={{ '--delay': `${i * 0.08}s`, '--rand': Math.random() }}></div>
            ))}
          </div>
        )}
      </div>

      <div className="aury-fever-tube-wrapper">
        <div className="aury-fever-tube">
          <div
            className="aury-fever-liquid"
            style={{
              height: `${percentage}%`,
              '--fever-pct': `${percentage}%`
            }}
          >
            <div className="liquid-surface" />
          </div>

          <div className="tube-highlight" />
          <div className="tube-markers">
            <span className="marker max">MAX</span>
            <span className="marker mid"></span>
            <span className="marker min">MIN</span>
          </div>
        </div>
      </div>

      <div className="aury-fever-footer">
        <span className="aury-fever-count">{displayedCount}/{maxCount}</span>
      </div>
    </div>
  );
};

export default React.memo(AuryFeverGauge);
