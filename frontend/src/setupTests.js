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

// jsdom does not implement media queries, but responsive hooks use the normal
// browser API during their initial render.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});
