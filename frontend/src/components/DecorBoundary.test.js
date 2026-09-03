import React from 'react';
import { render, screen } from '@testing-library/react';
import DecorBoundary from './DecorBoundary';

const { reportError } = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock('../utils/errorReporter', () => ({ reportError }));

const Bomb = () => {
    throw new Error('ornament exploded');
};

describe('DecorBoundary', () => {
    let consoleError;

    beforeEach(() => {
        reportError.mockClear();
        // React logs every caught render error; keep the run readable.
        consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleError.mockRestore();
    });

    it('renders its children when nothing throws', () => {
        render(<DecorBoundary><span>spider</span></DecorBoundary>);
        expect(screen.getByText('spider')).toBeInTheDocument();
        expect(reportError).not.toHaveBeenCalled();
    });

    it('swallows a child crash, renders nothing, and reports it', () => {
        const { container } = render(
            <div data-testid="table">
                <span>felt</span>
                <DecorBoundary><Bomb /></DecorBoundary>
            </div>,
        );
        expect(screen.getByText('felt')).toBeInTheDocument();
        expect(screen.getByTestId('table').childNodes).toHaveLength(1);
        expect(container.querySelector('[role="alert"]')).toBeNull();
        expect(reportError).toHaveBeenCalledWith('ornament exploded', expect.any(String));
    });

    it('runs a function child inside the boundary so render helpers are covered', () => {
        render(
            <div data-testid="table">
                <span>felt</span>
                <DecorBoundary>{() => { throw new Error('helper exploded'); }}</DecorBoundary>
            </div>,
        );
        expect(screen.getByText('felt')).toBeInTheDocument();
        expect(screen.getByTestId('table').childNodes).toHaveLength(1);
        expect(reportError).toHaveBeenCalledWith('helper exploded', expect.any(String));
    });

    it('renders what a function child returns when it does not throw', () => {
        render(<DecorBoundary>{() => <span>deck</span>}</DecorBoundary>);
        expect(screen.getByText('deck')).toBeInTheDocument();
    });
});
