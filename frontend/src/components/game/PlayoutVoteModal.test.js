import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import PlayoutVoteModal from './PlayoutVoteModal';

const makeState = (overrides = {}) => ({
    playoutVote: {
        isActive: true,
        timer: 27,
        resolution: null,
        votes: { Me: null, Brandi: null, Elena: null },
        ...overrides,
    },
});

describe('PlayoutVoteModal', () => {
    test('offers both choices and emits the chosen vote', () => {
        const onVote = vi.fn();
        render(
            <PlayoutVoteModal
                show
                currentTableState={makeState()}
                selfPlayerName="Me"
                onVote={onVote}
            />
        );

        expect(screen.getByText('Deal Struck!')).toBeInTheDocument();
        expect(screen.getByText('27s')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'PLAY IT OUT' }));
        expect(onVote).toHaveBeenCalledWith('play');
        fireEvent.click(screen.getByRole('button', { name: 'NEXT ROUND ▶' }));
        expect(onVote).toHaveBeenCalledWith('wrap');
    });

    test('after voting it shows the waiting tally instead of buttons', () => {
        render(
            <PlayoutVoteModal
                show
                currentTableState={makeState({ votes: { Me: 'wrap', Brandi: null, Elena: 'wrap' } })}
                selfPlayerName="Me"
                onVote={() => {}}
            />
        );

        expect(screen.queryByRole('button', { name: 'PLAY IT OUT' })).not.toBeInTheDocument();
        expect(screen.getByText(/You voted for the next round/)).toBeInTheDocument();
        expect(screen.getByText(/\(2\/3\)/)).toBeInTheDocument();
    });

    test('renders nothing when hidden or when the vote is inactive', () => {
        const { rerender } = render(
            <PlayoutVoteModal show={false} currentTableState={makeState()} selfPlayerName="Me" onVote={() => {}} />
        );
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

        rerender(
            <PlayoutVoteModal
                show
                currentTableState={makeState({ isActive: false })}
                selfPlayerName="Me"
                onVote={() => {}}
            />
        );
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
});
