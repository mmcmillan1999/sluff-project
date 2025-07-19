// NEW FILE: backend/src/core/handlers/scoringHandler.js

const gameLogic = require('../logic');

/**
 * Calculates the scores at the end of a round and prepares the summary.
 * @param {GameEngine} engine - The instance of the game engine.
 * @returns {Array} An array of effects to be executed.
 */
function calculateRoundScores(engine) {
    const effects = [];
    const roundData = gameLogic.calculateRoundScoreDetails(engine);

    for (const playerName in roundData.pointChanges) {
        if (engine.scores[playerName] !== undefined) {
            engine.scores[playerName] += roundData.pointChanges[playerName];
        }
    }
    
    const isGameOver = Object.values(engine.scores).some(score => score <= 0);
    
    engine.state = isGameOver ? "Game Over" : "Awaiting Next Round Trigger";

    if (isGameOver) {
        effects.push({
            type: 'HANDLE_GAME_OVER',
            payload: { /* ... payload data ... */ },
            onComplete: (gameWinnerName) => {
                engine.roundSummary.gameWinner = gameWinnerName;
            }
        });
    }

    engine.roundSummary = { /* ... create summary object ... */ };

    effects.push({ type: 'SYNC_PLAYER_TOKENS', payload: { playerIds: Object.keys(engine.players) } });
    effects.push({ type: 'BROADCAST_STATE' });
    
    return effects;
}

module.exports = {
    calculateRoundScores,
};