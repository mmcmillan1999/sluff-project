// frontend/src/components/game/VoiceControls.js
// Table voice is opt-in and off until the player turns it on. Nothing here
// touches the microphone before that: sitting down used to join and unmute
// immediately, which fired the OS permission prompt unasked and went live
// before the player had agreed to anything. Once enabled, the choice persists
// per device, so it is a one-time decision rather than a per-table nag.
//
// The prominent control is the player's own microphone toggle; the compact
// mixer controls only incoming player audio.
import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import VoiceChat from '../../utils/VoiceChat';
import { getVoiceEnabled as getVoiceEnabledInitial, setVoiceEnabled, useVoiceEnabled } from '../../utils/voicePreference';
import './VoiceControls.css';

const microphoneErrorMessage = (error) => {
    if (error?.name === 'NotAllowedError') {
        return 'Microphone access was blocked. Allow it in your browser settings, then try again.';
    }
    if (error?.name === 'TimeoutError') {
        return 'The microphone permission request timed out. Check the mic icon in your browser, then try again.';
    }
    if (error?.name === 'NotSupportedError') {
        return 'This browser cannot share your microphone. You can still listen to table voice.';
    }
    if (error?.name === 'NotFoundError') {
        return 'No microphone was found. You can still listen to table voice.';
    }
    return 'Your microphone could not start. You can still listen and try again.';
};

const connectionStatus = (peer) => {
    if (peer.connected) return null;
    const state = peer.iceState || 'new';
    if (state === 'failed') return 'connection failed';
    if (state === 'disconnected') return 'reconnecting';
    return 'connecting';
};

const MicrophoneIcon = ({ muted }) => (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M8.5 21h7" />
        {muted && <path className="voice-icon-slash" d="M4 4l16 16" />}
    </svg>
);

const MixerIcon = () => (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M10 14v6" />
        <circle cx="16" cy="7" r="2" />
        <circle cx="8" cy="17" r="2" />
    </svg>
);

