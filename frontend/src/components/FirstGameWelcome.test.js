import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FirstGameWelcome, {
    shouldShowFirstGameWelcome,
    TUTORIAL_VERSION,
} from './FirstGameWelcome';

const eligibleInput = {
    user: {
        games_played: 0,
        tutorial_version: 0,
        tutorial_active_version: 0,
    },
    isLobby: true,
    hasCurrentTable: false,
    hasPendingInvite: false,
    socketSessionReady: true,
};

describe('first-game welcome eligibility', () => {
    test('requires a fully hydrated zero-game user in an ordinary lobby session', () => {
        expect(shouldShowFirstGameWelcome(eligibleInput)).toBe(true);
        expect(shouldShowFirstGameWelcome({
            ...eligibleInput,
            user: { username: 'JWT placeholder' },
        })).toBe(false);
    });

    test.each([
        ['table view', { isLobby: false }],
        ['restored table', { hasCurrentTable: true }],
        ['invite navigation', { hasPendingInvite: true }],
        ['unresolved socket session', { socketSessionReady: false }],
        ['an experienced player', { user: { ...eligibleInput.user, games_played: 1 } }],
        ['a finished tutorial', { user: { ...eligibleInput.user, tutorial_version: TUTORIAL_VERSION } }],
    ])('stays hidden during %s', (_label, override) => {
        expect(shouldShowFirstGameWelcome({ ...eligibleInput, ...override })).toBe(false);
    });
});

describe('FirstGameWelcome', () => {
    test('presents the guided Academy choice and discloses its coin buy-in', () => {
        render(
            <FirstGameWelcome
                onStartGuided={vi.fn().mockResolvedValue(undefined)}
                onSkip={vi.fn().mockResolvedValue(undefined)}
            />
        );

        expect(screen.getByRole('dialog', { name: 'Welcome to Sluff' })).toHaveAttribute('aria-modal', 'true');
        expect(screen.getByText("Miss Paul's Academy")).toBeInTheDocument();
        expect(screen.getByText(/0\.10 coin buy-in/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Play Guided Game' })).toHaveFocus();
        expect(screen.getByRole('button', { name: 'I already know Sluff' })).toBeEnabled();
    });

    test('labels an active version as a continuation', () => {
        render(
            <FirstGameWelcome
                activeVersion={TUTORIAL_VERSION}
                onStartGuided={vi.fn().mockResolvedValue(undefined)}
                onSkip={vi.fn().mockResolvedValue(undefined)}
            />
        );

        expect(screen.getByRole('dialog', { name: 'Continue learning Sluff' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Continue Guided Game' })).toBeEnabled();
    });

    test('locks both choices while the guided start is being persisted', async () => {
        const user = userEvent.setup();
        let resolveStart;
        const onStartGuided = vi.fn(() => new Promise(resolve => { resolveStart = resolve; }));
        render(
            <FirstGameWelcome
                onStartGuided={onStartGuided}
                onSkip={vi.fn().mockResolvedValue(undefined)}
            />
        );

        await user.click(screen.getByRole('button', { name: 'Play Guided Game' }));
        expect(onStartGuided).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true');
        expect(screen.getByRole('button', { name: 'Opening the Academy…' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'I already know Sluff' })).toBeDisabled();

        resolveStart();
        await waitFor(() => expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'false'));
    });

    test('persists the skip choice', async () => {
        const user = userEvent.setup();
        const onSkip = vi.fn().mockResolvedValue(undefined);
        render(
            <FirstGameWelcome
                onStartGuided={vi.fn().mockResolvedValue(undefined)}
                onSkip={onSkip}
            />
        );

        await user.click(screen.getByRole('button', { name: 'I already know Sluff' }));
        expect(onSkip).toHaveBeenCalledTimes(1);
    });

    test('shows a persistence failure and allows a retry', async () => {
        const user = userEvent.setup();
        const onStartGuided = vi.fn().mockRejectedValue(new Error('Progress could not be saved.'));
        render(
            <FirstGameWelcome
                onStartGuided={onStartGuided}
                onSkip={vi.fn().mockResolvedValue(undefined)}
            />
        );

        await user.click(screen.getByRole('button', { name: 'Play Guided Game' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Progress could not be saved.');
        expect(screen.getByRole('button', { name: 'Play Guided Game' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'I already know Sluff' })).toBeEnabled();
    });
});
