// frontend/src/components/GameTableView.test.js

import React from 'react';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import GameTableView from './GameTableView';
import { getMockGameState } from '../__mocks__/mockGameState';

// Mock child components that are not relevant to this test
jest.mock('./game/PlayerHand', () => () => <div data-testid="player-hand" />);
jest.mock('./game/TableLayout', () => ({ currentTableState, ActionControls }) => (
    <div>
        <div data-testid="table-layout" />
        <ActionControls currentTableState={currentTableState} playerId={101} selfPlayerName="You" />
    </div>
));


describe('GameTableView State Transitions', () => {

    test('renders widow reveal correctly when all players pass', () => {
        // 1. ARRANGE
        // Create a specific game state for this test case
        const allPassState = getMockGameState({
            state: 'AllPassWidowReveal',
            roundSummary: {
                message: 'All players passed.',
                widowForReveal: ['AS', 'KS', 'QS'], // The cards to be revealed
            }
        });

        // Render the component with this state
        render(<GameTableView playerId={101} currentTableState={allPassState} />);

        // 2. ASSERT
        // Check for the specific UI elements that should appear
        expect(screen.getByText('All players passed. Revealing the widow...')).toBeInTheDocument();
        
        // Check if the specific widow cards are rendered
        // We use queryByText to check for the presence of the card content
        expect(screen.queryByText(/A/)).toBeInTheDocument();
        expect(screen.queryByText(/K/)).toBeInTheDocument();
        expect(screen.queryByText(/Q/)).toBeInTheDocument();
        expect(screen.getByText('♠')).toBeInTheDocument(); // Check for one of the suits
    });

    // We will add the other tests here in the next steps...

});