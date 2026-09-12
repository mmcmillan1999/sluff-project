// Speech, not stereo music: every mesh peer costs another upload.
export const VOICE_BITRATE = 24000;

// RFC 7587: these Opus receive preferences belong in BOTH local offers and
// answers. Keep opus/48000/2 intact even when requesting mono, and preserve
// other codecs, media sections, and browser-generated transport attributes.
// https://www.rfc-editor.org/rfc/rfc7587.html#section-7
export function withVoiceAudioProfile(description) {
    if (!description?.sdp) return description;
    const newline = description.sdp.includes('\r\n') ? '\r\n' : '\n';
    const sections = description.sdp.split(/(?=^m=)/m);
    const sdp = sections.map(section => {
        if (!section.startsWith('m=audio ')) return section;
        const lines = section.split(/\r?\n/);
        const payloads = lines.flatMap(line => {
            const match = /^a=rtpmap:(\d+) opus\/48000\/2\s*$/i.exec(line);
            return match ? [match[1]] : [];
        });
        for (const payload of payloads) {
            const prefix = `a=fmtp:${payload} `;
            const index = lines.findIndex(line => line.startsWith(prefix));
            const params = new Map((index < 0 ? [] : lines[index].slice(prefix.length).split(';'))
                .map(param => param.trim()).filter(Boolean).map(param => {
                    const separator = param.indexOf('=');
                    return separator < 0 ? [param.toLowerCase(), '']
                        : [param.slice(0, separator).toLowerCase(), param.slice(separator + 1)];
                }));
            params.set('maxaveragebitrate', String(VOICE_BITRATE));
            params.set('stereo', '0');
            params.set('sprop-stereo', '0');
            params.set('useinbandfec', '1');
            params.set('usedtx', '1');
            const fmtp = prefix + [...params].map(([key, value]) => value ? `${key}=${value}` : key).join(';');
            if (index >= 0) lines[index] = fmtp;
            else lines.splice(lines.findIndex(line => line.startsWith(`a=rtpmap:${payload} `)) + 1, 0, fmtp);
        }
        return lines.join(newline);
    }).join('');
    return { type: description.type, sdp };
}

// Apply the sender cap after negotiation, when encodings/codecs exist. Some
// browsers do not support audio setParameters; SDP still requests the profile.
// Do not force a speech bitrate onto a fallback fixed-rate codec such as PCMU.
export async function capVoiceSenderBitrate(sender) {
    if (!sender?.getParameters || !sender?.setParameters) return;
    const parameters = sender.getParameters();
    if (!parameters.encodings?.length) return;
    // codecs is a candidate list, not the active encoder. If fallback codecs
    // remain possible, use only the codec-specific SDP limit unless the
    // encoding explicitly selects Opus (newer browsers).
    const opusOnly = parameters.codecs?.length > 0
        && parameters.codecs.every(codec => codec.mimeType?.toLowerCase() === 'audio/opus');
    let changed = false;
    for (const encoding of parameters.encodings) {
        if (encoding.codec ? encoding.codec.mimeType?.toLowerCase() !== 'audio/opus' : !opusOnly) continue;
        encoding.maxBitrate = Math.min(encoding.maxBitrate ?? VOICE_BITRATE, VOICE_BITRATE);
        changed = true;
    }
    if (changed) await sender.setParameters(parameters);
}
