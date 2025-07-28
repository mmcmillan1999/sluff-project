import { useState, useEffect, useRef } from 'react';

export const useSounds = () => {
    const sounds = useRef({});
    const [isSoundEnabled, setIsSoundEnabled] = useState(false);

    useEffect(() => {
        // Helper to safely create an audio object even in non-browser (e.g., Jest) environments.
        const createAudio = (src) => {
            if (typeof Audio !== 'undefined') {
                return new Audio(src);
            }
            // Fallback stub with no-op implementations for tests
            return {
                load: () => {},
                play: () => Promise.resolve(),
                currentTime: 0,
                volume: 1,
            };
        };

        sounds.current = {
            turnAlert: createAudio('/Sounds/turn_alert.mp3'),
            cardPlay: createAudio('/Sounds/card_play.mp3'),
            trickWin: createAudio('/Sounds/trick_win.mp3'),
            cardDeal: createAudio('/Sounds/card_dealing_10s_v3.mp3'),
            no_peaking_cheater: createAudio('/Sounds/no_peaking_cheater.mp3'), // ADDED THIS LINE
        };
        Object.values(sounds.current).forEach(sound => {
            if (typeof sound.load === 'function') {
                sound.load();
            }
            sound.volume = 0.7;
        });
    }, []);

    const playSound = (soundName) => {
        if (isSoundEnabled && sounds.current[soundName]) {
            sounds.current[soundName].currentTime = 0;
            sounds.current[soundName].play().catch(e => console.error(`Error playing ${soundName}:`, e));
        }
    };

    const enableSound = () => {
        if (!isSoundEnabled) {
            console.log("Audio context unlocked by user interaction. Sounds are now enabled.");
            setIsSoundEnabled(true);
        }
    };

    return { playSound, enableSound };
};