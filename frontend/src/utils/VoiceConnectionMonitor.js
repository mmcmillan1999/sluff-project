// Read existing WebRTC statistics; never run a bandwidth test during a game.
// RTP loss counters are cumulative and jitter / RTT use seconds:
// https://www.w3.org/TR/webrtc-stats/
const SAMPLE_INTERVAL_MS = 5000;
const REQUIRED_SAMPLES = 3;
const MIN_LOSS_PACKETS = 20;
const MAX_LOSS_FRACTION = 0.05;
const MAX_JITTER_SECONDS = 0.06;
const MAX_ROUND_TRIP_SECONDS = 0.5;

const finite = value => typeof value === 'number' && Number.isFinite(value);
const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

function hasSlowNetworkEstimate(connection) {
    // This API reports a rough download estimate, not a measured voice uplink.
    // https://wicg.github.io/netinfo/#downlink-attribute
    return connection?.effectiveType === 'slow-2g'
        || connection?.effectiveType === '2g'
        || (finite(connection?.downlink) && connection.downlink > 0 && connection.downlink < 0.3);
}

function assessStream(stat, report, previous) {
    const outbound = stat.type === 'remote-inbound-rtp' ? report.get?.(stat.localId) : null;
    const current = {
        timestamp: stat.timestamp,
        received: stat.packetsReceived,
        lost: stat.packetsLost,
        sent: outbound?.packetsSent,
        outboundId: outbound ? `${outbound.id}:${outbound.ssrc}` : null,
        rttMeasurements: stat.roundTripTimeMeasurements,
    };
    if (!finite(current.timestamp)) return { current, result: null };
    if (!previous || !finite(previous.timestamp)) return { current, result: null };
    // A remote timestamp is the time its RTCP report arrived. Re-reading the
    // same report must not count the same loss or latency as another bad sample.
    if (current.timestamp === previous.timestamp) return { current: previous, result: null };
    if (current.timestamp < previous.timestamp || current.outboundId !== previous.outboundId) {
        return { current, result: null };
    }
    const received = finite(current.received) && finite(previous.received)
        ? current.received - previous.received : null;
    const lost = finite(current.lost) && finite(previous.lost)
        ? current.lost - previous.lost : null;
    const sent = finite(current.sent) && finite(previous.sent)
        ? current.sent - previous.sent : null;
    // Counter resets (or late packets reducing the loss estimate) are not loss.
    if (received < 0 || lost < 0 || sent < 0) return { current, result: null };

    const metrics = [];
    const expected = received !== null && lost !== null ? received + lost : sent;
    if (lost !== null && expected !== null && expected >= MIN_LOSS_PACKETS) {
        metrics.push(lost / expected >= MAX_LOSS_FRACTION);
    }
    const trafficAdvanced = (received !== null && received > 0) || (sent !== null && sent > 0);
    if (trafficAdvanced && finite(stat.jitter) && stat.jitter >= 0) {
        metrics.push(stat.jitter >= MAX_JITTER_SECONDS);
    }
    const rttAdvanced = !finite(current.rttMeasurements) || !finite(previous.rttMeasurements)
        || current.rttMeasurements > previous.rttMeasurements;
    if (stat.type === 'remote-inbound-rtp' && rttAdvanced
        && finite(stat.roundTripTime) && stat.roundTripTime >= 0) {
        metrics.push(stat.roundTripTime >= MAX_ROUND_TRIP_SECONDS);
    }
    return { current, result: metrics.length ? (metrics.some(Boolean) ? 'bad' : 'good') : null };
}

function assessPeer(report, state) {
    const results = [];
    const streamIds = new Set();
    report?.forEach?.(stat => {
        if ((stat.type !== 'inbound-rtp' && stat.type !== 'remote-inbound-rtp')
            || (stat.kind ?? stat.mediaType) !== 'audio') return;
        const id = `${stat.type}:${stat.id}:${stat.ssrc}`;
        streamIds.add(id);
        const { current, result } = assessStream(stat, report, state.streams.get(id));
        state.streams.set(id, current);
        if (result !== null) results.push(result);
    });
    for (const id of state.streams.keys()) {
        if (!streamIds.has(id)) state.streams.delete(id);
    }
    const result = results.includes('bad') ? 'bad' : results.length ? 'good' : null;
    if (result === null) {
        state.bad = 0;
        state.good = 0;
        state.missing += 1;
        // Brief gaps in RTCP reporting are normal. They neither prove recovery
        // nor provide new bad evidence; prolonged missing data is unknown.
        if (state.missing >= REQUIRED_SAMPLES) state.level = 'unknown';
    } else {
        state.missing = 0;
        state.bad = result === 'bad' ? state.bad + 1 : 0;
        state.good = result === 'good' ? state.good + 1 : 0;
        if (state.bad >= REQUIRED_SAMPLES) state.level = 'poor';
        if (state.good >= REQUIRED_SAMPLES) state.level = 'good';
    }
}

