// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// Mock Audio constructor for tests
global.Audio = jest.fn().mockImplementation(() => ({
  load: jest.fn(),
  play: jest.fn().mockResolvedValue(undefined),
  pause: jest.fn(),
  currentTime: 0,
  volume: 0.7,
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
}));