import { render, screen, act } from '@testing-library/react';
import App from './App';
import * as api from './services/api';
import { getMockGameState } from './__mocks__/mockGameState';
import { io } from 'socket.io-client';

// Mock socket.io-client with a hoisted factory so App.js's module-level
// io(...) call receives the mock socket (a plain auto-mock plus
// mockReturnValue runs after App.js has already evaluated).
const { mockSocket } = vi.hoisted(() => ({
    mockSocket: {
        on: vi.fn(),
        off: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
        emit: vi.fn(),
        auth: {},
        connected: false,
    },
}));
vi.mock('socket.io-client', () => ({
    io: vi.fn(() => mockSocket),
}));

// Mock the entire api service
vi.mock('./services/api');


describe('App Component and Game Flow', () => {

    let socketEventHandlers = {};
    
    beforeEach(() => {
        // Reset mocks before each test
        vi.clearAllMocks();
        socketEventHandlers = {};

        // Redefine the .on implementation for each test to capture handlers
        mockSocket.on.mockImplementation((event, handler) => {
            socketEventHandlers[event] = handler;
        });

        api.getLobbyChatHistory.mockResolvedValue([]);
        Storage.prototype.getItem = vi.fn(() => 'mock.token.payload');
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