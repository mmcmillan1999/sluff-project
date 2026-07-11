import { render, screen, act, waitFor, within } from '@testing-library/react';
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
        mockSocket.connected = false;
        window.history.replaceState({}, '', '/');

        // Redefine the .on implementation for each test to capture handlers
        mockSocket.on.mockImplementation((event, handler) => {
            socketEventHandlers[event] = handler;
        });

        api.getLobbyChatHistory.mockResolvedValue([]);
        api.getTokenLedger.mockResolvedValue({
            currentBalanceCents: 800,
            entries: [],
            nextCursor: null,
            hasMore: false,
        });
        api.updateTutorialStatus.mockResolvedValue({
            tutorial_version: 0,
            tutorial_active_version: 1,
        });
        Storage.prototype.getItem = vi.fn(() => mockToken);
        Storage.prototype.removeItem = vi.fn();
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

    test('opens the token ledger from the player menu and returns to the lobby', async () => {
        const user = userEvent.setup();
        render(<App />);

        await user.click(await screen.findByRole('button', { name: 'Open player menu' }));
        const playerMenu = screen.getByRole('group', { name: 'Player menu' });
        await user.click(within(playerMenu).getByRole('button', { name: 'Token Ledger' }));

        expect(await screen.findByRole('heading', { name: 'Token Ledger' })).toBeInTheDocument();
        expect(api.getTokenLedger).toHaveBeenCalledWith({ limit: 25, cursor: null, category: 'all' });

        await user.click(screen.getByRole('button', { name: 'Lobby' }));
        expect(await screen.findByText('Quick Play')).toBeInTheDocument();
        expect(mockSocket.emit).toHaveBeenCalledWith('requestUserSync');
    });

    test('opens the bulletin from the lobby ticker and returns to Quick Play', async () => {
        const user = userEvent.setup();
        render(<App />);

        await user.click(await screen.findByRole('button', {
            name: 'Open Sluff Bulletin: Alpha Season 1 honors and development news',
        }));

        expect(screen.getByRole('heading', { name: /first Sluff season/i })).toBeInTheDocument();
        expect(screen.getByText('McSaddle')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Lobby' }));
        expect(await screen.findByText('Quick Play')).toBeInTheDocument();
        expect(mockSocket.emit).toHaveBeenCalledWith('requestUserSync');
    });

    test('opens the bulletin from the player menu', async () => {
        const user = userEvent.setup();
        render(<App />);

        await user.click(await screen.findByRole('button', { name: 'Open player menu' }));
        const playerMenu = screen.getByRole('group', { name: 'Player menu' });
        await user.click(within(playerMenu).getByRole('button', { name: 'Sluff Bulletin' }));

        const pageHeading = screen.getByRole('heading', { name: /first Sluff season/i });
        expect(pageHeading).toHaveFocus();
        expect(screen.queryByRole('group', { name: 'Player menu' })).not.toBeInTheDocument();
    });

    test('hydrates before offering the tutorial and persists start before Academy matchmaking', async () => {
        const user = userEvent.setup();
        let resolveTutorialStart;
        api.updateTutorialStatus.mockImplementation(() => new Promise(resolve => {
            resolveTutorialStart = resolve;
        }));
        render(<App />);

        expect(screen.queryByRole('dialog', { name: 'Learn Sluff at the Academy' })).not.toBeInTheDocument();
        await act(async () => {
            socketEventHandlers.updateUser({
                id: 42,
                username: 'Test Player',
                tokens: '8.00',
                games_played: 86,
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

    test('defers an experienced player\'s offer while seated and restores it on return to the lobby', async () => {
        render(<App />);
        await act(async () => {
            socketEventHandlers.updateUser({
                id: 42,
                username: 'Test Player',
                tokens: '8.00',
                games_played: 86,
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

        await act(async () => {
            socketEventHandlers.forceLobbyReturn();
        });
        expect(await screen.findByRole(
            'dialog',
            { name: 'Continue learning Sluff' },
            { timeout: 1500 }
        )).toBeInTheDocument();
    });

    test('releases tutorial deferral when an invite join fails in the lobby', async () => {
        mockSocket.connected = true;
        window.history.replaceState({}, '', '/join/missing-table');
        render(<App />);

        await act(async () => {
            socketEventHandlers.updateUser({
                id: 42,
                username: 'Test Player',
                tokens: '8.00',
                games_played: 30,
                tutorial_version: 0,
                tutorial_active_version: 0,
            });
            socketEventHandlers.lobbyState({ themes: [], serverVersion: 'test' });
        });

        expect(mockSocket.emit).toHaveBeenCalledWith('joinTable', { tableId: 'missing-table' });
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 500));
        });
        expect(screen.queryByRole('dialog', { name: 'Learn Sluff at the Academy' })).not.toBeInTheDocument();

        await act(async () => {
            socketEventHandlers.error({ message: 'That table is no longer available.' });
        });
        expect(await screen.findByRole(
            'dialog',
            { name: 'Learn Sluff at the Academy' },
            { timeout: 1500 }
        )).toBeInTheDocument();
    });

    test('resets tutorial training from the pre-table player menu and clears seen lessons', async () => {
        const user = userEvent.setup();
        api.updateTutorialStatus.mockResolvedValueOnce({
            tutorial_version: 0,
            tutorial_active_version: 0,
        });
        render(<App />);

        await act(async () => {
            socketEventHandlers.updateUser({
                id: 42,
                username: 'Test Player',
                tokens: '8.00',
                games_played: 86,
                tutorial_version: 1,
                tutorial_active_version: 0,
            });
            socketEventHandlers.lobbyState({ themes: [], serverVersion: 'test' });
        });

        expect(screen.queryByRole('dialog', { name: /Academy/i })).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Open player menu' }));
        const playerMenu = screen.getByRole('group', { name: 'Player menu' });
        await user.click(within(playerMenu).getByRole('button', { name: 'Reset Tutorial Training' }));

        expect(api.updateTutorialStatus).toHaveBeenCalledWith('reset');
        expect(localStorage.removeItem).toHaveBeenCalledWith('sluff:tutorial:1:lessons:42');
        expect(await screen.findByRole(
            'dialog',
            { name: 'Learn Sluff at the Academy' },
            { timeout: 1500 }
        )).toBeInTheDocument();
    });

    test('keeps the tutorial reset available when persistence fails so it can be retried', async () => {
        const user = userEvent.setup();
        let rejectReset;
        api.updateTutorialStatus
            .mockImplementationOnce(() => new Promise((_resolve, reject) => {
                rejectReset = reject;
            }))
            .mockResolvedValueOnce({ tutorial_version: 0, tutorial_active_version: 0 });
        render(<App />);

        await act(async () => {
            socketEventHandlers.updateUser({
                id: 42,
                username: 'Test Player',
                tokens: '8.00',
                games_played: 12,
                tutorial_version: 1,
                tutorial_active_version: 0,
            });
            socketEventHandlers.lobbyState({ themes: [], serverVersion: 'test' });
        });

        await user.click(screen.getByRole('button', { name: 'Open player menu' }));
        const playerMenu = screen.getByRole('group', { name: 'Player menu' });
        const resetButton = within(playerMenu).getByRole('button', { name: 'Reset Tutorial Training' });
        await user.click(resetButton);

        expect(within(screen.getByRole('group', { name: 'Player menu' }))
            .getByRole('button', { name: 'Resetting Tutorial…' })).toBeDisabled();
        await act(async () => {
            rejectReset(new Error('Reset could not be saved.'));
        });

        expect(await screen.findByRole('alert')).toHaveTextContent('Reset could not be saved.');
        const retryButton = within(screen.getByRole('group', { name: 'Player menu' }))
            .getByRole('button', { name: 'Reset Tutorial Training' });
        expect(retryButton).toBeEnabled();
        expect(localStorage.removeItem).not.toHaveBeenCalled();

        await user.click(retryButton);
        await waitFor(() => expect(api.updateTutorialStatus).toHaveBeenCalledTimes(2));
        expect(localStorage.removeItem).toHaveBeenCalledWith('sluff:tutorial:1:lessons:42');
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
