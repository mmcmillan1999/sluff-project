import React, { useState } from 'react';
import '../styles/AdminObserverMode.css';

const AdminObserverMode = ({ 
  players, 
  currentObservedPlayer, 
  onPlayerSwitch, 
  onStartBotGame,
  onMoveToSpectator,
  gameInProgress,
  isAdmin,
  isSpectator,
  userId
}) => {
  const [showControls, setShowControls] = useState(false);

  console.log('[DEBUG] AdminObserverMode render - isAdmin:', isAdmin);
  console.log('[DEBUG] AdminObserverMode render - players:', players);
  console.log('[DEBUG] AdminObserverMode render - gameInProgress:', gameInProgress);
  console.log('[DEBUG] AdminObserverMode render - isSpectator:', isSpectator);

  if (!isAdmin) {
    console.log('[DEBUG] AdminObserverMode - returning null because isAdmin is false');
    return null;
  }

  const botPlayers = players.filter(p => p.isBot);
  const hasEnoughBots = botPlayers.length >= 3;

  console.log('[DEBUG] AdminObserverMode - RENDERING the component');

  return (
    <div className="admin-observer-mode">
      <button 
        className="observer-toggle"
        onClick={() => setShowControls(!showControls)}
      >
        👁️ Observer Mode
      </button>

      {showControls && (
        <div className="observer-controls">
          <h3>Admin Observer Controls</h3>
          
          {!gameInProgress && (
            <div className="start-bot-game">
              {!isSpectator && (
                <button 
                  className="move-to-spectator-btn"
                  onClick={onMoveToSpectator}
                  style={{ marginBottom: '10px' }}
                >
                  👁️ Move to Spectator Seat
                </button>
              )}
              {hasEnoughBots ? (
                <button 
                  className="start-bot-game-btn"
                  onClick={onStartBotGame}
                >
                  🤖 Start 3-Bot Game
                </button>
              ) : (
                <p className="not-enough-bots">
                  Need at least 3 bots to start observer game
                </p>
              )}
            </div>
          )}

          {gameInProgress && (
            <div className="perspective-switcher">
              <h4>View Perspective:</h4>
              {isSpectator && !currentObservedPlayer && (
                <p style={{color: '#ff6b6b', fontWeight: 'bold', margin: '10px 0'}}>
                  ⚠️ Select a player below to see their cards and perspective!
                </p>
              )}
              <div className="player-perspectives">
                {players.filter(p => !p.isSpectator).map(player => {
                  console.log('[ADMIN] Player in perspective switcher:', player);
                  return (
                    <button
                      key={player.userId}
                      className={`perspective-btn ${
                        currentObservedPlayer === player.userId ? 'active' : ''
                      } ${player.isBot ? 'bot' : 'human'}`}
                      onClick={() => {
                        console.log('[ADMIN] Switching to player:', player.playerName, 'ID:', player.userId);
                        onPlayerSwitch(player.userId);
                      }}
                    >
                      <span className="player-icon">
                        {player.isBot ? '🤖' : '👤'}
                      </span>
                      <span className="player-name">{player.playerName}</span>
                      {currentObservedPlayer === player.userId && (
                        <span className="viewing-indicator">👁️</span>
                      )}
                    </button>
                  );
                })}
              </div>
              
              <div className="observer-info">
                <p>Currently viewing: <strong>{
                  players.find(p => p.userId === currentObservedPlayer)?.playerName || 'None'
                }</strong></p>
                <p className="observer-tip">
                  Click any player to see their cards and perspective
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AdminObserverMode;