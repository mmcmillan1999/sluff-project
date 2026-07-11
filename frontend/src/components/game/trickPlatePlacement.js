const CORNERS = Object.freeze({
    bottomLeft: 'pile-bottom-left',
    bottomRight: 'pile-bottom-right',
    topLeft: 'pile-top-left',
    topRight: 'pile-top-right',
});

export const WIDOW_CORNER_BY_DEALER_SEAT = Object.freeze({
    // Each value is the corner immediately beside the dealer's left hand as
    // that player faces the middle of the table.
    bottom: CORNERS.bottomLeft,
    left: CORNERS.topLeft,
    top: CORNERS.topRight,
    right: CORNERS.bottomRight,
});

const BIDDER_CORNER_PREFERENCES = Object.freeze({
    // Prefer the bidder's right hand, then their left. Either result remains
    // directly beside the bidder while allowing occupied corners to be skipped.
    bottom: [CORNERS.bottomRight, CORNERS.bottomLeft],
    left: [CORNERS.bottomLeft, CORNERS.topLeft],
    top: [CORNERS.topLeft, CORNERS.topRight],
    right: [CORNERS.topRight, CORNERS.bottomRight],
});

const TEAM_CORNER_PREFERENCES = Object.freeze({
    // Adjacent teammates have one literal shared corner.
    'bottom|left': [CORNERS.bottomLeft],
    'bottom|right': [CORNERS.bottomRight],
    'left|top': [CORNERS.topLeft],
    'top|right': [CORNERS.topRight],

    // Opposite seats have no single shared corner. These stable preferences
    // choose one end of the open rail; occupied corners are skipped below.
    // In particular, left + right resolves to top-right in three-player mode.
    'left|right': [
        CORNERS.topRight,
        CORNERS.topLeft,
        CORNERS.bottomRight,
        CORNERS.bottomLeft,
    ],
    'bottom|top': [
        CORNERS.bottomRight,
        CORNERS.bottomLeft,
        CORNERS.topRight,
        CORNERS.topLeft,
    ],
});

const SEAT_ORDER = Object.freeze(['bottom', 'left', 'top', 'right']);

export const seatForPlayerName = (playerName, seatAssignments = {}) => {
    if (!playerName) return null;

    if (seatAssignments.self === playerName) return 'bottom';
    if (seatAssignments.opponentLeft === playerName) return 'left';
    if (seatAssignments.opponentAcross === playerName) return 'top';
    if (seatAssignments.opponentRight === playerName) return 'right';
    return null;
};

export const resolveDealerName = (dealer, players = {}) => {
    if (dealer === null || dealer === undefined) return null;

    const dealerPlayer = Object.values(players || {}).find(
        player => player?.userId !== null
            && player?.userId !== undefined
            && String(player.userId) === String(dealer),
    );

    return dealerPlayer?.playerName || null;
};

const teamKey = (seats) => [...seats]
    .sort((first, second) => SEAT_ORDER.indexOf(first) - SEAT_ORDER.indexOf(second))
    .join('|');

const firstAvailable = (preferences, occupied) => (
    preferences?.find(corner => !occupied.has(corner)) || null
);

/**
 * Derive the three fixed plate corners from the local viewer's seat map.
 *
 * The widow can be placed before bidding begins. Bidder/team positions remain
 * null until the active bidder and both active defenders can be identified.
 * Dealer is the server's user id; players is the serialized player map used to
 * translate that id to the player name held in seatAssignments.
 */
export const deriveTrickPlatePlacement = ({
    playerMode,
    seatAssignments = {},
    dealer,
    players = {},
    playerOrderActive = [],
    bidderName,
} = {}) => {
    const isFourPlayer = Number(playerMode) === 4;
    const dealerName = isFourPlayer ? resolveDealerName(dealer, players) : null;
    const dealerSeat = isFourPlayer
        ? seatForPlayerName(dealerName, seatAssignments)
        : null;
    const widowPileClass = isFourPlayer
        ? (WIDOW_CORNER_BY_DEALER_SEAT[dealerSeat] || null)
        : CORNERS.topLeft;

    const emptyResult = {
        widowPileClass,
        defenderPileClass: null,
        bidderPileClass: null,
    };

    const bidderSeat = seatForPlayerName(bidderName, seatAssignments);
    if (!bidderSeat || !Array.isArray(playerOrderActive)) return emptyResult;

    const defenderNames = [...new Set(
        playerOrderActive.filter(name => name && name !== bidderName),
    )];
    if (defenderNames.length !== 2) return emptyResult;

    const defenderSeats = defenderNames.map(name => seatForPlayerName(name, seatAssignments));
    if (defenderSeats.some(seat => !seat)) return emptyResult;

    const teamPreferences = TEAM_CORNER_PREFERENCES[teamKey(defenderSeats)] || [];
    const bidderPreferences = BIDDER_CORNER_PREFERENCES[bidderSeat] || [];
    const widowOccupied = new Set(widowPileClass ? [widowPileClass] : []);

    // Prefer a team corner that also leaves one of the bidder's two adjacent
    // corners free. This matters only for opposite-seat teammate pairs.
    const defenderPileClass = teamPreferences.find(candidate => {
        if (widowOccupied.has(candidate)) return false;
        const occupied = new Set([...widowOccupied, candidate]);
        return bidderPreferences.some(corner => !occupied.has(corner));
    }) || null;

    if (!defenderPileClass) return emptyResult;

    const occupied = new Set([...widowOccupied, defenderPileClass]);
    const bidderPileClass = firstAvailable(bidderPreferences, occupied);

    return {
        widowPileClass,
        defenderPileClass,
        bidderPileClass,
    };
};

export { CORNERS as TRICK_PLATE_CORNERS };
