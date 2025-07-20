// frontend/src/setupTests.js

import '@testing-library/jest-dom';

// Mock the global Audio object for Jest (JSDOM) environment
// This prevents errors from the useSounds hook during tests.
global.Audio = jest.fn().mockImplementation(() => ({
  load: jest.fn(),
  play: jest.fn(() => Promise.resolve()),
  pause: jest.fn(),
  volume: 0,
  currentTime: 0,
}));