const SpeakerIcon = ({ muted }) => (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M5 10h3l4-4v12l-4-4H5z" />
        {muted
            ? <path d="M16 10l4 4M20 10l-4 4" />
            : <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" />}
    </svg>
);

const VoiceControls = ({ socket, tableId }) => {
    const voiceEnabled = useVoiceEnabled();
    const [connectionState, setConnectionState] = useState(() => (
        getVoiceEnabledInitial() ? 'joining' : 'off'
    ));
    const [microphoneState, setMicrophoneState] = useState('muted');
    const [error, setError] = useState('');
    const [peers, setPeers] = useState([]);
    const [mixerOpen, setMixerOpen] = useState(false);
    const voiceRef = useRef(null);
    const sessionRef = useRef(0);
    const microphoneOperationRef = useRef(0);
    const mixerId = useId();

    const setLocalMicrophoneMuted = useCallback(async (
        muted,
        voice = voiceRef.current,
        session = sessionRef.current,
    ) => {
        if (!voice) return false;

        const operation = ++microphoneOperationRef.current;
        const isCurrent = () => (
            voiceRef.current === voice
            && sessionRef.current === session
            && microphoneOperationRef.current === operation
        );

        if (!muted && typeof document !== 'undefined' && document.visibilityState === 'hidden') {
            if (isCurrent()) setMicrophoneState('muted');
            return false;
        }

        if (muted) {
            // Reflect the privacy-safe state immediately. VoiceChat disables
            // the existing track synchronously before its promise settles.
            setMicrophoneState('muted');
        } else {
            setMicrophoneState('starting');
            setError('');
        }

        try {
            const changed = await voice.setMicrophoneMuted(muted);
            if (!isCurrent()) {
                // A stale activation may have resolved after a table change,
                // background event, or newer tap. Never let it stay live.
                if (!muted) void voice.setMicrophoneMuted(true);
                return false;
            }

            if (!muted && typeof document !== 'undefined' && document.visibilityState === 'hidden') {
                microphoneOperationRef.current += 1;
                await voice.setMicrophoneMuted(true);
                if (voiceRef.current === voice && sessionRef.current === session) {
                    setMicrophoneState('muted');
                }
                return false;
            }

            setMicrophoneState(muted || changed === false ? 'muted' : 'live');
            return changed !== false;
        } catch (micError) {
            if (isCurrent()) {
                setMicrophoneState('muted');
                setError(microphoneErrorMessage(micError));
            }
            return false;
        }
    }, []);

    useEffect(() => {
        // Opted out (the default): stay entirely inert. No VoiceChat instance,
        // no signalling, and above all no getUserMedia.
        if (!voiceEnabled) {
            sessionRef.current += 1;
            microphoneOperationRef.current += 1;
            if (voiceRef.current) {
                voiceRef.current.leave();
                voiceRef.current = null;
            }
            setConnectionState('off');
            setMicrophoneState('muted');
            setError('');
            setPeers([]);
            setMixerOpen(false);
            return undefined;
        }

        const session = ++sessionRef.current;
        microphoneOperationRef.current += 1;
        setConnectionState('joining');
        setMicrophoneState('starting');
        setError('');
        setPeers([]);
        setMixerOpen(false);

        let voice;
        voice = new VoiceChat(socket, tableId, {
            onPeersChanged: (nextPeers) => {
                if (voiceRef.current === voice && sessionRef.current === session) {
                    setPeers(nextPeers);
                }
            },
            onError: (micError) => {
                if (voiceRef.current === voice && sessionRef.current === session) {
                    setMicrophoneState('muted');
                    setError(microphoneErrorMessage(micError));
                }
            },
        });
        voiceRef.current = voice;

        const joinVoice = async () => {
            try {
                await voice.join();
                if (voiceRef.current !== voice || sessionRef.current !== session) {
                    voice.leave();
                    return;
                }

                setConnectionState('joined');
                // Going live here is the player's own opt-in taking effect —
                // they turned voice on, so the mic being open is the thing they
                // asked for. A blocked prompt affects sending only; receive
                // voice remains.
                await setLocalMicrophoneMuted(false, voice, session);
            } catch (joinError) {
                if (voiceRef.current !== voice || sessionRef.current !== session) return;
                voice.leave();
                voiceRef.current = null;
                setConnectionState('error');
                setMicrophoneState('muted');
                setError('Table voice could not connect. Re-enter the table to try again.');
            }
        };

        void joinVoice();

        return () => {
            sessionRef.current += 1;
            microphoneOperationRef.current += 1;
            if (voiceRef.current === voice) voiceRef.current = null;
            voice.leave();
        };
    }, [setLocalMicrophoneMuted, socket, tableId, voiceEnabled]);

    // An admin muted this player mid-session: the server has already removed
    // them from the signaling room; tear down the local half and say why.
    useEffect(() => {
        if (!socket) return undefined;
        const onEjected = () => {
            if (voiceRef.current) {
                voiceRef.current.leave();
                voiceRef.current = null;
            }
            sessionRef.current += 1;
            microphoneOperationRef.current += 1;
            setConnectionState('error');
            setMicrophoneState('muted');
            setPeers([]);
            setError('Voice chat ended: your chat access is suspended.');
        };
        socket.on('voiceEjected', onEjected);
        return () => socket.off('voiceEjected', onEjected);
    }, [socket]);

    useEffect(() => {
        const muteForBackground = () => {
            if (document.visibilityState === 'hidden') {
                void setLocalMicrophoneMuted(true);
            }
        };
        const muteForPageHide = () => {
            void setLocalMicrophoneMuted(true);
        };

        document.addEventListener('visibilitychange', muteForBackground);
        window.addEventListener('pagehide', muteForPageHide);
        return () => {
            document.removeEventListener('visibilitychange', muteForBackground);
            window.removeEventListener('pagehide', muteForPageHide);
        };
    }, [setLocalMicrophoneMuted]);

    const microphoneLive = microphoneState === 'live';
    const microphoneStarting = microphoneState === 'starting';
    const voiceJoined = connectionState === 'joined';
    const microphoneLabel = microphoneLive ? 'Mute microphone' : 'Unmute microphone';

    const toggleMicrophone = () => {
        if (!voiceJoined || microphoneStarting) return;
        void setLocalMicrophoneMuted(microphoneLive);
    };

    // Off is the default and the resting state. One tap turns table voice on
    // for good on this device; the OS microphone prompt appears only after it,
    // as a consequence of the player's choice rather than of sitting down.
    if (!voiceEnabled) {
        return (
            <div
                className="voice-controls"
                role="group"
                aria-label="Table voice controls"
                data-connection-state="off"
            >
                <div className="voice-primary-row">
                    <button
                        type="button"
                        className="voice-enable-btn"
                        onClick={() => setVoiceEnabled(true)}
                        title="Talk to the other players at this table using your microphone"
                    >
                        <MicrophoneIcon muted />
                        <span className="voice-enable-label">Turn on voice</span>
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div
            className="voice-controls"
            role="group"
            aria-label="Table voice controls"
            data-connection-state={connectionState}
        >
            <div className="voice-primary-row">
                <button
                    type="button"
                    className={`voice-self-btn${microphoneLive ? ' is-live' : ' is-muted'}`}
                    onClick={toggleMicrophone}
                    disabled={!voiceJoined || microphoneStarting}
                    aria-label={connectionState === 'joining' ? 'Connecting table voice' : microphoneLabel}
                    aria-pressed={!microphoneLive}
                >
                    <MicrophoneIcon muted={!microphoneLive} />
                </button>

                <button
                    type="button"
                    className="voice-mixer-btn"
                    onClick={() => setMixerOpen(open => !open)}
                    // Gated on the preference, not on a successful join: if
                    // joining fails this is the only way back out, and
                    // disabling it would strand the player with voice
                    // permanently on and getUserMedia retried at every table.
                    disabled={!voiceEnabled}
                    aria-label={mixerOpen ? 'Close voice settings' : 'Open voice settings'}
                    aria-expanded={mixerOpen}
                    aria-controls={mixerId}
                >
                    <MixerIcon />
                </button>
            </div>

            {createPortal(<div className="voice-popover-stack">
                {connectionState === 'joining' && (
                    <span className="voice-connection-status" role="status" aria-live="polite">
                        Joining table voice…
                    </span>
                )}
                {error && <p className="voice-error" role="alert">{error}</p>}

                {mixerOpen && (
                    <div className="voice-mixer" id={mixerId} role="group" aria-label="Voice player volumes">
                        <div className="voice-mixer-heading">
                            <strong>Table voice</strong>
                            <span>{peers.length} {peers.length === 1 ? 'player' : 'players'}</span>
                        </div>
                        {voiceJoined && peers.length === 0 && (
                            <p className="voice-mixer-empty">Waiting for other players to connect.</p>
                        )}
                        {!voiceJoined && (
                            <p className="voice-mixer-empty">Table voice is not connected.</p>
                        )}
                        <button
                            type="button"
                            className="voice-disable-btn"
                            onClick={() => setVoiceEnabled(false)}
                        >
                            Turn off voice chat
                        </button>
                        {peers.map((peer) => {
                            const peerMicrophoneLive = peer.microphoneLive ?? peer.speaking;
                            const peerStatus = connectionStatus(peer);
                            return (
                                <div className="voice-mixer-row" key={peer.userId}>
                                    <span className={`voice-peer-name${peerMicrophoneLive ? ' is-live' : ''}`}>
                                        <span className="voice-peer-dot" aria-hidden="true" />
                                        <span className="voice-peer-copy">
                                            <span>{peer.playerName}</span>
                                            {peerStatus && <em className="voice-peer-status">{peerStatus}</em>}
                                        </span>
                                        {peerMicrophoneLive && (
                                            <span className="voice-sr-only"> microphone active</span>
                                        )}
                                    </span>
                                    <input
                                        type="range"
                                        min="0"
                                        max="150"
                                        value={Math.round(peer.volume * 100)}
                                        disabled={peer.muted}
                                        onChange={(event) => voiceRef.current?.setVolume(
                                            peer.userId,
                                            Number(event.target.value) / 100,
                                        )}
                                        aria-label={`${peer.playerName} volume`}
                                        aria-valuetext={`${Math.round(peer.volume * 100)} percent`}
                                    />
                                    <button
                                        type="button"
                                        className={`voice-peer-mute${peer.muted ? ' is-muted' : ''}`}
                                        onClick={() => voiceRef.current?.setMuted(peer.userId, !peer.muted)}
                                        aria-label={peer.muted ? `Unmute ${peer.playerName}` : `Mute ${peer.playerName}`}
                                        aria-pressed={peer.muted}
                                    >
                                        <SpeakerIcon muted={peer.muted} />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>, document.body)}
        </div>
    );
};

export default VoiceControls;
