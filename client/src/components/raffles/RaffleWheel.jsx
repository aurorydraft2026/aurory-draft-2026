import React, { useState, useEffect, useRef, useCallback } from 'react';
import './RaffleWheel.css';

// Vibrant color palette inspired by the reference design
const SLICE_COLORS = [
  '#E63946', // Red
  '#457B9D', // Steel Blue
  '#F4A261', // Sandy Orange
  '#2A9D8F', // Teal
  '#264653', // Dark Teal
  '#E9C46A', // Gold
  '#F77F00', // Tangerine
  '#D62828', // Crimson
  '#023E8A', // Deep Blue
  '#48CAE4', // Sky Blue
  '#06D6A0', // Mint
  '#9B5DE5', // Purple
  '#F15BB5', // Pink
  '#00BBF9', // Bright Blue
  '#FEE440', // Yellow
  '#8AC926', // Lime
];

const RaffleWheel = ({ 
  participants = [], 
  onSpinEnd, 
  itemImage, 
  itemLink,
  auryAmount,
  isSpinning: externalIsSpinning,
  isStarting,
  minParticipants = 10,
  winnerId,
  status
}) => {
  const [rotation, setRotation] = useState(0);
  const [internalIsSpinning, setInternalIsSpinning] = useState(false);
  const wheelRef = useRef(null);
  const preSpinRef = useRef(null);
  const isPreSpinning = useRef(false);
  const isInternalSpinningRef = useRef(false);

  const isSpinning = externalIsSpinning || internalIsSpinning;

  const numSlices = participants.length || 1;
  const sliceAngle = 360 / numSlices;

  // Start the actual winner spin when status changes to spinning
  useEffect(() => {
    if (status === 'spinning' && winnerId && !internalIsSpinning) {
      // Stop pre-spin first
      isPreSpinning.current = false;
      if (preSpinRef.current) {
        cancelAnimationFrame(preSpinRef.current);
        preSpinRef.current = null;
      }
      startSpinAnimation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, winnerId]);

  // Pre-spin: always idle-rotate while raffle is open (not spinning/completed)
  useEffect(() => {
    const shouldPreSpin = status !== 'spinning' && status !== 'completed' && !internalIsSpinning;
    
    if (shouldPreSpin) {
      isPreSpinning.current = true;
      if (wheelRef.current) {
        wheelRef.current.style.transition = 'none';
      }
      let lastTime = performance.now();

      const animatePreSpin = (now) => {
        if (!isPreSpinning.current) return;
        const delta = now - lastTime;
        lastTime = now;
        setRotation(prev => prev + (delta * 0.015)); // Even slower idle ~5 deg/sec
        preSpinRef.current = requestAnimationFrame(animatePreSpin);
      };
      preSpinRef.current = requestAnimationFrame(animatePreSpin);
    } else {
      isPreSpinning.current = false;
      if (preSpinRef.current) {
        cancelAnimationFrame(preSpinRef.current);
        preSpinRef.current = null;
      }
    }

    return () => {
      if (preSpinRef.current) {
        cancelAnimationFrame(preSpinRef.current);
        preSpinRef.current = null;
      }
    };
  }, [internalIsSpinning, status]);

  const startSpinAnimation = useCallback(() => {
    setInternalIsSpinning(true);
    isInternalSpinningRef.current = true;

    const winnerIndex = participants.findIndex(p => p.uid === winnerId);
    if (winnerIndex === -1) {
      setInternalIsSpinning(false);
      return;
    }

    // Phase 1: Fast linear spin (The "Sustained Thrill")
    const fastDuration = 6000; // 6 seconds of max speed
    const fastestSpeed = 3.5; // rotations per second (high energy)
    
    // Calculate how much we'll rotate in Phase 1
    const fastRotationDelta = (fastDuration / 1000) * fastestSpeed * 360;
    const fastRotationTarget = rotation + fastRotationDelta;
    
    if (wheelRef.current) {
      wheelRef.current.style.transition = `transform ${fastDuration / 1000}s linear`;
    }
    setRotation(fastRotationTarget);

    // Phase 2: Deceleration to winner
    setTimeout(() => {
      // Ensure we're still spinning (hasn't been stopped)
      if (!isInternalSpinningRef.current) return;

      const slowDuration = 11000 + Math.random() * 2000; // ~12 seconds deceleration
      const extraCircles = 12 + Math.floor(Math.random() * 6); // More circles for longer duration
      const winnerAngle = winnerIndex * sliceAngle;

      // Random jitter: scatter within the middle 70% of the slice
      const randomOffset = (Math.random() * 0.7 - 0.35) * sliceAngle;
      const desiredFinalAngle = ((270 - winnerAngle + randomOffset) % 360 + 360) % 360;

      // Calculate where we are now (at the end of Phase 1)
      const currentAngle = ((fastRotationTarget % 360) + 360) % 360;
      let slowDelta = desiredFinalAngle - currentAngle;
      if (slowDelta <= 0) slowDelta += 360; // Always rotate forward

      const finalRotation = fastRotationTarget + slowDelta + (extraCircles * 360);

      if (wheelRef.current) {
        wheelRef.current.style.transition = `transform ${slowDuration / 1000}s cubic-bezier(0.1, 0.45, 0.1, 1.0)`;
      }
      setRotation(finalRotation);

      // Final completion
      setTimeout(() => {
        setInternalIsSpinning(false);
        isInternalSpinningRef.current = false;
        if (onSpinEnd) onSpinEnd();
      }, slowDuration + 500);

    }, fastDuration);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participants, winnerId, sliceAngle, rotation, onSpinEnd]);

  const handleCenterClick = () => {
    if (itemLink) {
      window.open(itemLink, '_blank', 'noopener,noreferrer');
    }
  };

  const getColor = (index) => SLICE_COLORS[index % SLICE_COLORS.length];

  const renderSlices = () => {
    const sliceCount = participants.length === 0 ? minParticipants : participants.length;
    const angle = 360 / sliceCount;

    return Array.from({ length: sliceCount }).map((_, i) => {
      const startAngle = i * angle - angle / 2;
      const endAngle = (i + 1) * angle - angle / 2;
      const largeArcFlag = angle > 180 ? 1 : 0;

      const x1 = 250 + 245 * Math.cos((startAngle * Math.PI) / 180);
      const y1 = 250 + 245 * Math.sin((startAngle * Math.PI) / 180);
      const x2 = 250 + 245 * Math.cos((endAngle * Math.PI) / 180);
      const y2 = 250 + 245 * Math.sin((endAngle * Math.PI) / 180);

      const pathData = `M 250 250 L ${x1} ${y1} A 245 245 0 ${largeArcFlag} 1 ${x2} ${y2} Z`;

      const isEmpty = participants.length === 0;
      const color = isEmpty ? (i % 2 === 0 ? '#1e293b' : '#162032') : getColor(i);

      // Text position at ~65% radius
      const midAngle = (startAngle + endAngle) / 2;
      const textX = 250 + 170 * Math.cos((midAngle * Math.PI) / 180);
      const textY = 250 + 170 * Math.sin((midAngle * Math.PI) / 180);

      return (
        <g key={i}>
          <path 
            d={pathData} 
            fill={color} 
            stroke={isEmpty ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.3)"}
            strokeWidth={isEmpty ? "1" : "1.5"}
          />
          {!isEmpty && participants[i] && (
            <text
              x={textX}
              y={textY}
              className="wheel-slice-text"
              textAnchor="middle"
              alignmentBaseline="middle"
              transform={`rotate(${midAngle}, ${textX}, ${textY})`}
            >
              {participants[i].playerName?.substring(0, 12)}
            </text>
          )}
        </g>
      );
    });
  };

  return (
    <div className="raffle-wheel-container">
      <div className="raffle-wheel-outer">
        {/* Outer ring decoration */}
        <div className="wheel-outer-ring" />

        {/* The spinning part */}
        <div 
          className="raffle-wheel-canvas" 
          ref={wheelRef}
          style={{ transform: `rotate(${rotation}deg)` }}
        >
          <svg viewBox="0 0 500 500" className="raffle-wheel-svg">
            {/* Outer circle border */}
            <circle cx="250" cy="250" r="248" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="4" />
            {renderSlices()}
            {/* Inner circle shadow */}
            <circle cx="250" cy="250" r="60" fill="rgba(0,0,0,0.2)" />
          </svg>
        </div>

        {/* Center Button */}
        <div 
          className={`wheel-center-button ${isSpinning ? 'disabled' : ''} ${itemLink ? 'has-link' : ''} ${auryAmount ? 'aury-center' : ''}`}
          onClick={handleCenterClick}
          title={itemLink ? 'View Item Details' : ''}
        >
          {auryAmount ? (
            <div className="wheel-aury-display">
              <span className="wheel-aury-num">{auryAmount}</span>
              <span className="wheel-aury-label">AURY</span>
            </div>
          ) : itemImage ? (
            <img src={itemImage} alt="item" className="wheel-item-icon" style={{width: '50px', height: '50px', objectFit: 'contain'}} />
          ) : (
            <div className="wheel-item-icon">🎁</div>
          )}
        </div>

        {/* Arrow Pointer - Top */}
        <div className="wheel-arrow-container">
          <div className="wheel-arrow" />
        </div>

        {/* Please Wait Overlay */}
        {isStarting && !internalIsSpinning && (
          <div className="wheel-loading-overlay">
            <div className="wheel-loading-spinner" />
            <span className="wheel-loading-text">Please wait...</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default RaffleWheel;
