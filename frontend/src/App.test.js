// frontend/src/App.test.js

import { render, screen } from '@testing-library/react';
import App from './App';

// --- THIS IS THE CORRECTED MOCK ---
jest.mock('socket.io-client', () => {
    const mockSocket = {
        on: jest.fn(),
        off: jest.fn(),
        connect: jest.fn(),
        disconnect: jest.fn(),
        emit: jest.fn(),
    };
    return {
        // The library exports a function named 'io'
        io: jest.fn(() => mockSocket),
    };
});
// --- END CORRECTION ---

test('renders Login component on initial load', () => {
  render(<App />);
  // Check for text that is unique to the Login component
  const loginButton = screen.getByRole('button', { name: /Login/i });
  expect(loginButton).toBeInTheDocument();
});