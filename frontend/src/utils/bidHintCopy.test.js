import buildBidHintCopy from './bidHintCopy';

describe('buildBidHintCopy', () => {
    test('names the heart count for a Heart Solo', () => {
        expect(buildBidHintCopy({
            bid: 'Heart Solo', handBid: 'Heart Solo', points: 38,
            suits: { H: 5, S: 2, C: 2, D: 2 }, outbid: false,
        })).toBe('Because you have 38 points and 5 hearts, you might try a Heart Solo.');
    });

    test('names the longest side suit for a Solo', () => {
        expect(buildBidHintCopy({
            bid: 'Solo', handBid: 'Solo', points: 48,
            suits: { H: 0, S: 2, C: 6, D: 3 }, outbid: false,
        })).toBe('Because you have 48 points and 6 clubs, you might try a Solo.');
    });

    test('explains the widow angle for a Frog', () => {
        expect(buildBidHintCopy({
            bid: 'Frog', handBid: 'Frog', points: 33,
            suits: { H: 4, S: 3, C: 2, D: 2 }, outbid: false,
        })).toBe('Because you have 33 points and 4 hearts to grow with the widow, you might try a Frog.');
    });

    test('recommends the pass without shaming the hand', () => {
        expect(buildBidHintCopy({
            bid: 'Pass', handBid: 'Pass', points: 14,
            suits: { H: 2, S: 3, C: 3, D: 3 }, outbid: false,
        })).toBe('With 14 points and no long suit to lean on, passing is the safe call.');
    });

    test('never denies a long suit the player can see — blames the points instead', () => {
        // Six spades but only 30 points: the hand misses the Solo bar on
        // points alone, and the copy must say so.
        expect(buildBidHintCopy({
            bid: 'Pass', handBid: 'Pass', points: 30,
            suits: { H: 1, S: 6, C: 2, D: 2 }, outbid: false,
        })).toBe('Your 6 spades run long, but at 30 points the hand is too light to back a bid — passing is the safe call.');
    });

    test('explains an outbid hand instead of suggesting an illegal bid', () => {
        // "Gone past it", not "taken": the table may sit at Solo while the
        // hand plays Frog — nobody bid Frog at all.
        expect(buildBidHintCopy({
            bid: 'Pass', handBid: 'Frog', points: 33,
            suits: { H: 4, S: 3, C: 2, D: 2 }, outbid: true,
        })).toBe('Your hand plays like a Frog, but the bidding has already gone past it — passing is the safe call.');
    });

    test('tolerates junk without throwing', () => {
        expect(buildBidHintCopy(null)).toBe('');
        expect(buildBidHintCopy(undefined)).toBe('');
        expect(buildBidHintCopy({ bid: 'Pass', points: 0 })).toContain('passing');
    });
});
