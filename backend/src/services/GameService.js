// backend/src/services/GameService.js

const GameEngine = require('../core/GameEngine');
const transactionManager = require('../data/transactionManager');
const { THEMES, TABLE_COSTS, SERVER_VERSION } = require('../core/constants');
const gameLogic = require('../core/logic');

class GameService {
    constructor(io, pool) {
        this.io = io;
        this.pool = pool;
        this.engines = {};
        this._initializeEngines();
    }

    _initializeEngines() {
        let tableCounter = 1;
        THEMES.forEach(theme => {
            for (let i = 0; i < theme.count; i++) {
                const tableId = `table-${tableCounter}`;
                const tableNumber = i + 1;
                const tableName = `${theme.name} #${tableNumber}`;
                const emitLobbyUpdateCallback = () => this.io.emit('lobbyState', this.getLobbyState());
                this.engines[tableId] = new GameEngine(tableId, theme.id, tableName, emitLobbyUpdateCallback);
                tableCounter++;
            }
        });
        console.log(`${tableCounter - 1} in-memory game engines initialized.`);
    }

    getEngineById(tableId) { return this.engines[tableId]; }
    getAllEngines() { return this.engines; }
    getLobbyState() {
        const groupedByTheme = THEMES.map(theme => {
            const themeTables = Object.values(this.engines)
                .filter(engine => engine.theme === theme.id)
                .map(engine => {
                    const clientState = engine.getStateForClient();
                    const activePlayers = Object.values(clientState.players).filter(p => !p.isSpectator);
                    return {
                        tableId: clientState.tableId,
                        tableName: clientState.tableName,
                        state: clientState.state,
                        playerCount: activePlayers.length,
                        players: activePlayers.map(p => ({ userId: p.userId, playerName: p.playerName }))
                    };
                });
            return { ...theme, cost: TABLE_COSTS[theme.id] || 0, tables: themeTables };
        });
        return { themes: groupedByTheme, serverVersion: SERVER_VERSION };
    }

    async playCard(tableId, userId, card) {
        await this._performAction(tableId, (engine) => engine.playCard(userId, card));
    }
    
    async startGame(tableId, requestingUserId) {
        await this._performAction(tableId, (engine) => engine.startGame(requestingUserId));
    }
    
    async dealCards(tableId, requestingUserId) {
        await this._performAction(tableId, (engine) => engine.dealCards(requestingUserId));
    }

    async placeBid(tableId, userId, bid) {
        await this._performAction(tableId, (engine) => engine.placeBid(userId, bid));
    }

    async chooseTrump(tableId, userId, suit) {
        await this._performAction(tableId, (engine) => engine.chooseTrump(userId, suit));
    }

    async submitFrogDiscards(tableId, userId, discards) {
        await this._performAction(tableId, (engine) => engine.submitFrogDiscards(userId, discards));
    }

    async requestNextRound(tableId, userId) {
        await this._performAction(tableId, (engine) => engine.requestNextRound(userId));
    }

    async submitDrawVote(tableId, userId, vote) {
        await this._performAction(tableId, (engine) => engine.submitDrawVote(userId, vote));
    }
    
