// frontend/src/utils/bidHintCopy.js
// Turns the server's bid-hint facts into one friendly sentence. The facts
// (points, suit counts, the hand's bid, whether the table already outbid it)
// come from the same evaluator that drives the table's automated play; only
// the wording lives here.

const SUIT_NAMES = { S: 'spades', C: 'clubs', D: 'diamonds', H: 'hearts' };

const longestSuit = (suits = {}, candidates) => {
    let best = null;
    for (const suit of candidates) {
        const count = Number(suits[suit]) || 0;
        if (!best || count > best.count) best = { suit, count };
    }
    return best;
};

// Matches the evaluator's lowest length threshold: a 4-card suit is what the
// bid tiers start caring about, so that is where "long" starts too.
const LONG_SUIT_MIN = 4;

export const buildBidHintCopy = (hint) => {
    if (!hint || typeof hint !== 'object') return '';
    const { handBid, bid, points, suits = {}, outbid } = hint;
    const hearts = Number(suits.H) || 0;

    if (outbid) {
        // "Gone past it", not "taken": the table's bid may be strictly
        // higher than the hand's — nobody need have bid the hand's level.
        return `Your hand plays like a ${handBid}, but the bidding has already gone past it — passing is the safe call.`;
    }

    switch (bid) {
        case 'Heart Solo':
            return `Because you have ${points} points and ${hearts} hearts, you might try a Heart Solo.`;
        case 'Solo': {
            const side = longestSuit(suits, ['S', 'C', 'D']);
            return `Because you have ${points} points and ${side.count} ${SUIT_NAMES[side.suit]}, you might try a Solo.`;
        }
        case 'Frog':
            return `Because you have ${points} points and ${hearts} hearts to grow with the widow, you might try a Frog.`;
        default: {
            // Never tell a player staring at six spades that they have no
            // long suit — when length is there and points are not, blame
            // the points.
            const best = longestSuit(suits, ['S', 'C', 'D', 'H']);
            if (best && best.count >= LONG_SUIT_MIN) {
                return `Your ${best.count} ${SUIT_NAMES[best.suit]} run long, but at ${points} points the hand is too light to back a bid — passing is the safe call.`;
            }
            return `With ${points} points and no long suit to lean on, passing is the safe call.`;
        }
    }
};

export default buildBidHintCopy;
