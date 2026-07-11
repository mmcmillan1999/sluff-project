'use strict';

const { BID_HIERARCHY, deck } = require('../core/constants');

const CARD_SET = new Set(deck);

function authorizeTableAction(socket, gameService, payload, options = {}) {
    const {
        adminOnly = false,
        allowSpectator = false,
        requireMembership = true,
        validate,
    } = options;

    if (!isPlainObject(payload)) return reject(socket, 'Invalid action payload.');
    const { tableId } = payload;
    if (typeof tableId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(tableId)) {
        return reject(socket, 'Invalid table id.');
    }

    const engine = gameService.getEngineById(tableId);
    if (!engine) return reject(socket, 'Table not found.');
    if (adminOnly && socket.user?.is_admin !== true) {
        return reject(socket, 'Admin privileges required.');
    }

    const player = engine.players?.[socket.user?.id];
    if (requireMembership && !player) return reject(socket, 'You are not at this table.');
    if (requireMembership && player.socketId !== socket.id) {
        return reject(socket, 'This connection no longer controls that table seat.');
    }
    if (player?.isSpectator && !allowSpectator) {
        return reject(socket, 'Spectators cannot perform this action.');
    }

    if (validate) {
        const validationError = validate(payload, { engine, player, socket });
        if (validationError) return reject(socket, validationError);
    }

    return { engine, player, payload };
}

function reject(socket, message) {
    socket.emit('error', { message });
    return null;
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const validators = {
    card: payload => CARD_SET.has(payload.card) ? null : 'Invalid card.',
    bid: payload => BID_HIERARCHY.includes(payload.bid) ? null : 'Invalid bid.',
    trump: payload => ['S', 'C', 'D'].includes(payload.suit) ? null : 'Invalid trump suit.',
    frogDiscards: payload => (
        Array.isArray(payload.discards)
        && payload.discards.length === 3
        && new Set(payload.discards).size === 3
        && payload.discards.every(card => CARD_SET.has(card))
    ) ? null : 'Choose three unique valid cards to discard.',
    drawVote: payload => ['wash', 'split', 'no'].includes(payload.vote) ? null : 'Invalid draw vote.',
    insurance: payload => (
        ['bidderRequirement', 'defenderOffer'].includes(payload.settingType)
        && Number.isInteger(Number(payload.value))
    ) ? null : 'Invalid insurance setting.',
    targetPlayer: payload => (
        typeof payload.targetPlayerName === 'string'
        && payload.targetPlayerName.length > 0
        && payload.targetPlayerName.length <= 64
    ) ? null : 'Invalid target player.',
    presentationAck: payload => (
        typeof payload.presentationReadyAt === 'number'
        && Number.isSafeInteger(payload.presentationReadyAt)
        && payload.presentationReadyAt > 0
    ) ? null : 'Invalid round presentation acknowledgement.',
    roundAdvance: (_payload, { engine }) => (
        engine.state === 'Awaiting Next Round Trigger'
        && !engine.isRoundPresentationAdvanceReady()
    ) ? 'The round presentation is still finishing.' : null,
    terminalReset: (_payload, { engine }) => {
        if (!['Game Over', 'DrawComplete'].includes(engine.state)) {
            return 'The table can only be reset after the game ends.';
        }
        if (engine.settlement && engine.settlement.status !== 'complete') {
            return 'The table cannot reset until settlement commits.';
        }
        if (!engine.isRoundPresentationAdvanceReady()) {
            return 'The final results presentation is still finishing.';
        }
        return null;
    },
};

module.exports = {
    authorizeTableAction,
    isPlainObject,
    validators,
};
