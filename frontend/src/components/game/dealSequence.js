export const CARDS_PER_PLAYER = 11;
export const WIDOW_CARD_COUNT = 3;

// The cards overlap like a practiced physical deal, but each individual card
// keeps the slower, weighted travel of the trick-collection magnet.
export const DEAL_CARD_STAGGER_MS = 115;
export const DEAL_CARD_FLIGHT_MS = 800;

const asNonNegativeInteger = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
};
/**
 * Build the public presentation order for one deal.
 *
 * Events intentionally contain destinations only. Card identities remain in
 * the viewer-specific hand state and are never exposed through the animation.
 */
export const buildDealSequence = (
    playerOrder,
    cardsPerPlayer = CARDS_PER_PLAYER,
    widowCards = WIDOW_CARD_COUNT,
) => {
    if (!Array.isArray(playerOrder) || playerOrder.length === 0) return [];

    const circuitCount = asNonNegativeInteger(cardsPerPlayer);
    const widowCount = asNonNegativeInteger(widowCards);
    const sequence = [];

    for (let circuit = 0; circuit < circuitCount; circuit += 1) {
        playerOrder.forEach((playerName, playerIndex) => {
            sequence.push({
                type: 'player',
                playerName,
                circuit,
                playerIndex,
            });
        });

        if (circuit < widowCount) {
            sequence.push({
                type: 'widow',
                circuit,
                widowIndex: circuit,
            });
        }
    }

    return sequence;
};
