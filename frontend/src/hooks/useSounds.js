import { useState, useEffect, useRef } from 'react';

// Mock Audio for testing environment
const createAudio = (src) => {
    if (typeof Audio === 'undefined' || process.env.NODE_ENV === 'test') {
        return {
            load: () => {},
            play: () => Promise.resolve(),
            pause: () => {},
            currentTime: 0,
            volume: 0.7,
            addEventListener: () => {},
            removeEventListener: () => {},
        };
    }
    return new Audio(src);
};

export const useSounds = () => {
    const sounds = useRef({});
    const [isSoundEnabled, setIsSoundEnabled] = useState(false);

    useEffect(() => {
        sounds.current = {
            turnAlert: createAudio('/Sounds/turn_alert.mp3'),
            cardPlay: createAudio('/Sounds/card_play.mp3'),
            trickWin: createAudio('/Sounds/trick_win.mp3'),
            cardDeal: createAudio('/Sounds/card_dealing_10s_v3.mp3'),
            no_peaking_cheater: createAudio('/Sounds/no_peaking_cheater.mp3'), // ADDED THIS LINE
        };
        Object.values(sounds.current).forEach(sound => {
            sound.load();
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