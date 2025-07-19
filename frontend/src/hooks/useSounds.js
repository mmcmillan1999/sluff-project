import { useState, useEffect, useRef } from 'react';

export const useSounds = () => {
    const sounds = useRef({});
    const [isSoundEnabled, setIsSoundEnabled] = useState(false);

    useEffect(() => {
        sounds.current = {
            turnAlert: new Audio('/Sounds/turn_alert.mp3'),
            cardPlay: new Audio('/Sounds/card_play.mp3'),
            trickWin: new Audio('/Sounds/trick_win.mp3'),
            cardDeal: new Audio('/Sounds/card_dealing_10s_v3.mp3'),
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