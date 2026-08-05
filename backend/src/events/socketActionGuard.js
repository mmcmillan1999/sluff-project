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
        // Self-heal with newest-wins semantics, mirroring the connect-time
        // reseat policy: the owner's NEWER connection may take the seat over
        // a dead, zombie, or older registered socket (exactly what a manual
        // refresh achieves), while an older tab can never snatch the seat
        // back from a live newer controller. resumePending covers a seat
        // restored from a deploy snapshot that no connection has claimed
        // yet. Without an io registry nothing is provable, so fail closed.
        const socketsMap = gameService.io?.sockets?.sockets;
        const registeredSocket = player.socketId ? socketsMap?.get?.(player.socketId) : null;
        const registeredAlive = Boolean(registeredSocket && registeredSocket.connected !== false);
        const actingIssued = Number(socket.handshake?.issued) || 0;
        const registeredIssued = Number(registeredSocket?.handshake?.issued) || 0;
        const mayAdopt = player.resumePending === true
            || (Boolean(socketsMap) && (!registeredAlive || actingIssued > registeredIssued));
        if (!mayAdopt) {
            // Compact forensics for the next occurrence: which condition
            // failed and how the two connections compared.
            gameService.pool?.query?.(
                'INSERT INTO funnel_events (name, session_id) VALUES ($1, $2)',
                ['seat_guard_reject', [
                    `u${socket.user?.id}`,
                    `rp${player.resumePending ? 1 : 0}`,
                    `reg${registeredSocket ? (registeredAlive ? 'A' : 'D') : 'X'}`,
                    `ai${actingIssued % 1e7}`,
                    `ri${registeredIssued % 1e7}`,
                ].join(' ').slice(0, 64)],
            ).catch(() => {});
            return reject(socket, 'This connection no longer controls that table seat.');
        }
        socket.join?.(engine.tableId);
        engine.reconnectPlayer(socket.user.id, socket);
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
    playoutVote: payload => ['play', 'wrap'].includes(payload.vote) ? null : 'Invalid playout vote.',
    rematchVote: payload => ['accept', 'decline'].includes(payload.vote) ? null : 'Invalid rematch vote.',
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