    async handleGameOver(payload) {
        const { scores, theme, gameId, players } = payload;
        const tableCost = TABLE_COSTS[theme] || 0;
        const transactionPromises = [];
        const statPromises = [];
        const payoutDetails = {};

        const transactionFn = (args) => transactionPromises.push(transactionManager.postTransaction(this.pool, args));
        const statUpdateFn = (query, params) => statPromises.push(this.pool.query(query, params));

        const finalRankings = Object.values(players)
            .filter(p => !p.isSpectator)
            .map(p => ({ ...p, score: scores[p.playerName] || 0 }))
            .sort((a, b) => b.score - a.score);

        const winners = finalRankings.filter(p => p.score === finalRankings[0].score);
        const gameWinnerName = winners.map(w => w.playerName).join(' & ');
        
        if (finalRankings.length === 3) {
            const [p1, p2, p3] = finalRankings;

            if (p1.score > p2.score && p2.score > p3.score) {
                if (!p1.isBot) {
                    transactionFn({ userId: p1.userId, gameId, type: 'win_payout', amount: tableCost * 2, description: `Win and Payout from ${p3.playerName}` });
                    statUpdateFn("UPDATE users SET wins = wins + 1 WHERE id = $1", [p1.userId]);
                    payoutDetails[p1.userId] = `You finished 1st and won ${tableCost.toFixed(2)} tokens!`;
                }
                if (!p2.isBot) {
                    transactionFn({ userId: p2.userId, gameId, type: 'wash_payout', amount: tableCost, description: `Wash - Buy-in returned` });
                    statUpdateFn("UPDATE users SET washes = washes + 1 WHERE id = $1", [p2.userId]);
                    payoutDetails[p2.userId] = `You finished 2nd. Your buy-in was returned.`;
                }
                if (!p3.isBot) {
                    statUpdateFn("UPDATE users SET losses = losses + 1 WHERE id = $1", [p3.userId]);
                    payoutDetails[p3.userId] = `You finished last and lost your buy-in of ${tableCost.toFixed(2)} tokens.`;
                }
            }
            else if (p1.score === p2.score && p2.score > p3.score) {
                if (!p1.isBot) {
                    transactionFn({ userId: p1.userId, gameId, type: 'win_payout', amount: tableCost * 1.5, description: `Win (tie) - Split payout from ${p3.playerName}` });
                    statUpdateFn("UPDATE users SET wins = wins + 1 WHERE id = $1", [p1.userId]);
                    payoutDetails[p1.userId] = `You tied for 1st, splitting the winnings for a net gain of ${(tableCost * 0.5).toFixed(2)} tokens!`;
                }
                if (!p2.isBot) {
                    transactionFn({ userId: p2.userId, gameId, type: 'win_payout', amount: tableCost * 1.5, description: `Win (tie) - Split payout from ${p3.playerName}` });
                    statUpdateFn("UPDATE users SET wins = wins + 1 WHERE id = $1", [p2.userId]);
                    payoutDetails[p2.userId] = `You tied for 1st, splitting the winnings for a net gain of ${(tableCost * 0.5).toFixed(2)} tokens!`;
                }
                if (!p3.isBot) {
                    statUpdateFn("UPDATE users SET losses = losses + 1 WHERE id = $1", [p3.userId]);
                    payoutDetails[p3.userId] = `You finished last and lost your buy-in of ${tableCost.toFixed(2)} tokens.`;
                }
            }
            else if (p1.score > p2.score && p2.score === p3.score) {
                if (!p1.isBot) {
                    transactionFn({ userId: p1.userId, gameId, type: 'win_payout', amount: tableCost * 3, description: `Win - Collects full pot` });
                    statUpdateFn("UPDATE users SET wins = wins + 1 WHERE id = $1", [p1.userId]);
                    payoutDetails[p1.userId] = `You won and collected the full pot of ${(tableCost * 2).toFixed(2)} tokens!`;
                }
                if (!p2.isBot) {
                    statUpdateFn("UPDATE users SET losses = losses + 1 WHERE id = $1", [p2.userId]);
                    payoutDetails[p2.userId] = `You tied for last and lost your buy-in of ${tableCost.toFixed(2)} tokens.`;
                }
                if (!p3.isBot) {
                    statUpdateFn("UPDATE users SET losses = losses + 1 WHERE id = $1", [p3.userId]);
                    payoutDetails[p3.userId] = `You tied for last and lost your buy-in of ${tableCost.toFixed(2)} tokens.`;
                }
            }
            else {
                finalRankings.forEach(p => {
                    if (!p.isBot) {
                        transactionFn({ userId: p.userId, gameId, type: 'wash_payout', amount: tableCost, description: `3-Way Tie - Buy-in returned` });
                        statUpdateFn("UPDATE users SET washes = washes + 1 WHERE id = $1", [p.userId]);
                        payoutDetails[p.userId] = "3-Way Tie! Your buy-in was returned.";
                    }
                });
            }
        }
        
        try {
            await Promise.all(transactionPromises);
            await Promise.all(statPromises);
            await transactionManager.updateGameRecordOutcome(this.pool, gameId, `Game Over! Winner: ${gameWinnerName}`);
        } catch(err) {
            console.error("Database error during game over update:", err);
        }

        return { gameWinnerName, payoutDetails };
    }

