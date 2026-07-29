import { getPendingSelfAction, pendingActionKey } from './pendingSelfAction';

const ME = 'You';
const MY_ID = 101;

const table = (overrides) => ({
    state: 'Playing Phase',
    trickTurnPlayerName: ME,
    biddingTurnPlayerName: null,
    bidWinnerInfo: null,
    tricksPlayedCount: 3,
    currentTrickCards: [],
    playersWhoPassedThisRound: [],
    currentHighestBidDetails: null,
    ...overrides
});

describe('getPendingSelfAction', () => {
    test('card play is a hand decision', () => {
        expect(getPendingSelfAction(table(), ME, MY_ID))
            .toEqual({ kind: 'play', surface: 'hand' });
    });

    test('bidding reads its own turn field, not the trick one', () => {
        const state = table({
            state: 'Bidding Phase',
            biddingTurnPlayerName: ME,
            trickTurnPlayerName: 'Brandi'
        });
        expect(getPendingSelfAction(state, ME, MY_ID))
            .toEqual({ kind: 'bid', surface: 'prompt' });
    });

    test('trump selection and the Frog exchange belong to the bid winner by id', () => {
        const winner = { userId: MY_ID, playerName: ME };
        expect(getPendingSelfAction(table({ state: 'Trump Selection', bidWinnerInfo: winner }), ME, MY_ID))
            .toEqual({ kind: 'trump', surface: 'prompt' });
        expect(getPendingSelfAction(table({ state: 'Frog Widow Exchange', bidWinnerInfo: winner }), ME, MY_ID))
            .toEqual({ kind: 'frogDiscard', surface: 'hand' });
    });

    test('another player holding the action is never our problem', () => {
        expect(getPendingSelfAction(table({ trickTurnPlayerName: 'Brandi' }), ME, MY_ID)).toBeNull();
        expect(getPendingSelfAction(
            table({ state: 'Bidding Phase', biddingTurnPlayerName: 'Brandi' }), ME, MY_ID
        )).toBeNull();
        expect(getPendingSelfAction(
            table({ state: 'Trump Selection', bidWinnerInfo: { userId: 999 } }), ME, MY_ID
        )).toBeNull();
    });

    test('states nobody is being waited on for stay quiet', () => {
        ['TrickCompleteLinger', 'Bid Announcement', 'WidowReveal', 'Game Over', 'Dealing Pending']
            .forEach(state => {
                expect(getPendingSelfAction(table({ state }), ME, MY_ID)).toBeNull();
            });
    });

    test('missing table or player never throws', () => {
        expect(getPendingSelfAction(null, ME, MY_ID)).toBeNull();
        expect(getPendingSelfAction(table(), undefined, MY_ID)).toBeNull();
    });
});

describe('pendingActionKey', () => {
    test('a card landing on the trick counts as a new decision', () => {
        const before = table({ currentTrickCards: [{ card: 'KH' }] });
        const after = table({ currentTrickCards: [{ card: 'KH' }, { card: '9H' }] });
        const action = { kind: 'play', surface: 'hand' };
        expect(pendingActionKey(before, action)).not.toBe(pendingActionKey(after, action));
    });

    test('table chatter that is not a turn change leaves the clock alone', () => {
        const action = { kind: 'play', surface: 'hand' };
        const base = table({ currentTrickCards: [{ card: 'KH' }] });
        const chatter = table({
            currentTrickCards: [{ card: 'KH' }],
            // Another seat moved their insurance and a score updated.
            insurance: { bidderRequirement: 90 },
            scores: { You: 120 }
        });
        expect(pendingActionKey(base, action)).toBe(pendingActionKey(chatter, action));
    });

    test('each pass during bidding is its own decision', () => {
        const action = { kind: 'bid', surface: 'prompt' };
        const first = table({ state: 'Bidding Phase', playersWhoPassedThisRound: [] });
        const second = table({ state: 'Bidding Phase', playersWhoPassedThisRound: ['Brandi'] });
        expect(pendingActionKey(first, action)).not.toBe(pendingActionKey(second, action));
    });

    test('no pending action means no clock', () => {
        expect(pendingActionKey(table(), null)).toBeNull();
    });
});
