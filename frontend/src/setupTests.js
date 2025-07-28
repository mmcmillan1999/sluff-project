// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// Mock Audio object globally
global.Audio = jest.fn().mockImplementation((src) => {
  return {
    src,
    currentTime: 0,
    volume: 1,
    play: jest.fn().mockResolvedValue(undefined),
    load: jest.fn(),
    pause: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  };
});