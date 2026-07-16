const TOP_LEVEL_SCALAR_FIELDS = [
    'gameId',
    'tableId',
    'tableName',
    'theme',
    'state',
    'serverTime',
    'serverVersion',
    'tableType',
    'qpPhase',
    'qpGeneration',
    'playerMode',
    'gameStarted',
    'dealer',
    'widowCount',
    'tricksPlayedCount',
    'leadSuitCurrentTrick',
    'trumpBroken',
    'trumpSuit',
    'bidderCardPoints',
    'defenderCardPoints',
    'drawCountdown',
    'biddingTurnPlayerName',
    'trickTurnPlayerName',
    'originalFrogBidderId',
    'soloBidMadeAfterFrog',
];

const PLAYER_FIELDS = ['userId', 'playerName', 'isSpectator', 'disconnected', 'isBot'];
const BID_FIELDS = ['userId', 'playerName', 'bid'];
const INSURANCE_FIELDS = [
    'isActive',
    'bidMultiplier',
    'bidderPlayerName',
    'bidderRequirement',
    'dealExecuted',
];
const ROUND_SUMMARY_FIELDS = [
    'message',
    'isGameOver',
    'gameWinner',
    'dealerOfRoundId',
    'insuranceDealWasMade',
    'finalBidderPoints',
    'finalDefenderPoints',
    'widowPointsValue',
    'bidType',
    'presentationReadyAt',
    'presentationForceReadyAt',
    'allConnectedHumansPresented',
    'settlementFailed',
    'drawOutcome',
];

const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isScalar = value => value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value));

const copyScalarFields = (source, fields) => {
    if (!isRecord(source)) return null;

    const result = {};
    fields.forEach(field => {
        if (Object.prototype.hasOwnProperty.call(source, field) && isScalar(source[field])) {
            result[field] = source[field];
        }
    });
    return result;
};

const copyScalarMap = source => {
    if (!isRecord(source)) return null;

    return Object.fromEntries(
        Object.entries(source).filter(([, value]) => isScalar(value)),
    );
};

const copyScalarArray = source => (
    Array.isArray(source) ? source.filter(isScalar) : null
);

const addObjectWhenPresent = (target, field, source, sanitizer) => {
    if (!isRecord(source)) return;
    target[field] = sanitizer(source);
};

const sanitizePlayers = players => Object.fromEntries(
    Object.entries(players).map(([playerId, player]) => [
        playerId,
        copyScalarFields(player, PLAYER_FIELDS) || {},
    ]),
);

const sanitizeInsuranceDetails = details => {
    const result = {};
    if (!isRecord(details?.agreement)) return result;

    result.agreement = copyScalarFields(details.agreement, [
        'bidderPlayerName',
        'bidderRequirement',
        'bidderSettlement',
    ]) || {};
    const defenderOffers = copyScalarMap(details.agreement.defenderOffers);
    if (defenderOffers) result.agreement.defenderOffers = defenderOffers;
    return result;
};

const sanitizeInsurance = insurance => {
    const result = copyScalarFields(insurance, INSURANCE_FIELDS) || {};
    const defenderOffers = copyScalarMap(insurance.defenderOffers);
    if (defenderOffers) result.defenderOffers = defenderOffers;
    addObjectWhenPresent(result, 'executedDetails', insurance.executedDetails, sanitizeInsuranceDetails);
    return result;
};

const sanitizeDrawRequest = drawRequest => {
    const result = copyScalarFields(drawRequest, ['isActive', 'initiator']) || {};
    const votes = copyScalarMap(drawRequest.votes);
    if (votes) result.votes = votes;
    return result;
};

const sanitizeRoundSummary = roundSummary => {
    const result = copyScalarFields(roundSummary, ROUND_SUMMARY_FIELDS) || {};

    ['finalScores', 'pointChanges'].forEach(field => {
        const value = copyScalarMap(roundSummary[field]);
        if (value) result[field] = value;
    });
    addObjectWhenPresent(result, 'insuranceDetails', roundSummary.insuranceDetails, sanitizeInsuranceDetails);
    addObjectWhenPresent(
        result,
        'forfeit',
        roundSummary.forfeit,
        value => copyScalarFields(value, ['forfeitingPlayerName', 'reason']) || {},
    );
    return result;
};

/**
 * Reduce a viewer-personalized game state to diagnostics that are safe to
 * attach to feedback. This is intentionally an allowlist: hands, widow cards,
 * trick cards, captured cards, token balances, socket ids, and future unknown
 * state fields cannot cross the feedback boundary by accident.
 */
export function sanitizeFeedbackGameContext(gameContext) {
    if (!isRecord(gameContext)) return null;

    const result = copyScalarFields(gameContext, TOP_LEVEL_SCALAR_FIELDS) || {};

    ['playerOrderActive', 'seatingOrder', 'playersWhoPassedThisRound'].forEach(field => {
        const value = copyScalarArray(gameContext[field]);
        if (value) result[field] = value;
    });

    const scores = copyScalarMap(gameContext.scores);
    if (scores) result.scores = scores;

    addObjectWhenPresent(result, 'players', gameContext.players, sanitizePlayers);
    addObjectWhenPresent(
        result,
        'currentHighestBidDetails',
        gameContext.currentHighestBidDetails,
        value => copyScalarFields(value, BID_FIELDS) || {},
    );
    addObjectWhenPresent(
        result,
        'bidWinnerInfo',
        gameContext.bidWinnerInfo,
        value => copyScalarFields(value, BID_FIELDS) || {},
    );
    addObjectWhenPresent(result, 'insurance', gameContext.insurance, sanitizeInsurance);
    addObjectWhenPresent(
        result,
        'forfeiture',
        gameContext.forfeiture,
        value => copyScalarFields(value, ['targetPlayerName', 'timeLeft']) || {},
    );
    addObjectWhenPresent(result, 'drawRequest', gameContext.drawRequest, sanitizeDrawRequest);
    addObjectWhenPresent(
        result,
        'settlement',
        gameContext.settlement,
        value => copyScalarFields(value, ['status', 'kind', 'attempts', 'lastErrorCode']) || {},
    );
    addObjectWhenPresent(result, 'roundSummary', gameContext.roundSummary, sanitizeRoundSummary);

    return result;
}
