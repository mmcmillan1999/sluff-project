import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import VoiceChat, { resetAudioSessionAccountingForTests } from './VoiceChat';

const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
};

const makeMicrophone = () => {
    const track = {
        kind: 'audio',
        enabled: false,
        stop: vi.fn(),
    };
    const stream = {
        getTracks: vi.fn(() => [track]),
        getAudioTracks: vi.fn(() => [track]),
    };
    return { stream, track };
};

const makeSocket = () => {
    const handlers = new Map();
    return {
        emit: vi.fn(),
        on: vi.fn((event, handler) => handlers.set(event, handler)),
        off: vi.fn((event, handler) => {
            if (handlers.get(event) === handler) handlers.delete(event);
        }),
        trigger(event, payload) {
            return handlers.get(event)?.(payload);
        },
        handlers,
    };
};

let peerConnections;
let audioContexts;

class MockSender {
    constructor() {
        this.replaceTrack = vi.fn().mockResolvedValue(undefined);
    }
}

class MockPeerConnection {
    constructor(configuration) {
        this.configuration = configuration;
        this.connectionState = 'new';
        this.iceConnectionState = 'new';
        this.iceGatheringState = 'new';
        this.signalingState = 'stable';
        this.localDescription = null;
        this.remoteDescription = null;
        this.transceivers = [];
        this.addIceCandidate = vi.fn().mockResolvedValue(undefined);
        this.close = vi.fn();
        this.createOffer = vi.fn().mockResolvedValue({ type: 'offer', sdp: 'offer' });
        this.createAnswer = vi.fn().mockResolvedValue({ type: 'answer', sdp: 'answer' });
        this.setLocalDescription = vi.fn(async description => {
            this.localDescription = description;
        });
        this.setRemoteDescription = vi.fn(async description => {
            this.remoteDescription = description;
            if (description?.type === 'offer' && this.transceivers.length === 0) {
                this.transceivers.push({
                    direction: 'recvonly',
                    sender: new MockSender(),
                    receiver: { track: { kind: 'audio' } },
                });
            }
        });
        this.getTransceivers = vi.fn(() => this.transceivers);
        this.getStats = vi.fn().mockResolvedValue(new Map());
        this.restartIce = vi.fn();
        peerConnections.push(this);
    }

    addTransceiver(kind, options) {
        const transceiver = {
            direction: options.direction,
            sender: new MockSender(),
            receiver: { track: { kind } },
        };
        this.transceivers.push(transceiver);
        return transceiver;
    }
}

class MockAudioContext {
    constructor() {
        this.state = 'running';
        this.destination = {};
        this.resume = vi.fn().mockResolvedValue(undefined);
        this.close = vi.fn().mockResolvedValue(undefined);
        this.createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }));
        this.createGain = vi.fn(() => ({
            connect: vi.fn(),
            disconnect: vi.fn(),
            gain: { value: 1 },
        }));
        audioContexts.push(this);
    }
}

