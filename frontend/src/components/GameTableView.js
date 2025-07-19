// frontend/src/components/GameTableView.js
import React, { useState, useEffect, useRef, useCallback } from 'react';

import './GameTableView.css';

import PlayerHand from './game/PlayerHand';
import InsuranceControls from './game/InsuranceControls';
import RoundSummaryModal from './game/RoundSummaryModal';
import TableLayout from './game/TableLayout';
import PlayerSeat from './game/PlayerSeat';
import ActionControls from './game/ActionControls';
import InsurancePrompt from './game/InsurancePrompt';
import IosPwaPrompt from './game/IosPwaPrompt';
import DrawVoteModal from './game/DrawVoteModal';
import LobbyChat from './LobbyChat';

import { getLobbyChatHistory } from '../services/api';
import { SUITS_MAP, SUIT_SYMBOLS, SUIT_COLORS, SUIT_BACKGROUNDS } from '../constants';

const GameTableView = ({ playerId, currentTableState, handleLeaveTable, handleLogout, errorMessage, emitEvent, playSound, socket }) => {
    // --- STEP 1: All useState and useRef hooks are at the top. ---
    const [seatAssignments, setSeatAssignments] = useState({ self: null, opponentLeft: null, opponentRight: null });
    const [showRoundSummaryModal, setShowRoundSummaryModal] = useState(false);
    const [showInsurancePrompt, setShowInsurancePrompt] = useState(false);
    const [showGameMenu, setShowGameMenu] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [showIosPrompt, setShowIosPrompt] = useState(false);
    const [showDrawVote, setShowDrawVote] = useState(false);
    const [chatOpen, setChatOpen] = useState(false);
    const [unreadChat, setUnreadChat] = useState(0);
    const [touchStartX, setTouchStartX] = useState(null);
    const SWIPE_CLOSE_THRESHOLD = 50; 
    const [playerError, setPlayerError] = useState(null);
    const [chatMessages, setChatMessages] = useState([]);
    const turnPlayerRef = useRef(null);
    const trickWinnerRef = useRef(null);
    const cardCountRef = useRef(null);
    const gameStateRef = useRef(null);
    const insurancePromptShownRef = useRef(false);
    const errorTimerRef = useRef(null);

    // --- STEP 2: Define derived variables needed by hooks. ---
    const selfPlayerInTable = currentTableState ? currentTableState.players[playerId] : null;
    const isSpectator = selfPlayerInTable?.isSpectator;
    const selfPlayerName = selfPlayerInTable?.playerName;
    
    // --- STEP 3: All useEffect and useCallback hooks are called here, unconditionally. ---
    useEffect(() => {
        getLobbyChatHistory()
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

        socket.on('new_lobby_message', handleNewChatMessage);
        socket.on('error', handlePlayerError);

        return () => {
            socket.off('new_lobby_message', handleNewChatMessage);
            socket.off('error', handlePlayerError);
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
            const myVote = currentTableState.drawRequest?.votes?.[selfPlayerName];
            const shouldShow = currentTableState.drawRequest?.isActive && myVote == null && !isSpectator;
            setShowDrawVote(shouldShow);
        }
    }, [currentTableState, selfPlayerName, isSpectator]);

    useEffect(() => {
        if (currentTableState?.playerOrderActive?.length > 0 && playerId && currentTableState.players[playerId] && !isSpectator) {
            const myName = getPlayerNameByUserId(playerId);
            const selfIndex = currentTableState.playerOrderActive.indexOf(myName);
            if (selfIndex !== -1) {
                const numActive = currentTableState.playerOrderActive.length;
                const opponentLeftName = currentTableState.playerOrderActive[(selfIndex + 1) % numActive];
                const opponentRightName = currentTableState.playerOrderActive[(selfIndex + numActive - 1) % numActive];
                setSeatAssignments({ self: myName, opponentLeft: opponentLeftName, opponentRight: opponentRightName });
            } else { setSeatAssignments({ self: null, opponentLeft: null, opponentRight: null }); }
        } else { setSeatAssignments({ self: null, opponentLeft: null, opponentRight: null }); }
    }, [currentTableState, playerId, isSpectator, getPlayerNameByUserId]);
    
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

    const isIos = () => /iPhone|iPad|iPod/i.test(navigator.userAgent);
    
    useEffect(() => {
        if (!isIos()) {
            document.addEventListener('fullscreenchange', handleFullscreenChange);
            return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
        }
    }, []);

    // --- STEP 4: The guard clause is now the last item before the return statement. ---
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

    const renderCard = (cardString, { isButton = false, onClick = null, disabled = false, isSelected = false, small = false, large = false, isFaceDown = false, style: customStyle = {} } = {}) => {
        const width = large ? '65px' : (small ? '30px' : '45px');
        const height = large ? '90px' : (small ? '50px' : '70px');

        if (isFaceDown) {
            return (
                <div className="card-back-container" style={{ width, height, ...customStyle }}>
                    <img src="/SluffLogo.png" alt="Card Back" className="card-back-image" />
                </div>
            );
        }

        if (!cardString) {
            return (
                <div 
                    className="card-placeholder" 
                    style={{ 
                        width, 
                        height, 
                        border: '2px dashed rgba(0, 0, 0, 0.2)', 
                        margin: '3px', 
                        display: 'inline-block', 
                        borderRadius: '4px', 
                        backgroundColor: 'transparent',
                        boxSizing: 'border-box' 
                    }}>
                </div>
            );
        }
        
        const rank = cardString.slice(0, -1);
        const suit = cardString.slice(-1);
        const symbol = SUIT_SYMBOLS[suit] || suit;
        const color = SUIT_COLORS[suit] || 'black';
        const backgroundColor = SUIT_BACKGROUNDS[suit] || 'white';
        let borderStyle = isSelected ? '3px solid royalblue' : '1px solid #777';
        const baseFontSize = large ? '1.3em' : (small ? '0.8em' : '1em');
        const style = { padding: large ? '10px' : (small ? '4px' : '8px'), border: borderStyle, borderRadius: '4px', backgroundColor: isSelected ? 'lightblue' : backgroundColor, color: color, margin: '3px', minWidth: width, height, textAlign: 'center', fontWeight: 'bold', fontSize: baseFontSize, cursor: isButton && !disabled ? 'pointer' : 'default', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', ...customStyle };

        const symbolStyle = { fontSize: '125%' };
        const cardContent = <>{rank !== '?' && rank}<span style={symbolStyle}>{symbol}</span></>;

        if (isButton) return (<button key={cardString} onClick={onClick} disabled={disabled} style={style}>{cardContent}</button>);
        return (<span key={cardString} style={{ ...style, display: 'inline-flex' }}>{cardContent}</span>);
    };

    const handleFullscreenChange = () => {
        setIsFullscreen(!!document.fullscreenElement);
    };

    const toggleFullscreen = () => {
        if (isIos()) {
            setShowIosPrompt(true);
        } else if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        }
        setShowGameMenu(false);
    };

    const handleForfeit = () => {
        if (window.confirm("Are you sure you want to forfeit? This will count as a loss and your buy-in will be distributed to the other players.")) {
            emitEvent("forfeitGame");
        }
        setShowGameMenu(false);
    };
    
    const GameMenu = () => (
        <div className="game-menu-popup">
            <h3>{currentTableState.tableName}</h3>
            <div className="game-menu-info">
                <p><strong>State:</strong> {currentTableState?.state || "N/A"}</p>
                <p><strong>Mode:</strong> {currentTableState?.playerMode ? `${currentTableState.playerMode}-Player` : "N/A"}</p>
                <p><strong>Trump:</strong> {currentTableState?.trumpSuit ? SUITS_MAP[currentTableState.trumpSuit] : "N/A"}</p>
                <p><strong>Bid:</strong> {currentTableState?.bidWinnerInfo?.bid || "N/A"} {currentTableState?.bidWinnerInfo?.playerName && ` by ${currentTableState.bidWinnerInfo.playerName}`}</p>
            </div>
            <div className="game-menu-actions">
                <button 
                    onClick={() => emitEvent("requestDraw")}
                    className="game-button"
                    disabled={currentTableState.state !== 'Playing Phase'}
                    style={{backgroundColor: '#1d4ed8'}}
                >
                    Request Draw
                </button>
                {/* --- MODIFICATION: Removed the Fullscreen button --- */}
                {/*
                <button onClick={toggleFullscreen} className="game-button">
                    {isIos() ? 'App Mode' : (isFullscreen ? 'Exit Fullscreen' : 'Fullscreen')}
                </button>
                */}
                <button onClick={handleForfeit} className="game-button" style={{backgroundColor: '#dc3545'}}>Forfeit Game</button>
                <button onClick={handleLeaveTable} className="game-button">Lobby</button>
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
                show={showDrawVote}
                drawRequest={currentTableState.drawRequest}
                onVote={(vote) => emitEvent("submitDrawVote", { vote })}
            />

            <IosPwaPrompt show={showIosPrompt} onClose={() => setShowIosPrompt(false)} />

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
                playerError={playerError}
            />
            
            <footer className="game-footer">
                <PlayerHand
                    currentTableState={currentTableState}
                    selfPlayerName={selfPlayerName}
                    isSpectator={isSpectator}
                    emitEvent={emitEvent}
                    renderCard={renderCard}
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
                    <button className="chat-close-button" onClick={closeChatWindow} aria-label="Close chat window">Ã—</button>
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