import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import './LobbyChat.css';
import {
    getBlockedPlayers,
    reportChatMessage,
    sendLobbyChatMessage,
    setPlayerBlocked,
} from '../services/api';

// Report and block are App Store guideline 1.2 requirements, so they have to be
// reachable from the offending message itself rather than buried in a settings
// screen. Tapping a message opens its actions; nothing there is destructive and
// blocking is reversible from the same place.
const MAX_MESSAGE_LENGTH = 300;

const LobbyChat = ({ socket, messages = [], currentUserId }) => {
    const [message, setMessage] = useState('');
    const [sendError, setSendError] = useState('');
    const [openActionsFor, setOpenActionsFor] = useState(null);
    const [blockedIds, setBlockedIds] = useState(() => new Set());
    const [notice, setNotice] = useState('');
    const chatLogRef = useRef(null);

    useEffect(() => {
        let cancelled = false;
        // Promise.resolve so a stubbed or absent implementation cannot throw
        // here: a block list that fails to load must degrade to "no live
        // filtering", never to a chat pane that will not render.
        Promise.resolve()
            .then(() => getBlockedPlayers())
            .then(rows => {
                if (cancelled || !Array.isArray(rows)) return;
                setBlockedIds(new Set(rows.map(row => Number(row.user_id))));
            })
            .catch(() => {
                // History is already filtered server-side; only live messages
                // from a blocked player would slip past until the next load.
            });
        return () => { cancelled = true; };
    }, []);

    // History arrives pre-filtered, but a live broadcast goes to everyone at
    // once, so the block list is applied again here.
    const visibleMessages = useMemo(
        () => messages.filter(msg => !blockedIds.has(Number(msg.user_id))),
        [messages, blockedIds],
    );

    useEffect(() => {
        if (chatLogRef.current) {
            chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight;
        }
    }, [visibleMessages]);

    useEffect(() => {
        if (!notice) return undefined;
        const timer = setTimeout(() => setNotice(''), 3500);
        return () => clearTimeout(timer);
    }, [notice]);

    const handleSend = async () => {
        const trimmed = message.trim();
        if (!trimmed) return;
        try {
            await sendLobbyChatMessage(trimmed);
            setMessage('');
            setSendError('');
        } catch (err) {
            setSendError(err.message || 'Your message could not be sent.');
        }
    };

    const handleReport = useCallback(async (msg) => {
        setOpenActionsFor(null);
        try {
            await reportChatMessage(msg.id, 'abuse');
            setNotice('Thanks — that message has been reported.');
        } catch (err) {
            setNotice(err.message || 'That report could not be sent.');
        }
    }, []);

    const handleBlock = useCallback(async (msg) => {
        setOpenActionsFor(null);
        const userId = Number(msg.user_id);
        const blocked = !blockedIds.has(userId);
        try {
            await setPlayerBlocked(userId, blocked);
            setBlockedIds(previous => {
                const next = new Set(previous);
                if (blocked) next.add(userId);
                else next.delete(userId);
                return next;
            });
            setNotice(blocked
                ? `You will no longer see messages from ${msg.username}.`
                : `${msg.username} is unblocked.`);
        } catch (err) {
            setNotice(err.message || 'That block could not be updated.');
        }
    }, [blockedIds]);

    return (
        <>
            <div className="chat-log-window" ref={chatLogRef}>
                {visibleMessages.length === 0 ? (
                    <p className="chat-placeholder-text">No messages yet.</p>
                ) : (
                    visibleMessages.map(msg => {
                        const isOwn = currentUserId != null
                            && Number(msg.user_id) === Number(currentUserId);
                        const isOpen = openActionsFor === msg.id;
                        const canAct = !isOwn && msg.user_id != null;
                        return (
                            <div key={msg.id} className="chat-line">
                                <button
                                    type="button"
                                    className="chat-line-body"
                                    onClick={() => canAct && setOpenActionsFor(isOpen ? null : msg.id)}
                                    aria-expanded={canAct ? isOpen : undefined}
                                    aria-label={canAct
                                        ? `Message from ${msg.username}: ${msg.message}. Activate for report and block options.`
                                        : `Your message: ${msg.message}`}
                                >
                                    <strong>{msg.username}: </strong>{msg.message}
                                </button>
                                {isOpen && canAct && (
                                    <div className="chat-line-actions" role="group" aria-label="Message actions">
                                        <button type="button" onClick={() => handleReport(msg)}>
                                            Report
                                        </button>
                                        <button type="button" onClick={() => handleBlock(msg)}>
                                            {blockedIds.has(Number(msg.user_id)) ? 'Unblock' : 'Block'}
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>
            {notice && <p className="chat-notice" role="status">{notice}</p>}
            {sendError && <p className="chat-notice chat-notice--error" role="alert">{sendError}</p>}
            <div className="chat-input-area">
                <input
                    type="text"
                    placeholder="Type a message..."
                    className="chat-input"
                    value={message}
                    maxLength={MAX_MESSAGE_LENGTH}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                />
                <button className="chat-send-button" onClick={handleSend} disabled={!message.trim()}>
                    <svg width="24" height="24" viewBox="0 0 24 24">
                        <path fill="currentColor" d="M13,20H11V8L5.5,13.5L4.08,12.08L12,4.16L19.92,12.08L18.5,13.5L13,8V20Z" />
                    </svg>
                </button>
            </div>
        </>
    );
};

export default LobbyChat;
