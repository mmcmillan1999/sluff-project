import React, { useState, useEffect, useRef } from 'react';
import './LobbyChat.css';
import { sendLobbyChatMessage } from '../services/api';

// Component now receives messages as a prop
const LobbyChat = ({ socket, messages = [] }) => {
    const [message, setMessage] = useState('');
    const chatLogRef = useRef(null);

    // Scroll to the bottom whenever the messages prop changes
    useEffect(() => {
        if (chatLogRef.current) {
            chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight;
        }
    }, [messages]);

    const handleSend = async () => {
        if (message.trim()) {
            try {
                // The send logic remains the same
                await sendLobbyChatMessage(message.trim());
                setMessage('');
            } catch (err) {
                console.error('Failed to send chat message:', err);
            }
        }
    };

    // The stray brace has been removed from before this return statement
    return (
        <>
            <div className="chat-log-window" ref={chatLogRef}>
                {messages.length === 0 ? (
                    <p className="chat-placeholder-text">No messages yet.</p>
                ) : (
                    messages.map(msg => (
                        <div key={msg.id} className="chat-line">
                            <strong>{msg.username}: </strong>{msg.message}
                        </div>
                    ))
                )}
            </div>
            <div className="chat-input-area">
                <input 
                    type="text" 
                    placeholder="Type a message..." 
                    className="chat-input"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSend()}
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