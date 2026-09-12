import { describe, expect, test, vi } from 'vitest';
import { capVoiceSenderBitrate, withVoiceAudioProfile } from './voiceAudioProfile';

describe('voice speech profile', () => {
    test.each(['offer', 'answer'])('negotiates mono, low-bitrate Opus and silence suppression in an %s', type => {
        const original = {
            type,
            sdp: 'v=0\r\na=group:BUNDLE 0 1\r\n'
                + 'm=audio 9 UDP/TLS/RTP/SAVPF 109 0\r\na=mid:0\r\na=sendrecv\r\n'
                + 'a=ice-ufrag:unchanged\r\na=rtpmap:109 opus/48000/2\r\n'
                + 'a=fmtp:109 minptime=10;useinbandfec=0;stereo=1;maxaveragebitrate=64000\r\n'
                + 'a=rtpmap:0 PCMU/8000\r\n'
                + 'm=video 9 UDP/TLS/RTP/SAVPF 109\r\na=mid:1\r\n'
                + 'a=rtpmap:109 VP8/90000\r\na=fmtp:109 max-fr=30\r\n',
        };
        const profiled = withVoiceAudioProfile(original);
        expect(profiled.type).toBe(type);
        expect(profiled.sdp).toContain('a=fmtp:109 minptime=10;useinbandfec=1;stereo=0;maxaveragebitrate=24000;sprop-stereo=0;usedtx=1\r\n');
        expect(profiled.sdp).toContain('a=rtpmap:109 opus/48000/2\r\n');
        expect(profiled.sdp).toContain('a=ice-ufrag:unchanged\r\n');
        expect(profiled.sdp).toContain('a=sendrecv\r\n');
        expect(profiled.sdp.split('m=video')[1]).toBe(original.sdp.split('m=video')[1]);
        expect(original.sdp).toContain('maxaveragebitrate=64000');
        expect(withVoiceAudioProfile(profiled)).toEqual(profiled);
    });

    test('adds missing fmtp without changing codec clock, payload ID, or line endings', () => {
        const result = withVoiceAudioProfile({ type: 'offer', sdp: 'v=0\nm=audio 9 RTP/AVP 111\na=rtpmap:111 opus/48000/2\na=sendrecv\n' });
        expect(result.sdp).toContain('a=rtpmap:111 opus/48000/2\na=fmtp:111 maxaveragebitrate=24000;stereo=0;sprop-stereo=0;useinbandfec=1;usedtx=1\na=sendrecv\n');
    });

    test('leaves non-Opus audio and absent SDP untouched', () => {
        const description = { type: 'answer', sdp: 'v=0\r\nm=audio 9 RTP/AVP 0\r\na=rtpmap:0 PCMU/8000\r\n' };
        expect(withVoiceAudioProfile(description)).toEqual(description);
        expect(withVoiceAudioProfile({ type: 'rollback' })).toEqual({ type: 'rollback' });
    });

    test('caps negotiated Opus without altering encoding identity or raising a lower limit', async () => {
        const parameters = { transactionId: 'transaction', codecs: [{ mimeType: 'audio/opus' }], encodings: [{ active: true, ssrc: 42 }, { maxBitrate: 16000 }] };
        const sender = { getParameters: () => parameters, setParameters: vi.fn().mockResolvedValue() };
        await capVoiceSenderBitrate(sender);
        expect(sender.setParameters).toHaveBeenCalledWith({
            ...parameters, encodings: [{ active: true, ssrc: 42, maxBitrate: 24000 }, { maxBitrate: 16000 }],
        });
    });

    test('does not starve a fixed-rate fallback codec or fail on missing APIs/encodings', async () => {
        const sender = { getParameters: () => ({ codecs: [{ mimeType: 'audio/PCMU' }], encodings: [{}] }), setParameters: vi.fn() };
        await capVoiceSenderBitrate(sender);
        await capVoiceSenderBitrate({ getParameters: () => ({ codecs: [{ mimeType: 'audio/opus' }] }), setParameters: sender.setParameters });
        await capVoiceSenderBitrate({});
        expect(sender.setParameters).not.toHaveBeenCalled();
    });

    test('does not assume the first negotiated codec is active when fallback codecs remain', async () => {
        const sender = { getParameters: () => ({ codecs: [{ mimeType: 'audio/opus' }, { mimeType: 'audio/PCMU' }], encodings: [{}] }), setParameters: vi.fn() };
        await capVoiceSenderBitrate(sender);
        expect(sender.setParameters).not.toHaveBeenCalled();
    });
});
