// backend/src/utils/stateValidator.js

/**
 * Validates game engine state for consistency and potential issues
 * @param {GameEngine} engine - The game engine to validate
 * @returns {Object} Validation result with issues array
 */
const validateGameState = (engine) => {
    const issues = [];
    const warnings = [];

    try {
        // Validate player order consistency
        const playerOrderIds = engine.playerOrder.allIds;
        const playerIds = Object.keys(engine.players).map(id => parseInt(id, 10));
        
        // Check for players in playerOrder but not in players object
        for (const orderId of playerOrderIds) {
            if (!engine.players[orderId]) {
                issues.push(`Player ${orderId} exists in playerOrder but not in players object`);
            }
        }

        // Check for active players not in playerOrder
        for (const playerId of playerIds) {
            const player = engine.players[playerId];
            if (player && !player.isSpectator && !player.disconnected) {
                if (!playerOrderIds.includes(playerId)) {
                    issues.push(`Active player ${playerId} (${player.playerName}) not in playerOrder`);
                }
            }
        }

        // Validate dealer exists and is in playerOrder
        if (engine.gameStarted && engine.dealer) {
            if (!engine.players[engine.dealer]) {
                issues.push(`Dealer ${engine.dealer} does not exist in players`);
            } else if (!playerOrderIds.includes(engine.dealer)) {
                issues.push(`Dealer ${engine.dealer} not in playerOrder`);
            }
        }

        // Validate bot consistency
        for (const botId in engine.bots) {
            if (!engine.players[botId]) {
                issues.push(`Bot ${botId} exists in bots but not in players`);
            } else if (!engine.players[botId].isBot) {
                issues.push(`Player ${botId} in bots but not marked as bot`);
            }
        }

        // Check for bot players not in bots object
        for (const playerId in engine.players) {
            const player = engine.players[playerId];
            if (player.isBot && !engine.bots[playerId]) {
                issues.push(`Player ${playerId} marked as bot but not in bots object`);
            }
        }

        // Validate scores consistency
        for (const playerId in engine.players) {
            const player = engine.players[playerId];
            if (!player.isSpectator && engine.scores[player.playerName] === undefined) {
                warnings.push(`Player ${player.playerName} has no score entry`);
            }
        }

        // Validate timer states
        if (engine.drawRequest.isActive && !engine.internalTimers.drawTimer) {
            warnings.push('Draw request is active but no draw timer is set');
        }

        if (engine.forfeiture.targetPlayerName && !engine.internalTimers.forfeit) {
            warnings.push('Forfeit target set but no forfeit timer is active');
        }

        // Validate turn player exists
        if (engine.gameStarted) {
            if (engine.biddingTurnPlayerId && !engine.players[engine.biddingTurnPlayerId]) {
                issues.push(`Bidding turn player ${engine.biddingTurnPlayerId} does not exist`);
            }
            if (engine.trickTurnPlayerId && !engine.players[engine.trickTurnPlayerId]) {
                issues.push(`Trick turn player ${engine.trickTurnPlayerId} does not exist`);
            }
        }

    } catch (error) {
        issues.push(`State validation error: ${error.message}`);
    }

    return {
        isValid: issues.length === 0,
        issues,
        warnings,
        summary: `${issues.length} issues, ${warnings.length} warnings`
    };
};

/**
 * Logs validation results
 * @param {string} tableId - Table identifier
 * @param {Object} validation - Validation result
 */
const logValidationResults = (tableId, validation) => {
    if (!validation.isValid) {
        console.error(`[${tableId}] State validation failed: ${validation.summary}`);
        validation.issues.forEach(issue => console.error(`[${tableId}] ISSUE: ${issue}`));
    }
    
    if (validation.warnings.length > 0) {
        console.warn(`[${tableId}] State warnings: ${validation.warnings.length}`);
        validation.warnings.forEach(warning => console.warn(`[${tableId}] WARNING: ${warning}`));
    }
};

/**
 * Validates and logs game state, optionally throwing on critical issues
 * @param {GameEngine} engine - The game engine to validate
 * @param {boolean} throwOnIssues - Whether to throw an error if issues are found
 * @returns {Object} Validation result
 */
const validateAndReport = (engine, throwOnIssues = false) => {
    const validation = validateGameState(engine);
    logValidationResults(engine.tableId, validation);
    
    if (throwOnIssues && !validation.isValid) {
        throw new Error(`Game state validation failed for table ${engine.tableId}: ${validation.issues.join(', ')}`);
    }
    
    return validation;
};

module.exports = {
    validateGameState,
    logValidationResults,
    validateAndReport
};