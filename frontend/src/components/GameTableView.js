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
import LayoutDevPanel from './LayoutDevPanel';
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
    const [showLayoutDev, setShowLayoutDev] = useState(false);
    const [showCardDebug, setShowCardDebug] = useState(false); // Hide debug overlay
    const [selectedFrogDiscards, setSelectedFrogDiscards] = useState([]);
    const [viewportOverflow, setViewportOverflow] = useState(false);
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

    // Development only: Check for viewport overflow
    useEffect(() => {
        if (process.env.NODE_ENV !== 'development') return;
        
        const checkViewportOverflow = () => {
            const documentHeight = document.documentElement.scrollHeight;
            const viewportHeight = window.innerHeight;
            setViewportOverflow(documentHeight > viewportHeight);
            
            if (documentHeight > viewportHeight) {
                console.error(`⚠️ VIEWPORT OVERFLOW DETECTED! Document: ${documentHeight}px, Viewport: ${viewportHeight}px, Overflow: ${documentHeight - viewportHeight}px`);
            }
        };
        
        // Check immediately and on any changes
        checkViewportOverflow();
        
        // Check periodically to catch dynamic changes
        const interval = setInterval(checkViewportOverflow, 1000);
        
        // Check on resize
        window.addEventListener('resize', checkViewportOverflow);
        
        // Use MutationObserver to detect DOM changes
        const observer = new MutationObserver(checkViewportOverflow);
        observer.observe(document.body, { childList: true, subtree: true, attributes: true });
        
        return () => {
            clearInterval(interval);
            window.removeEventListener('resize', checkViewportOverflow);
            observer.disconnect();
        };
    }, []);

    // Keyboard accessibility: allow ESC to close chat when open
    useEffect(() => {
        const onKeyDown = (e) => {
            if (e.key === 'Escape' && chatOpen) {
                e.stopPropagation();
                setChatOpen(false);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [chatOpen]);
    
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
                // console.log('[ADMIN] Spectator seat assignment - active players:', activePlayerNames);
                if (activePlayerNames.length === 3) {
                    const assignments = { 
                        self: activePlayerNames[0], 
                        opponentLeft: activePlayerNames[1], 
                        opponentRight: activePlayerNames[2] 
                    };
                    // console.log('[ADMIN] Setting 3-player spectator seats:', assignments);
                    setSeatAssignments(assignments);
                } else if (activePlayerNames.length === 4) {
                    const assignments = { 
                        self: activePlayerNames[0], 
                        opponentLeft: activePlayerNames[1], 
                        opponentAcross: activePlayerNames[2],
                        opponentRight: activePlayerNames[3] 
                    };
                    // console.log('[ADMIN] Setting 4-player spectator seats:', assignments);
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
            // eslint-disable-next-line no-unused-vars
            const player = currentTableState.players[playerId];
            // console.log('[ADMIN] TableState updated - spectator status debug:');
            // console.log('[ADMIN]   - playerId:', playerId);
            // console.log('[ADMIN]   - player object:', player);
            // console.log('[ADMIN]   - isSpectator calculated:', player?.isSpectator);
            // console.log('[ADMIN]   - playerOrderActive:', currentTableState.playerOrderActive);
            // console.log('[ADMIN]   - player in playerOrderActive:', currentTableState.playerOrderActive?.includes(player?.playerName));
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
        // Clear Frog discards when state changes away from Frog Widow Exchange
        if (state !== "Frog Widow Exchange") {
            setSelectedFrogDiscards([]);
        }
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

    const handleFrogDiscardSelect = (card) => {
        setSelectedFrogDiscards(prev => {
            if (prev.includes(card)) return prev.filter(c => c !== card);
            if (prev.length < 3) return [...prev, card];
            return prev;
        });
    };

    const handleSubmitFrogDiscards = () => {
        if (selectedFrogDiscards.length === 3) {
            console.log('[Frog] Submitting discards:', selectedFrogDiscards);
            emitEvent("submitFrogDiscards", { discards: selectedFrogDiscards });
            setSelectedFrogDiscards([]); // Clear after submit
        }
    };

    const renderCard = (cardString, options = {}) => {
        const { isButton = false, onClick = null, disabled = false, isSelected = false, small = false, large = false, isFaceDown = false, style: customStyle = {}, className = '', responsive = true } = options;
        
        // Viewport-based card sizing with proper aspect ratio
        // Standard playing card ratio is approximately 5:7 (0.714 width/height)
        const CARD_ASPECT_RATIO = 0.714;
        
        // Unified card sizing based on viewport height
        const getCardHeight = () => {
            const vh = window.innerHeight / 100;
            
            // Small cards (widow, trick piles) are 50% of normal size
            if (small) {
                return `${6 * vh}px`;  // 6vh for small cards
            }
            
            if (large) {
                return `${10 * vh}px`; // 10vh for large cards
            }
            
            // Normal cards - unified 10vh height
            return `${10 * vh}px`;
        };
        
        // Calculate width maintaining aspect ratio
        const getCardWidth = () => {
            const heightStr = getCardHeight();
            const heightNum = parseFloat(heightStr);
            return `${Math.round(heightNum * CARD_ASPECT_RATIO)}px`;
        };
        
        const width = responsive ? getCardWidth() : (large ? '65px' : (small ? '37.5px' : '45px'));
        const height = responsive ? getCardHeight() : (large ? '85px' : (small ? '50px' : '70px'));

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
        const cardContent = (
            <div style={{ 
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'flex-start',
                position: 'absolute',
                top: '2px',
                left: '4px'
            }}>
                <span style={{ lineHeight: '1' }}>{rank !== '?' && rank}</span>
                <span className="card-symbol" style={{ lineHeight: '1', marginTop: '-2px' }}>{symbol}</span>
            </div>
        );
        
        // Font size relative to card height
        const getFontSize = () => {
            const heightNum = parseFloat(height);
            // Font should be roughly 25-30% of card height for good readability
            return `${Math.round(heightNum * 0.28)}px`;
        };
        
        // Combine inline styles with !important overrides
        const style = { 
            width: width,  // Set explicit width
            height: height,  // Set explicit height
            minWidth: width,  // Prevent shrinking
            maxWidth: width,  // Prevent growing
            minHeight: height,  // Prevent shrinking
            maxHeight: height,  // Prevent growing
            backgroundColor, 
            color, 
            fontSize: getFontSize(),
            display: 'inline-block',  // Changed from inline-flex for proper positioning
            position: 'relative',  // For absolute positioning of content
            padding: '2px',  // Override TableLayout.css padding
            boxSizing: 'border-box',
            flexShrink: 0,  // Prevent flex shrinking
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
        // console.log('[ADMIN] Moving to spectator mode');
        // console.log('[ADMIN] BEFORE moveToSpectator - currentTableState.players[playerId]:', currentTableState.players[playerId]);
        // console.log('[ADMIN] BEFORE moveToSpectator - playerOrderActive:', currentTableState.playerOrderActive);
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
                {user?.is_admin && (
                    <button
                        onClick={() => { setShowLayoutDev(true); setShowGameMenu(false); }}
                        className="game-menu-button"
                    >
                        🎨 Layout Dev
                    </button>
                )}
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
            {/* Development Warning Banner for Viewport Overflow */}
            {process.env.NODE_ENV === 'development' && viewportOverflow && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    zIndex: 99999,
                    background: 'repeating-linear-gradient(45deg, #ff0000, #ff0000 10px, #ffff00 10px, #ffff00 20px)',
                    color: 'white',
                    padding: '10px',
                    textAlign: 'center',
                    fontSize: '20px',
                    fontWeight: 'bold',
                    textShadow: '2px 2px 4px rgba(0,0,0,0.8)',
                    pointerEvents: 'none'
                }}>
                    ⚠️ VIEWPORT OVERFLOW! Content exceeds 100vh - FIX YOUR CODE! ⚠️
                    <br />
                    <span style={{ fontSize: '14px' }}>
                        Check console for details - Scroll needed!
                    </span>
                </div>
            )}
            {/* Card position debug overlay */}
            {showCardDebug && window.cardDebugPositions && window.cardDebugPositions.length > 0 && (
                <div style={{
                    position: 'fixed',
                    bottom: '0',
                    left: '0',
                    right: '0',
                    height: '200px',
                    pointerEvents: 'none',
                    zIndex: 10000,
                    backgroundColor: 'rgba(0, 0, 0, 0.5)'
                }}>
                    <div style={{
                        position: 'absolute',
                        top: '10px',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        color: 'yellow',
                        fontSize: '16px',
                        fontWeight: 'bold',
                        backgroundColor: 'black',
                        padding: '5px 10px',
                        borderRadius: '5px'
                    }}>
                        CARD POSITION DEBUG
                    </div>
                    {window.cardDebugPositions.map((pos, i) => {
                        // Alternate colors for better visibility
                        const isEven = i % 2 === 0;
                        const bgColor = isEven ? 'rgba(255, 255, 0, 0.3)' : 'rgba(0, 255, 255, 0.3)';
                        const borderColor = isEven ? 'yellow' : 'cyan';
                        const labelBgColor = isEven ? 'yellow' : 'cyan';
                        const labelTextColor = 'black';
                        
                        return (
                            <div
                                key={i}
                                style={{
                                    position: 'absolute',
                                    left: `${pos.left}px`,
                                    bottom: `${50 + pos.height}px`, // Move up by one card height
                                    width: `${pos.width}px`,
                                    height: `${pos.height}px`,
                                    border: `3px solid ${borderColor}`,
                                    backgroundColor: bgColor,
                                    boxSizing: 'border-box'
                                }}
                            >
                                <span style={{
                                    position: 'absolute',
                                    top: '2px',
                                    left: '2px',
                                    color: labelTextColor,
                                    fontSize: '16px',
                                    fontWeight: 'bold',
                                    backgroundColor: labelBgColor,
                                    padding: '2px 4px',
                                    borderRadius: '3px',
                                    border: '1px solid black',
                                    lineHeight: '1'
                                }}>
                                    {i+1}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
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

            {/* Debug: Check admin status (log removed to avoid console spam) */}
            
            {user?.is_admin && (
                <>
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
                    {showLayoutDev && (
                        <LayoutDevPanel 
                            onClose={() => setShowLayoutDev(false)}
                            emitEvent={emitEvent}
                            currentTableState={currentTableState}
                        />
                    )}
                </>
            )}
            {/* console.log('[DEBUG] GameTableView render - user:', user) */}
            {/* console.log('[DEBUG] GameTableView render - user.is_admin:', user?.is_admin) */}
            {/* console.log('[DEBUG] GameTableView render - should show AdminObserverMode:', !!user?.is_admin) */}

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
                selectedFrogDiscards={selectedFrogDiscards}
                onSubmitFrogDiscards={handleSubmitFrogDiscards}
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
                    playerId={playerId}
                    isObserverMode={isObserverMode}
                    emitEvent={emitEvent}
                    renderCard={renderCard}
                    dropZoneRef={dropZoneRef}
                    selectedDiscards={selectedFrogDiscards}
                    onSelectDiscard={handleFrogDiscardSelect}
                />
                <div className="footer-controls-wrapper">
                    <InsuranceControls
                        insuranceState={currentTableState.insurance}
                        selfPlayerName={selfPlayerName}
                        isSpectator={isSpectator}
                        emitEvent={emitEvent}
                    />
                    <div className="button-panel">
                        <button className="hamburger-btn" onClick={() => setShowGameMenu(prev => !prev)}>
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="3" y1="12" x2="21" y2="12"></line>
                                <line x1="3" y1="6" x2="21" y2="6"></line>
                                <line x1="3" y1="18" x2="21" y2="18"></line>
                            </svg>
                        </button>
                        {!chatOpen && (
                            <button className="chat-tab-button" onClick={openChatWindow}>
                                <span>Chat</span>
                                {unreadChat > 0 && <span className="unread-badge">{unreadChat}</span>}
                            </button>
                        )}
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