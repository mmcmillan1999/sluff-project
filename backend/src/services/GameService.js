    // backend/src/services/GameService.js

    const GameEngine = require('../core/GameEngine');
    const transactionManager = require('../data/transactionManager');
    const { THEMES, TABLE_COSTS, SERVER_VERSION } = require('../core/constants');
    const gameLogic = require('../core/logic');
    const AdaptiveInsuranceStrategy = require('../core/bot-strategies/AdaptiveInsuranceStrategy');

    class GameService {
        constructor(io, pool) {
            this.io = io;
            this.pool = pool;
            this.engines = {};
            this.adaptiveInsurance = new AdaptiveInsuranceStrategy(pool, io);
            this._initializeEngines();

            // --- THE NEW GAME LOOP HEARTBEAT ---
            // This runs every 1.5 seconds to check if any bots need to act.
            setInterval(() => {
                for (const tableId in this.engines) {
                    const engine = this.engines[tableId];
                    if (engine.gameStarted) {
                        this._triggerBots(tableId);
                    }
                }
            }, 1500);
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
                        // --- THE FIX: No longer call _triggerBots here. ---
                        
                        // Log insurance hindsight values for bots when round ends
                        if (engine.roundSummary && engine.roundSummary.insuranceHindsight && engine.gameId) {
                            console.log(`[Insurance] Round ended with hindsight data for game ${engine.gameId}`);
                            console.log(`[Insurance] Insurance was active:`, engine.insurance.isActive);
                            console.log(`[Insurance] Deal executed:`, engine.insurance.dealExecuted);
                            console.log(`[Insurance] Hindsight data:`, engine.roundSummary.insuranceHindsight);
                            // Store the hindsight data before setTimeout since roundSummary might be cleared
                            const hindsightDataSnapshot = { ...engine.roundSummary.insuranceHindsight };
                            setTimeout(async () => {
                                for (const botId in engine.bots) {
                                    const bot = engine.bots[botId];
                                    const hindsightData = hindsightDataSnapshot[bot.playerName];
                                    if (hindsightData) {
                                        console.log(`[Insurance] Bot ${bot.playerName} hindsight:`, hindsightData);
                                        // Log the decision
                                        await this.adaptiveInsurance.logInsuranceDecision(
                                            engine.gameId,
                                            bot.playerName,
                                            engine,
                                            engine.insurance.dealExecuted,
                                            hindsightData.hindsightValue
                                        );
                                        
                                        // Have bot comment on their learning
                                        if (hindsightData.hindsightValue < -20) {
                                            const messages = [
                                                `You got me this time! I wasted ${Math.abs(hindsightData.hindsightValue)} points by ${engine.insurance.dealExecuted ? 'making' : 'not making'} that deal at trick ${engine.tricksPlayedCount}.`,
                                                `Ouch! That insurance ${engine.insurance.dealExecuted ? 'deal' : 'decision'} cost me ${Math.abs(hindsightData.hindsightValue)} points. My circuits are adjusting...`,
                                                `Well played! I'm learning that trick ${engine.tricksPlayedCount} is too ${engine.tricksPlayedCount <= 3 ? 'early' : 'late'} for those kinds of deals.`,
                                                `${Math.abs(hindsightData.hindsightValue)} points down the drain! Next time I'll be smarter about ${engine.tricksPlayedCount <= 3 ? 'early' : engine.tricksPlayedCount <= 7 ? 'mid' : 'late'}-game insurance.`
                                            ];
                                            const message = messages[Math.floor(Math.random() * messages.length)];
                                            // Use new_lobby_message event that frontend is listening for
                                            this.io.emit('new_lobby_message', {
                                                id: Date.now(),
                                                username: bot.playerName,
                                                message: message,
                                                created_at: new Date().toISOString()
                                            });
                                        } else if (hindsightData.hindsightValue > 20) {
                                            const messages = [
                                                `Ha! My insurance strategy saved me ${hindsightData.hindsightValue} points that round!`,
                                                `My neural network is pleased - that ${engine.insurance.dealExecuted ? 'deal' : 'decision'} gained me ${hindsightData.hindsightValue} points!`,
                                                `Experience pays off! Making the right call at trick ${engine.tricksPlayedCount} saved me ${hindsightData.hindsightValue} points.`
                                            ];
                                            const message = messages[Math.floor(Math.random() * messages.length)];
                                            // Use new_lobby_message event that frontend is listening for
                                            this.io.emit('new_lobby_message', {
                                                id: Date.now(),
                                                username: bot.playerName,
                                                message: message,
                                                created_at: new Date().toISOString()
                                            });
                                        }
                                    }
                                }
                            }, 3000); // Delay so it appears after round summary
                        }
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
                        break;
                    }
                    case 'START_GAME_TRANSACTIONS': {
                        try {
                            const gameId = await transactionManager.createGameRecord(this.pool, effect.payload.table);
                            console.log(`[GAME-START] Created game record with ID: ${gameId}`);
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
        
            // Helper function to check if game is human vs bot only
            const isHumanVsBotOnly = () => {
                const humanPlayers = Object.values(engine.players).filter(p => !p.isBot && !p.isSpectator);
                return humanPlayers.length === 1;
            };
        
            let turnActionTaken = false;
        
            const scheduleTurnAction = (actionFn, delay, ...args) => {
                turnActionTaken = true;
                engine.pendingBotAction = setTimeout(async () => {
                    engine.pendingBotAction = null;
                    await actionFn.call(this, tableId, ...args);
                    // Re-trigger bot check after action completes
                    setTimeout(() => {
                        this._triggerBots(tableId);
                    }, 100);
                }, delay);
            };
        
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
                } else if (engine.state === 'Awaiting Next Round Trigger') {
                    // Check if this bot should trigger next round
                    if (engine.roundSummary && engine.roundSummary.dealerOfRoundId == botUserId) {
                        console.log(`[BOT] ${bot.playerName} scheduling next round trigger as dealer`);
                        scheduleTurnAction(this.requestNextRound, roundEndDelay, botUserId);
                    } else if (!engine.roundSummary) {
                        // Round summary not ready yet, will retry on next interval
                        console.log(`[BOT] Waiting for round summary to be set before next round trigger`);
                    }
                } else if (engine.state === 'Game Over') {
                    // Handle game over state - reset the game after a delay
                    // Only do this once per game (check if no other bot has scheduled it)
                    if (!engine.gameOverHandled) {
                        engine.gameOverHandled = true;
                        console.log(`[BOT] Game Over detected on table ${tableId}. Resetting in 10 seconds...`);
                        setTimeout(() => {
                            const currentEngine = this.getEngineById(tableId);
                            if (currentEngine && currentEngine.state === 'Game Over') {
                                console.log(`[BOT] Resetting game on table ${tableId}`);
                                currentEngine.reset();
                                this.io.to(tableId).emit('gameState', currentEngine.getStateForClient());
                                this.io.emit('lobbyState', this.getLobbyState());
                                
                                // If all players are bots, start a new game automatically
                                const allBots = Object.values(currentEngine.players).every(p => p.isBot && !p.isSpectator);
                                if (allBots && currentEngine.playerOrder.count === 3) {
                                    setTimeout(() => {
                                        const engine = this.getEngineById(tableId);
                                        if (engine && engine.state === 'Ready to Start') {
                                            console.log(`[BOT] Starting new bot-only game on table ${tableId}`);
                                            const firstBot = Object.values(engine.players).find(p => p.isBot && !p.isSpectator);
                                            if (firstBot) {
                                                this._performAction(tableId, (eng) => eng.startGame(firstBot.userId));
                                            }
                                        }
                                    }, 3000);
                                }
                            }
                        }, 10000); // 10 second delay before reset
                    }
                    break; // Exit the loop since we've handled game over
                } else if (engine.state === 'Bidding Phase' && engine.biddingTurnPlayerId == botUserId) {
                    const bid = bot.decideBid();
                    console.log(`[BOT-BID] ${bot.playerName} is bidding: ${bid}`);
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
        
            if (engine.drawRequest.isActive) {
                let delay = 2000;
                for (const botId in engine.bots) {
                    const bot = engine.bots[botId];
                    if (engine.drawRequest.votes[bot.playerName] === null) {
                        setTimeout(async () => {
                            const currentEngine = this.getEngineById(tableId);
                            if (currentEngine && currentEngine.drawRequest.isActive && currentEngine.drawRequest.votes[bot.playerName] === null) {
                                const vote = bot.decideDrawVote();
                                await this.submitDrawVote(tableId, bot.userId, vote);
                            }
                        }, delay);
                        delay += 1500;
                    }
                }
            }

            if (engine.state === 'Playing Phase' && engine.insurance.isActive && !engine.insurance.dealExecuted) {
                console.log(`[INSURANCE] Processing insurance for table ${tableId} - ${Object.keys(engine.bots).length} bots`);
                let insuranceDelay = 500;
                for (const botId in engine.bots) {
                    const bot = engine.bots[botId];
                    setTimeout(async () => {
                        const currentEngine = this.getEngineById(tableId);
                        if (currentEngine && currentEngine.insurance.isActive && !currentEngine.insurance.dealExecuted) {
                            console.log(`[INSURANCE] Bot ${bot.playerName} making insurance decision`);
                            // Use adaptive strategy instead of fixed strategy
                            const decision = await this.adaptiveInsurance.calculateInsuranceMove(currentEngine, bot);
                            if (decision) {
                                currentEngine.updateInsuranceSetting(bot.userId, decision.settingType, decision.value);
                                this.io.to(tableId).emit('gameState', currentEngine.getStateForClient());
                                
                                // Log the decision for learning
                                console.log(`[INSURANCE] Logging decision for ${bot.playerName}, gameId: ${currentEngine.gameId}`);
                                if (currentEngine.gameId) {
                                    await this.adaptiveInsurance.logInsuranceDecision(
                                        currentEngine.gameId,
                                        bot.playerName,
                                        currentEngine,
                                        false, // deal not executed yet
                                        null // hindsight value will be calculated later
                                    );
                                } else {
                                    console.log(`[INSURANCE] WARNING: No gameId available for logging`);
                                }
                            }
                        }
                    }, insuranceDelay);
                    insuranceDelay += 750;
                }
            }
        }
    }

    module.exports = GameService;