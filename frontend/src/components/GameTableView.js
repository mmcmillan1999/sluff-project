// frontend/src/components/GameTableView.js
import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import './GameTableView.css';
import DrawVoteModal from './game/DrawVoteModal';
import PlayerHand from './game/PlayerHand';
import InsuranceControls from './game/InsuranceControls';
import RoundSummaryModal from './game/RoundSummaryModal';
import GameOverPodium from './game/GameOverPodium';
import TableLayout from './game/TableLayout';
import PlayerSeat from './game/PlayerSeat';
import ActionControls from './game/ActionControls';
import InsurancePrompt from './game/InsurancePrompt';
import BidWinnerSplash from './game/BidWinnerSplash';
import IosPwaPrompt from './game/IosPwaPrompt';
import {
    END_ROUND_TOTAL_MS,
    ROUND_RECAP_ACTION_MS,
    SETTLED_RECAP_HOLD_MS,
} from '../config/endRoundTiming';
import LobbyChat from './LobbyChat';
import AdminObserverMode from './AdminObserverMode';
import PlayerHandAnchorDebug from './game/PlayerHandAnchorDebug';
import { getLobbyChatHistory } from '../services/api';
import SoundControls from './game/SoundControls';
import { useModalFocus } from '../hooks/useModalFocus';
import { shareInvite, getInviteUrl } from '../utils/tableInvites';
import { SUIT_SYMBOLS, SUIT_COLORS, SUIT_BACKGROUNDS } from '../constants';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { useBidWinnerSplash } from '../hooks/useBidWinnerSplash';
import TutorialCoach, { FIRST_GAME_TUTORIAL_VERSION } from './game/TutorialCoach';
import DealAnimation from './game/DealAnimation';
import { CARDS_PER_PLAYER, WIDOW_CARD_COUNT } from './game/dealSequence';
import {
    TUTORIAL_FORFEIT_RECAP_HINT,
    TUTORIAL_RECAP_HINT,
    TUTORIAL_THEME_ID,
} from '../config/tutorial';
import { getThemePresentation } from '../config/themePresentation';
import PlayerProfileModal from './PlayerProfileModal';
import VoiceControls from './game/VoiceControls';

const ROUND_PRESENTATION_STATES = new Set([
    'WidowReveal',
    'Awaiting Next Round Trigger',
    'Game Over'
]);
const ROUND_SCORES_RELEASED_PHASES = new Set([
    'score-settled-waiting',
    'settled',
    'podium'
]);
const scoresBeforeRound = (summary, fallbackScores) => {
    if (!summary) return null;
    const finalScores = summary.finalScores || fallbackScores || {};
    const pointChanges = summary.pointChanges || {};
    const names = new Set([
        ...Object.keys(finalScores),
        ...Object.keys(pointChanges),
        ...Object.keys(fallbackScores || {})
    ]);

    return Object.fromEntries([...names].map(name => {
        const finalScore = Number(finalScores[name] ?? fallbackScores?.[name]);
        const pointChange = Number(pointChanges[name] ?? 0);
        return [
            name,
            Number.isFinite(finalScore)
                ? finalScore - (Number.isFinite(pointChange) ? pointChange : 0)
                : fallbackScores?.[name]
        ];
    }));
};


