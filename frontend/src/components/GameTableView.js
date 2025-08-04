// frontend/src/components/GameTableView.js
import React, { useState, useEffect, useRef, useCallback } from 'react';
import './GameTableView.css';
import DrawVoteModal from './game/DrawVoteModal';
import PlayerHand from './game/PlayerHand';
import InsuranceControls from './game/InsuranceControls';
import RoundSummaryModal from './game/RoundSummaryModal';
import TableLayout from './game/TableLayout';
import PlayerSeat from './game/PlayerSeat';
import ActionControls from './game/ActionControls';
import InsurancePrompt from './game/InsurancePrompt';
import IosPwaPrompt from './game/IosPwaPrompt';
import LobbyChat from './LobbyChat';
import AdminObserverMode from './AdminObserverMode';
import { getLobbyChatHistory } from '../services/api';
import { SUIT_SYMBOLS, SUIT_COLORS, SUIT_BACKGROUNDS } from '../constants';

const GameTableView = ({ user, playerId, currentTableState, handleLeaveTable, handleLogout, emitEvent, playSound, socket, handleOpenFeedbackModal }) => {
    const [seatAssignments, setSeatAssignments] = useState({ self: null, opponentLeft: null, opponentRight: null });
    const [showRoundSummaryModal, setShowRoundSummaryModal] = useState(false);
    const [showInsurancePrompt, setShowInsurancePrompt] = useState(false);
    const [showGameMenu, setShowGameMenu] = useState(false);
    const [showIosPwaPrompt, setShowIosPwaPrompt] = useState(false);
    const [showDrawVoteModal, setShowDrawVoteModal] = useState(false);
    const [chatOpen, setChatOpen] = useState(false);
    const [unreadChat, setUnreadChat] = useState(0);
    const [touchStartX, setTouchStartX] = useState(null);
    const SWIPE_CLOSE_THRESHOLD = 50; 
    const [playerError, setPlayerError] = useState(null);
    const [chatMessages, setChatMessages] = useState([]);
    const [observedPlayerId, setObservedPlayerId] = useState(playerId);
    const [isObserverMode, setIsObserverMode] = useState(false);
    const turnPlayerRef = useRef(null);
    const trickWinnerRef = useRef(null);
    const cardCountRef = useRef(null);
    const gameStateRef = useRef(null);
    const insurancePromptShownRef = useRef(false);
    const errorTimerRef = useRef(null);
    const dropZoneRef = useRef(null);

    const selfPlayerInTable = currentTableState ? currentTableState.players[playerId] : null;
    const isSpectator = selfPlayerInTable?.isSpectator;
    const selfPlayerName = selfPlayerInTable?.playerName;
    
    useEffect(() => {
        getLobbyChatHistory(50)
            .then(setChatMessages)
            .catch(err => {
                console.error('Failed to load chat history:', err);
                setChatMessages([{ id: 'error', username: 'System', message: 'Could not load chat history.' }]);
            });
    }, []);

    useEffect(() => {
        if (!socket) return;
        
        const handleNewChatMessage = (newMessage) => {
            setChatMessages(prev => [...prev, newMessage]);
            setChatOpen(currentChatOpenState => {
                if (!currentChatOpenState) {
                    setUnreadChat(c => c + 1);
                }
                return currentChatOpenState;
            });
        };
        
        const handlePlayerError = ({ message }) => {
            if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
            setPlayerError({ message });
            errorTimerRef.current = setTimeout(() => {
                setPlayerError(null);
                errorTimerRef.current = null;
            }, 4000);
        };

        const handleDrawDeclined = () => {};

        socket.on('new_lobby_message', handleNewChatMessage);
        socket.on('error', handlePlayerError);
        socket.on('drawDeclined', handleDrawDeclined);

        return () => {
            socket.off('new_lobby_message', handleNewChatMessage);
            socket.off('error', handlePlayerError);
            socket.off('drawDeclined', handleDrawDeclined);
            if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
        };
    }, [socket]);

    useEffect(() => {
        if (!showGameMenu) return;
        const timer = setTimeout(() => setShowGameMenu(false), 3000);
        return () => clearTimeout(timer);
    }, [showGameMenu]);
    
    const getPlayerNameByUserId = useCallback((targetPlayerId) => {
        if (!currentTableState?.players || !targetPlayerId) return String(targetPlayerId);
        const player = Object.values(currentTableState.players).find(p => p.userId === targetPlayerId);
        return player?.playerName || String(targetPlayerId);
    }, [currentTableState]);

    useEffect(() => {
        if (currentTableState && !isSpectator) {
            const insurance = currentTableState.insurance;
            if (insurance?.isActive && !insurancePromptShownRef.current) {
                setShowInsurancePrompt(true);
                insurancePromptShownRef.current = true;
            }
            if (!insurance?.isActive && insurancePromptShownRef.current) {
                insurancePromptShownRef.current = false;
            }
        }
    }, [currentTableState, isSpectator]);

    useEffect(() => {
        if (currentTableState) {
            const { state, drawRequest } = currentTableState;
            const shouldShow = (drawRequest?.isActive || state === 'DrawDeclined' || state === 'DrawComplete') && !isSpectator;
            setShowDrawVoteModal(shouldShow);
        }
    }, [currentTableState, isSpectator]);

    useEffect(() => {
        if (currentTableState?.playerOrderActive?.length > 0) {
            if (isSpectator) {
                // For spectators, show all players in a default arrangement
                const activePlayerNames = currentTableState.playerOrderActive;
                console.log('[ADMIN] Spectator seat assignment - active players:', activePlayerNames);
                if (activePlayerNames.length === 3) {
                    const assignments = { 
                        self: activePlayerNames[0], 
                        opponentLeft: activePlayerNames[1], 
                        opponentRight: activePlayerNames[2] 
                    };
                    console.log('[ADMIN] Setting 3-player spectator seats:', assignments);
                    setSeatAssignments(assignments);
                } else if (activePlayerNames.length === 4) {
                    const assignments = { 
                        self: activePlayerNames[0], 
                        opponentLeft: activePlayerNames[1], 
                        opponentAcross: activePlayerNames[2],
                        opponentRight: activePlayerNames[3] 
                    };
                    console.log('[ADMIN] Setting 4-player spectator seats:', assignments);
                    setSeatAssignments(assignments);
                }
            } else if (playerId && currentTableState.players[playerId]) {
                // For players, show from their perspective
                const myName = getPlayerNameByUserId(playerId);
                const selfIndex = currentTableState.playerOrderActive.indexOf(myName);
                if (selfIndex !== -1) {
                    const numActive = currentTableState.playerOrderActive.length;
                    const opponentLeftName = currentTableState.playerOrderActive[(selfIndex + 1) % numActive];
                    const opponentRightName = currentTableState.playerOrderActive[(selfIndex + numActive - 1) % numActive];
                    setSeatAssignments({ self: myName, opponentLeft: opponentLeftName, opponentRight: opponentRightName });
                } else { setSeatAssignments({ self: null, opponentLeft: null, opponentRight: null }); }
            }
        } else { 
            setSeatAssignments({ self: null, opponentLeft: null, opponentRight: null }); 
        }
    }, [currentTableState, playerId, isSpectator, getPlayerNameByUserId]);

    // Debug spectator status changes
    useEffect(() => {
        if (currentTableState && playerId) {
            const player = currentTableState.players[playerId];
            console.log('[ADMIN] TableState updated - spectator status debug:');
            console.log('[ADMIN]   - playerId:', playerId);
            console.log('[ADMIN]   - player object:', player);
            console.log('[ADMIN]   - isSpectator calculated:', player?.isSpectator);
            console.log('[ADMIN]   - playerOrderActive:', currentTableState.playerOrderActive);
            console.log('[ADMIN]   - player in playerOrderActive:', currentTableState.playerOrderActive?.includes(player?.playerName));
        }
    }, [currentTableState, playerId]);
    
    useEffect(() => {
        if (currentTableState) {
            const { state, roundSummary } = currentTableState;
            const isModalState = state === "WidowReveal" || state === "Awaiting Next Round Trigger" || state === "Game Over";
            setShowRoundSummaryModal(!!(roundSummary && isModalState));
        }
    }, [currentTableState]);

    useEffect(() => {
        if (!currentTableState || !selfPlayerName || isSpectator) return;
        const { state, trickTurnPlayerName, lastCompletedTrick, currentTrickCards } = currentTableState;
        if ((state === "Playing Phase" || state === "Bidding Phase") && trickTurnPlayerName === selfPlayerName && turnPlayerRef.current !== selfPlayerName) playSound('turnAlert');
        turnPlayerRef.current = trickTurnPlayerName;
        const newCardCount = currentTrickCards?.length || 0;
        if (newCardCount > 0 && newCardCount !== cardCountRef.current) playSound('cardPlay');
        cardCountRef.current = newCardCount;
        if (lastCompletedTrick && lastCompletedTrick.winnerName === selfPlayerName && trickWinnerRef.current !== lastCompletedTrick.winnerName) playSound('trickWin');
        trickWinnerRef.current = lastCompletedTrick?.winnerName;
        if (state === 'Bidding Phase' && gameStateRef.current === 'Dealing Pending') playSound('cardDeal');
        gameStateRef.current = state;
    }, [currentTableState, selfPlayerName, isSpectator, playSound]);
    
    if (!currentTableState) {
        return <div>Loading table...</div>;
    }

    const openChatWindow = () => {
        setChatOpen(true);
        setUnreadChat(0);
    };

    const closeChatWindow = () => {
        setChatOpen(false);
    };

    const renderCard = (cardString, options = {}) => {
        const { isButton = false, onClick = null, disabled = false, isSelected = false, small = false, large = false, isFaceDown = false, style: customStyle = {}, className = '' } = options;
        const width = large ? '65px' : (small ? '37.5px' : '45px');
        const height = large ? '85px' : (small ? '50px' : '70px');

        if (isFaceDown) {
            return (
                <div className="card-back-container" style={{ width, height, ...customStyle }}>
                    <img src="/SluffLogo.png" alt="Card Back" className="card-back-image" />
                </div>
            );
        }

        if (!cardString) {
            return (
                <div className="card-placeholder" style={{ width, height, margin: '3px', ...customStyle }}></div>
            );
        }
        
        const rank = cardString.slice(0, -1);
        const suit = cardString.slice(-1);
        const symbol = SUIT_SYMBOLS[suit] || suit;
        const color = SUIT_COLORS[suit] || 'black';
        const backgroundColor = isSelected ? 'lightblue' : (SUIT_BACKGROUNDS[suit] || 'white');
        const cardClasses = ['card-display', className].filter(Boolean).join(' ');
        const cardContent = <>{rank !== '?' && rank}<span className="card-symbol">{symbol}</span></>;
        const style = { 
            backgroundColor, 
            color, 
            minWidth: width, 
            height,
            fontSize: large ? '1.2em' : (small ? '0.8em' : '1em'),
            ...customStyle
        };
        
        if (isButton) {
            return (<button onClick={onClick} disabled={disabled} style={style} className={cardClasses}>{cardContent}</button>);
        }
        return (<span style={style} className={cardClasses}>{cardContent}</span>);
    };

    const handleForfeit = () => {
        if (window.confirm("Are you sure you want to forfeit? This will count as a loss and your buy-in will be distributed to the other players.")) {
            emitEvent("forfeitGame");
        }
        setShowGameMenu(false);
    };
    
    // Observer mode handlers
    const handlePlayerSwitch = (newPlayerId) => {
        setObservedPlayerId(newPlayerId);
        setIsObserverMode(true);
    };

    const handleStartBotGame = () => {
        // Emit event to start a bot-only game
        emitEvent('startBotGame', { botCount: 3 });
    };

    const handleMoveToSpectator = () => {
        console.log('[ADMIN] Moving to spectator mode');
        console.log('[ADMIN] BEFORE moveToSpectator - currentTableState.players[playerId]:', currentTableState.players[playerId]);
        console.log('[ADMIN] BEFORE moveToSpectator - playerOrderActive:', currentTableState.playerOrderActive);
        emitEvent('moveToSpectator', { tableId: currentTableState.tableId });
    };

    // Get the current perspective player (either self or observed)
    const perspectivePlayerId = isObserverMode ? observedPlayerId : playerId;
    const perspectivePlayer = currentTableState ? currentTableState.players[perspectivePlayerId] : null;
    
    const GameMenu = () => (
        <div className="game-menu-popup">
            <h3>{currentTableState.tableName}</h3>
            <div className="game-menu-info">
                <p><strong>State:</strong> {currentTableState?.state || "N/A"}</p>
                <p><strong>Bid:</strong> {currentTableState?.bidWinnerInfo?.bid || "N/A"} {currentTableState?.bidWinnerInfo?.playerName && ` by ${currentTableState.bidWinnerInfo.playerName}`}</p>
            </div>
            <div className="game-menu-actions">
                <button onClick={handleLeaveTable} className="game-menu-button secondary">Back to Lobby</button>
                <button 
                    onClick={() => {
                        handleOpenFeedbackModal(currentTableState);
                        setShowGameMenu(false);
                    }}
                    className="game-menu-button feedback"
                >
                    Submit Feedback
                </button>
                <button 
                    onClick={() => { emitEvent("requestDraw"); setShowGameMenu(false); }}
                    className="game-menu-button primary"
                    disabled={currentTableState.state !== 'Playing Phase'}
                >
                    Request Draw
                </button>
                <button onClick={handleForfeit} className="game-menu-button danger">Forfeit Game</button>
            </div>
        </div>
    );

    return (
        <div className="game-view">
            <InsurancePrompt 
                show={showInsurancePrompt}
                insuranceState={currentTableState.insurance}
                selfPlayerName={selfPlayerName}
                emitEvent={emitEvent}
                onClose={() => setShowInsurancePrompt(false)}
            />

            <DrawVoteModal
                show={showDrawVoteModal}
                currentTableState={{...currentTableState, playerId: playerId}}
                onVote={(vote) => emitEvent("submitDrawVote", { vote })}
                handleLeaveTable={handleLeaveTable}
            />

            <IosPwaPrompt show={showIosPwaPrompt} onClose={() => setShowIosPwaPrompt(false)} />

            {user?.is_admin && (
                <AdminObserverMode
                    players={Object.values(currentTableState.players || {})}
                    currentObservedPlayer={observedPlayerId}
                    onPlayerSwitch={handlePlayerSwitch}
                    onStartBotGame={handleStartBotGame}
                    onMoveToSpectator={handleMoveToSpectator}
                    gameInProgress={currentTableState.gameStarted || (currentTableState.state !== 'Waiting for Players' && currentTableState.state !== 'Ready to Start')}
                    isAdmin={user.is_admin}
                    isSpectator={currentTableState.players?.[playerId]?.isSpectator}
                    userId={playerId}
                />
            )}
            {console.log('[DEBUG] GameTableView render - user:', user)}
            {console.log('[DEBUG] GameTableView render - user.is_admin:', user?.is_admin)}
            {console.log('[DEBUG] GameTableView render - should show AdminObserverMode:', !!user?.is_admin)}

            <RoundSummaryModal
                summaryData={currentTableState.roundSummary}
                showModal={showRoundSummaryModal}
                playerId={playerId}
                getPlayerNameByUserId={getPlayerNameByUserId}
                renderCard={renderCard}
                emitEvent={emitEvent}
                insurance={currentTableState.insurance}
                bidWinnerInfo={currentTableState.bidWinnerInfo}
                playerOrderActive={currentTableState.playerOrderActive}
                handleLeaveTable={handleLeaveTable}
                handleLogout={handleLogout}
            />
            
            <TableLayout 
                currentTableState={currentTableState}
                seatAssignments={seatAssignments}
                isSpectator={isSpectator}
                renderCard={renderCard}
                PlayerSeat={PlayerSeat}
                ActionControls={ActionControls}
                selfPlayerName={selfPlayerName}
                playerId={playerId}
                emitEvent={emitEvent}
                handleLeaveTable={handleLeaveTable}
                playerError={playerError}
                playSound={playSound}
                dropZoneRef={dropZoneRef}
                isAdmin={user?.is_admin}
            />
            
            <footer className="game-footer">
                <PlayerHand
                    currentTableState={{
                        ...currentTableState,
                        // Override the player data with the observed player's data if in observer mode
                        players: {
                            ...currentTableState.players,
                            [playerId]: isObserverMode ? perspectivePlayer : selfPlayerInTable
                        }
                    }}
                    selfPlayerName={isObserverMode ? perspectivePlayer?.playerName : selfPlayerName}
                    isSpectator={isObserverMode ? false : isSpectator}
                    emitEvent={emitEvent}
                    renderCard={renderCard}
                    dropZoneRef={dropZoneRef}
                />
                <div className="footer-controls-wrapper">
                    {!chatOpen && (
                        <button className="chat-tab-button" onClick={openChatWindow}>
                            <span>Chat</span>
                            {unreadChat > 0 && <span className="unread-badge">{unreadChat}</span>}
                        </button>
                    )}
                    <div className="right-controls-group">
                        <InsuranceControls
                            insuranceState={currentTableState.insurance}
                            selfPlayerName={selfPlayerName}
                            isSpectator={isSpectator}
                            emitEvent={emitEvent}
                        />
                        <button className="hamburger-btn" onClick={() => setShowGameMenu(prev => !prev)}>
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="3" y1="12" x2="21" y2="12"></line>
                                <line x1="3" y1="6" x2="21" y2="6"></line>
                                <line x1="3" y1="18" x2="21" y2="18"></line>
                            </svg>
                        </button>
                    </div>
                </div>
                {showGameMenu && <GameMenu />}
            </footer>
            
            {chatOpen && (
                <div 
                    className="game-view-chat-container open"
                    onTouchStart={(e) => setTouchStartX(e.touches[0].clientX)}
                    onTouchEnd={(e) => {
                        if (touchStartX !== null && e.changedTouches[0].clientX - touchStartX > SWIPE_CLOSE_THRESHOLD) {
                            closeChatWindow();
                        }
                        setTouchStartX(null);
                    }}
                >
                    <button className="chat-close-button" onClick={closeChatWindow} aria-label="Close chat window">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                    <LobbyChat
                        socket={socket}
                        messages={chatMessages}
                    />
                </div>
            )}
        </div>
    );
};

export default GameTableView;