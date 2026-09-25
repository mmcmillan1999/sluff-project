import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SeasonEndNotice, {
    SEASON_TWO_ENDS_AT,
    localSeasonEnd,
    seasonEndNoticeDismissed,
    shouldShowSeasonEndNotice,
} from './SeasonEndNotice';

const USER = { id: 1, username: 'Tester' };
const BEFORE = Date.parse('2026-09-24T18:00:00Z');

describe('SeasonEndNotice', () => {
    beforeEach(() => window.localStorage.clear());

    test('closes at midnight Mountain Time at the end of September 30', () => {
        expect(SEASON_TWO_ENDS_AT).toBe('2026-10-01T06:00:00Z');
        expect(localSeasonEnd('en-US')).toMatch(/Oct 1|Sep 30/);
    });

    test('shows in the lobby only, before the season ends, until dismissed', () => {
        const base = { user: USER, isLobby: true, hasCurrentTable: false, now: BEFORE };
        expect(shouldShowSeasonEndNotice(base)).toBe(true);
        expect(shouldShowSeasonEndNotice({ ...base, isLobby: false })).toBe(false);
        expect(shouldShowSeasonEndNotice({ ...base, hasCurrentTable: true })).toBe(false);
        expect(shouldShowSeasonEndNotice({ ...base, blocked: true })).toBe(false);
        expect(shouldShowSeasonEndNotice({ ...base, user: null })).toBe(false);
        expect(shouldShowSeasonEndNotice({ ...base, now: Date.parse(SEASON_TWO_ENDS_AT) })).toBe(false);
    });

    test('"Got it" hides it and keeps it hidden on this device', async () => {
        const user = userEvent.setup();
        const onDismiss = vi.fn();
        render(<SeasonEndNotice onDismiss={onDismiss} />);
        expect(screen.getByRole('dialog', { name: 'The final week' })).toBeInTheDocument();
        expect(screen.getByText(/midnight Mountain Time/)).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Got it' }));
        expect(onDismiss).toHaveBeenCalledTimes(1);
        expect(seasonEndNoticeDismissed()).toBe(true);
        expect(shouldShowSeasonEndNotice({ user: USER, isLobby: true, hasCurrentTable: false, now: BEFORE })).toBe(false);
    });

    test('a device that cannot store the dismissal just sees it again', () => {
        const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
        expect(seasonEndNoticeDismissed()).toBe(false);
        spy.mockRestore();
    });
});
