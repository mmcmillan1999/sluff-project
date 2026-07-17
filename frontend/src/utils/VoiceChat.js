// frontend/src/utils/VoiceChat.js
// Push-to-talk voice chat for a Sluff table.
//
// Architecture: WebRTC peer-to-peer mesh (each participant connects directly
// to every other participant — at most 3 peers, well within mesh limits).
// Audio never touches the game server; Socket.IO only relays the WebRTC
// handshake (offers/answers/ICE) between players seated at the same table.
//
// Push-to-talk RELEASES the microphone entirely between presses and
// re-acquires it on press via RTCRtpSender.replaceTrack (no renegotiation).
// Holding the mic open all the time would keep the phone's audio session in
// call mode, which ducks the game's music/effects the entire time voice is
// joined (and players compensate with hardware volume, then get blasted when
// the session flips modes). Releasing capture between presses keeps game
// audio at its true level except during the moment someone is talking. The
// price is ~100-300ms of mic spin-up on the first syllable of each press.
//
// Remote audio routes through a per-peer WebAudio GainNode, which is what
// makes per-player volume work on iOS (media-element volume is read-only
// there).
//
// NAT traversal: STUN by default (free). For the small share of networks
// that need a relay, provide TURN credentials via VITE_TURN_URL /
// VITE_TURN_USERNAME / VITE_TURN_CREDENTIAL.

const buildIceServers = () => {
    const servers = [
        { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    ];
    const turnUrl = import.meta.env.VITE_TURN_URL;
    if (turnUrl) {
        servers.push({
            urls: turnUrl,
            username: import.meta.env.VITE_TURN_USERNAME || '',
            credential: import.meta.env.VITE_TURN_CREDENTIAL || '',
        });
    }
    return servers;
};

const MIC_CONSTRAINTS = {
    audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
    },
    video: false,
};

const DEFAULT_VOLUME = 1.0;
const MAX_VOLUME = 1.5;

// A dismissed (not denied) permission prompt leaves getUserMedia pending
// FOREVER in Chrome — without a timeout the UI would hang on "Joining…".
const MIC_TIMEOUT_MS = 12000;

const acquireMic = () => {
    if (!navigator.mediaDevices?.getUserMedia) {
        const unsupported = new Error('Voice chat is not supported in this browser.');
        unsupported.name = 'NotSupportedError';
        return Promise.reject(unsupported);
    }
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            const timeout = new Error('Timed out waiting for microphone permission.');
            timeout.name = 'TimeoutError';
            reject(timeout);
        }, MIC_TIMEOUT_MS);
        navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS).then(
            (stream) => { clearTimeout(timer); resolve(stream); },
            (error) => { clearTimeout(timer); reject(error); },
        );
    });
};

class VoiceChat {
    constructor(socket, tableId, { onPeersChanged, onSpeakingChanged, onError } = {}) {
        this.socket = socket;
        this.tableId = tableId;
        this.onPeersChanged = onPeersChanged || (() => {});
        this.onSpeakingChanged = onSpeakingChanged || (() => {});
        this.onError = onError || (() => {});
        this.peers = new Map(); // userId -> peer record
        this.micStream = null;  // live only while the talk button is held
        this.audioContext = null;
        this.joined = false;
        this.talking = false;
        this.talkToken = 0;     // invalidates in-flight mic acquisitions
        this.boundHandlers = null;
    }

    async join() {
        if (this.joined) return;
        // Prompt for permission up front (and fail early with a clear error),
        // then release the device immediately — capture only runs while the
        // talk button is held. The grant is cached for subsequent presses.
        const probe = await acquireMic();
        probe.getTracks().forEach(track => track.stop());

        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        this.audioContext = new AudioContextClass();
        // join() runs from a user gesture, which is what iOS needs to unlock
        // audio. Fire-and-forget: resume() can wedge in odd session states and
        // must never hang the join.
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume().catch(() => {});
        }