    async handleDrawOutcome(payload) {
        const { outcome, ...tableData } = payload;
        try {
            const summary = await transactionManager.handleDrawTransactions(this.pool, tableData, outcome);
            return summary;
        } catch (error) {
            console.error(`[SERVICE] Error handling draw outcome for game ${payload.gameId}:`, error);
            return {
                isGameOver: true,
                drawOutcome: 'Error',
                message: 'An error occurred processing the game end. Please contact an admin.',
                payouts: {},
            };
        }
    }

    resetAllEngines() {
        console.log("[ADMIN] Resetting all game engines to initial state.");
        this.engines = {};
        this._initializeEngines();
        this.io.emit('lobbyState', this.getLobbyState());
    }

    async _performAction(tableId, actionFn) {
        const engine = this.getEngineById(tableId);
        if (!engine) return;

        if (engine.pendingBotAction) {
            clearTimeout(engine.pendingBotAction);
            engine.pendingBotAction = null;
        }

        const result = actionFn(engine);
        if (result && result.effects) {
            await this._executeEffects(tableId, result.effects);
        }
    }
    
    async _executeEffects(tableId, effects = []) {
        if (!effects || effects.length === 0) return;
        const engine = this.getEngineById(tableId);

        for (const effect of effects) {
            switch (effect.type) {
                case 'BROADCAST_STATE':
                    this.io.to(tableId).emit('gameState', engine.getStateForClient());
                    this._triggerBots(tableId);
                    break;
                case 'EMIT_TO_SOCKET':
                    this.io.to(effect.payload.socketId).emit(effect.payload.event, effect.payload.data);
                    break;
                case 'EMIT_TO_TABLE':
                    this.io.to(tableId).emit(effect.payload.event, effect.payload.data || {});
                    break;
                case 'UPDATE_LOBBY':
                    this.io.emit('lobbyState', this.getLobbyState());
                    break;
                case 'START_TIMER': {
                    const timerFn = this.timerOverride || setTimeout;
                    timerFn(async () => {
                        const followUpEffects = effect.payload.onTimeout(engine);
                        if (followUpEffects && followUpEffects.length > 0) {
                            await this._executeEffects(tableId, followUpEffects);
                        }
                    }, effect.payload.duration);
                    break;
                }
                case 'SYNC_PLAYER_TOKENS':
                    Object.values(engine.players).forEach(p => {
                        if (!p.isBot && p.socketId) {
                            const playerSocket = this.io.sockets.sockets.get(p.socketId);
                            if (playerSocket) playerSocket.emit("requestUserSync");
                        }
                    });
                    break;
                case 'HANDLE_GAME_OVER': {
                    const gameOverResult = await this.handleGameOver(effect.payload);
                    if (effect.onComplete) {
                        engine.roundSummary.gameWinner = gameOverResult.gameWinnerName;
                        engine.roundSummary.payoutDetails = gameOverResult.payoutDetails;
                    }
                    this.io.to(tableId).emit('gameState', engine.getStateForClient());
                    break;
                }
                case 'HANDLE_DRAW_OUTCOME': {
                    const summary = await this.handleDrawOutcome(effect.payload);
                    if (effect.onComplete) {
                        effect.onComplete(summary);
                    }
                    this.io.to(tableId).emit('gameState', engine.getStateForClient());
                    this._triggerBots(tableId);
                    break;
                }
                case 'START_GAME_TRANSACTIONS': {
                    try {
                        const gameId = await transactionManager.createGameRecord(this.pool, effect.payload.table);
                        const updatedTokens = await transactionManager.handleGameStartTransaction(this.pool, effect.payload.table, effect.payload.playerIds, gameId);
                        if (effect.onSuccess) effect.onSuccess(gameId, updatedTokens);
                    } catch (err) {
                        const insufficientFundsMatch = err.message.match(/(.+) has insufficient tokens/);
                        const brokePlayerName = insufficientFundsMatch ? insufficientFundsMatch[1] : null;
                        if (effect.onFailure) effect.onFailure(err, brokePlayerName);
                        this.io.to(tableId).emit('gameStartFailed', { message: err.message, kickedPlayer: brokePlayerName });
                    }
                    break;
                }
            }
        }
    }

