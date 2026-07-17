// frontend/src/components/game/VoiceControls.js
// Table voice chat UI: join, hold-to-talk, and a per-player mixer
// (volume + mute) for everyone else in the voice room.
import React, { useEffect, useRef, useState } from 'react';
import VoiceChat from '../../utils/VoiceChat';
import './VoiceControls.css';

const VoiceControls = ({ socket, tableId }) => {
    const [joined, setJoined] = useState(false);
    const [joining, setJoining] = useState(false);
    const [error, setError] = useState('');
    const [talking, setTalking] = useState(false);
    const [peers, setPeers] = useState([]);
    const [mixerOpen, setMixerOpen] = useState(false);
    const voiceRef = useRef(null);

    // Tear down entirely when the table changes or the view unmounts.
    useEffect(() => () => {
        voiceRef.current?.leave();
        voiceRef.current = null;
    }, [tableId]);

    // Desktop nicety: hold V to talk (ignored while typing).
    useEffect(() => {
        if (!joined) return undefined;
        const isTyping = () => {
            const el = document.activeElement;
            return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
        };
        const down = (event) => {
            if (event.repeat || isTyping()) return;
            if (event.key === 'v' || event.key === 'V') {
                voiceRef.current?.setTalking(true);
                setTalking(true);
            }
        };
        const up = (event) => {
            if (event.key === 'v' || event.key === 'V') {
                voiceRef.current?.setTalking(false);
                setTalking(false);
            }
        };
        window.addEventListener('keydown', down);
        window.addEventListener('keyup', up);
        return () => {
            window.removeEventListener('keydown', down);
            window.removeEventListener('keyup', up);
        };
    }, [joined]);

    const handleJoin = async () => {
        if (joining || joined) return;
        setJoining(true);
        setError('');
        try {
            const voice = new VoiceChat(socket, tableId, {
                onPeersChanged: setPeers,
            });
            await voice.join();
            voiceRef.current = voice;
            setJoined(true);
        } catch (err) {
            const denied = err?.name === 'NotAllowedError';
            setError(denied
                ? 'Microphone access was blocked. Allow it in your browser settings to use voice.'
                : 'Could not start voice. Check your microphone and try again.');
        } finally {
            setJoining(false);
        }
    };

    const handleLeave = () => {
        voiceRef.current?.leave();
        voiceRef.current = null;
        setJoined(false);
        setTalking(false);
        setPeers([]);
        setMixerOpen(false);
    };

    const startTalk = (event) => {
        event.preventDefault();
        voiceRef.current?.setTalking(true);
        setTalking(true);
    };
    const stopTalk = () => {
        voiceRef.current?.setTalking(false);
        setTalking(false);
    };

    if (!joined) {
        return (
            <div className="voice-controls">
                <button
                    type="button"
                    className="voice-join-btn"
                    onClick={handleJoin}
                    disabled={joining}
                    title="Join table voice chat"
                >
                    🎙 {joining ? 'Joining…' : 'Voice'}
                </button>
                {error && <p className="voice-error" role="alert">{error}</p>}
            </div>
        );
    }

    return (
        <div className="voice-controls">
            <button
                type="button"
                className={`voice-ptt-btn${talking ? ' is-talking' : ''}`}
                onPointerDown={startTalk}
                onPointerUp={stopTalk}
                onPointerLeave={stopTalk}
                onPointerCancel={stopTalk}
                onContextMenu={(event) => event.preventDefault()}
                aria-pressed={talking}
                title="Hold to talk (or hold V)"
            >
                {talking ? '🔴 Talking' : '🎙 Hold to Talk'}
            </button>

            <div className="voice-secondary-row">
                <button
                    type="button"
                    className="voice-mini-btn"
                    onClick={() => setMixerOpen(open => !open)}
                    aria-expanded={mixerOpen}
                    title="Player volumes"
                >
                    🎚
                </button>
                <button
                    type="button"
                    className="voice-mini-btn voice-leave-btn"
                    onClick={handleLeave}
                    title="Leave voice"
                >
                    ✕
                </button>
            </div>

            {mixerOpen && (
                <div className="voice-mixer" role="group" aria-label="Voice player volumes">
                    {peers.length === 0 && (
                        <p className="voice-mixer-empty">No one else is in voice yet.</p>
                    )}
                    {peers.map(peer => (
                        <div className="voice-mixer-row" key={peer.userId}>
                            <span className={`voice-peer-name${peer.speaking ? ' is-speaking' : ''}`}>
                                <span className="voice-peer-dot" aria-hidden="true" />
                                {peer.playerName}
                                {!peer.connected && <em className="voice-peer-status"> connecting…</em>}
                            </span>
                            <input
                                type="range"
                                min="0"
                                max="150"
                                value={Math.round(peer.volume * 100)}
                                disabled={peer.muted}
                                onChange={(event) => voiceRef.current?.setVolume(peer.userId, Number(event.target.value) / 100)}
                                aria-label={`${peer.playerName} volume`}
                            />
                            <button
                                type="button"
                                className={`voice-mini-btn voice-mute-btn${peer.muted ? ' is-muted' : ''}`}
                                onClick={() => voiceRef.current?.setMuted(peer.userId, !peer.muted)}
                                aria-pressed={peer.muted}
                                title={peer.muted ? `Unmute ${peer.playerName}` : `Mute ${peer.playerName}`}
                            >
                                {peer.muted ? '🔇' : '🔊'}
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default VoiceControls;
