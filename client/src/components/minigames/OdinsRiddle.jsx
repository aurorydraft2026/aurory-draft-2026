import React, { useState, useEffect, useCallback, useRef } from 'react';
import { fetchRandomRiddle, submitRiddleAnswer, getMiniGameConfig, fetchDailyRiddleProgress } from '../../services/miniGameService';
import './OdinsRiddle.css';

const CATEGORY_META = {
  norse: { icon: '⚔️', label: 'Norse Mythology' },
  crypto: { icon: '🔗', label: 'Crypto & Blockchain' },
  aurory: { icon: '✨', label: 'Aurory' },
  gaming: { icon: '🎮', label: 'Gaming' },
  asgard: { icon: '🏰', label: 'Asgard Duels' },
};

const OPTION_LETTERS = ['A', 'B', 'C', 'D'];
const CIRCUMFERENCE = 2 * Math.PI * 26;

const DEFAULT_CONFIG = {
  timerLimit: 15,
  maxWrongPerDay: 3,
  baseRiddles: [
    { difficulty: 'easy', reward: 20 },
    { difficulty: 'easy', reward: 20 },
    { difficulty: 'medium', reward: 30 },
    { difficulty: 'medium', reward: 30 },
    { difficulty: 'hard', reward: 50 },
  ],
  streakRiddles: [
    { difficulty: 'easy', reward: 50 },
    { difficulty: 'easy', reward: 50 },
    { difficulty: 'easy', reward: 50 },
    { difficulty: 'medium', reward: 50 },
    { difficulty: 'hard', reward: 50 },
  ]
};

