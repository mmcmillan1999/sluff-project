import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import LobbyChat from './LobbyChat';

vi.mock('../services/api', () => ({
    blockUser: vi.fn(() => Promise.resolve({})),
    unblockUser: vi.fn(() => Promise.resolve({})),
    getBlockedUsers: vi.fn(() => Promise.resolve([])),
}));

describe('LobbyChat accessibility', () => {
    test('the message field and the send control have names', () => {
        const socket = { emit: vi.fn(), on: vi.fn(), off: vi.fn() };
        render(<LobbyChat socket={socket} messages={[]} currentUserId={1} />);
        expect(screen.getByRole('textbox', { name: 'Message' })).toBeTruthy();
        const send = screen.getByRole('button', { name: 'Send message' });
        expect(send.getAttribute('type')).toBe('button');
        expect(send.querySelector('svg').getAttribute('aria-hidden')).toBe('true');
    });
});
