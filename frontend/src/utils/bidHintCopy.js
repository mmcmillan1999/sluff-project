// frontend/src/utils/bidHintCopy.js
// Turns the server's bid-hint facts into one friendly sentence. The facts
// come from the same control evaluator that drives the table's automated
// play — since Aug 2026 the advice speaks OWNERSHIP, not point arithmetic:
// aces lead, a 10 is safe when its own ace clears the way, and a naked 10
// is bait. Only the wording lives here.

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

// How a suit is owned, in words: the ace-and-ten lock, the bare ace, or the
// guarded ten. Empty string when nothing in the suit commands it.
const ownershipPhrase = (suit, name) => {
    if (!suit) return '';
    if (suit.hasA && suit.has10 && suit.hasK) return `the ace, ten, and king of ${name}`;
    if (suit.hasA && suit.has10) return `the ace and ten of ${name}`;
    if (suit.hasA) return `the ace of ${name}`;
    if (suit.has10 && suit.length >= 3) return `a guarded ten of ${name}`;
    return '';
};

export const buildBidHintCopy = (hint) => {
    if (!hint || typeof hint !== 'object') return '';
    const { handBid, bid, points, suits = {}, control = {}, outbid } = hint;
    const hearts = Number(suits.H) || 0;
    const heartFacts = control.hearts || {};
    const sideFacts = control.side || {};
    const aces = Number(control.aces) || 0;
    const nakedTens = Number(control.nakedTens) || 0;

    if (outbid) {
        // "Gone past it", not "taken": the table's bid may be strictly
        // higher than the hand's — nobody need have bid the hand's level.
        return `Your hand plays like a ${handBid}, but the bidding has already gone past it — passing is the safe call.`;
    }

    switch (bid) {
        case 'Heart Solo': {
            const owns = ownershipPhrase(heartFacts, 'hearts')
                || `${aces} aces backing them`;
            return `With ${hearts} hearts and ${owns}, you own enough of the table — a Heart Solo is on.`;
        }
        case 'Solo': {
            const name = SUIT_NAMES[sideFacts.suit] || 'trump';
            const owns = ownershipPhrase(sideFacts, name)
                || `${aces} aces beside them`;
            return `Your ${sideFacts.length || 'long'} ${name} come with ${owns} — a Solo is worth a look.`;
        }
        case 'Frog': {
            const owns = ownershipPhrase(heartFacts, 'hearts')
                || `${aces} aces behind them`;
            return `Your hearts carry ${owns}, and the widow can grow them — you might try a Frog.`;
        }
        default: {
            const best = longestSuit(suits, ['S', 'C', 'D', 'H']);
            const tenWarning = nakedTens > 0
                ? " And an unguarded 10 is bait — without its ace, someone else's ace takes it."
                : '';
            if (aces === 0) {
                return `No aces means nothing in your hand owns a suit — kings and queens get outranked by the ace AND the ten.${tenWarning} Passing is the safe call.`;
            }
            if (best && best.count >= LONG_SUIT_MIN) {
                return `Your ${best.count} ${SUIT_NAMES[best.suit]} run long, but you don't own enough of the table to back a bid.${tenWarning} Passing is the safe call.`;
            }
            return `With ${points} points and no suit you truly own, passing is the safe call.${tenWarning ? tenWarning : ''}`;
        }
    }
};

export default buildBidHintCopy;