export default class VoiceConnectionMonitor {
    constructor({ getPeers, onChange = () => {} }) {
        this.getPeers = getPeers;
        this.onChange = onChange;
        this.states = new Map();
        this.running = false;
        this.generation = 0;
        this.timer = null;
        this.lastValue = null;
        this.connection = null;
        // This event also fires when an estimate changes on the same network.
        // Do not continually discard audio evidence as those estimates vary.
        this.onNetworkChange = () => this.publish();
    }

    start() {
        if (this.running) return;
        this.running = true;
        this.generation += 1;
        this.states.clear();
        this.lastValue = null;
        this.connection = typeof navigator === 'undefined' ? null : navigator.connection;
        this.connection?.addEventListener?.('change', this.onNetworkChange);
        this.publish();
        this.schedule(this.generation);
    }

    stop() {
        this.running = false;
        this.generation += 1;
        clearTimeout(this.timer);
        this.timer = null;
        this.connection?.removeEventListener?.('change', this.onNetworkChange);
        this.connection = null;
        this.states.clear();
    }

    schedule(generation) {
        if (!this.running || generation !== this.generation) return;
        this.timer = setTimeout(() => this.sample(generation), SAMPLE_INTERVAL_MS);
    }

    async sample(generation) {
        if (!this.running || generation !== this.generation) return;
        try {
            if (hidden()) {
                this.states.clear();
                this.publish();
                return;
            }
            const peers = Array.from(this.getPeers()).filter(peer => peer.connected && peer.pc);
            const connections = new Set(peers.map(peer => peer.pc));
            for (const pc of this.states.keys()) {
                if (!connections.has(pc)) this.states.delete(pc);
            }
            // Every connected peer is sampled once per round, in parallel. The
            // next round starts only after this one settles, never overlapping.
            const reports = await Promise.allSettled(peers.map(peer => Promise.resolve().then(() => (
                typeof peer.pc.getStats === 'function' ? peer.pc.getStats() : null
            ))));
            if (!this.running || generation !== this.generation) return;
            if (hidden()) {
                this.states.clear();
                this.publish();
                return;
            }
            const currentConnections = new Set(Array.from(this.getPeers())
                .filter(peer => peer.connected).map(peer => peer.pc));
            reports.forEach((result, index) => {
                const pc = peers[index].pc;
                if (!currentConnections.has(pc)) {
                    this.states.delete(pc);
                    return;
                }
                let state = this.states.get(pc);
                if (!state) {
                    state = { streams: new Map(), bad: 0, good: 0, missing: 0, level: 'unknown' };
                    this.states.set(pc, state);
                }
                assessPeer(result.status === 'fulfilled' ? result.value : null, state);
            });
            this.publish();
        } catch {
            // Stats are best effort and must never interfere with the call.
            this.states.clear();
            if (this.running && generation === this.generation) this.publish();
        } finally {
            this.schedule(generation);
        }
    }

    publish() {
        if (!this.running) return;
        const states = [...this.states.values()];
        let value;
        if (states.some(state => state.level === 'poor')) {
            value = { level: 'poor', reason: 'unstable-audio' };
        } else if (states.length && states.every(state => state.level === 'good')) {
            // Actual audio measurements take precedence over the coarse hint.
            value = { level: 'good', reason: null };
        } else if (hasSlowNetworkEstimate(this.connection)) {
            value = { level: 'poor', reason: 'slow-network' };
        } else {
            value = { level: 'unknown', reason: null };
        }
        if (value.level !== this.lastValue?.level || value.reason !== this.lastValue?.reason) {
            this.lastValue = value;
            this.onChange(value);
        }
    }
}
