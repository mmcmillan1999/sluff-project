// frontend/src/components/GameTableView.test.js

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import GameTableView from './GameTableView';
import { getMockGameState } from '../__mocks__/mockGameState';

// Mock child components that are not relevant to this test
jest.mock('./game/PlayerHand', () => () => <div data-testid="player-hand" />);
jest.mock('./game/TableLayout', () => ({ currentTableState, ActionControls, renderCard }) => (
    <div>
        <div data-testid="table-layout" />
        <ActionControls currentTableState={currentTableState} playerId={101} selfPlayerName="You" renderCard={renderCard} />
    </div>
));


describe('GameTableView State Transitions', () => {

    test('renders widow reveal correctly when all players pass', () => {
        const allPassState = getMockGameState({
            state: 'AllPassWidowReveal',
            roundSummary: {
                message: 'All players passed.',
                widowForReveal: ['AS', 'KS', 'QS'],
            }
        });
        
        // This mock is needed because ActionControls uses it
        const mockRenderCard = (cardString) => <div>{cardString}</div>;

        render(<GameTableView playerId={101} currentTableState={allPassState} renderCard={mockRenderCard} />);

        expect(screen.getByText('All players passed. Revealing the widow...')).toBeInTheDocument();
        expect(screen.getByText('AS')).toBeInTheDocument();
        expect(screen.getByText('KS')).toBeInTheDocument();
        expect(screen.getByText('QS')).toBeInTheDocument();
    });

});