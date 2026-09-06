import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    extractInviteTournamentId, getTournamentInviteUrl, shareTournamentInvite, tournamentInviteText,
} from './tournamentInvites';

const tournament = { id: 12, name: 'Saturday Sluff', buyInTokens: 2, startingStack: 120, status: 'registering' };

describe('extractInviteTournamentId', () => {
    it('parses a full https link', () => {
        expect(extractInviteTournamentId('https://playsluff.com/tournament/12')).toBe(12);
    });

    it('parses a bare path and a trailing slash', () => {
        expect(extractInviteTournamentId('/tournament/7')).toBe(7);
        expect(extractInviteTournamentId('https://playsluff.com/tournament/7/')).toBe(7);
    });

    it('parses the ?tournament= query fallback and ignores tracking params', () => {
        expect(extractInviteTournamentId('https://playsluff.com/?tournament=3')).toBe(3);
        expect(extractInviteTournamentId('https://playsluff.com/tournament/40?utm_source=sms')).toBe(40);
    });

    it('returns null for anything else', () => {
        expect(extractInviteTournamentId('https://playsluff.com/')).toBeNull();
        expect(extractInviteTournamentId('https://playsluff.com/join/table-3')).toBeNull();
        expect(extractInviteTournamentId('/tournament/not-a-number')).toBeNull();
        expect(extractInviteTournamentId('')).toBeNull();
        expect(extractInviteTournamentId(null)).toBeNull();
    });
});

describe('sharing', () => {
    afterEach(() => {
        delete navigator.share;
        delete navigator.clipboard;
    });

    it('builds the link on the current origin', () => {
        expect(getTournamentInviteUrl(12)).toBe(`${window.location.origin}/tournament/12`);
    });

    it('describes the tournament in the message', () => {
        expect(tournamentInviteText(tournament)).toBe('Come play in my Sluff tournament — "Saturday Sluff" (2 token buy-in, 120 chips). Registration is open!');
        expect(tournamentInviteText({ ...tournament, status: 'running' })).toMatch(/under way .* Come watch!/);
    });

    it('uses the share sheet when there is one', async () => {
        navigator.share = vi.fn().mockResolvedValue(undefined);
        expect(await shareTournamentInvite(tournament)).toBe('shared');
        expect(navigator.share).toHaveBeenCalledWith(expect.objectContaining({ url: `${window.location.origin}/tournament/12` }));
    });

    it('copies the link when there is no share sheet', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        navigator.clipboard = { writeText };
        expect(await shareTournamentInvite(tournament)).toBe('copied');
        expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/tournament/12`);
    });

    it('reports failure when neither works', async () => {
        expect(await shareTournamentInvite(tournament)).toBe('failed');
    });
});
