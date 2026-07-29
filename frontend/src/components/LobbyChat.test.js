import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LobbyChat from './LobbyChat';
import {
    getBlockedPlayers,
    reportChatMessage,
    sendLobbyChatMessage,
    setPlayerBlocked,
} from '../services/api';

vi.mock('../services/api', () => ({
    getBlockedPlayers: vi.fn(),
    reportChatMessage: vi.fn(),
    sendLobbyChatMessage: vi.fn(),
    setPlayerBlocked: vi.fn(),
}));

const socket = { on: vi.fn(), off: vi.fn(), emit: vi.fn() };

const MESSAGES = [
    { id: 1, user_id: 7, username: 'Brandi', message: 'nice hand' },
    { id: 2, user_id: 13, username: 'Me', message: 'thanks' },
    { id: 3, user_id: 7, username: 'Brandi', message: 'rematch?' },
];

const renderChat = (props = {}) => render(
    <LobbyChat socket={socket} messages={MESSAGES} currentUserId={13} {...props} />,
);

describe('LobbyChat moderation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getBlockedPlayers.mockResolvedValue([]);
        reportChatMessage.mockResolvedValue({ reported: true });
        setPlayerBlocked.mockResolvedValue({ blocked: true });
        sendLobbyChatMessage.mockResolvedValue({});
    });

    test('another player\'s message exposes report and block', async () => {
        const user = userEvent.setup();
        renderChat();
        await waitFor(() => expect(getBlockedPlayers).toHaveBeenCalled());

        await user.click(screen.getByRole('button', { name: /message from brandi: nice hand/i }));

        expect(screen.getByRole('button', { name: 'Report' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Block' })).toBeInTheDocument();
    });

    test('your own message offers no report or block', async () => {
        const user = userEvent.setup();
        renderChat();
        await waitFor(() => expect(getBlockedPlayers).toHaveBeenCalled());

        await user.click(screen.getByRole('button', { name: /your message: thanks/i }));

        expect(screen.queryByRole('button', { name: 'Report' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Block' })).not.toBeInTheDocument();
    });

    test('reporting confirms without revealing what happens next', async () => {
        const user = userEvent.setup();
        renderChat();
        await waitFor(() => expect(getBlockedPlayers).toHaveBeenCalled());

        await user.click(screen.getByRole('button', { name: /message from brandi: nice hand/i }));
        await user.click(screen.getByRole('button', { name: 'Report' }));

        await waitFor(() => expect(reportChatMessage).toHaveBeenCalledWith(1, 'abuse'));
        expect(await screen.findByRole('status')).toHaveTextContent(/reported/i);
    });

    test('blocking hides every message from that player at once', async () => {
        const user = userEvent.setup();
        renderChat();
        await waitFor(() => expect(getBlockedPlayers).toHaveBeenCalled());
        expect(screen.getByText(/nice hand/)).toBeInTheDocument();
        expect(screen.getByText(/rematch\?/)).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /message from brandi: nice hand/i }));
        await user.click(screen.getByRole('button', { name: 'Block' }));

        await waitFor(() => expect(setPlayerBlocked).toHaveBeenCalledWith(7, true));
        // Both of Brandi's messages go, not just the one that was actioned.
        await waitFor(() => expect(screen.queryByText(/nice hand/)).not.toBeInTheDocument());
        expect(screen.queryByText(/rematch\?/)).not.toBeInTheDocument();
        expect(screen.getByText(/thanks/)).toBeInTheDocument();
    });

    test('an existing block filters live messages the server could not', async () => {
        getBlockedPlayers.mockResolvedValue([{ user_id: 7, username: 'Brandi' }]);
        renderChat();

        await waitFor(() => expect(screen.queryByText(/nice hand/)).not.toBeInTheDocument());
        expect(screen.getByText(/thanks/)).toBeInTheDocument();
    });

    test('a failed block-list load leaves chat usable', async () => {
        getBlockedPlayers.mockRejectedValue(new Error('offline'));
        renderChat();

        // Server-side filtering already applied to history; chat must not break.
        expect(await screen.findByText(/nice hand/)).toBeInTheDocument();
        expect(screen.getByText(/thanks/)).toBeInTheDocument();
    });

    test('a rejected message surfaces the server reason', async () => {
        const user = userEvent.setup();
        sendLobbyChatMessage.mockRejectedValue(new Error('Messages are limited to 300 characters.'));
        renderChat();

        await user.type(screen.getByPlaceholderText('Type a message...'), 'hello');
        await user.click(screen.getByRole('button', { name: '' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(/limited to 300 characters/i);
    });
});