const OdinsRiddle = ({ user, onClose, onBack }) => {
  const [riddle, setRiddle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [result, setResult] = useState(null);
  const [timeLeft, setTimeLeft] = useState(15);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [dailyProgress, setDailyProgress] = useState({
    date: '',
    totalAnswered: 0,
    totalCorrect: 0,
    wrongAnswers: 0,
    streakUnlocked: false,
    phase: 'base'
  });
  const [stats, setStats] = useState({ streak: 0, totalCorrect: 0, totalPlayed: 0 });
  const [isStarted, setIsStarted] = useState(false);
  const timerRef = useRef(null);

  // Get the current riddle slot info based on daily progress
  const getCurrentSlot = useCallback(() => {
    const idx = dailyProgress.totalAnswered;
    const baseRiddles = config.baseRiddles || DEFAULT_CONFIG.baseRiddles;
    const streakRiddles = config.streakRiddles || DEFAULT_CONFIG.streakRiddles;

    if (idx < baseRiddles.length) {
      return { ...baseRiddles[idx], phase: 'base', number: idx + 1, totalInPhase: baseRiddles.length };
    }
    const streakIdx = idx - baseRiddles.length;
    if (streakIdx < streakRiddles.length) {
      return { ...streakRiddles[streakIdx], phase: 'streak', number: streakIdx + 1, totalInPhase: streakRiddles.length };
    }
    return null;
  }, [dailyProgress.totalAnswered, config]);

  // ── Load config and daily progress on mount ──
  useEffect(() => {
    const init = async () => {
      try {
        const gameConfig = await getMiniGameConfig();
        if (gameConfig?.odinsRiddle) {
          setConfig(gameConfig.odinsRiddle);
        }
        const progress = await fetchDailyRiddleProgress(user?.uid);
        if (progress) {
          setDailyProgress(progress);
        }
      } catch (err) {
        console.error('Failed to load config/progress:', err);
      }
    };
    init();
  }, [user?.uid]);

  // ── Load a riddle ──
  const loadRiddle = useCallback(async () => {
    if (!isStarted) return; // Wait for start button

    setLoading(true);
    setResult(null);
    setSelectedAnswer(null);
    setTimeLeft(config.timerLimit || 15);
    setError('');

    // Check if player is locked or completed
    if (dailyProgress.phase === 'locked' || dailyProgress.phase === 'completed') {
      setLoading(false);
      return;
    }

    const slot = getCurrentSlot();
    if (!slot) {
      setDailyProgress(prev => ({ ...prev, phase: 'completed' }));
      setLoading(false);
      return;
    }

    try {
      const data = await fetchRandomRiddle(user?.uid, slot.difficulty);
      if (data) {
        setRiddle(data);
        if (data.initialTimeLeft !== undefined) {
          setTimeLeft(data.initialTimeLeft);
        } else {
          setTimeLeft(config.timerLimit || 15);
        }
      } else {
        setError('No riddles available for this difficulty. Ask your admin to add some!');
      }
    } catch (err) {
      setError('Failed to load riddle.');
    }
    setLoading(false);
  }, [user?.uid, config, dailyProgress.phase, getCurrentSlot, isStarted]);

  useEffect(() => {
    loadRiddle();
    return () => clearInterval(timerRef.current);
  }, [loadRiddle]);

  // ── Timer countdown ──
  useEffect(() => {
    if (!riddle || result || loading || dailyProgress.phase === 'locked' || dailyProgress.phase === 'completed') {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          handleSubmit(-1);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timerRef.current);
  }, [riddle, result, loading]); // eslint-disable-line

  // ── Submit answer ──
  const handleSubmit = async (answerIndex) => {
    if (isSubmitting || result) return;
    clearInterval(timerRef.current);
    setIsSubmitting(true);
    setSelectedAnswer(answerIndex);

    // Explicitly handle timeout — still call server with answerIndex=-1
    if (answerIndex < 0) {
      try {
        const res = await submitRiddleAnswer(riddle.id, -1);
        setResult({
          correct: false,
          correctIndex: res.correctIndex ?? -1,
          reward: 0,
          streak: res.streak || 0,
          isTimeout: true
        });
        setStats({
          streak: res.streak || 0,
          totalCorrect: res.totalCorrect || 0,
          totalPlayed: res.totalPlayed || 0,
        });
        if (res.dailyProgress) {
          setDailyProgress(res.dailyProgress);
        }
      } catch (err) {
        // Fallback to local update if server call fails
        setResult({
          correct: false,
          correctIndex: -1,
          reward: 0,
          streak: 0,
          isTimeout: true
        });
        setDailyProgress(prev => {
          const newWrong = prev.wrongAnswers + 1;
          const maxWrong = config.maxWrongPerDay || 3;
          return {
            ...prev,
            totalAnswered: prev.totalAnswered + 1,
            wrongAnswers: newWrong,
            phase: newWrong >= maxWrong ? 'locked' : prev.phase
          };
        });
      }
      setIsSubmitting(false);
      return;
    }

    try {
      const res = await submitRiddleAnswer(riddle.id, Math.max(0, answerIndex));
      setResult({
        correct: res.correct,
        correctIndex: res.correctIndex,
        reward: res.reward || 0,
        streak: res.streak || 0,
        isTimeout: false
      });
      setStats({
        streak: res.streak || 0,
        totalCorrect: res.totalCorrect || 0,
        totalPlayed: res.totalPlayed || 0,
      });

      // Update daily progress from server response
      if (res.dailyProgress) {
        setDailyProgress(res.dailyProgress);
      }

      // Clear session after submission
      try {
        const { db } = await import('../../firebase');
        const { doc, updateDoc } = await import('firebase/firestore');
        await updateDoc(doc(db, 'users', user.uid, 'activeSessions', 'odinsRiddle'), {
          status: 'completed'
        });
      } catch (e) {
        console.error("Non-critical: Failed to clear riddle session:", e);
      }
    } catch (err) {
      setError(err.message || 'Failed to submit answer.');
    }
    setIsSubmitting(false);
  };

  // ── Next riddle ──
  const handleNext = () => {
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

  const timerProgress = (timeLeft / (config.timerLimit || 15)) * CIRCUMFERENCE;
  const currentSlot = getCurrentSlot();
  const baseCount = (config.baseRiddles || DEFAULT_CONFIG.baseRiddles).length;
  const streakCount = (config.streakRiddles || DEFAULT_CONFIG.streakRiddles).length;
  const maxWrong = config.maxWrongPerDay || 3;

  // ── Intro State ──
  if (!isStarted && dailyProgress.phase !== 'locked' && dailyProgress.phase !== 'completed') {
    return (
      <div className="riddle-container">
        <div className="riddle-intro-card">
          <div className="riddle-intro-icon">🗡️</div>
          <h2 className="riddle-intro-title">Odin's Riddle</h2>
          <p className="riddle-intro-text">
            Odin commands your presence. Answer his riddles and prove your wisdom to earn Valcoins.
          </p>
          <div className="riddle-intro-perks">
            <div className="perk"><span>🏆</span> Daily Prizes</div>
            <div className="perk"><span>🔥</span> Streak Bonuses</div>
            <div className="perk"><span>⚡</span> 15s Per Riddle</div>
          </div>
          <button className="riddle-start-btn" onClick={() => setIsStarted(true)}>
            Accept Riddle
          </button>
        </div>
      </div>
    );
  }

  // ── Locked state (too many wrong answers) ──
  if (dailyProgress.phase === 'locked') {
    return (
      <div className="riddle-container">
        <DailyProgressGauge progress={dailyProgress} baseCount={baseCount} totalRiddles={baseCount + streakCount} maxWrong={maxWrong} />
        <div className="riddle-locked-overlay">
          <div className="riddle-terminal-card locked">
            <div className="terminal-icon">🔒</div>
            <h2 className="terminal-title">Odin's Judgement</h2>
            <div className="terminal-body">
              <p>You have used all <strong>{maxWrong}</strong> wrong answers for today.</p>
              <div className="reset-hint">
                <span>⏳</span> The runes will reset at midnight UTC.
              </div>
            </div>
            <button className="riddle-terminal-btn" onClick={onClose}>
              Accept Fate
            </button>
          </div>
        </div>
        <StatsBar stats={stats} />
      </div>
    );
  }

  // ── Completed state (all riddles done) ──
  if (dailyProgress.phase === 'completed') {
    return (
      <div className="riddle-container">
        <DailyProgressGauge progress={dailyProgress} baseCount={baseCount} totalRiddles={baseCount + streakCount} maxWrong={maxWrong} />
        <div className="riddle-completed-overlay">
          <div className="riddle-terminal-card completed">
            <div className="terminal-icon">{dailyProgress.streakUnlocked ? '🏆' : '✅'}</div>
            <h2 className="terminal-title">
              {dailyProgress.streakUnlocked ? 'Grand Master!' : 'Daily Quest Done'}
            </h2>
            <div className="terminal-body">
              <div className="summary-stat">
                <span className="label">Total Correct</span>
                <span className="value">{dailyProgress.totalCorrect}/{dailyProgress.streakUnlocked ? (baseCount + streakCount) : baseCount}</span>
              </div>
              {!dailyProgress.streakUnlocked && dailyProgress.totalAnswered >= baseCount && (
                <p className="streak-hint">💡 Stay under {maxWrong} mistakes to unlock Streak Rewards!</p>
              )}
              <p className="comeback-text">Return tomorrow for your next audience with Odin.</p>
            </div>
            <button className="riddle-terminal-btn completed" onClick={onClose}>
              Return to Halls
            </button>
          </div>
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

  return (
    <div className="riddle-container" style={{ position: 'relative' }}>
      {/* Daily Progress Gauge */}
      <DailyProgressGauge progress={dailyProgress} baseCount={baseCount} totalRiddles={baseCount + streakCount} maxWrong={maxWrong} />

      {/* Phase Badge */}
      {dailyProgress.phase === 'streak' && (
        <div className="riddle-streak-banner">🔥 STREAK BONUS ACTIVE</div>
      )}

      {/* Header: Category + Difficulty + Timer */}
      <div className="riddle-header-row">
        <span className={`riddle-category-badge ${riddle.category}`}>
          {category.icon} {category.label}
        </span>

        <div className="riddle-difficulty">
          {getDifficultyStars(currentSlot?.difficulty || riddle.difficulty)}
          <span className="riddle-reward-tag">+{currentSlot?.reward || 0} Valcoins</span>
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
        {riddle.imageUrl && (
          <div className="riddle-image-container">
            <img src={riddle.imageUrl} alt="Riddle Hint" className="riddle-image" />
          </div>
        )}
        <p className="riddle-question-text">{riddle.question}</p>
      </div>

      {/* Options */}
      <div className="riddle-options">
        {riddle.options.map((option, idx) => {
          let stateClass = '';
          if (result) {
            // Compare against originalIndex for correct/wrong highlighting
            if (option.originalIndex === result.correctIndex) stateClass = 'correct';
            else if (option.originalIndex === selectedAnswer && !result.correct) stateClass = 'wrong';
            else stateClass = 'revealed';
          }

          return (
            <button
              key={idx}
              className={`riddle-option-btn ${stateClass}`}
              onClick={() => handleSubmit(option.originalIndex)}
              disabled={!!result || isSubmitting}
            >
              <span className="riddle-option-letter">{OPTION_LETTERS[idx]}</span>
              {option.text}
            </button>
          );
        })}
      </div>

      {/* Stats Bar */}
      <StatsBar stats={stats} />

      {/* Feedback Alert Overlay */}
      {result && (
        <div className="riddle-feedback-overlay">
          <div className={`riddle-feedback-card ${result.correct ? 'correct' : 'wrong'}`}>
            <div className="feedback-anim-icon">
              {result.correct ? '✨' : '❌'}
            </div>
            <h2 className="feedback-status">
              {result.isTimeout ? "TIME'S UP" : result.correct ? 'EXCELLENT!' : 'WRONG ANSWER'}
            </h2>
            
            <div className="feedback-details">
              {result.correct ? (
                <div className="reward-info">
                  <span className="reward-label">REWARD</span>
                  <div className="reward-value">+{result.reward} Valcoins</div>
                </div>
              ) : (
                <div className="penalty-info">
                  <div className="wrong-count">{dailyProgress.wrongAnswers}/{maxWrong} WRONG</div>
                  <p className="penalty-text">
                    {result.isTimeout ? "You ran out of time!" : `Careful! ${maxWrong} mistakes will lock you out for the day.`}
                  </p>
                </div>
              )}
            </div>

            <div className="feedback-stats">
              <div className="stat-item">
                <span className="stat-label">🔥 Streak</span>
                <span className="stat-val">{result.streak}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">🎯 Correct</span>
                <span className="stat-val">{stats.totalCorrect}</span>
              </div>
            </div>

            <button 
              className={`feedback-continue-btn ${result.correct ? 'correct' : 'wrong'}`}
              onClick={handleNext}
            >
              {dailyProgress.phase === 'locked' || dailyProgress.phase === 'completed' ? 'Finish' : 'Next Riddle'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Daily Progress Gauge Sub-component ──
const DailyProgressGauge = ({ progress, baseCount, totalRiddles, maxWrong }) => {
  const answered = progress.totalAnswered || 0;
  const wrong = progress.wrongAnswers || 0;
  
  // Calculate stroke dash array for a 100px radius circle (Circumference ≈ 314)
  const R = 45;
  const C = 2 * Math.PI * R;
  const percentage = (answered / totalRiddles) * 100;
  const offset = C - (percentage / 100) * C;

  return (
    <div className="riddle-gauge-container">
      <div className="riddle-gauge-inner">
        <svg viewBox="0 0 100 100" className="gauge-svg">
          {/* Base Track */}
          <circle cx="50" cy="50" r={R} className="gauge-track" />
          {/* Progress Segment */}
          <circle 
            cx="50" cy="50" r={R} 
            className="gauge-progress" 
            strokeDasharray={C}
            strokeDashoffset={offset}
            transform="rotate(-90 50 50)"
          />
        </svg>
        <div className="gauge-text">
          <span className="current">{answered}</span>
          <span className="divider">/</span>
          <span className="total">{totalRiddles}</span>
        </div>
      </div>
      <div className="gauge-labels">
        <div className="gauge-label correct">✅ {progress.totalCorrect} Correct</div>
        <div className="gauge-label wrong">❌ {wrong}/{maxWrong} Wrong</div>
      </div>
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
