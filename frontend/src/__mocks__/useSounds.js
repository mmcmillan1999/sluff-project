// Mock implementation of useSounds hook for testing
export const useSounds = () => {
    const playSound = vi.fn();
    const enableSound = vi.fn();

    return { playSound, enableSound };
};