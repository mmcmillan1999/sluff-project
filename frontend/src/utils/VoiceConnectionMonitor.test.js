import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import VoiceConnectionMonitor from './VoiceConnectionMonitor';

const report = (...stats) => new Map(stats.map(stat => [stat.id, stat]));
const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};

// An active audio stream producing one fresh five-second interval each call.
function audioSource(overrides = {}) {
    const values = { packets: 200, loss: 0, jitter: 0.01, rtt: 0.1, ...overrides };
    let sample = 0;
    let received = 0;
    let lost = 0;
    const next = () => {
        sample += 1;
        received += values.packets;
        lost += values.loss;
        return report({
            id: 'audio', type: 'inbound-rtp', kind: 'audio', ssrc: 100,
            timestamp: sample * 5000, packetsReceived: received, packetsLost: lost,
            jitter: values.jitter,
        });
    };
    return { values, next };
}

describe('VoiceConnectionMonitor', () => {
    let monitors;
    let visibility;

    beforeEach(() => {
        vi.useFakeTimers();
        monitors = [];
        visibility = 'visible';
        vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
        Object.defineProperty(navigator, 'connection', { configurable: true, value: undefined });
    });

    afterEach(() => {
        monitors.forEach(monitor => monitor.stop());
        vi.useRealTimers();
        vi.restoreAllMocks();
        delete navigator.connection;
    });

    function setup(peers) {
        const onChange = vi.fn();
        const monitor = new VoiceConnectionMonitor({ getPeers: () => peers, onChange });
        monitors.push(monitor);
        monitor.start();
        return { monitor, onChange, latest: () => onChange.mock.lastCall?.[0] };
    }

    const poll = async (count = 1) => {
        for (let index = 0; index < count; index += 1) {
            await vi.advanceTimersByTimeAsync(5000);
        }
    };

    const makePeer = (source = audioSource()) => ({
        userId: 'player', connected: true,
        pc: { getStats: vi.fn(() => Promise.resolve(source.next())) },
    });

    test('warms up, warns only after sustained interval loss, and requires sustained recovery', async () => {
        const source = audioSource({ loss: 20 });
        const { latest, onChange } = setup([makePeer(source)]);
        expect(latest()).toEqual({ level: 'unknown', reason: null });
        await poll(3); // Baseline plus two bad intervals is not sustained yet.
        expect(latest().level).toBe('unknown');
        await poll();
        expect(latest()).toEqual({ level: 'poor', reason: 'unstable-audio' });
        await poll(2);
        expect(onChange).toHaveBeenCalledTimes(2);
        source.values.loss = 0;
        await poll(2);
        expect(latest().level).toBe('poor');
        await poll();
        expect(latest()).toEqual({ level: 'good', reason: null });
    });

    test('one bad interval does not warn, and old cumulative loss is not counted again', async () => {
        const source = audioSource({ loss: 500 });
        const { latest, onChange } = setup([makePeer(source)]);
        await poll();
        source.values.loss = 0;
        await poll(3);
        expect(latest().level).toBe('good');
        source.values.loss = 100;
        await poll();
        source.values.loss = 0;
        await poll(3);
        expect(latest().level).toBe('good');
        expect(onChange.mock.calls.some(([value]) => value.level === 'poor')).toBe(false);
    });

    test('small loss samples and silent-stream jitter do not create a warning', async () => {
        const source = audioSource({ packets: 1, loss: 1 });
        const { latest, onChange } = setup([makePeer(source)]);
        await poll(4);
        expect(latest().level).toBe('good');
        source.values.packets = 0;
        source.values.loss = 0;
        source.values.jitter = 0.5;
        await poll(3);
        expect(latest().level).toBe('unknown');
        expect(onChange.mock.calls.some(([value]) => value.level === 'poor')).toBe(false);
    });

    test('detects sustained jitter on an active incoming audio stream', async () => {
        const { latest } = setup([makePeer(audioSource({ jitter: 0.08 }))]);
        await poll(4);
        expect(latest()).toEqual({ level: 'poor', reason: 'unstable-audio' });
    });

    test.each(['loss', 'latency'])('detects outbound %s from fresh remote RTCP reports', async kind => {
        let sample = 0;
        const peer = {
            userId: 'player', connected: true,
            pc: { getStats: vi.fn(async () => {
                sample += 1;
                return report(
                    { id: 'out', type: 'outbound-rtp', kind: 'audio', ssrc: 101, packetsSent: sample * 200 },
                    {
                        id: 'remote', type: 'remote-inbound-rtp', kind: 'audio', ssrc: 101,
                        localId: 'out', timestamp: sample * 5000,
                        packetsLost: sample * (kind === 'loss' ? 20 : 0),
                        roundTripTime: kind === 'latency' ? 0.7 : 0.1,
                        roundTripTimeMeasurements: sample,
                    },
                );
            }) },
        };
        const { latest } = setup([peer]);
        await poll(4);
        expect(latest()).toEqual({ level: 'poor', reason: 'unstable-audio' });
    });

    test('stale RTCP reports cannot be counted repeatedly as bad readings', async () => {
        let timestamp = 5000;
        const peer = {
            userId: 'player', connected: true,
            pc: { getStats: vi.fn(async () => report({
                id: 'remote', type: 'remote-inbound-rtp', kind: 'audio',
                timestamp, roundTripTime: 0.8,
            })) },
        };
        const { latest, onChange } = setup([peer]);
        await poll();
        timestamp += 5000;
        await poll(6);
        expect(latest().level).toBe('unknown');
        expect(onChange.mock.calls.some(([value]) => value.level === 'poor')).toBe(false);
    });

    test('changed stats IDs and reset counters get new baselines', async () => {
        let timestamp = 0;
        let received = 1000;
        let lost = 500;
        let id = 'audio';
        const peer = {
            userId: 'player', connected: true,
            pc: { getStats: vi.fn(async () => {
                timestamp += 5000;
                received += 200;
                return report({ id, type: 'inbound-rtp', kind: 'audio', timestamp,
                    packetsReceived: received, packetsLost: lost, jitter: 0.01 });
            }) },
        };
        const { latest, onChange } = setup([peer]);
        await poll(4);
        expect(latest().level).toBe('good');
        received = 0;
        lost = 0;
        await poll(4);
        id = 'replacement';
        lost = 10000;
        await poll(4);
        expect(latest().level).toBe('good');
        expect(onChange.mock.calls.some(([value]) => value.level === 'poor')).toBe(false);
    });

    test('missing, unsupported, rejected, and non-audio stats remain unknown', async () => {
        const peers = [
            { userId: 'unsupported', connected: true, pc: {} },
            { userId: 'empty', connected: true, pc: { getStats: vi.fn(async () => report()) } },
            { userId: 'rejected', connected: true, pc: { getStats: vi.fn(() => { throw new Error('closed'); }) } },
            { userId: 'video', connected: true, pc: { getStats: vi.fn(async () => report({
                id: 'video', type: 'inbound-rtp', kind: 'video', timestamp: Date.now(), jitter: 10,
            })) } },
        ];
        const { latest, onChange } = setup(peers);
        await poll(5);
        expect(latest()).toEqual({ level: 'unknown', reason: null });
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    test('a synchronous stats failure on one peer does not hide another peer with sustained loss', async () => {
        const broken = { userId: 'broken', connected: true,
            pc: { getStats: vi.fn(() => { throw new Error('closed'); }) } };
        const { latest } = setup([broken, makePeer(audioSource({ loss: 30 }))]);
        await poll(4);
        expect(latest()).toEqual({ level: 'poor', reason: 'unstable-audio' });
    });

    test('alternating single-peer blips do not add up to one sustained warning', async () => {
        const first = audioSource();
        const second = audioSource();
        const { onChange } = setup([makePeer(first), makePeer(second)]);
        await poll();
        for (let index = 0; index < 6; index += 1) {
            first.values.loss = index % 2 ? 20 : 0;
            second.values.loss = index % 2 ? 0 : 20;
            await poll();
        }
        expect(onChange.mock.calls.some(([value]) => value.level === 'poor')).toBe(false);
    });

    test('five humans sample their four connected peers once per round and fully clean up', async () => {
        const peers = Array.from({ length: 4 }, (_, index) => ({ ...makePeer(), userId: `player-${index}` }));
        const disconnected = { ...makePeer(), connected: false };
        const { monitor, latest, onChange } = setup([...peers, disconnected]);
        monitor.start();
        expect(vi.getTimerCount()).toBe(1);
        await poll(4);
        peers.forEach(peer => expect(peer.pc.getStats).toHaveBeenCalledTimes(4));
        expect(disconnected.pc.getStats).not.toHaveBeenCalled();
        expect(latest().level).toBe('good');
        const callbacks = onChange.mock.calls.length;
        monitor.stop();
        monitor.stop();
        expect(vi.getTimerCount()).toBe(0);
        await poll(10);
        peers.forEach(peer => expect(peer.pc.getStats).toHaveBeenCalledTimes(4));
        expect(onChange).toHaveBeenCalledTimes(callbacks);
    });

    test('unresolved statistics do not overlap, and stopping suppresses their late result', async () => {
        const pending = deferred();
        const peer = { connected: true, pc: { getStats: vi.fn(() => pending.promise) } };
        const { monitor, onChange } = setup([peer]);
        await poll(4);
        expect(peer.pc.getStats).toHaveBeenCalledTimes(1);
        monitor.stop();
        pending.resolve(audioSource({ jitter: 1 }).next());
        await Promise.resolve();
        await Promise.resolve();
        await poll();
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    test('restarting invalidates an old pending round and starts with fresh histories', async () => {
        const pending = deferred();
        const peer = makePeer(audioSource({ loss: 30 }));
        peer.pc.getStats.mockImplementationOnce(() => pending.promise);
        const { monitor, latest } = setup([peer]);
        await poll();
        monitor.stop();
        monitor.start();
        pending.resolve(audioSource({ jitter: 1 }).next());
        await poll(3);
        expect(latest().level).toBe('unknown');
        await poll();
        expect(latest().level).toBe('poor');
        expect(vi.getTimerCount()).toBe(1);
    });

    test('background polling skips stats and resumes with a fresh baseline', async () => {
        const peer = makePeer(audioSource({ jitter: 0.1 }));
        const { latest } = setup([peer]);
        await poll(3);
        visibility = 'hidden';
        await poll(3);
        expect(peer.pc.getStats).toHaveBeenCalledTimes(3);
        visibility = 'visible';
        await poll(3);
        expect(latest().level).toBe('unknown');
        await poll();
        expect(latest().level).toBe('poor');
    });

    test('replacing or disconnecting a peer does not inherit previous poor quality', async () => {
        const peers = [makePeer(audioSource({ jitter: 0.1 }))];
        const { latest } = setup(peers);
        await poll(4);
        expect(latest().level).toBe('poor');
        peers[0] = makePeer();
        await poll();
        expect(latest().level).toBe('unknown');
        await poll(3);
        expect(latest().level).toBe('good');
        peers[0].connected = false;
        await poll();
        expect(latest().level).toBe('unknown');
    });

    test('offers only a rough slow-network hint, lets measured recovery override it, and removes its listener', async () => {
        const connection = new EventTarget();
        connection.effectiveType = '2g';
        connection.downlink = 0.1;
        const removeListener = vi.spyOn(connection, 'removeEventListener');
        Object.defineProperty(navigator, 'connection', { configurable: true, value: connection });
        const { monitor, latest } = setup([makePeer()]);
        expect(latest()).toEqual({ level: 'poor', reason: 'slow-network' });
        await poll(4);
        expect(latest()).toEqual({ level: 'good', reason: null });
        connection.effectiveType = '4g';
        connection.downlink = 10;
        connection.dispatchEvent(new Event('change'));
        expect(latest()).toEqual({ level: 'good', reason: null });
        monitor.stop();
        expect(removeListener).toHaveBeenCalledWith('change', expect.any(Function));
    });

    test('network estimate changes update the advisory while audio measurements are unavailable', () => {
        const connection = new EventTarget();
        connection.downlink = 0.2;
        Object.defineProperty(navigator, 'connection', { configurable: true, value: connection });
        const { latest } = setup([]);
        expect(latest()).toEqual({ level: 'poor', reason: 'slow-network' });
        connection.downlink = 10;
        connection.dispatchEvent(new Event('change'));
        expect(latest()).toEqual({ level: 'unknown', reason: null });
    });

    test.each([undefined, 0, -1, Infinity])('does not claim unknown download estimate %s is slow', downlink => {
        Object.defineProperty(navigator, 'connection', { configurable: true, value: { downlink } });
        const { latest } = setup([]);
        expect(latest()).toEqual({ level: 'unknown', reason: null });
    });
});
