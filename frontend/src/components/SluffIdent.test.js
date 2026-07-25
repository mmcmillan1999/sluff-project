import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import SluffIdent, { IDENT_TOTAL_MS, IDENT_FADE_MS } from './SluffIdent';

describe('SluffIdent', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    test('plays the full timeline and then reports done', () => {
        vi.useFakeTimers();
        const onDone = vi.fn();
        render(<SluffIdent onDone={onDone} />);

        expect(screen.getByTestId('sluff-ident')).toBeInTheDocument();
        act(() => vi.advanceTimersByTime(IDENT_TOTAL_MS - 1));
        expect(onDone).not.toHaveBeenCalled();

        // The leave timer fires, the effect schedules the fade timer, then
        // the fade runs out.
        act(() => vi.advanceTimersByTime(1));
        expect(screen.getByTestId('sluff-ident').className).toContain('is-leaving');
        act(() => vi.advanceTimersByTime(IDENT_FADE_MS));
        expect(onDone).toHaveBeenCalledTimes(1);
    });

    test('a tap skips straight to the fade-out', () => {
        vi.useFakeTimers();
        const onDone = vi.fn();
        render(<SluffIdent onDone={onDone} />);

        fireEvent.pointerDown(screen.getByTestId('sluff-ident'));
        expect(screen.getByTestId('sluff-ident').className).toContain('is-leaving');
        act(() => vi.advanceTimersByTime(IDENT_FADE_MS));
        expect(onDone).toHaveBeenCalledTimes(1);
    });

    test('hold mode never leaves (harness screenshots)', () => {
        vi.useFakeTimers();
        const onDone = vi.fn();
        render(<SluffIdent onDone={onDone} hold />);

        fireEvent.pointerDown(screen.getByTestId('sluff-ident'));
        act(() => vi.advanceTimersByTime(IDENT_TOTAL_MS * 3));
        expect(onDone).not.toHaveBeenCalled();
        expect(screen.getByTestId('sluff-ident').className).toContain('is-held');
    });
});
