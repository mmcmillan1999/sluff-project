// Tournament-wide voice lives above the views. App.js renders one
// VoiceControls for the whole event into a host node that is not part of
// any view; the felt and the board each mount a slot that adopts that node
// while they are on screen. The React subtree (and with it the WebRTC mesh)
// never unmounts between rounds, so voice is built once per tournament
// rather than once per table.
import React, { useLayoutEffect, useRef } from 'react';

let host = null;

export const tournamentVoiceHost = () => {
    if (!host && typeof document !== 'undefined') {
        host = document.createElement('div');
        host.className = 'tournament-voice-host';
    }
    return host;
};

export const TournamentVoiceSlot = ({ className = 'tournament-voice-slot' }) => {
    const ref = useRef(null);
    useLayoutEffect(() => {
        const node = ref.current;
        const voiceHost = tournamentVoiceHost();
        if (!node || !voiceHost) return undefined;
        node.appendChild(voiceHost);
        return () => {
            if (voiceHost.parentNode === node) node.removeChild(voiceHost);
        };
    }, []);
    return <div ref={ref} className={className} />;
};

export default TournamentVoiceSlot;
