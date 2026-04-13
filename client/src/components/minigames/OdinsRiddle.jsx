import React, { useState, useEffect, useCallback, useRef } from 'react';
import { fetchRandomRiddle, submitRiddleAnswer } from '../../services/miniGameService';
import './OdinsRiddle.css';

const CATEGORY_META = {
  norse: { icon: '⚔️', label: 'Norse Mythology' },
  crypto: { icon: '🔗', label: 'Crypto & Blockchain' },
  aurory: { icon: '✨', label: 'Aurory' },
  gaming: { icon: '🎮', label: 'Gaming' },
  asgard: { icon: '🏰', label: 'Asgard Duels' },
};

const DIFFICULTY_REWARDS = { easy: 10, medium: 25, hard: 50 };
const OPTION_LETTERS = ['A', 'B', 'C', 'D'];
const TIME_LIMIT = 15;
const COOLDOWN_SECONDS = 30;
const CIRCUMFERENCE = 2 * Math.PI * 26;

const OdinsRiddle = ({ user }) => {
  const [riddle, setRiddle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [result, setResult] = useState(null); // { correct, reward, streak, correctIndex }
  const [timeLeft, setTimeLeft] = useState(TIME_LIMIT);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [stats, setStats] = useState({ streak: 0, totalCorrect: 0, totalPlayed: 0 });
  const timerRef = useRef(null);
  const cooldownRef = useRef(null);

  // ── Load a random riddle ──
  const loadRiddle = useCallback(async () => {
    setLoading(true);
    setResult(null);
    setSelectedAnswer(null);
    setTimeLeft(TIME_LIMIT);
    setError('');

    try {
      const data = await fetchRandomRiddle();
      if (data) {
        setRiddle(data);
      } else {
        setError('No riddles available. Ask your admin to add some!');
      }
    } catch (err) {
      setError('Failed to load riddle.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadRiddle();
    return () => {
      clearInterval(timerRef.current);
      clearInterval(cooldownRef.current);
    };
  }, [loadRiddle]);

  // ── Timer countdown ──
  useEffect(() => {
    if (!riddle || result || loading) return;

    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          // Time's up — auto-submit with wrong answer
          handleSubmit(-1);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timerRef.current);
  }, [riddle, result, loading]); // eslint-disable-line

  // ── Cooldown timer ──
  useEffect(() => {
    if (cooldown <= 0) return;
    clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setCooldown(prev => {
        if (prev <= 1) {
          clearInterval(cooldownRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(cooldownRef.current);
  }, [cooldown]);

  // ── Submit answer ──
  const handleSubmit = async (answerIndex) => {
    if (isSubmitting || result) return;
    clearInterval(timerRef.current);
    setIsSubmitting(true);
    setSelectedAnswer(answerIndex);

    try {
      const res = await submitRiddleAnswer(riddle.id, Math.max(0, answerIndex));
      setResult({
        correct: res.correct,
        correctIndex: res.correctIndex,
        reward: res.reward || 0,
        streak: res.streak || 0,
      });
      setStats({
        streak: res.streak || 0,
        totalCorrect: res.totalCorrect || 0,
        totalPlayed: res.totalPlayed || 0,
      });
    } catch (err) {
      // If it was a timeout answer (index -1), show as wrong
      if (answerIndex < 0) {
        setResult({ correct: false, correctIndex: -1, reward: 0, streak: 0 });
      } else {
        setError(err.message || 'Failed to submit answer.');
      }
    }
    setIsSubmitting(false);
  };

  // ── Next riddle ──
  const handleNext = () => {
    setCooldown(COOLDOWN_SECONDS);
    loadRiddle();
  };

  // Render helpers
  const getDifficultyStars = (difficulty) => {
    const count = difficulty === 'hard' ? 3 : difficulty === 'medium' ? 2 : 1;
    return (
      <>
        {[1, 2, 3].map(i => (
          <span key={i} className={`star ${i <= count ? '' : 'empty'}`}>★</span>
        ))}
      </>
    );
  };

  const timerProgress = (timeLeft / TIME_LIMIT) * CIRCUMFERENCE;

  // ── Cooldown screen ──
  if (cooldown > 0 && !riddle) {
    return (
      <div className="riddle-container">
        <div className="riddle-cooldown-overlay">
          <div className="riddle-cooldown-timer">{cooldown}s</div>
          <div className="riddle-cooldown-label">Odin is preparing the next riddle...</div>
        </div>
        <StatsBar stats={stats} />
      </div>
    );
  }

  // ── Loading ──
  if (loading) {
    return (
      <div className="riddle-container">
        <div className="riddle-loading">
          <div className="minigames-spinner" />
          <p>Summoning a riddle from the runes...</p>
        </div>
      </div>
    );
  }

  // ── Error / Empty ──
  if (error || !riddle) {
    return (
      <div className="riddle-container">
        <div className="riddle-empty">
          <span className="riddle-empty-icon">🔮</span>
          <p>{error || 'The runes are silent today. No riddles found.'}</p>
        </div>
      </div>
    );
  }

  const category = CATEGORY_META[riddle.category] || CATEGORY_META.norse;
  const reward = DIFFICULTY_REWARDS[riddle.difficulty] || 10;

  return (
    <div className="riddle-container" style={{ position: 'relative' }}>
      {/* Header: Category + Difficulty + Timer */}
      <div className="riddle-header-row">
        <span className={`riddle-category-badge ${riddle.category}`}>
          {category.icon} {category.label}
        </span>

        <div className="riddle-difficulty">
          {getDifficultyStars(riddle.difficulty)}
          <span className="riddle-reward-tag">+{reward} VC</span>
        </div>

        <div className="riddle-timer-ring">
          <svg viewBox="0 0 60 60">
            <circle className="timer-bg" cx="30" cy="30" r="26" />
            <circle
              className={`timer-progress ${timeLeft <= 5 ? 'danger' : ''}`}
              cx="30" cy="30" r="26"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={CIRCUMFERENCE - timerProgress}
            />
          </svg>
          <span className={`riddle-timer-text ${timeLeft <= 5 ? 'danger' : ''}`}>
            {timeLeft}
          </span>
        </div>
      </div>

      {/* Question */}
      <div className="riddle-question-card">
        <p className="riddle-question-text">{riddle.question}</p>
      </div>

      {/* Options */}
      <div className="riddle-options">
        {riddle.options.map((option, idx) => {
          let stateClass = '';
          if (result) {
            if (idx === result.correctIndex) stateClass = 'correct';
            else if (idx === selectedAnswer && !result.correct) stateClass = 'wrong';
            else stateClass = 'revealed';
          }

          return (
            <button
              key={idx}
              className={`riddle-option-btn ${stateClass}`}
              onClick={() => handleSubmit(idx)}
              disabled={!!result || isSubmitting}
            >
              <span className="riddle-option-letter">{OPTION_LETTERS[idx]}</span>
              {option}
            </button>
          );
        })}
      </div>

      {/* Stats Bar */}
      <StatsBar stats={stats} />

      {/* Result Overlay */}
      {result && (
        <div className="riddle-result-overlay">
          <div className="riddle-result-card">
            <div className="riddle-result-icon">
              {result.correct ? '🏆' : timeLeft <= 0 ? '⏰' : '💀'}
            </div>
            <h3 className={`riddle-result-title ${result.correct ? 'correct' : 'wrong'}`}>
              {result.correct ? 'Correct!' : timeLeft <= 0 ? "Time's Up!" : 'Wrong!'}
            </h3>
            {result.correct && (
              <p className="riddle-result-reward">+{result.reward} Valcoins</p>
            )}
            <p className="riddle-result-streak">
              {result.correct
                ? `🔥 ${result.streak} streak`
                : 'Streak reset. Try again!'}
            </p>
            <button className="riddle-next-btn" onClick={handleNext}>
              Next Riddle
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Stats Bar Sub-component ──
const StatsBar = ({ stats }) => {
  const accuracy = stats.totalPlayed > 0
    ? Math.round((stats.totalCorrect / stats.totalPlayed) * 100)
    : 0;

  return (
    <div className="riddle-stats-bar">
      <div className="riddle-stat">
        🔥 Streak: <span className="riddle-stat-value streak">{stats.streak}</span>
      </div>
      <div className="riddle-stat">
        ✅ Correct: <span className="riddle-stat-value">{stats.totalCorrect}/{stats.totalPlayed}</span>
      </div>
      <div className="riddle-stat">
        🎯 Accuracy: <span className="riddle-stat-value accuracy">{accuracy}%</span>
      </div>
    </div>
  );
};

export default OdinsRiddle;
