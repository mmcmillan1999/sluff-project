// Mock implementation of useSounds hook for testing
export const useSounds = () => {
    const playSound = jest.fn();
    const enableSound = jest.fn();

    return { playSound, enableSound };
};