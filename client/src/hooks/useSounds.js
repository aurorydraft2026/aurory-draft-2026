import { useCallback, useRef, useEffect } from 'react';

/**
 * Custom hook for managing game sounds in the draft system
 * 
 * Sound files should be placed in: public/sounds/
 * Expected files:
 * - pick.mp3     - plays when picking an Amiko
 * - remove.mp3   - plays when removing an Amiko pick
 * - lock.mp3     - plays when confirming/locking picks
 * - tick.mp3     - plays during last 10 seconds countdown
 * - bgm.mp3      - background music during draft (optional, can use existing music)
 */

const SOUND_PATHS = {
    pick: '/sounds/pick.mp3',
    remove: '/sounds/remove.mp3',
    lock: '/sounds/lock.mp3',
    tick: '/sounds/tick.mp3',
    bgm: '/music/MUS_Swamp.wav' // Using existing music file
};

export function useSounds() {
    const audioRefs = useRef({});
    const bgmRef = useRef(null);
    const lastTickSecond = useRef(-1);

    // Initialize audio elements
    useEffect(() => {
        // Create audio elements for sound effects
        Object.entries(SOUND_PATHS).forEach(([key, path]) => {
            if (key !== 'bgm') {
                const audio = new Audio(path);
                audio.preload = 'auto';
                audio.volume = 0.5;
                audioRefs.current[key] = audio;
            }
        });

        // Create background music element
        bgmRef.current = new Audio(SOUND_PATHS.bgm);
        bgmRef.current.loop = true;
        bgmRef.current.volume = 0.3;
        bgmRef.current.preload = 'auto';

        // Capture refs for cleanup
        const currentAudioRefs = audioRefs.current;
        const currentBgm = bgmRef.current;

        return () => {
            // Cleanup
            Object.values(currentAudioRefs).forEach(audio => {
                audio.pause();
                audio.src = '';
            });
            if (currentBgm) {
                currentBgm.pause();
                currentBgm.src = '';
            }
        };
    }, []);

    // Play a sound effect
    const playSound = useCallback((soundKey) => {
        const audio = audioRefs.current[soundKey];
        if (audio) {
            // Reset to start if already playing
            audio.currentTime = 0;
            audio.play().catch(err => {
                // Log error but don't crash - audio might be blocked by browser
                console.log(`[Sound] ${soundKey} - would play (file may be missing or blocked):`, err.message);
            });
        } else {
            console.log(`[Sound] ${soundKey} - placeholder (add ${SOUND_PATHS[soundKey]})`);
        }
    }, []);

    // Play pick sound
    const playPickSound = useCallback(() => {
        console.log('[Sound] 🎵 Pick sound');
        playSound('pick');
    }, [playSound]);

    // Play remove sound
    const playRemoveSound = useCallback(() => {
        console.log('[Sound] 🎵 Remove sound');
        playSound('remove');
    }, [playSound]);

    // Play lock/confirm sound
    const playLockSound = useCallback(() => {
        console.log('[Sound] 🎵 Lock/Confirm sound');
        playSound('lock');
    }, [playSound]);

    // Play tick sound (for countdown)
    const playTickSound = useCallback(() => {
        console.log('[Sound] 🎵 Tick sound');
        playSound('tick');
    }, [playSound]);

    // Check time and play tick if within last 10 seconds
    // Call this with the remaining milliseconds
    const checkTimerTick = useCallback((remainingMs) => {
        const seconds = Math.ceil(remainingMs / 1000);

        // Only tick for last 10 seconds, and only once per second
        if (seconds <= 10 && seconds > 0 && seconds !== lastTickSecond.current) {
            lastTickSecond.current = seconds;
            playTickSound();
        }

        // Reset when timer goes above 10 seconds
        if (seconds > 10) {
            lastTickSecond.current = -1;
        }
    }, [playTickSound]);

    // Start background music
    const startBgm = useCallback(() => {
        if (bgmRef.current) {
            // Start at 5 seconds into the track
            bgmRef.current.currentTime = 5;
            bgmRef.current.play().catch(err => {
                console.log('[Sound] BGM autoplay blocked (user interaction needed):', err.message);
            });
        }
    }, []);

    // Stop background music
    const stopBgm = useCallback(() => {
        if (bgmRef.current) {
            bgmRef.current.pause();
            bgmRef.current.currentTime = 0;
        }
    }, []);

    // Toggle background music
    const toggleBgm = useCallback(() => {
        if (bgmRef.current) {
            if (bgmRef.current.paused) {
                bgmRef.current.play().catch(console.error);
                return true;
            } else {
                bgmRef.current.pause();
                return false;
            }
        }
        return false;
    }, []);

    // Check if BGM is playing
    const isBgmPlaying = useCallback(() => {
        return bgmRef.current && !bgmRef.current.paused;
    }, []);

    return {
        playPickSound,
        playRemoveSound,
        playLockSound,
        playTickSound,
        checkTimerTick,
        startBgm,
        stopBgm,
        toggleBgm,
        isBgmPlaying
    };
}

export default useSounds;
