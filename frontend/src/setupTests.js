// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom/vitest';

// Mock Audio constructor for tests
global.Audio = vi.fn().mockImplementation(() => ({
  load: vi.fn(),
  play: vi.fn().mockResolvedValue(undefined),
  pause: vi.fn(),
  currentTime: 0,
  volume: 0.7,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}));