        this._bindSocket();
        this.joined = true;
        this.socket.emit('voiceJoin', { tableId: this.tableId });
    }

    leave() {
        if (this.boundHandlers) {
            for (const [event, handler] of Object.entries(this.boundHandlers)) {
                this.socket.off(event, handler);
            }
            this.boundHandlers = null;
        }
        this._releaseMic();
        if (this.joined) {
            this.socket.emit('voiceLeave', { tableId: this.tableId });
        }
        for (const userId of [...this.peers.keys()]) {
            this._teardownPeer(userId, { silent: true });
        }
        this.peers.clear();
        if (this.audioContext) {
            this.audioContext.close().catch(() => {});
            this.audioContext = null;
        }
        this.joined = false;
        this.talking = false;
        this._emitPeers();
    }

    // --- push-to-talk ------------------------------------------------------

    async setTalking(on) {
        if (!this.joined) return;
        if (on) {
            this.talkToken += 1;
            const token = this.talkToken;
            if (this.micStream || this.talking) return;
            this.talking = true;
            try {
                const stream = await acquireMic();
                // Released (or left voice) before the mic spun up.
                if (this.talkToken !== token || !this.talking || !this.joined) {
                    stream.getTracks().forEach(track => track.stop());
                    return;
                }
                this.micStream = stream;
                const track = stream.getAudioTracks()[0];
                for (const peer of this.peers.values()) {
                    peer.audioSender?.replaceTrack(track).catch(() => {});
                }
                this.socket.emit('voiceSpeaking', { tableId: this.tableId, speaking: true });
            } catch (error) {
                this.talking = false;
                this.onError(error);
            }
        } else {
            this.talkToken += 1;
            if (!this.talking) return;
            this.talking = false;
            if (this.micStream) {
                this.socket.emit('voiceSpeaking', { tableId: this.tableId, speaking: false });
            }
            this._releaseMic();
        }
    }

    _releaseMic() {
        if (!this.micStream) return;
        for (const peer of this.peers.values()) {
            peer.audioSender?.replaceTrack(null).catch(() => {});
        }
        this.micStream.getTracks().forEach(track => track.stop());
        this.micStream = null;
    }

    // --- per-peer output controls -------------------------------------------

    setVolume(userId, volume) {
        const peer = this.peers.get(userId);
        if (!peer) return;
        peer.volume = Math.max(0, Math.min(MAX_VOLUME, Number(volume)));
        this._applyGain(peer);
        this._emitPeers();
    }

    setMuted(userId, muted) {
        const peer = this.peers.get(userId);
        if (!peer) return;
        peer.muted = Boolean(muted);
        this._applyGain(peer);
        this._emitPeers();
    }

    _applyGain(peer) {
        if (peer.gainNode) {
            peer.gainNode.gain.value = peer.muted ? 0 : peer.volume;
        }
    }

    // --- signaling ----------------------------------------------------------

    _bindSocket() {
        const handlers = {
            voiceRoster: ({ tableId, peers }) => {
                if (tableId !== this.tableId) return;
                // We are the newcomer: initiate an offer to everyone already in.
                for (const peer of peers || []) {
                    this._createPeer(Number(peer.userId), peer.playerName, true);
                }
                this._emitPeers();
            },
            voicePeerJoined: ({ userId, playerName }) => {
                // The joiner initiates; we just prepare a record to answer with.
                this._createPeer(Number(userId), playerName, false);
                this._emitPeers();
            },
            voicePeerLeft: ({ userId }) => {
                this._teardownPeer(Number(userId));
                this._emitPeers();
            },
            voiceSignal: ({ fromUserId, data }) => {
                this._handleSignal(Number(fromUserId), data).catch(error => {
                    console.error('[voice] signal handling failed:', error);
                });
            },
            voiceSpeaking: ({ userId, speaking }) => {
                const peer = this.peers.get(Number(userId));
                if (peer) peer.speaking = Boolean(speaking);
                this.onSpeakingChanged(Number(userId), Boolean(speaking));
                this._emitPeers();
            },
        };
        this.boundHandlers = handlers;
        for (const [event, handler] of Object.entries(handlers)) {
            this.socket.on(event, handler);
        }
    }

    _signal(targetUserId, data) {
        this.socket.emit('voiceSignal', { tableId: this.tableId, targetUserId, data });
    }

    _createPeer(userId, playerName, initiator) {
        if (this.peers.has(userId)) {
            const existing = this.peers.get(userId);
            existing.playerName = playerName || existing.playerName;
            return existing;
        }

        const pc = new RTCPeerConnection({ iceServers: buildIceServers() });
        const peer = {
            userId,
            playerName: playerName || 'Player',
            pc,
            initiator,
            connected: false,
            speaking: false,
            muted: false,
            volume: DEFAULT_VOLUME,
            gainNode: null,
            audioEl: null,
            audioSender: null,
            pendingCandidates: [],
        };
        this.peers.set(userId, peer);

        // A dedicated audio transceiver keeps the m-line negotiated even while
        // no track is being sent; replaceTrack later swaps the live mic in and
        // out without renegotiation. (An unassociated transceiver added before
        // setRemoteDescription is reused by the remote offer, so both sides
        // share a single audio line.)
        try {
            const transceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
            peer.audioSender = transceiver.sender;
            if (this.micStream) {
                const track = this.micStream.getAudioTracks()[0];
                if (track) peer.audioSender.replaceTrack(track).catch(() => {});
            }
        } catch (error) {
            console.error('[voice] failed to add audio transceiver:', error);
        }

        pc.onicecandidate = (event) => {
            if (event.candidate) this._signal(userId, { candidate: event.candidate });
        };
        pc.ontrack = (event) => {
            this._attachRemoteStream(peer, event.streams[0] || new MediaStream([event.track]));
        };
        pc.onconnectionstatechange = () => {
            peer.connected = pc.connectionState === 'connected';
            if (pc.connectionState === 'failed') {
                // One retry via ICE restart; WebRTC handles the renegotiation.
                pc.restartIce?.();
            }
            this._emitPeers();
        };

        if (initiator) {
            pc.onnegotiationneeded = async () => {
                try {
                    await pc.setLocalDescription(await pc.createOffer());
                    this._signal(userId, { sdp: pc.localDescription });
                } catch (error) {
                    console.error('[voice] offer failed:', error);
                }
            };
        }

        return peer;
    }

    async _handleSignal(fromUserId, data) {
        let peer = this.peers.get(fromUserId);
        if (!peer) {
            // An offer can arrive before the voicePeerJoined event settles.
            peer = this._createPeer(fromUserId, null, false);
        }
        const { pc } = peer;

        if (data?.sdp) {
            await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
            if (data.sdp.type === 'offer') {
                await pc.setLocalDescription(await pc.createAnswer());
                this._signal(fromUserId, { sdp: pc.localDescription });
            }
            while (peer.pendingCandidates.length > 0) {
                await pc.addIceCandidate(peer.pendingCandidates.shift()).catch(() => {});
            }
        } else if (data?.candidate) {
            if (pc.remoteDescription) {
                await pc.addIceCandidate(data.candidate).catch(() => {});
            } else {
                peer.pendingCandidates.push(data.candidate);
            }
        }
    }

    _attachRemoteStream(peer, stream) {
        if (!this.audioContext) return;
        // Chrome quirk: a MediaStreamSource stays silent unless the stream is
        // also attached to a media element. Keep a muted element as the sink
        // and do the actual output through the gain node.
        if (!peer.audioEl) {
            const el = document.createElement('audio');
            el.autoplay = true;
            el.muted = true;
            el.setAttribute('playsinline', '');
            peer.audioEl = el;
        }
        peer.audioEl.srcObject = stream;
        peer.audioEl.play().catch(() => {});

        try {
            const source = this.audioContext.createMediaStreamSource(stream);
            const gainNode = this.audioContext.createGain();
            source.connect(gainNode);
            gainNode.connect(this.audioContext.destination);
            peer.gainNode = gainNode;
            this._applyGain(peer);
        } catch (error) {
            console.error('[voice] failed to route remote audio:', error);
        }
        this._emitPeers();
    }

    _teardownPeer(userId, { silent = false } = {}) {
        const peer = this.peers.get(userId);
        if (!peer) return;
        try {
            peer.pc.onicecandidate = null;
            peer.pc.ontrack = null;
            peer.pc.onconnectionstatechange = null;
            peer.pc.onnegotiationneeded = null;
            peer.pc.close();
        } catch (err) { /* already closed */ }
        if (peer.audioEl) {
            peer.audioEl.srcObject = null;
        }
        if (peer.gainNode) {
            try { peer.gainNode.disconnect(); } catch (err) { /* detached */ }
        }
        this.peers.delete(userId);
        if (!silent) this._emitPeers();
    }

    _emitPeers() {
        this.onPeersChanged([...this.peers.values()].map(peer => ({
            userId: peer.userId,
            playerName: peer.playerName,
            connected: peer.connected,
            speaking: peer.speaking,
            muted: peer.muted,
            volume: peer.volume,
        })));
    }
}

export default VoiceChat;
