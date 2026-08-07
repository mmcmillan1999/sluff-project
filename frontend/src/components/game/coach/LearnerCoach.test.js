// The pinned milestone note: a score milestone outlives its trick linger
// and leaves only on "Got it" or when the next card hits the felt — a
// timed fade outran the reader.

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LearnerCoach from './LearnerCoach';

vi.mock('../../../services/api', () => ({
    getSeenTips: () => Promise.resolve([]),
    markTipSeen: () => Promise.resolve(),
}));

// The callout only lays itself out against a measurable anchor; jsdom
// rects are all zeros, so the seat plate fakes one.
const mountAnchor = (selector) => {
    const el = document.createElement('div');
    el.setAttribute('data-seat-player', 'Ann');
    el.getBoundingClientRect = () => ({
        left: 100, top: 200, right: 220, bottom: 260, width: 120, height: 60,
    });
    document.body.appendChild(el);
    return el;
};

// Ann (the bidder) just took a 21-point trick that put her at 64.
const lingerState = {
    state: 'TrickCompleteLinger',
    bidWinnerInfo: { playerName: 'Ann', bid: 'Solo' },
    playerOrderActive: ['Ann', 'Me', 'Bea'],
    lastCompletedTrick: {
        winnerName: 'Ann',
        cards: [
            { playerName: 'Ann', card: 'AH' },
            { playerName: 'Me', card: '10H' },
            { playerName: 'Bea', card: '6H' },
        ],
    },
    capturedTricks: { Ann: [
        { cards: ['AS', 'AC', 'AD'] },
        { cards: ['KC', 'KD', 'JC'] },
        { cards: ['AH', '10H', '6H'] },
    ] },
    hands: { Me: [] },
    playoutVote: { isActive: false },
    drawRequest: { isActive: false },
};

const seenEverything = [
    'learner-teams-2026-08', 'learner-card-points-2026-08',
    'learner-trump-lock-2026-08', 'learner-must-trump-2026-08',
    'learner-follow-suit-2026-08', 'learner-insurance-2026-08',
    'learner-ten-beats-king-2026-08', 'learner-ace-takes-ten-2026-08',
    'learner-trump-wins-2026-08', 'learner-points-pile-2026-08',
];

describe('LearnerCoach pinned milestones', () => {
    let anchorEl;
    beforeEach(() => {
        window.localStorage.setItem('sluff_tips_seen:7', JSON.stringify(seenEverything));
        anchorEl = mountAnchor();
    });
    afterEach(() => {
        anchorEl.remove();
        window.localStorage.clear();
    });

    const renderCoach = (state) => render(
        <LearnerCoach
            currentTableState={state}
            selfPlayerName="Me"
            userId={7}
            active
        />,
    );

    test('the note survives the linger AND bot plays, dying only on my own card', async () => {
        const { rerender } = renderCoach(lingerState);
        expect(await screen.findByText(/past 60 — the bid is made/)).toBeInTheDocument();

        // Linger over, new trick open, nothing played: the note holds.
        rerender(
            <LearnerCoach
                currentTableState={{ ...lingerState, state: 'Playing Phase', currentTrickCards: [] }}
                selfPlayerName="Me"
                userId={7}
                active
            />,
        );
        expect(screen.getByText(/past 60 — the bid is made/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /got it/i })).toBeInTheDocument();

        // Bots play under it: the reader still sets the pace.
        rerender(
            <LearnerCoach
                currentTableState={{
                    ...lingerState,
                    state: 'Playing Phase',
                    currentTrickCards: [
                        { playerName: 'Bea', card: '7S' },
                        { playerName: 'Ann', card: '8S' },
                    ],
                }}
                selfPlayerName="Me"
                userId={7}
                active
            />,
        );
        expect(screen.getByText(/past 60 — the bid is made/)).toBeInTheDocument();

        // My own card: I've moved on, the note retires.
        rerender(
            <LearnerCoach
                currentTableState={{
                    ...lingerState,
                    state: 'Playing Phase',
                    currentTrickCards: [
                        { playerName: 'Bea', card: '7S' },
                        { playerName: 'Ann', card: '8S' },
                        { playerName: 'Me', card: '9S' },
                    ],
                }}
                selfPlayerName="Me"
                userId={7}
                active
            />,
        );
        expect(screen.queryByText(/past 60 — the bid is made/)).not.toBeInTheDocument();
    });

    test('"Got it" retires the note for good', async () => {
        renderCoach(lingerState);
        const button = await screen.findByRole('button', { name: /got it/i });
        await userEvent.click(button);
        expect(screen.queryByText(/past 60 — the bid is made/)).not.toBeInTheDocument();
    });

    test('a round wrap retires the note so it cannot float over the recap', async () => {
        const { rerender } = renderCoach(lingerState);
        expect(await screen.findByText(/past 60 — the bid is made/)).toBeInTheDocument();
        rerender(
            <LearnerCoach
                currentTableState={{ ...lingerState, state: 'Awaiting Next Round Trigger' }}
                selfPlayerName="Me"
                userId={7}
                active
            />,
        );
        expect(screen.queryByText(/past 60 — the bid is made/)).not.toBeInTheDocument();
    });
});