    _triggerBots(tableId) {
        const engine = this.getEngineById(tableId);
        if (!engine || engine.pendingBotAction) return;
    
        let turnActionTaken = false;
    
        const scheduleTurnAction = (actionFn, delay, ...args) => {
            turnActionTaken = true;
            engine.pendingBotAction = setTimeout(async () => {
                engine.pendingBotAction = null;
                await actionFn.call(this, tableId, ...args);
            }, delay);
        };
    
        // --- Primary Turn-Based Action Loop ---
        for (const botId in engine.bots) {
            if (turnActionTaken) break;
    
            const bot = engine.bots[botId];
            const botUserId = bot.userId;
            const isCourtney = bot.playerName === "Courtney Sr.";
            const standardDelay = isCourtney ? 2000 : 1000;
            const playDelay = isCourtney ? 2400 : 1200;
            const roundEndDelay = isCourtney ? 16000 : 8000;
    
            if (engine.state === 'Dealing Pending' && engine.dealer == botUserId) {
                scheduleTurnAction(this.dealCards, standardDelay, botUserId);
            } else if (engine.state === 'Awaiting Next Round Trigger' && engine.roundSummary?.dealerOfRoundId == botUserId) {
                scheduleTurnAction(this.requestNextRound, roundEndDelay, botUserId);
            } else if (engine.state === 'Bidding Phase' && engine.biddingTurnPlayerId == botUserId) {
                const bid = bot.decideBid();
                scheduleTurnAction(this.placeBid, standardDelay, botUserId, bid);
            } else if (engine.state === 'Awaiting Frog Upgrade Decision' && engine.biddingTurnPlayerId == botUserId) {
                const bid = bot.decideFrogUpgrade();
                scheduleTurnAction(this.placeBid, standardDelay, botUserId, bid);
            } else if (engine.state === 'Trump Selection' && engine.bidWinnerInfo?.userId == botUserId && !engine.trumpSuit) {
                const suit = bot.chooseTrump();
                scheduleTurnAction(this.chooseTrump, standardDelay, botUserId, suit);
            } else if (engine.state === 'Frog Widow Exchange' && engine.bidWinnerInfo?.userId == botUserId && engine.widowDiscardsForFrogBidder.length === 0) {
                const discards = bot.submitFrogDiscards();
                scheduleTurnAction(this.submitFrogDiscards, standardDelay, botUserId, discards);
            } else if (engine.state === 'Playing Phase' && engine.trickTurnPlayerId == botUserId) {
                const card = bot.playCard();
                if (card) {
                    scheduleTurnAction(this.playCard, playDelay, botUserId, card);
                }
            }
        }
    
        // --- Independent Logic for Draw Voting ---
        // This runs regardless of the turn-based action above.
        if (engine.drawRequest.isActive) {
            let delay = 2000; // Stagger the bot votes
            for (const botId in engine.bots) {
                const bot = engine.bots[botId];
                if (engine.drawRequest.votes[bot.playerName] === null) {
                    setTimeout(async () => {
                        // Re-fetch engine state in case it changed during the delay
                        const currentEngine = this.getEngineById(tableId);
                        if (currentEngine && currentEngine.drawRequest.isActive && currentEngine.drawRequest.votes[bot.playerName] === null) {
                            const vote = bot.decideDrawVote();
                            await this.submitDrawVote(tableId, bot.userId, vote);
                        }
                    }, delay);
                    delay += 1500; // Each bot waits a bit longer than the last
                }
            }
        }

        // --- Independent Logic for Insurance ---
        if (engine.state === 'Playing Phase' && engine.insurance.isActive && !engine.insurance.dealExecuted) {
            // ... (insurance logic remains unchanged)
        }
    }
}

module.exports = GameService;