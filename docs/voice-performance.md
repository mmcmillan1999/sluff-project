# Voice performance

Voice is opt-in and uses a WebRTC mesh across the table or tournament. Five
enabled players give each browser four outgoing and four incoming audio streams.
Audio travels between browsers (or through the configured TURN relay); the game
server relays signaling only.

## Speech profile

`voiceAudioProfile.js` requests mono Opus, a 24,000 bit/s maximum average payload
bitrate, discontinuous transmission during silence (DTX), and in-band forward
error correction. Both offers and answers carry the preferences. The single
microphone capture requests mono; mute still retains the existing track to
preserve mobile audio behavior. Optional sender caps apply only when Opus is
unambiguous. Unsupported optional preferences fall back to browser defaults.

Four outgoing streams at that profile have up to roughly 96 kbit/s of average
audio payload; RTP, encryption, transport, and relay overhead add to that. This
is not a minimum internet speed or a measured performance guarantee. The mesh
still requires a separate connection to each participant.

## Connection recommendation

`VoiceConnectionMonitor.js` reads connected peers' existing WebRTC statistics
every five seconds; it does not download a speed-test payload. It compares
packet counters between samples and requires three consecutive bad observations
on the same peer. Thresholds are 5% packet loss (at least 20 packets in the
interval), 60 ms jitter, or 500 ms round-trip latency. Initial baselining means
a sustained problem normally appears after about 20 seconds. Three healthy
observations clear it; missing statistics remain unknown.

Where available, a browser estimate of 2G/slow-2G or download speed below
0.3 Mbit/s provides an early, explicitly tentative advisory. Healthy measured
audio takes precedence. This estimate cannot measure upload capacity, and one
struggling peer does not prove the local player's connection is at fault.

The recommendation offers **Turn off voice chat**, which leaves the room,
closes all peer connections, and releases capture. Muting only the microphone
keeps incoming voice connected. Players retain control; recommendations never
automatically remove them from voice.

## Signaling protection

Voice signaling/speaking and room membership have separate bounded socket
budgets from game actions, so an ICE burst cannot spend the game's action
tokens. Unchanged microphone-state broadcasts are suppressed, while newly
joined listeners receive the current state.

## Verification and rollout

Focused frontend tests cover speech negotiation, microphone lifecycle, monitor
sampling/recovery/cleanup, and the recommendation action. Backend voice tests
exercise five tournament participants and actual socket middleware, including
voice bursts that leave the game-action budget available.

A local headless Chromium check with five VoiceChat instances and synthetic
audio connected all 20 endpoints (10 peer pairs), received Opus audio in both
directions, and retained one sendrecv transceiver per endpoint. Every offer and
answer included the speech profile without a fallback warning. Synthetic tone
traffic measured about 24.4 kbit/s of RTP payload per stream; silence dropped
below 0.1 kbit/s. All voice resources were released after leaving. These figures
exclude transport overhead and are not a real-network performance benchmark.

After deployment, validate with five real devices including mobile Safari:
check two-way speech, mute/unmute, reseating, and voice off/on; compare game
responsiveness with voice enabled and fully disabled. Browser loopback and
mock tests cannot establish performance over participants' real networks.

References: [Opus RTP parameters](https://www.rfc-editor.org/rfc/rfc7587.html#section-7),
[WebRTC statistics](https://www.w3.org/TR/webrtc-stats/),
[browser network estimates](https://wicg.github.io/netinfo/).
