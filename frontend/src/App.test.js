import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import * as api from './services/api';
import { getMockGameState } from './__mocks__/mockGameState';

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
    default: vi.fn(() => mockSocket),
}));

// Mock the entire api service
vi.mock('./services/api');


describe('App Component and Game Flow', () => {

    let socketEventHandlers = {};
    const mockToken = `header.${btoa(JSON.stringify({ id: 42, username: 'Test Player' }))}.signature`;
    
    beforeEach(() => {
        // Reset mocks before each test
        vi.clearAllMocks();
        socketEventHandlers = {};

        // Redefine the .on implementation for each test to capture handlers
        mockSocket.on.mockImplementation((event, handler) => {
            socketEventHandlers[event] = handler;
        });

        api.getLobbyChatHistory.mockResolvedValue([]);
        api.updateTutorialStatus.mockResolvedValue({
            tutorial_version: 0,
            tutorial_active_version: 1,
        });
        Storage.prototype.getItem = vi.fn(() => mockToken);
    });

    test('renders Login component on initial load without a token', () => {
        Storage.prototype.getItem.mockReturnValueOnce(null);
        render(<App />);
        expect(screen.getByRole('button', { name: /Login/i })).toBeInTheDocument();
    });
    
    test('renders LobbyView component when a token is present', async () => {
        render(<App />);
        expect(await screen.findByText('Quick Play')).toBeInTheDocument();
    });

    test('hydrates before offering the tutorial and persists start before Academy matchmaking', async () => {
        const user = userEvent.setup();
        let resolveTutorialStart;
        api.updateTutorialStatus.mockImplementation(() => new Promise(resolve => {
            resolveTutorialStart = resolve;
        }));
        render(<App />);

        expect(screen.queryByRole('dialog', { name: 'Welcome to Sluff' })).not.toBeInTheDocument();
        await act(async () => {
            socketEventHandlers.updateUser({
                id: 42,
                username: 'Test Player',
                tokens: '8.00',
                games_played: 0,
                tutorial_version: 0,
                tutorial_active_version: 0,
            });
            socketEventHandlers.lobbyState({ themes: [], serverVersion: 'test' });
        });

        const startButton = await screen.findByRole('button', { name: 'Play Guided Game' }, { timeout: 1500 });
        await user.click(startButton);
        expect(api.updateTutorialStatus).toHaveBeenCalledWith('start');
        expect(mockSocket.emit).not.toHaveBeenCalledWith('quickPlay', { theme: 'miss-pauls-academy' });

        resolveTutorialStart({ tutorial_version: 0, tutorial_active_version: 1 });
        await waitFor(() => {
            expect(mockSocket.emit).toHaveBeenCalledWith('quickPlay', { theme: 'miss-pauls-academy' });
        });
    });

    test('cancels the welcome delay when a reconnect restores a table', async () => {
        render(<App />);
        await act(async () => {
            socketEventHandlers.updateUser({
                id: 42,
                username: 'Test Player',
                tokens: '8.00',
                games_played: 0,
                tutorial_version: 0,
                tutorial_active_version: 1,
            });
            socketEventHandlers.lobbyState({ themes: [], serverVersion: 'test' });
            socketEventHandlers.joinedTable({ gameState: getMockGameState() });
        });

        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 500));
        });
        expect(screen.queryByRole('dialog', { name: /learning Sluff/i })).not.toBeInTheDocument();
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

        expect(screen.getByRole('heading', { name: 'All passed · Widow reveal' })).toBeInTheDocument();
        expect(screen.getAllByText('A')).toHaveLength(2);
        expect(screen.getAllByText('K')).toHaveLength(2);
        expect(screen.getAllByText('Q')).toHaveLength(2);
        expect(screen.getAllByText('♠')).toHaveLength(6);
    });
});
