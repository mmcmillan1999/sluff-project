// frontend/src/utils/VoiceChat.js
// Always-on voice chat for a Sluff table.
//
// Architecture: WebRTC peer-to-peer mesh (each participant connects directly
// to every other participant — at most 3 peers, well within mesh limits).
// Audio never touches the game server; Socket.IO only relays the WebRTC
// handshake (offers/answers/ICE) between players seated at the same table.
//
// Players join the voice room with the table. One microphone stream is kept
// for the table session and muted by toggling MediaStreamTrack.enabled. This
// avoids the mobile cut-outs caused by repeatedly stopping, reacquiring, and
// swapping the microphone track for every short press.
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
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            const timeout = new Error('Timed out waiting for microphone permission.');
            timeout.name = 'TimeoutError';
            reject(timeout);
        }, MIC_TIMEOUT_MS);
        navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS).then(
            (stream) => {
                clearTimeout(timer);
                // getUserMedia cannot be cancelled. If the browser resolves a
                // dismissed prompt after our timeout, stop that late stream
                // instead of leaving an invisible microphone capture alive.
                if (settled) {
                    stream.getTracks().forEach(track => track.stop());
                    return;
                }
                settled = true;
                resolve(stream);
            },
            (error) => {
                clearTimeout(timer);
                if (settled) return;
                settled = true;
                reject(error);
            },
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
        this.micStream = null;  // retained until the player leaves the table
        this.microphoneMuted = true;
        this.micRequest = null;
        this.micRequestToken = 0;
        this.audioContext = null;
        this.audioUnlockHandler = null;
        this.joined = false;
        this.lifecycleToken = 0;
        this.boundHandlers = null;
    }

    async join() {
        if (this.joined) return;
        this.lifecycleToken += 1;
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        this.audioContext = new AudioContextClass();
        this._bindAudioUnlock();
        this._resumeAudio();

        this._bindSocket();
        this.joined = true;
        console.log(`[voice] joining voice room for table ${this.tableId}`
            + ' (a voiceRoster log must follow; if it never does, the server rejected the join)');
        // Socket.IO buffers emits while disconnected. Let the connect handler
        // perform the join in that case so the server never sees two joins.
        if (this.socket.connected !== false) {
            this.socket.emit('voiceJoin', { tableId: this.tableId });
        }
    }

    leave() {
        console.log('[voice] leaving voice room');
        this.lifecycleToken += 1;
        this.micRequestToken += 1;
        this.micRequest = null;
        if (this.boundHandlers) {
            for (const [event, handler] of Object.entries(this.boundHandlers)) {
                this.socket.off(event, handler);
            }
            this.boundHandlers = null;
        }
        this._stopMicrophone();
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
        this._unbindAudioUnlock();
        this.joined = false;
        this._emitPeers();
    }

    // --- local microphone --------------------------------------------------

    async setMicrophoneMuted(muted) {
        if (!this.joined) return false;
        const shouldMute = Boolean(muted);

        if (shouldMute) {
            this.microphoneMuted = true;
            this.micRequestToken += 1;
            this.micRequest = null;
            this._applyMicrophoneState();
            this._broadcastMicrophoneState();
            return true;
        }

        if (this.micStream) {
            this.microphoneMuted = false;
            this._applyMicrophoneState();
            this._broadcastMicrophoneState();
            return true;
        }

        // Duplicate unmute requests share one permission/capture request.
        if (this.micRequest) return this.micRequest;

        const lifecycleToken = this.lifecycleToken;
        const requestToken = ++this.micRequestToken;
        let request;
        request = acquireMic().then((stream) => {
            if (!this.joined || this.lifecycleToken !== lifecycleToken
                || this.micRequestToken !== requestToken) {
                stream.getTracks().forEach(track => track.stop());
                return false;
            }

            this.micStream = stream;
            this.microphoneMuted = false;
            this._applyMicrophoneState();
            const track = stream.getAudioTracks()[0];
            console.log(`[voice] stable mic acquired — attaching to ${this.peers.size} peer sender(s)`);
            for (const peer of this.peers.values()) {
                if (!peer.audioSender) continue;
                peer.audioSender.replaceTrack(track)
                    .catch(err => console.warn(`[voice] peer ${peer.userId}: replaceTrack failed`, err));
            }
            this._broadcastMicrophoneState();
            return true;
        }).catch((error) => {
            if (!this.joined || this.lifecycleToken !== lifecycleToken
                || this.micRequestToken !== requestToken) {
                return false;
            }
            this.microphoneMuted = true;
            this.onError(error);
            throw error;
        }).finally(() => {
            if (this.micRequest === request) this.micRequest = null;
        });
        this.micRequest = request;
        return request;
    }

    _applyMicrophoneState() {
        for (const track of this.micStream?.getAudioTracks?.() || []) {
            track.enabled = !this.microphoneMuted;
        }
    }

    _broadcastMicrophoneState() {
        if (!this.joined) return;
        this.socket.emit('voiceSpeaking', {
            tableId: this.tableId,
            speaking: !this.microphoneMuted && Boolean(this.micStream),
        });
    }

    _stopMicrophone() {
        if (!this.micStream) return;
        this.micStream.getTracks().forEach(track => track.stop());
        this.micStream = null;
        this.microphoneMuted = true;
    }

    // Automatic table entry is not always considered a playback gesture on
    // mobile browsers. Keep a lightweight unlock listener for the next real
    // interaction and for returning from a suspended/backgrounded state.
    _bindAudioUnlock() {
        if (this.audioUnlockHandler || typeof document === 'undefined') return;
        this.audioUnlockHandler = () => this._resumeAudio();
        document.addEventListener('pointerdown', this.audioUnlockHandler, { passive: true });
        document.addEventListener('touchend', this.audioUnlockHandler, { passive: true });
        document.addEventListener('keydown', this.audioUnlockHandler);
    }

    _unbindAudioUnlock() {
        if (!this.audioUnlockHandler || typeof document === 'undefined') return;
        document.removeEventListener('pointerdown', this.audioUnlockHandler);
        document.removeEventListener('touchend', this.audioUnlockHandler);
        document.removeEventListener('keydown', this.audioUnlockHandler);
        this.audioUnlockHandler = null;
    }

    _resumeAudio() {
        if (!this.audioContext) return;
        const resume = this.audioContext.state === 'suspended'
            ? this.audioContext.resume()
            : Promise.resolve();
        Promise.resolve(resume).catch(() => {}).finally(() => {
            for (const peer of this.peers.values()) {
                peer.audioEl?.play?.().catch(() => {});
            }
        });
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
            // Socket.IO auto-reconnect gives this user a NEW server-side
            // socket; the server's disconnect handler already removed us from
            // the voice room (and told everyone else via voicePeerLeft), so
            // every signal we send afterwards is silently dropped. Re-join
            // and rebuild the mesh from scratch — as the newcomer we will
            // re-initiate offers from fresh RTCPeerConnections.
            connect: () => {
                if (!this.joined) return;
                console.log('[voice] socket reconnected — rejoining voice room');
                for (const userId of [...this.peers.keys()]) {
                    this._teardownPeer(userId, { silent: true });
                }
                this._emitPeers();
                this.socket.emit('voiceJoin', { tableId: this.tableId });
            },
            voiceRoster: ({ tableId, peers }) => {
                if (tableId !== this.tableId) return;
                console.log(`[voice] roster received: ${(peers || []).length} existing peer(s)`);
                // We are the newcomer: initiate an offer to everyone already in.
                for (const peer of peers || []) {
                    this._createPeer(Number(peer.userId), peer.playerName, true);
                }
                this._emitPeers();
                this._broadcastMicrophoneState();
            },
            voicePeerJoined: ({ tableId, userId, playerName }) => {
                if (tableId && tableId !== this.tableId) return;
                console.log(`[voice] peer joined: ${userId} (${playerName})`);
                // A voicePeerJoined for a user we already track means that
                // user re-joined the room (e.g. after their socket dropped):
                // their side built a brand-new RTCPeerConnection, so our old
                // one can never pair with it. Replace it with a fresh record.
                if (this.peers.has(Number(userId))) {
                    console.log(`[voice] peer ${userId} rejoined — resetting stale connection`);
                    this._teardownPeer(Number(userId), { silent: true });
                }
                // The joiner initiates; we just prepare a record to answer with.
                this._createPeer(Number(userId), playerName, false);
                this._emitPeers();
                this._broadcastMicrophoneState();
            },
            voicePeerLeft: ({ tableId, userId }) => {
                if (tableId && tableId !== this.tableId) return;
                console.log(`[voice] peer left: ${userId}`);
                this._teardownPeer(Number(userId), { silent: true });
                this._emitPeers();
            },
            voiceSignal: ({ tableId, fromUserId, data }) => {
                if (tableId && tableId !== this.tableId) return;
                this._handleSignal(Number(fromUserId), data).catch(error => {
                    console.error('[voice] signal handling failed:', error);
                });
            },
            voiceSpeaking: ({ tableId, userId, speaking }) => {
                if (tableId && tableId !== this.tableId) return;
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

        console.log(`[voice] creating peer ${userId} (${playerName || 'Player'}) initiator=${initiator}`);
        const pc = new RTCPeerConnection({ iceServers: buildIceServers() });
        const peer = {
            userId,
            playerName: playerName || 'Player',
            pc,
            initiator,
            connected: false,
            iceState: 'new',
            speaking: false,
            muted: false,
            volume: DEFAULT_VOLUME,
            sourceNode: null,
            gainNode: null,
            audioEl: null,
            audioSender: null,
            pendingCandidates: [],
        };
        this.peers.set(userId, peer);

        // Only the OFFERER pre-creates the audio transceiver. It keeps the
        // m-line negotiated while no track is sent; replaceTrack later swaps
        // the live mic in/out without renegotiation (WebRTC 1.0 §5.2:
        // replaceTrack explicitly avoids negotiation).
        //
        // The ANSWERER must NOT pre-create one. When a remote offer is
        // applied, the browser only reuses unassociated transceivers that
        // were created by addTrack() (WebRTC 1.0 §4.4.1.9 / RFC 8829 §5.10);
        // an addTransceiver()-created transceiver is skipped and a NEW
        // transceiver with direction 'recvonly' is created for the offered
        // m-line. Pre-creating one here made the answer a=recvonly (this
        // side could never send) and left peer.audioSender pointing at the
        // unassociated sender, so replaceTrack() fed a sender with no
        // m-line. The answerer instead adopts the transceiver the offer
        // creates — see _handleSignal.
        if (initiator) {
            try {
                const transceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
                peer.audioSender = transceiver.sender;
                if (this.micStream) {
                    const track = this.micStream.getAudioTracks()[0];
                    if (track) {
                        console.log(`[voice] peer ${userId}: replaceTrack(mic) into new initiator sender`);
                        peer.audioSender.replaceTrack(track)
                            .catch(err => console.warn(`[voice] peer ${userId}: replaceTrack failed`, err));
                    }
                }
            } catch (error) {
                console.error('[voice] failed to add audio transceiver:', error);
            }
        }

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                const typeMatch = / typ (\w+)/.exec(event.candidate.candidate || '');
                console.log(`[voice] peer ${userId}: local ICE candidate (${typeMatch ? typeMatch[1] : 'end'})`);
                this._signal(userId, { candidate: event.candidate });
            }
        };
        pc.ontrack = (event) => {
            console.log(`[voice] peer ${userId}: remote track received (streams=${event.streams.length})`);
            this._attachRemoteStream(peer, event.streams[0] || new MediaStream([event.track]));
        };
        pc.onsignalingstatechange = () => {
            console.log(`[voice] peer ${userId}: signaling ${pc.signalingState}`);
        };
        pc.onicegatheringstatechange = () => {
            console.log(`[voice] peer ${userId}: ICE gathering ${pc.iceGatheringState}`);
        };
        pc.oniceconnectionstatechange = () => {
            peer.iceState = pc.iceConnectionState;
            console.log(`[voice] peer ${userId}: ICE ${pc.iceConnectionState}`);
            this._emitPeers();
        };
        pc.onconnectionstatechange = () => {
            peer.connected = pc.connectionState === 'connected';
            console.log(`[voice] peer ${userId}: connection ${pc.connectionState}`);
            if (pc.connectionState === 'connected') {
                this._logSelectedCandidatePair(peer);
            }
            if (pc.connectionState === 'failed') {
                // One retry via ICE restart; WebRTC handles the renegotiation.
                console.warn(`[voice] peer ${userId}: connection failed — attempting ICE restart`);
                pc.restartIce?.();
            }
            this._emitPeers();
        };

        if (initiator) {
            pc.onnegotiationneeded = async () => {
                try {
                    await pc.setLocalDescription(await pc.createOffer());
                    console.log(`[voice] peer ${userId}: sending offer`);
                    this._signal(userId, { sdp: pc.localDescription });
                } catch (error) {
                    console.error('[voice] offer failed:', error);
                }
            };
        }

        return peer;
    }

    // Diagnostic: log which candidate types carried the connection. If both
    // sides only ever pair host/srflx candidates and still fail, the network
    // needs a TURN relay (VITE_TURN_URL).
    async _logSelectedCandidatePair(peer) {
        try {
            const stats = await peer.pc.getStats();
            let pair = null;
            stats.forEach((report) => {
                if (report.type === 'transport' && report.selectedCandidatePairId) {
                    pair = stats.get(report.selectedCandidatePairId) || pair;
                }
            });
            if (!pair) {
                // Firefox does not expose transport.selectedCandidatePairId.
                stats.forEach((report) => {
                    if (report.type === 'candidate-pair' && report.state === 'succeeded'
                        && (report.selected || report.nominated)) {
                        pair = pair || report;
                    }
                });
            }
            if (!pair) return;
            const local = stats.get(pair.localCandidateId);
            const remote = stats.get(pair.remoteCandidateId);
            console.log(`[voice] peer ${peer.userId}: selected pair local=${local?.candidateType || '?'}`
                + ` remote=${remote?.candidateType || '?'} protocol=${local?.protocol || '?'}`);
        } catch (error) {
            console.warn('[voice] getStats failed:', error);
        }
    }

    async _handleSignal(fromUserId, data) {
        let peer = this.peers.get(fromUserId);
        if (!peer) {
            // An offer can arrive before the voicePeerJoined event settles.
            peer = this._createPeer(fromUserId, null, false);
        }
        const { pc } = peer;

        if (data?.sdp) {
            console.log(`[voice] peer ${fromUserId}: received ${data.sdp.type}`);
            await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
            if (data.sdp.type === 'offer') {
                // Adopt the transceiver that applying the offer just created.
                // setRemoteDescription(offer) associates the audio m-line with
                // a browser-created transceiver whose direction is 'recvonly'
                // (WebRTC 1.0 §4.4.1.9 / RFC 8829 §5.10 — only addTrack()-
                // created transceivers are reused, and we deliberately create
                // none on the answering side). Upgrading its direction to
                // 'sendrecv' BEFORE createAnswer makes the generated answer
                // sendrecv (RFC 8829 §5.3.1: answer direction is the
                // intersection of the offered direction and the transceiver
                // direction), which is what lets this side transmit later via
                // replaceTrack without renegotiation.
                const transceiver = pc.getTransceivers()
                    .find(t => t.receiver?.track?.kind === 'audio');
                if (transceiver) {
                    transceiver.direction = 'sendrecv';
                    peer.audioSender = transceiver.sender;
                    if (this.micStream) {
                        const track = this.micStream.getAudioTracks()[0];
                        if (track) {
                            console.log(`[voice] peer ${fromUserId}: replaceTrack(mic) into adopted answer sender`);
                            peer.audioSender.replaceTrack(track)
                                .catch(err => console.warn(`[voice] peer ${fromUserId}: replaceTrack failed`, err));
                        }
                    }
                } else {
                    console.warn(`[voice] peer ${fromUserId}: no audio transceiver found in remote offer`);
                }
                await pc.setLocalDescription(await pc.createAnswer());
                console.log(`[voice] peer ${fromUserId}: sending answer`);
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
            peer.sourceNode?.disconnect?.();
            peer.gainNode?.disconnect?.();
            const source = this.audioContext.createMediaStreamSource(stream);
            const gainNode = this.audioContext.createGain();
            source.connect(gainNode);
            gainNode.connect(this.audioContext.destination);
            peer.sourceNode = source;
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
            peer.pc.onsignalingstatechange = null;
            peer.pc.onicegatheringstatechange = null;
            peer.pc.oniceconnectionstatechange = null;
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
        if (peer.sourceNode) {
            try { peer.sourceNode.disconnect(); } catch (err) { /* detached */ }
        }
        this.peers.delete(userId);
        if (!silent) this._emitPeers();
    }

    _emitPeers() {
        this.onPeersChanged([...this.peers.values()].map(peer => ({
            userId: peer.userId,
            playerName: peer.playerName,
            connected: peer.connected,
            iceState: peer.iceState,
            speaking: peer.speaking,
            microphoneLive: peer.speaking,
            muted: peer.muted,
            volume: peer.volume,
        })));
    }
}

export default VoiceChat;