describe('VoiceChat microphone lifecycle', () => {
    let getUserMedia;

    beforeEach(() => {
        peerConnections = [];
        audioContexts = [];
        resetAudioSessionAccountingForTests();
        getUserMedia = vi.fn();
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: { getUserMedia },
        });
        vi.stubGlobal('RTCPeerConnection', MockPeerConnection);
        vi.stubGlobal('RTCSessionDescription', class RTCSessionDescription {
            constructor(description) {
                Object.assign(this, description);
            }
        });
        window.AudioContext = MockAudioContext;
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        delete window.AudioContext;
    });

    test('joins the table voice room in receive mode without requesting a microphone', async () => {
        const socket = makeSocket();
        const voice = new VoiceChat(socket, 'table-12');

        await voice.join();

        expect(getUserMedia).not.toHaveBeenCalled();
        expect(socket.emit).toHaveBeenCalledWith('voiceJoin', { tableId: 'table-12' });
        expect(socket.handlers.has('voiceRoster')).toBe(true);
        expect(voice.microphoneMuted).toBe(true);
    });

    test('keeps one stable stream, toggles its track, and attaches it to existing and new senders', async () => {
        const socket = makeSocket();
        const voice = new VoiceChat(socket, 'table-12');
        const { stream, track } = makeMicrophone();
        getUserMedia.mockResolvedValue(stream);
        await voice.join();
        socket.trigger('voiceRoster', {
            tableId: 'table-12',
            peers: [{ userId: 7, playerName: 'Alice' }],
        });
        const firstSender = peerConnections[0].transceivers[0].sender;

        await expect(voice.setMicrophoneMuted(false)).resolves.toBe(true);

        expect(getUserMedia).toHaveBeenCalledTimes(1);
        expect(track.enabled).toBe(true);
        expect(firstSender.replaceTrack).toHaveBeenCalledOnce();
        expect(firstSender.replaceTrack).toHaveBeenCalledWith(track);

        await voice.setMicrophoneMuted(true);
        expect(track.enabled).toBe(false);
        expect(track.stop).not.toHaveBeenCalled();
        expect(firstSender.replaceTrack).toHaveBeenCalledTimes(1);
        expect(firstSender.replaceTrack).not.toHaveBeenCalledWith(null);

        await voice.setMicrophoneMuted(false);
        expect(track.enabled).toBe(true);
        expect(getUserMedia).toHaveBeenCalledTimes(1);
        expect(firstSender.replaceTrack).toHaveBeenCalledTimes(1);

        socket.trigger('voiceRoster', {
            tableId: 'table-12',
            peers: [{ userId: 8, playerName: 'Ben' }],
        });
        const secondSender = peerConnections[1].transceivers[0].sender;
        expect(secondSender.replaceTrack).toHaveBeenCalledWith(track);
    });

    test('coalesces duplicate unmute calls into one pending microphone request', async () => {
        const socket = makeSocket();
        const voice = new VoiceChat(socket, 'table-12');
        const pending = deferred();
        const { stream, track } = makeMicrophone();
        getUserMedia.mockReturnValue(pending.promise);
        await voice.join();

        const first = voice.setMicrophoneMuted(false);
        const second = voice.setMicrophoneMuted(false);

        expect(getUserMedia).toHaveBeenCalledTimes(1);
        pending.resolve(stream);
        await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
        expect(track.enabled).toBe(true);
        expect(voice.micStream).toBe(stream);
    });

    test('stops a late stream when the player mutes during permission acquisition', async () => {
        const socket = makeSocket();
        const voice = new VoiceChat(socket, 'table-12');
        const pending = deferred();
        const { stream, track } = makeMicrophone();
        getUserMedia.mockReturnValue(pending.promise);
        await voice.join();

        const unmute = voice.setMicrophoneMuted(false);
        await voice.setMicrophoneMuted(true);
        pending.resolve(stream);

        await expect(unmute).resolves.toBe(false);
        expect(track.stop).toHaveBeenCalledOnce();
        expect(voice.micStream).toBeNull();
        expect(voice.microphoneMuted).toBe(true);
    });

    test('stops a late stream when voice is left during permission acquisition', async () => {
        const socket = makeSocket();
        const voice = new VoiceChat(socket, 'table-12');
        const pending = deferred();
        const { stream, track } = makeMicrophone();
        getUserMedia.mockReturnValue(pending.promise);
        await voice.join();

        const unmute = voice.setMicrophoneMuted(false);
        voice.leave();
        pending.resolve(stream);

        await expect(unmute).resolves.toBe(false);
        expect(track.stop).toHaveBeenCalledOnce();
        expect(socket.emit).toHaveBeenCalledWith('voiceLeave', { tableId: 'table-12' });
        expect(voice.joined).toBe(false);
    });

    test('leave stops the stable stream and tears down listeners, peers, and audio exactly once', async () => {
        const socket = makeSocket();
        const voice = new VoiceChat(socket, 'table-12');
        const { stream, track } = makeMicrophone();
        getUserMedia.mockResolvedValue(stream);
        await voice.join();
        socket.trigger('voiceRoster', {
            tableId: 'table-12',
            peers: [
                { userId: 7, playerName: 'Alice' },
                { userId: 8, playerName: 'Ben' },
            ],
        });
        await voice.setMicrophoneMuted(false);

        voice.leave();
        voice.leave();

        expect(track.stop).toHaveBeenCalledOnce();
        expect(socket.emit.mock.calls.filter(([event]) => event === 'voiceLeave')).toHaveLength(1);
        expect(socket.off).toHaveBeenCalledTimes(6);
        expect(socket.handlers.size).toBe(0);
        expect(peerConnections).toHaveLength(2);
        expect(peerConnections.every(peer => peer.close.mock.calls.length === 1)).toBe(true);
        expect(audioContexts[0].close).toHaveBeenCalledOnce();
    });

    test('ignores another table roster and rebuilds the current table mesh after reconnect', async () => {
        const socket = makeSocket();
        const onPeersChanged = vi.fn();
        const voice = new VoiceChat(socket, 'table-12', { onPeersChanged });
        await voice.join();

        socket.trigger('voiceRoster', {
            tableId: 'table-99',
            peers: [{ userId: 99, playerName: 'Wrong Table' }],
        });
        expect(peerConnections).toHaveLength(0);

        socket.trigger('voiceRoster', {
            tableId: 'table-12',
            peers: [{ userId: 7, playerName: 'Alice' }],
        });
        expect(peerConnections).toHaveLength(1);

        socket.trigger('connect');

        expect(peerConnections[0].close).toHaveBeenCalledOnce();
        expect(voice.peers.size).toBe(0);
        expect(socket.emit.mock.calls.filter(([event]) => event === 'voiceJoin')).toEqual([
            ['voiceJoin', { tableId: 'table-12' }],
            ['voiceJoin', { tableId: 'table-12' }],
        ]);
        expect(onPeersChanged).toHaveBeenLastCalledWith([]);
    });

    test('revives its audio graph from the iOS interrupted state', async () => {
        const socket = makeSocket();
        const voice = new VoiceChat(socket, 'table-12');
        await voice.join();
        const ctx = audioContexts[0];
        expect(ctx.resume).not.toHaveBeenCalled();

        // Incoming peer voice routes through this context's gain graph, so an
        // interruption that is never resumed silences every other player.
        ctx.state = 'interrupted';
        ctx.onstatechange();
        expect(ctx.resume).toHaveBeenCalledTimes(1);

        ctx.state = 'interrupted';
        voice._resumeAudio();
        expect(ctx.resume).toHaveBeenCalledTimes(2);

        voice.leave();
        expect(ctx.onstatechange).toBeNull();
    });

    test('elevates the audio session for capture and restores playback only when it truly ends', async () => {
        Object.defineProperty(navigator, 'audioSession', {
            configurable: true,
            value: { type: 'playback' },
        });
        try {
            const socket = makeSocket();
            const voice = new VoiceChat(socket, 'table-12');
            const { stream } = makeMicrophone();
            getUserMedia.mockResolvedValue(stream);
            await voice.join();
            expect(navigator.audioSession.type).toBe('playback');

            await voice.setMicrophoneMuted(false);
            expect(navigator.audioSession.type).toBe('play-and-record');

            // A muted-but-held stream is still capturing — no restore yet.
            await voice.setMicrophoneMuted(true);
            expect(navigator.audioSession.type).toBe('play-and-record');

            voice.leave();
            expect(navigator.audioSession.type).toBe('playback');
        } finally {
            delete navigator.audioSession;
        }
    });

    test('a refused capture never leaves play-and-record declared', async () => {
        // A stranded play-and-record declaration would duck and reroute game
        // audio with no capture running — the very thing the denial gate on
        // auto-unmute exists to prevent.
        Object.defineProperty(navigator, 'audioSession', {
            configurable: true,
            value: { type: 'playback' },
        });
        try {
            const socket = makeSocket();
            const voice = new VoiceChat(socket, 'table-12');
            const blocked = new Error('Permission denied');
            blocked.name = 'NotAllowedError';
            getUserMedia.mockRejectedValue(blocked);
            await voice.join();

            await expect(voice.setMicrophoneMuted(false)).rejects.toThrow('Permission denied');
            expect(navigator.audioSession.type).toBe('playback');
        } finally {
            delete navigator.audioSession;
        }
    });

    test('a superseded acquire settling late cannot downgrade a newer capture', async () => {
        Object.defineProperty(navigator, 'audioSession', {
            configurable: true,
            value: { type: 'playback' },
        });
        try {
            const socket = makeSocket();
            const voice = new VoiceChat(socket, 'table-12');
            const staleAcquire = deferred();
            const staleMic = makeMicrophone();
            getUserMedia.mockReturnValueOnce(staleAcquire.promise);
            await voice.join();

            // Request A hangs on the prompt; the player backgrounds (mute),
            // returns, and unmutes again — request B — which is granted.
            const first = voice.setMicrophoneMuted(false);
            await voice.setMicrophoneMuted(true);
            const liveMic = makeMicrophone();
            getUserMedia.mockResolvedValue(liveMic.stream);
            await voice.setMicrophoneMuted(false);
            expect(navigator.audioSession.type).toBe('play-and-record');

            // A finally resolves, stale: its stream must be stopped, but the
            // page-global declaration belongs to B's live capture now.
            staleAcquire.resolve(staleMic.stream);
            await expect(first).resolves.toBe(false);
            expect(staleMic.track.stop).toHaveBeenCalled();
            expect(navigator.audioSession.type).toBe('play-and-record');

            voice.leave();
            expect(navigator.audioSession.type).toBe('playback');
        } finally {
            delete navigator.audioSession;
        }
    });

    test('leave during a pending acquire keeps play-and-record until the prompt settles', async () => {
        Object.defineProperty(navigator, 'audioSession', {
            configurable: true,
            value: { type: 'playback' },
        });
        try {
            const socket = makeSocket();
            const voice = new VoiceChat(socket, 'table-12');
            const pending = deferred();
            const { stream, track } = makeMicrophone();
            getUserMedia.mockReturnValue(pending.promise);
            await voice.join();

            const unmute = voice.setMicrophoneMuted(false);
            voice.leave();
            // The OS prompt may still be on screen; restoring 'playback' now
            // would misconfigure the capture a late Allow starts.
            expect(navigator.audioSession.type).toBe('play-and-record');

            pending.resolve(stream);
            await expect(unmute).resolves.toBe(false);
            expect(track.stop).toHaveBeenCalled();
            expect(navigator.audioSession.type).toBe('playback');
        } finally {
            delete navigator.audioSession;
        }
    });

    test('a live voice session keeps the release private until the player leaves', async () => {
        Object.defineProperty(navigator, 'audioSession', {
            configurable: true,
            value: { type: 'playback' },
        });
        const released = vi.fn();
        window.addEventListener('sluff:audio-session-released', released);
        try {
            const socket = makeSocket();
            const voice = new VoiceChat(socket, 'table-12');
            const blocked = new Error('Permission denied');
            blocked.name = 'NotAllowedError';
            getUserMedia.mockRejectedValue(blocked);
            await voice.join();

            await expect(voice.setMicrophoneMuted(false)).rejects.toThrow('Permission denied');
            // Listen-only peer audio still rides the media channel; releasing
            // to the game here would let a fully muted game drop the session
            // to 'ambient' and silence teammates behind the silent switch.
            expect(navigator.audioSession.type).toBe('playback');
            expect(released).not.toHaveBeenCalled();

            voice.leave();
            expect(released).toHaveBeenCalled();
        } finally {
            window.removeEventListener('sluff:audio-session-released', released);
            delete navigator.audioSession;
        }
    });

    test('leaves an interruption alone while the app is backgrounded', async () => {
        const socket = makeSocket();
        const voice = new VoiceChat(socket, 'table-12');
        await voice.join();
        const ctx = audioContexts[0];

        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        try {
            // Resuming here would queue peer audio to blare from the
            // background the moment the interruption (e.g. a call) ends.
            ctx.state = 'interrupted';
            ctx.onstatechange();
            expect(ctx.resume).not.toHaveBeenCalled();
        } finally {
            delete document.visibilityState;
        }
        voice.leave();
    });
});
