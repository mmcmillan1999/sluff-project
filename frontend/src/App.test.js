import { render, screen, act } from '@testing-library/react';
import App from './App';
import * as api from './services/api';
import { getMockGameState } from './__mocks__/mockGameState';
import { io } from 'socket.io-client';

// We will mock the entire library.
jest.mock('socket.io-client');

// Mock the entire api service
jest.mock('./services/api');

// Mock the useSounds hook
jest.mock('./hooks/useSounds');

// Configure the mock implementation for io
const mockSocket = {
    on: jest.fn(),
    off: jest.fn(),
    connect: jest.fn(),
    disconnect: jest.fn(),
    emit: jest.fn(),
    auth: {},
    connected: false,
};
io.mockReturnValue(mockSocket);


describe('App Component and Game Flow', () => {

    let socketEventHandlers = {};
    
    beforeEach(() => {
        // Reset mocks before each test
        jest.clearAllMocks();
        socketEventHandlers = {};

        // Redefine the .on implementation for each test to capture handlers
        mockSocket.on.mockImplementation((event, handler) => {
            socketEventHandlers[event] = handler;
        });

        api.getLobbyChatHistory.mockResolvedValue([]);
        Storage.prototype.getItem = jest.fn(() => 'mock.token.payload');
    });

    test('renders Login component on initial load without a token', () => {
        Storage.prototype.getItem.mockReturnValueOnce(null);
        render(<App />);
        expect(screen.getByRole('button', { name: /Login/i })).toBeInTheDocument();
    });
    
    test('renders LobbyView component when a token is present', () => {
        render(<App />);
        expect(screen.getByText('Lobby')).toBeInTheDocument();
    });

    test('renders widow reveal correctly when all players pass', async () => {
        render(<App />);
        
        const allPassState = getMockGameState({
            state: 'AllPassWidowReveal',
            roundSummary: {
                message: 'All players passed.',
                widowForReveal: ['AS', 'KS', 'QS'],
            }
        });
        
        // Use act to wrap state updates from the socket event
        await act(async () => {
            if (socketEventHandlers.joinedTable) {
                socketEventHandlers.joinedTable({ gameState: allPassState });
            }
        });

        expect(screen.getByText('All players passed. Revealing the widow...')).toBeInTheDocument();
        expect(screen.getByText('A')).toBeInTheDocument();
        expect(screen.getByText('K')).toBeInTheDocument();
        expect(screen.getByText('Q')).toBeInTheDocument();
        expect(screen.getAllByText('♠').length).toBe(3);
    });
});