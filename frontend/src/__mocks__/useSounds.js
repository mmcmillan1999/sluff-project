// Mock implementation of useSounds hook for testing
export const useSounds = () => {
    const playSound = vi.fn();
    const playDealSounds = vi.fn();
    const playWheelTick = vi.fn();
    const playWheelSettle = vi.fn();
    const playMidnightSpecial = vi.fn();
    const enableSound = vi.fn();

    const soundSettings = {
        muted: false,
        volume: 0.7,
        toggleMute: vi.fn(),
        setVolume: vi.fn(),
        musicMuted: false,
        musicVolume: 0.15,
        toggleMusicMute: vi.fn(),
        setMusicVolume: vi.fn(),
    };

    return { playSound, playDealSounds, playWheelTick, playWheelSettle, playMidnightSpecial, enableSound, soundSettings };
};
