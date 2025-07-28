// Mock implementation of useSounds hook
export const useSounds = () => {
  return {
    isSoundEnabled: false,
    enableSound: jest.fn(),
    disableSound: jest.fn(),
    playSound: jest.fn(),
  };
};