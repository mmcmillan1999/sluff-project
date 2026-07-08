// backend/src/core/PlayerList.js

class PlayerList {
    constructor() {
        // The core of this class: a simple array to preserve join order.
        this._playerIds = [];
        this._turnOrder = [];
    }

    get count() {
        return this._playerIds.length;
    }

    get allIds() {
        return [...this._playerIds];
    }
    
    get turnOrder() {
        return [...this._turnOrder];
    }

    add(playerId) {
        if (!this._playerIds.includes(playerId)) {
            this._playerIds.push(playerId);
        }
    }

    remove(playerId) {
        console.log(`[PLAYERLIST] Removing player ${playerId} from [${this._playerIds.join(', ')}]`);
        this._playerIds = this._playerIds.filter(id => id !== playerId);
        this._turnOrder = this._turnOrder.filter(id => id !== playerId);
        console.log(`[PLAYERLIST] After removal: [${this._playerIds.join(', ')}]`);
    }
    
    includes(playerId) {
        return this._playerIds.includes(playerId);
    }

    /**
     * Sets the turn order based on the dealer's position.
     * This is the ONLY place where the order is shuffled/recalculated.
     * @param {number} dealerId
     * @param {boolean} excludeDealer - 4-player mode: the dealer sits the
     *   round out, so they are omitted from the turn order (they still deal
     *   and still appear in allIds/seating). See docs/FOUR_PLAYER_SPEC.md.
     */
    setTurnOrder(dealerId, excludeDealer = false) {
        let activePlayers = [...this._playerIds];
        let dealerIndex = activePlayers.indexOf(dealerId);

        if (dealerIndex === -1) { // Safety check
            if (activePlayers.length > 0) {
                dealerIndex = 0;
            } else {
                this._turnOrder = [];
                return;
            }
        }

        const orderedIds = [];
        for (let i = 1; i <= activePlayers.length; i++) {
            orderedIds.push(activePlayers[(dealerIndex + i) % activePlayers.length]);
        }
        this._turnOrder = excludeDealer
            ? orderedIds.filter(id => id !== activePlayers[dealerIndex])
            : orderedIds;
    }
}

module.exports = PlayerList;