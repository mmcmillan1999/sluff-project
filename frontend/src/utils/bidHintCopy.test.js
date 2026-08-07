import buildBidHintCopy from './bidHintCopy';

// The hint speaks CONTROL since the Aug 2026 evaluator flip: aces lead, a
// 10 is safe behind its own ace, a naked 10 is bait, and kings get
// outranked by both. The copy must teach the same game the table plays.

describe('buildBidHintCopy', () => {
    test('cites heart ownership for a Heart Solo', () => {
        expect(buildBidHintCopy({
            bid: 'Heart Solo', handBid: 'Heart Solo', points: 38,
            suits: { H: 5, S: 2, C: 2, D: 2 },
            control: {
                aces: 2, protectedTens: 1, nakedTens: 0,
                hearts: { length: 5, hasA: true, has10: true, hasK: false },
                side: { suit: 'S', length: 2, hasA: true, has10: false, hasK: false },
            },
            outbid: false,
        })).toBe('With 5 hearts and the ace and ten of hearts, you own enough of the table — a Heart Solo is on.');
    });

    test('cites the side suit and its ownership for a Solo', () => {
        expect(buildBidHintCopy({
            bid: 'Solo', handBid: 'Solo', points: 48,
            suits: { H: 0, S: 2, C: 6, D: 3 },
            control: {
                aces: 2, protectedTens: 1, nakedTens: 0,
                hearts: { length: 0, hasA: false, has10: false, hasK: false },
                side: { suit: 'C', length: 6, hasA: true, has10: true, hasK: true },
            },
            outbid: false,
        })).toBe('Your 6 clubs come with the ace, ten, and king of clubs — a Solo is worth a look.');
    });

    test('explains the widow angle for a Frog', () => {
        expect(buildBidHintCopy({
            bid: 'Frog', handBid: 'Frog', points: 33,
            suits: { H: 4, S: 3, C: 2, D: 2 },
            control: {
                aces: 1, protectedTens: 0, nakedTens: 0,
                hearts: { length: 4, hasA: true, has10: false, hasK: false },
                side: { suit: 'S', length: 3, hasA: false, has10: false, hasK: false },
            },
            outbid: false,
        })).toBe('Your hearts carry the ace of hearts, and the widow can grow them — you might try a Frog.');
    });

    test('teaches the no-aces lesson on a pass', () => {
        expect(buildBidHintCopy({
            bid: 'Pass', handBid: 'Pass', points: 33,
            suits: { H: 5, S: 2, C: 2, D: 2 },
            control: {
                aces: 0, protectedTens: 0, nakedTens: 1,
                hearts: { length: 5, hasA: false, has10: false, hasK: true },
                side: { suit: 'D', length: 2, hasA: false, has10: true, hasK: false },
            },
            outbid: false,
        })).toBe('No aces means nothing in your hand owns a suit — kings and queens get outranked by the ace AND the ten.'
            + " And an unguarded 10 is bait — without its ace, someone else's ace takes it. Passing is the safe call.");
    });

    test('never denies a long suit the player can see — blames the missing ownership', () => {
        expect(buildBidHintCopy({
            bid: 'Pass', handBid: 'Pass', points: 30,
            suits: { H: 1, S: 6, C: 2, D: 2 },
            control: {
                aces: 1, protectedTens: 0, nakedTens: 0,
                hearts: { length: 1, hasA: true, has10: false, hasK: false },
                side: { suit: 'S', length: 6, hasA: false, has10: false, hasK: true },
            },
            outbid: false,
        })).toBe("Your 6 spades run long, but you don't own enough of the table to back a bid. Passing is the safe call.");
    });

    test('keeps a plain pass gentle', () => {
        expect(buildBidHintCopy({
            bid: 'Pass', handBid: 'Pass', points: 14,
            suits: { H: 2, S: 3, C: 3, D: 3 },
            control: {
                aces: 1, protectedTens: 0, nakedTens: 0,
                hearts: { length: 2, hasA: false, has10: false, hasK: false },
                side: { suit: 'S', length: 3, hasA: true, has10: false, hasK: false },
            },
            outbid: false,
        })).toBe('With 14 points and no suit you truly own, passing is the safe call.');
    });

    test('explains an outbid hand instead of suggesting an illegal bid', () => {
        expect(buildBidHintCopy({
            bid: 'Pass', handBid: 'Frog', points: 33,
            suits: { H: 4, S: 3, C: 2, D: 2 },
            control: {
                aces: 1, protectedTens: 0, nakedTens: 0,
                hearts: { length: 4, hasA: true, has10: false, hasK: false },
                side: { suit: 'S', length: 3, hasA: false, has10: false, hasK: false },
            },
            outbid: true,
        })).toBe('Your hand plays like a Frog, but the bidding has already gone past it — passing is the safe call.');
    });

    test('tolerates junk without throwing', () => {
        expect(buildBidHintCopy(null)).toBe('');
        expect(buildBidHintCopy(undefined)).toBe('');
        expect(buildBidHintCopy({ bid: 'Pass', points: 0 })).toMatch(/passing/i);
    });
});