const GameTableView = ({ user, playerId, currentTableState, handleLeaveTable, handleLogout, handleShowHowToPlay, emitEvent, playSound, socket, handleOpenFeedbackModal, soundSettings, tutorialState, onTutorialAction, onShowTokenLedger }) => {
    const themePresentation = getThemePresentation(currentTableState?.theme);
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
    const [showAnchorDebug, setShowAnchorDebug] = useState(false); // Toggle debug overlay
    const [selectedFrogDiscards, setSelectedFrogDiscards] = useState([]);
    const [profilePlayerName, setProfilePlayerName] = useState(null);
    const [shareNotice, setShareNotice] = useState(null);
    const gameMenuRef = useModalFocus(showGameMenu, '.game-menu-button:not(:disabled)');
    const [quickPlayDecisionRejectionNonce, setQuickPlayDecisionRejectionNonce] = useState(0);
    const [roundPresentationPhase, setRoundPresentationPhase] = useState('idle');
    const [dealPresentation, setDealPresentation] = useState({
        active: false,
        animationKey: 0,
        playerOrder: [],
        localPlayerName: null,
        revealedSelfCards: 0,
        revealedWidowCards: 0,
        cardsRemaining: 0,
    });
    const [, setPresentationClockTick] = useState(0);
    const gameViewRef = useRef(null);
    const shareNoticeTimerRef = useRef(null);
    const turnPlayerRef = useRef(null);
    const trickWinnerRef = useRef(null);
    const cardCountRef = useRef(null);
    const gameStateRef = useRef(null);
    const highBidRef = useRef(null);
    const passedCountRef = useRef(0);
    const roundModalTimerRef = useRef(null);
    const roundModalScheduledRef = useRef(false);
    const roundPresentationAckRef = useRef(null);
    const roundPresentationConfirmedAckRef = useRef(null);
    const roundAdvanceTimerRef = useRef(null);
    const errorTimerRef = useRef(null);
    const dropZoneRef = useRef(null);
    const dealTransitionRef = useRef({
        tableId: currentTableState?.tableId ?? null,
        state: currentTableState?.state ?? null,
    });
    const prefersReducedMotion = usePrefersReducedMotion();
    const { bidSplashInfo, dismissBidSplash } = useBidWinnerSplash(
        currentTableState,
        prefersReducedMotion
    );

    const selfPlayerInTable = currentTableState ? currentTableState.players[playerId] : null;
    const isSpectator = selfPlayerInTable?.isSpectator;
    const selfPlayerName = selfPlayerInTable?.playerName;
    const tableVoiceAvailable = Boolean(
        selfPlayerInTable
        && !isSpectator
        && socket
        && currentTableState?.tableId
    );
    const gameState = currentTableState?.state;
    const gameHasSettled = gameState === 'Game Over' || gameState === 'DrawComplete';
    const activeSeatIsHeld = Boolean(
        selfPlayerInTable
        && !isSpectator
        && currentTableState?.gameStarted
        && !gameHasSettled
    );
    const canRequestDraw = activeSeatIsHeld
        && gameState === 'Playing Phase'
        && !currentTableState?.drawRequest?.isActive;
    const canForfeit = activeSeatIsHeld && gameState !== 'Draw Resolving';
    const dealLocalPlayerName = isObserverMode
        ? currentTableState?.players?.[observedPlayerId]?.playerName
        : (!isSpectator ? selfPlayerName : null);
    const currentDealTableId = currentTableState?.tableId ?? null;
    const currentDealState = currentTableState?.state ?? null;
    const currentDealOrder = currentTableState?.playerOrderActive;

    useLayoutEffect(() => {
        const previous = dealTransitionRef.current;
        const sameTable = previous.tableId === currentDealTableId;
        const observedDealTransition = sameTable
            && previous.state === 'Dealing Pending'
            && currentDealState === 'Bidding Phase';

        dealTransitionRef.current = {
            tableId: currentDealTableId,
            state: currentDealState,
        };

        if (observedDealTransition && !prefersReducedMotion) {
            const playerOrder = Array.isArray(currentDealOrder)
                ? [...currentDealOrder]
                : [];

            // A normal Sluff round always deals to exactly three active players.
            // If a malformed/incomplete snapshot arrives, fail open to the real
            // server state instead of holding the UI behind a decorative sequence.
            if (playerOrder.length === 3) {
                setDealPresentation(previousPresentation => ({
                    active: true,
                    animationKey: previousPresentation.animationKey + 1,
                    playerOrder,
                    localPlayerName: dealLocalPlayerName || null,
                    revealedSelfCards: 0,
                    revealedWidowCards: 0,
                    cardsRemaining: (playerOrder.length * CARDS_PER_PLAYER) + WIDOW_CARD_COUNT,
                }));
                return;
            }
        }

        if (prefersReducedMotion || !sameTable || currentDealState !== 'Bidding Phase') {
            setDealPresentation(previousPresentation => (
                previousPresentation.active
                    ? { ...previousPresentation, active: false }
                    : previousPresentation
            ));
        }
    }, [
        currentDealOrder,
        currentDealState,
        currentDealTableId,
        dealLocalPlayerName,
        prefersReducedMotion,
    ]);

    const handleDealCardLaunch = useCallback((_step, index, total) => {
        setDealPresentation(previousPresentation => (
            previousPresentation.active
                ? {
                    ...previousPresentation,
                    cardsRemaining: Math.max(0, total - index - 1),
                }
                : previousPresentation
        ));
    }, []);

    const handleDealCardArrival = useCallback((step) => {
        setDealPresentation(previousPresentation => {
            if (!previousPresentation.active) return previousPresentation;

            if (step.type === 'widow') {
                return {
                    ...previousPresentation,
                    revealedWidowCards: Math.min(
                        WIDOW_CARD_COUNT,
                        previousPresentation.revealedWidowCards + 1,
                    ),
                };
            }

            if (step.type === 'player'
                && step.playerName === previousPresentation.localPlayerName) {
                return {
                    ...previousPresentation,
                    revealedSelfCards: Math.min(
                        CARDS_PER_PLAYER,
                        previousPresentation.revealedSelfCards + 1,
                    ),
                };
            }

            return previousPresentation;
        });
    }, []);

    const handleDealAnimationComplete = useCallback(() => {
        setDealPresentation(previousPresentation => (
            previousPresentation.active
                ? {
                    ...previousPresentation,
                    active: false,
                    cardsRemaining: 0,
                    revealedSelfCards: CARDS_PER_PLAYER,
                    revealedWidowCards: WIDOW_CARD_COUNT,
                }
                : previousPresentation
        ));
    }, []);

    const tutorialCoachActive = Boolean(
        tutorialState?.activeVersion === FIRST_GAME_TUTORIAL_VERSION
        && currentTableState?.theme === TUTORIAL_THEME_ID
        && currentTableState?.tableType === 'quickplay'
        && !isSpectator
        && !isObserverMode
    );
    const roundSummary = currentTableState?.roundSummary;
    const rawPresentationReadyAt = roundSummary?.presentationReadyAt;
    const presentationReadyAt = Number(rawPresentationReadyAt);
    const hasSharedPresentationClock = rawPresentationReadyAt !== null
        && rawPresentationReadyAt !== undefined
        && Number.isFinite(presentationReadyAt);
    const serverTime = Number(currentTableState?.serverTime);
    const hasServerTime = Number.isFinite(serverTime);
    const presentationRemainingAtReceipt = hasSharedPresentationClock
        ? presentationReadyAt - (hasServerTime ? serverTime : Date.now())
        : 0;
    const localPresentationDeadline = useMemo(
        () => Date.now() + Math.max(0, presentationRemainingAtReceipt),
        [presentationReadyAt, presentationRemainingAtReceipt]
    );
    const sharedPresentationReady = !hasSharedPresentationClock
        || presentationRemainingAtReceipt <= 0
        || Date.now() >= localPresentationDeadline;
    const rawPresentationForceReadyAt = roundSummary?.presentationForceReadyAt;
    const presentationForceReadyAt = Number(rawPresentationForceReadyAt);
    const hasPresentationForceClock = rawPresentationForceReadyAt !== null
        && rawPresentationForceReadyAt !== undefined
        && Number.isFinite(presentationForceReadyAt);
    const presentationForceRemainingAtReceipt = hasPresentationForceClock
        ? presentationForceReadyAt - (hasServerTime ? serverTime : Date.now())
        : null;
    const localPresentationForceDeadline = useMemo(
        () => hasPresentationForceClock
            ? Date.now() + Math.max(0, presentationForceRemainingAtReceipt)
            : null,
        [hasPresentationForceClock, presentationForceReadyAt, presentationForceRemainingAtReceipt]
    );
    const presentationForceReady = hasPresentationForceClock && (
        presentationForceRemainingAtReceipt <= 0
        || Date.now() >= localPresentationForceDeadline
    );
    const hasServerPresentationQuorum = roundSummary?.allConnectedHumansPresented !== undefined
        || rawPresentationForceReadyAt !== undefined;
    const serverRoundPresentationReady = !hasServerPresentationQuorum
        || roundSummary?.allConnectedHumansPresented === true
        || presentationForceReady;
    const isRoundPresentationState = Boolean(
        roundSummary && ROUND_PRESENTATION_STATES.has(currentTableState?.state)
    );
    const previousRoundScores = useMemo(
        () => scoresBeforeRound(roundSummary, currentTableState?.scores),
        [roundSummary, currentTableState?.scores]
    );
    const shouldHoldTableScores = Boolean(
        isRoundPresentationState
        && !ROUND_SCORES_RELEASED_PHASES.has(roundPresentationPhase)
        && !(roundPresentationPhase === 'idle'
            && sharedPresentationReady
            && hasSharedPresentationClock
            && currentTableState?.settlement?.status !== 'pending')
    );
    const tableStateForPresentation = useMemo(() => (
        shouldHoldTableScores && previousRoundScores
            ? { ...currentTableState, scores: previousRoundScores }
            : currentTableState
    ), [currentTableState, previousRoundScores, shouldHoldTableScores]);
    const tableStateForDealPresentation = useMemo(() => (
        dealPresentation.active
            ? {
                ...tableStateForPresentation,
                widow: [],
                originalDealtWidow: [],
                widowCount: dealPresentation.revealedWidowCards,
            }
            : tableStateForPresentation
    ), [
        dealPresentation.active,
        dealPresentation.revealedWidowCards,
        tableStateForPresentation,
    ]);
    const handStateForDealPresentation = useMemo(() => {
        if (!dealPresentation.active || !dealPresentation.localPlayerName) {
            return currentTableState;
        }

        const localPlayerName = dealPresentation.localPlayerName;
        const fullLocalHand = currentTableState?.hands?.[localPlayerName] || [];
        return {
            ...currentTableState,
            hands: {
                ...(currentTableState?.hands || {}),
                [localPlayerName]: fullLocalHand.slice(0, dealPresentation.revealedSelfCards),
            },
        };
    }, [
        currentTableState,
        dealPresentation.active,
        dealPresentation.localPlayerName,
        dealPresentation.revealedSelfCards,
    ]);
    const tutorialStateForDealPresentation = useMemo(() => (
        dealPresentation.active
            ? { ...currentTableState, state: 'Dealing Pending' }
            : currentTableState
    ), [currentTableState, dealPresentation.active]);
    const hasRoundScoreChanges = Object.values(roundSummary?.pointChanges || {})
        .some(value => Number.isFinite(Number(value)) && Number(value) !== 0);
    const selfRoundPointChange = Number(roundSummary?.pointChanges?.[selfPlayerName]);
    const scoreCollectionLabel = Number.isFinite(selfRoundPointChange)
        ? (selfRoundPointChange > 0
            ? 'Collect Points'
            : (selfRoundPointChange < 0 ? 'Hand Over Points' : 'Count the Score'))
        : 'Count the Score';
    const terminalSettlementStatus = currentTableState?.settlement?.status;
    const terminalSettlementBlocked = Boolean(
        roundSummary?.isGameOver
        && terminalSettlementStatus
        && terminalSettlementStatus !== 'complete'
    );
    const roundPresentationControlsLocked = isRoundPresentationState && [
        'waiting',
        'recap',
        'scoring',
        'score-settled-waiting'
    ].includes(roundPresentationPhase);
    const terminalSettlementMessage = terminalSettlementBlocked
        ? (roundSummary?.message || (terminalSettlementStatus === 'pending'
            ? 'Final settlement is still processing.'
            : 'Final settlement needs administrator review.'))
        : (roundSummary?.isGameOver
            && (!sharedPresentationReady || !serverRoundPresentationReady)
            ? 'Finishing the celebration for everyone at the table.'
            : null);

    useEffect(() => {
        if (!hasSharedPresentationClock) return undefined;
        const remaining = localPresentationDeadline - Date.now();
        if (remaining <= 0) return undefined;
        const timer = setTimeout(() => setPresentationClockTick(value => value + 1), remaining + 25);
        return () => clearTimeout(timer);
    }, [hasSharedPresentationClock, localPresentationDeadline]);

    useEffect(() => {
        if (!hasPresentationForceClock || roundSummary?.allConnectedHumansPresented === true) return undefined;
        const remaining = localPresentationForceDeadline - Date.now();
        if (remaining <= 0) return undefined;
        const timer = setTimeout(() => setPresentationClockTick(value => value + 1), remaining + 25);
        return () => clearTimeout(timer);
    }, [
        hasPresentationForceClock,
        localPresentationForceDeadline,
        roundSummary?.allConnectedHumansPresented
    ]);
    
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
        // The event is only a retry signal. The next authoritative gameState
        // remains the sole source of phase/generation data.
        const handleQuickPlayDecisionRejected = () => {
            setQuickPlayDecisionRejectionNonce(value => value + 1);
        };

        socket.on('new_lobby_message', handleNewChatMessage);
        socket.on('error', handlePlayerError);
        socket.on('drawDeclined', handleDrawDeclined);
        socket.on('quickPlayDecisionRejected', handleQuickPlayDecisionRejected);

        return () => {
            socket.off('new_lobby_message', handleNewChatMessage);
            socket.off('error', handlePlayerError);
            socket.off('drawDeclined', handleDrawDeclined);
            socket.off('quickPlayDecisionRejected', handleQuickPlayDecisionRejected);
            if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
        };
    }, [socket]);

    // Keyboard accessibility: close the top-most utility first and support debug toggles.
    useEffect(() => {
        const onKeyDown = (e) => {
            if (e.key === 'Escape') {
                if (showGameMenu) {
                    e.stopPropagation();
                    setShowGameMenu(false);
                    return;
                }
                if (chatOpen) {
                    e.stopPropagation();
                    setChatOpen(false);
                    return;
                }
            }
            // Toggle debug overlay with Shift+D
            if (e.key.toLowerCase() === 'd' && e.shiftKey) {
                e.preventDefault();
                setShowAnchorDebug(prev => !prev);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [chatOpen, showGameMenu]);
    
    const getPlayerNameByUserId = useCallback((targetPlayerId) => {
        if (!currentTableState?.players || !targetPlayerId) return String(targetPlayerId);
        const player = Object.values(currentTableState.players).find(p => p.userId === targetPlayerId);
        return player?.playerName || String(targetPlayerId);
    }, [currentTableState]);

    useEffect(() => {
        if (currentTableState) {
            const { state, drawRequest } = currentTableState;
            const shouldShow = state === 'DrawComplete'
                || ((drawRequest?.isActive || state === 'DrawDeclined') && !isSpectator);
            setShowDrawVoteModal(shouldShow);
            if (shouldShow) {
                setChatOpen(false);
                setShowGameMenu(false);
                setShowInsurancePrompt(false);
                setShowIosPwaPrompt(false);
            }
        }
    }, [currentTableState, isSpectator]);

    useEffect(() => {
        // Seats derive from the full seating roster, not playerOrderActive:
        // in a 4-player game playerOrderActive shrinks to the 3 active players
        // (the dealer sits out) but everyone keeps their fixed seat all game.
        const roster = (currentTableState?.playerMode === 4 && currentTableState?.seatingOrder?.length === 4)
            ? currentTableState.seatingOrder
            : currentTableState?.playerOrderActive;
        if (roster?.length > 0) {
            if (isSpectator) {
                // For spectators, show all players in a default arrangement
                if (roster.length === 3) {
                    setSeatAssignments({
                        self: roster[0],
                        opponentLeft: roster[1],
                        opponentRight: roster[2]
                    });
                } else if (roster.length === 4) {
                    setSeatAssignments({
                        self: roster[0],
                        opponentLeft: roster[1],
                        opponentAcross: roster[2],
                        opponentRight: roster[3]
                    });
                }
            } else if (playerId && currentTableState.players[playerId]) {
                // For players, show from their perspective (self at bottom)
                const myName = getPlayerNameByUserId(playerId);
                const selfIndex = roster.indexOf(myName);
                if (selfIndex !== -1) {
                    const n = roster.length;
                    const opponentLeftName = roster[(selfIndex + 1) % n];
                    const opponentRightName = roster[(selfIndex + n - 1) % n];
                    if (n === 4) {
                        setSeatAssignments({
                            self: myName,
                            opponentLeft: opponentLeftName,
                            opponentAcross: roster[(selfIndex + 2) % n],
                            opponentRight: opponentRightName
                        });
                    } else {
                        setSeatAssignments({ self: myName, opponentLeft: opponentLeftName, opponentRight: opponentRightName });
                    }
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
    
    // Hold the recap until the final trick + widow celebration finishes. Once
    // it opens, the recap, score count, and terminal result become one explicit
    // local presentation sequence. Repeated settlement broadcasts must not
    // restart that sequence.
    useEffect(() => {
        if (!currentTableState) return undefined;
        const { state, roundSummary } = currentTableState;
        const isModalState = ROUND_PRESENTATION_STATES.has(state);
        if (roundSummary && isModalState) {
            // A reconnect can receive Game Over while the settlement transaction
            // is still running. Keep the table undisturbed until the server has
            // an authoritative result and presentation clock. Failed settlement
            // still proceeds so its administrator-review message is visible.
            if (roundSummary.isGameOver && currentTableState.settlement?.status === 'pending') {
                return undefined;
            }
            if (!roundModalScheduledRef.current) {
                setChatOpen(false);
                setShowGameMenu(false);
                setShowInsurancePrompt(false);
                setShowIosPwaPrompt(false);
                setShowDrawVoteModal(false);
            }
            const rawReadyAt = roundSummary.presentationReadyAt;
            const readyAt = Number(rawReadyAt);
            const stateServerTime = Number(currentTableState.serverTime);
            const comparisonNow = Number.isFinite(stateServerTime) ? stateServerTime : Date.now();
            const presentationWasAlreadyCompleted = rawReadyAt !== null
                && rawReadyAt !== undefined
                && Number.isFinite(readyAt)
                && comparisonNow >= readyAt;
            if (!roundModalScheduledRef.current && presentationWasAlreadyCompleted) {
                roundModalScheduledRef.current = true;
                setShowRoundSummaryModal(false);
                setRoundPresentationPhase(roundSummary.isGameOver ? 'podium' : 'settled');
                return undefined;
            }
            if (prefersReducedMotion) {
                const wasWaitingOnTimer = Boolean(roundModalTimerRef.current);
                if (roundModalTimerRef.current) clearTimeout(roundModalTimerRef.current);
                roundModalTimerRef.current = null;
                if (!roundModalScheduledRef.current || wasWaitingOnTimer) {
                    roundModalScheduledRef.current = true;
                    setRoundPresentationPhase('recap');
                    setShowRoundSummaryModal(true);
                }
            } else if (!roundModalScheduledRef.current) {
                roundModalScheduledRef.current = true;
                setRoundPresentationPhase('waiting');
                setShowRoundSummaryModal(false);
                const delay = (isSpectator || roundSummary.forfeit) ? 0 : END_ROUND_TOTAL_MS;
                roundModalTimerRef.current = setTimeout(() => {
                    roundModalTimerRef.current = null;
                    setRoundPresentationPhase('recap');
                    setShowRoundSummaryModal(true);
                }, delay);
            }
        } else {
            roundModalScheduledRef.current = false;
            if (roundModalTimerRef.current) {
                clearTimeout(roundModalTimerRef.current);
                roundModalTimerRef.current = null;
            }
            if (roundAdvanceTimerRef.current) {
                clearTimeout(roundAdvanceTimerRef.current);
                roundAdvanceTimerRef.current = null;
            }
            setShowRoundSummaryModal(false);
            setRoundPresentationPhase('idle');
        }
        return undefined;
    }, [currentTableState, isSpectator, prefersReducedMotion]);

    useEffect(() => {
        if (!roundPresentationControlsLocked) return;
        setChatOpen(false);
        setShowGameMenu(false);
    }, [roundPresentationControlsLocked]);

    const handleRoundRecapContinue = useCallback(() => {
        if (hasRoundScoreChanges && !roundSummary?.forfeit) {
            setRoundPresentationPhase('scoring');
            return;
        }
        setShowRoundSummaryModal(false);
        setRoundPresentationPhase(roundSummary?.isGameOver ? 'podium' : 'settled');
    }, [hasRoundScoreChanges, roundSummary]);

    const handleScoreCeremonyComplete = useCallback(() => {
        // Start the reading window only after the score animation finishes.
        // If the server's shared presentation clock runs longer, keep the recap
        // up through that deadline so it transitions directly into an enabled
        // podium or next-round action instead of exposing a dead table gap.
        const sharedClockRemaining = hasSharedPresentationClock
            ? Math.max(0, localPresentationDeadline - Date.now())
            : 0;
        const settledRecapHold = Math.max(SETTLED_RECAP_HOLD_MS, sharedClockRemaining);
        setRoundPresentationPhase('score-settled-waiting');
        if (roundAdvanceTimerRef.current) clearTimeout(roundAdvanceTimerRef.current);
        roundAdvanceTimerRef.current = setTimeout(() => {
            roundAdvanceTimerRef.current = null;
            setShowRoundSummaryModal(false);
            setRoundPresentationPhase(roundSummary?.isGameOver ? 'podium' : 'settled');
        }, settledRecapHold);
    }, [hasSharedPresentationClock, localPresentationDeadline, roundSummary?.isGameOver]);

    useEffect(() => {
        const presentationComplete = roundPresentationPhase === 'settled'
            || roundPresentationPhase === 'podium';
        const readyAt = Number(roundSummary?.presentationReadyAt);
        const ackKey = `${currentTableState?.tableId || ''}:${readyAt}:${socket?.id || ''}`;
        const viewerAcknowledged = currentTableState?.viewerRoundPresentationAcknowledged;
        const acknowledgementWasConfirmed = roundPresentationConfirmedAckRef.current === ackKey;
        const acknowledgementWasInvalidated = viewerAcknowledged === false
            && acknowledgementWasConfirmed;

        if (viewerAcknowledged === true) {
            roundPresentationConfirmedAckRef.current = ackKey;
        } else if (acknowledgementWasInvalidated) {
            roundPresentationConfirmedAckRef.current = null;
        }

        if (!presentationComplete
            || (roundSummary?.isGameOver
                && terminalSettlementStatus
                && terminalSettlementStatus !== 'complete')
            || !Number.isFinite(readyAt)
            || !selfPlayerInTable
            || isSpectator
            || selfPlayerInTable.isBot
            || viewerAcknowledged === true
            || (roundPresentationAckRef.current === ackKey && !acknowledgementWasInvalidated)) {
            return;
        }

        roundPresentationAckRef.current = ackKey;
        emitEvent('ackRoundPresentation', { presentationReadyAt: readyAt });
    }, [
        currentTableState?.tableId,
        currentTableState?.viewerRoundPresentationAcknowledged,
        emitEvent,
        isSpectator,
        roundPresentationPhase,
        roundSummary?.presentationReadyAt,
        selfPlayerInTable,
        socket?.id,
        terminalSettlementStatus
    ]);

    useEffect(() => {
        if (!currentTableState || !selfPlayerName || isSpectator) return;
        const { state, trickTurnPlayerName, lastCompletedTrick, currentTrickCards } = currentTableState;
        if ((state === "Playing Phase" || state === "Bidding Phase") && trickTurnPlayerName === selfPlayerName && turnPlayerRef.current !== selfPlayerName) playSound('turnAlert');
        // Don't stamp the ref during Bid Announcement: the leader is assigned
        // then, and stamping would swallow their turn alert when play opens.
        if (state !== "Bid Announcement") turnPlayerRef.current = trickTurnPlayerName;
        const newCardCount = currentTrickCards?.length || 0;
        if (newCardCount > 0 && newCardCount !== cardCountRef.current) playSound('cardPlay');
        cardCountRef.current = newCardCount;
        if (lastCompletedTrick && lastCompletedTrick.winnerName === selfPlayerName && trickWinnerRef.current !== lastCompletedTrick.winnerName) playSound('trickWin');
        trickWinnerRef.current = lastCompletedTrick?.winnerName;
        if (state === 'Bidding Phase' && gameStateRef.current === 'Dealing Pending') playSound('cardDeal');
        // Bidding accents: play once each time the winning bid escalates, and on all-pass.
        const highBid = currentTableState.currentHighestBidDetails?.bid || null;
        if (highBid && highBid !== highBidRef.current) {
            if (highBid === 'Frog') playSound('bidFrog');
            else if (highBid === 'Solo') playSound('bidSolo');
            else if (highBid === 'Heart Solo') playSound('bidHeartSolo');
        }
        highBidRef.current = highBid;
        if (state === 'AllPassWidowReveal' && gameStateRef.current !== 'AllPassWidowReveal') playSound('bidAllPass');
        // Individual pass: knock when another player drops out of the bidding.
        const passedCount = currentTableState.playersWhoPassedThisRound?.length || 0;
        if (passedCount > passedCountRef.current) playSound('bidPass');
        passedCountRef.current = passedCount;
        // Note: the Solo trump-suit announcement now plays inside the round-start
        // VS splash (BidWinnerSplash), a beat after the bid sound replays.
        // The round-end fanfare plays at the widow flip (TableLayout),
        // not here, so the drumroll has time to build first.
        gameStateRef.current = state;
        // Clear selected discards when leaving Frog Widow Exchange
        if (state !== "Frog Widow Exchange") {
            setSelectedFrogDiscards([]);
        }
    }, [currentTableState, selfPlayerName, isSpectator, playSound, playerId]);
    
    // Global keyboard handler for puck debug
    useEffect(() => {
        const handleKeyPress = (e) => {
            if (e.shiftKey && e.key === 'D') {
                console.log('========== PUCK DEBUG TRIGGERED ==========');
                // Measure all player seats
                document.querySelectorAll('.player-seat-wrapper').forEach((wrapper) => {
                    const seatElement = wrapper.querySelector('.player-seat');
                    const nameElement = seatElement?.querySelector('.player-name');
                    const name = nameElement?.textContent;
                    if (name) {
                        const dealerPuck = wrapper.querySelector('.dealer-puck-ear');
                        const bidderPuck = wrapper.querySelector('.bidder-puck-ear');
                        
                        if (dealerPuck || bidderPuck) {
                            const wrapperRect = wrapper.getBoundingClientRect();
                            
                            console.log(`[PUCK DEBUG] ${name}:`);
                            
                            if (dealerPuck) {
                                const dealerRect = dealerPuck.getBoundingClientRect();
                                const topFromWrapper = (dealerRect.top - wrapperRect.top) / window.innerHeight * 100;
                                console.log(`  Dealer puck top from wrapper: ${topFromWrapper.toFixed(3)}vh`);
                                console.log(`  Dealer puck CSS top: ${window.getComputedStyle(dealerPuck).top}`);
                            }
                            
                            if (bidderPuck) {
                                const bidderRect = bidderPuck.getBoundingClientRect();
                                const topFromWrapper = (bidderRect.top - wrapperRect.top) / window.innerHeight * 100;
                                console.log(`  Bidder puck top from wrapper: ${topFromWrapper.toFixed(3)}vh`);
                                console.log(`  Bidder puck CSS top: ${window.getComputedStyle(bidderPuck).top}`);
                            }
                            
                            if (dealerPuck && bidderPuck) {
                                const dealerRect = dealerPuck.getBoundingClientRect();
                                const bidderRect = bidderPuck.getBoundingClientRect();
                                const diff = (dealerRect.top - bidderRect.top) / window.innerHeight * 100;
                                console.log(`  Vertical difference (dealer - bidder): ${diff.toFixed(3)}vh`);
                            }
                        }
                    }
                });
                console.log('==========================================');
            }
        };
        
        window.addEventListener('keydown', handleKeyPress);
        
        return () => {
            window.removeEventListener('keydown', handleKeyPress);
        };
    }, []);
    
    if (!currentTableState) {
        return <div>Loading table...</div>;
    }

    const toggleChatWindow = () => {
        setChatOpen(prev => !prev);
        if (!chatOpen) {
            setUnreadChat(0);
        }
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
        const backgroundColor = SUIT_BACKGROUNDS[suit] || '#fbfaf4';
        const cardClasses = ['card-display', className].filter(Boolean).join(' ');
        const cardContent = (
            <>
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
                {/* Mirrored bottom-right index, standard playing-card convention */}
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    position: 'absolute',
                    bottom: '2px',
                    right: '4px',
                    transform: 'rotate(180deg)'
                }}>
                    <span style={{ lineHeight: '1' }}>{rank !== '?' && rank}</span>
                    <span className="card-symbol" style={{ lineHeight: '1', marginTop: '-2px' }}>{symbol}</span>
                </div>
            </>
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
            // Pin the card font on the card itself so rank/suit glyphs keep the
            // same proportions no matter where the card is mounted — the Frog
            // discard overlay is portaled to <body>, outside .game-view, so it
            // can't inherit Merriweather from the game container.
            fontFamily: '"Merriweather", serif',
            display: 'inline-block',  // Changed from inline-flex for proper positioning
            position: 'relative',  // For absolute positioning of content
            padding: '2px',  // Override TableLayout.css padding
            boxSizing: 'border-box',
            // Selected = blue ring + glow + lift; card stock stays white
            boxShadow: isSelected ?
                '0 0 0 0.3vh #3b82f6, 0 0 1.6vh rgba(59, 130, 246, 0.75), 0 0.3vh 0.6vh rgba(0, 0, 0, 0.35)' :
                undefined,
            transform: isSelected ? 'translateY(-0.2vh) scale(1.05)' : undefined,
            transition: 'all 0.15s ease',
            flexShrink: 0,  // Prevent flex shrinking
            ...customStyle
        };
        
        if (isButton) {
            return (<button onClick={onClick} disabled={disabled} style={style} className={cardClasses}>{cardContent}</button>);
        }
        return (<span style={style} className={cardClasses}>{cardContent}</span>);
    };

    const handleShareInvite = async () => {
        setShowGameMenu(false);
        const result = await shareInvite(currentTableState.tableId, currentTableState.tableName);
        if (result === 'copied') {
            if (shareNoticeTimerRef.current) clearTimeout(shareNoticeTimerRef.current);
            setShareNotice('Invite link copied — send it to your friends!');
            shareNoticeTimerRef.current = setTimeout(() => setShareNotice(null), 4000);
        } else if (result === 'failed') {
            // No share sheet and no clipboard access — let them copy by hand.
            window.prompt('Copy this invite link:', getInviteUrl(currentTableState.tableId));
        }
    };

    useEffect(() => () => {
        if (shareNoticeTimerRef.current) clearTimeout(shareNoticeTimerRef.current);
        if (roundModalTimerRef.current) clearTimeout(roundModalTimerRef.current);
        roundModalTimerRef.current = null;
        roundModalScheduledRef.current = false;
        if (roundAdvanceTimerRef.current) clearTimeout(roundAdvanceTimerRef.current);
        roundAdvanceTimerRef.current = null;
    }, []);

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
    
    const GameMenu = () => createPortal(
        <div
            className="game-menu-layer"
            data-table-theme={themePresentation.id}
            style={{ zIndex: 2147483000 }}
        >
            <div
                className="game-menu-backdrop"
                aria-hidden="true"
                onClick={() => setShowGameMenu(false)}
            />
            <div
                id="game-menu-dialog"
                className="game-menu-popup"
                ref={gameMenuRef}
                role="dialog"
                aria-modal="true"
                aria-label="Game menu"
                tabIndex="-1"
            >
                <p className="game-menu-venue">{themePresentation.eyebrow}</p>
                <h3>{currentTableState.tableName}</h3>
                <p className="game-menu-description">{themePresentation.description}</p>
                <div className="game-menu-sound">
                    <SoundControls soundSettings={soundSettings} />
                </div>
                <div className="game-menu-actions">
                    <div className="game-menu-section">
                        <button onClick={() => { handleShowHowToPlay(); setShowGameMenu(false); }} className="game-menu-button">How to Play</button>
                        <button onClick={handleShareInvite} className="game-menu-button invite">Invite Friends</button>
                        <button
                            onClick={() => {
                                handleOpenFeedbackModal(currentTableState);
                                setShowGameMenu(false);
                            }}
                            className="game-menu-button feedback"
                        >
                            Send Feedback
                        </button>
                        <button
                            onClick={handleLeaveTable}
                            className="game-menu-button secondary"
                            aria-describedby={activeSeatIsHeld ? 'game-menu-seat-held-note' : undefined}
                        >
                            Return to Lobby
                        </button>
                        {activeSeatIsHeld && (
                            <p id="game-menu-seat-held-note" className="game-menu-helper">
                                Your seat stays reserved. Returning to the lobby does not forfeit the game.
                            </p>
                        )}
                    </div>
                    {(canRequestDraw || canForfeit) && (
                        <div className="game-menu-section game-menu-game-actions">
                            <p className="game-menu-section-title">Game Actions</p>
                            {canRequestDraw && (
                                <button
                                    onClick={() => { emitEvent("requestDraw"); setShowGameMenu(false); }}
                                    className="game-menu-button primary"
                                >
                                    Request Draw
                                </button>
                            )}
                            {canForfeit && (
                                <button onClick={handleForfeit} className="game-menu-button danger">Forfeit Game</button>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );

    return (
        <div
            className="game-view"
            data-table-theme={themePresentation.id}
            ref={gameViewRef}
        >
            {shareNotice && <div className="share-invite-notice">{shareNotice}</div>}
            {!roundPresentationControlsLocked && createPortal(
                <button
                    className="game-menu-btn game-header-menu-btn"
                    type="button"
                    aria-label="Open game menu"
                    aria-haspopup="dialog"
                    aria-expanded={showGameMenu}
                    aria-controls="game-menu-dialog"
                    onClick={event => {
                        event.currentTarget.focus();
                        setShowGameMenu(prev => !prev);
                    }}
                >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="3" y1="12" x2="21" y2="12"></line>
                        <line x1="3" y1="6" x2="21" y2="6"></line>
                        <line x1="3" y1="18" x2="21" y2="18"></line>
                    </svg>
                </button>,
                document.body
            )}
            {showGameMenu && !roundPresentationControlsLocked && <GameMenu />}
            {/* Card position debug overlay */}
            {false && window.cardDebugPositions && window.cardDebugPositions.length > 0 && (
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
            {bidSplashInfo && (
                <BidWinnerSplash
                    info={bidSplashInfo}
                    seatAssignments={seatAssignments}
                    playSound={playSound}
                    onDone={dismissBidSplash}
                />
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
                    {showAnchorDebug && (
                        <PlayerHandAnchorDebug />
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
                showScoreTotals={!roundSummary?.forfeit}
                title={roundSummary?.forfeit
                    ? 'Game Ended by Forfeit'
                    : (roundSummary?.isGameOver ? 'Final Round Recap' : 'Round Recap')}
                continueLabel={hasRoundScoreChanges && !roundSummary?.forfeit
                    ? scoreCollectionLabel
                    : (roundSummary?.isGameOver ? 'View Final Standings' : 'Continue')}
                onContinue={handleRoundRecapContinue}
                scoreStage={roundPresentationPhase === 'scoring'
                    ? 'counting'
                    : (roundPresentationPhase === 'score-settled-waiting' ? 'complete' : 'preview')}
                playerOrder={currentTableState.seatingOrder || currentTableState.playerOrderActive}
                playSound={playSound}
                onScoreComplete={handleScoreCeremonyComplete}
                prefersReducedMotion={prefersReducedMotion}
                scoreActionTimerMs={hasRoundScoreChanges && !roundSummary?.forfeit
                    ? ROUND_RECAP_ACTION_MS
                    : null}
                actionTimerKey={roundSummary?.presentationReadyAt}
                tutorialHint={tutorialCoachActive && roundPresentationPhase === 'recap'
                    ? (roundSummary?.forfeit ? TUTORIAL_FORFEIT_RECAP_HINT : TUTORIAL_RECAP_HINT)
                    : null}
            />

            <GameOverPodium
                show={roundPresentationPhase === 'podium' && currentTableState.state === 'Game Over'}
                gameWinner={roundSummary?.gameWinner}
                finalScores={roundSummary?.finalScores}
                forfeit={roundSummary?.forfeit}
                tokenSettlement={roundSummary?.tokenSettlement}
                statusMessage={terminalSettlementMessage}
                actionsDisabled={!sharedPresentationReady || !serverRoundPresentationReady}
                onRematch={(terminalSettlementBlocked || isSpectator)
                    ? undefined
                    : () => emitEvent('resetGame')}
                onLobby={handleLeaveTable}
            />

            <PlayerProfileModal
                playerName={profilePlayerName}
                currentUsername={user?.username}
                onClose={() => setProfilePlayerName(null)}
                onShowTokenLedger={onShowTokenLedger}
            />

            <TableLayout
                currentTableState={tableStateForDealPresentation}
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
                showDebugAnchors={showAnchorDebug}
                quickPlayDecisionRejectionNonce={quickPlayDecisionRejectionNonce}
                roundPresentationComplete={roundPresentationPhase === 'settled'
                    && sharedPresentationReady
                    && serverRoundPresentationReady}
                dealPresentationActive={dealPresentation.active}
                dealCardsRemaining={dealPresentation.cardsRemaining}
                suppressActionControls={dealPresentation.active}
                onPlayerProfile={setProfilePlayerName}
            />

            <TutorialCoach
                key={`${playerId}:${FIRST_GAME_TUTORIAL_VERSION}`}
                active={tutorialCoachActive}
                currentTableState={tutorialStateForDealPresentation}
                playerId={playerId}
                selfPlayerName={selfPlayerName}
                roundPresentationPhase={roundPresentationPhase}
                onAction={onTutorialAction}
                tutorialVersion={FIRST_GAME_TUTORIAL_VERSION}
            />
            
            <footer className="game-footer">
                <div
                    className="deal-local-hand-target"
                    data-deal-target="local-hand"
                    aria-hidden="true"
                />
                <PlayerHand
                    currentTableState={{
                        ...handStateForDealPresentation,
                        // Override the player data with the observed player's data if in observer mode
                        players: {
                            ...handStateForDealPresentation.players,
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
                    showDebug={false}
                />
                <div className="footer-controls-wrapper">
                    {['Playing Phase', 'TrickCompleteLinger'].includes(currentTableState.state) && currentTableState.bidWinnerInfo && (
                        <div
                            className="round-status-hud"
                            title={`${currentTableState.bidWinnerInfo.playerName}: ${currentTableState.bidderCardPoints || 0} card points; ${currentTableState.tricksPlayedCount || 0} of 11 tricks complete`}
                        >
                            <span>Tricks {currentTableState.tricksPlayedCount || 0}/11</span>
                            <span className="round-status-divider" aria-hidden="true">·</span>
                            <span className="round-status-bidder">{currentTableState.bidWinnerInfo.playerName} {currentTableState.bidderCardPoints || 0}/60</span>
                        </div>
                    )}
                    <InsuranceControls
                        insuranceState={currentTableState.insurance}
                        selfPlayerName={selfPlayerName}
                        isSpectator={isSpectator}
                        emitEvent={emitEvent}
                        onOpenPrompt={() => setShowInsurancePrompt(true)}
                    />
                    {(tableVoiceAvailable || !roundPresentationControlsLocked) && (
                        <div className="button-panel">
                            {tableVoiceAvailable && (
                                <VoiceControls
                                    key={currentTableState.tableId}
                                    socket={socket}
                                    tableId={currentTableState.tableId}
                                />
                            )}
                            {!roundPresentationControlsLocked && (
                                <button className="chat-tab-button" onClick={toggleChatWindow}>
                                    <span>Chat</span>
                                    {!chatOpen && unreadChat > 0 && <span className="unread-badge">{unreadChat}</span>}
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </footer>

            <DealAnimation
                active={dealPresentation.active}
                animationKey={dealPresentation.animationKey}
                playerOrder={dealPresentation.playerOrder}
                localPlayerName={dealPresentation.localPlayerName}
                scopeRef={gameViewRef}
                renderCard={renderCard}
                onCardLaunch={handleDealCardLaunch}
                onCardArrive={handleDealCardArrival}
                onComplete={handleDealAnimationComplete}
            />
            
            {chatOpen && !roundPresentationControlsLocked && (
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
