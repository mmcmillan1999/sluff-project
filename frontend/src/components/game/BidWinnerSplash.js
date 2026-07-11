// Round-start fanfare: the bid winner's name squares off against the two
// defenders in a "VS" splash, the winning bid sound replays, then the names
// fly out to each player's actual seat before the overlay unmounts.
import React, { useState, useEffect, useRef } from 'react';
import './BidWinnerSplash.css';
import { PLAYER_SEAT_CONFIG } from '../../config/PlayerSeatConfig';
import { SUIT_SYMBOLS, SUIT_COLORS } from '../../constants';

// Timeline (ms from mount). The splash itself mounts SPLASH_DELAY_MS after the
// bids resolve (GameTableView), which gives the live bid call time to finish
// before this replays it.
export const BID_SPLASH_TIMING = Object.freeze({
    BID_SOUND_AT: 250,   // replay lands just as the names hit their marks
    SUIT_SOUND_AT: 900,  // Solo only: suit announce a beat after the bid
    FLY_AT: 2200,        // bidder leaves first; team follows shortly after (CSS)
    DONE_AT: 3000        // parent unmounts after every fly-to-seat transition
});

const BID_SOUNDS = { 'Frog': 'bidFrog', 'Solo': 'bidSolo', 'Heart Solo': 'bidHeartSolo' };
const SUIT_SOUNDS = { S: 'suitSpades', C: 'suitClubs', D: 'suitDiamonds' };

const SEAT_POSITION_BY_ASSIGNMENT = Object.freeze({
    self: 'bottom',
    opponentLeft: 'left',
    opponentRight: 'right',
    opponentAcross: 'top'
});

const CONFIG_BY_SEAT_POSITION = Object.freeze({
    bottom: PLAYER_SEAT_CONFIG.south,
    left: PLAYER_SEAT_CONFIG.west,
    right: PLAYER_SEAT_CONFIG.east,
    top: PLAYER_SEAT_CONFIG.north
});

// PlayerSeatPositioner publishes its effective anchor after applying portrait
// collision mode. Read that live value so the fly-out lands on the seat users
// actually see, with the static config retained only as a defensive fallback.
export const seatAnchorForPlayer = (name, seatAssignments, root = globalThis.document) => {
    const assignment = Object.keys(SEAT_POSITION_BY_ASSIGNMENT).find(
        key => seatAssignments?.[key] === name
    );
    const seatPosition = assignment ? SEAT_POSITION_BY_ASSIGNMENT[assignment] : null;
    if (!seatPosition) return { anchorX: 50, anchorY: 45 };

    const seatElement = root?.querySelector?.(
        `.player-seat-positioner.player-seat-${seatPosition}`
    );
    const measuredX = Number.parseFloat(seatElement?.dataset?.anchorX);
    const measuredY = Number.parseFloat(seatElement?.dataset?.anchorY);
    if (Number.isFinite(measuredX) && Number.isFinite(measuredY)) {
        return { anchorX: measuredX, anchorY: measuredY };
    }

    return CONFIG_BY_SEAT_POSITION[seatPosition] || { anchorX: 50, anchorY: 45 };
};

// VS-layout positions (vw/vh). This tighter grouping sits about 6vh above the
// old composition while leaving breathing room below the north-seat nameplate.
const BIDDER_POS = { x: 50, y: 23 };
const DEFENDER_POS = [{ x: 50, y: 46.5 }, { x: 50, y: 52.5 }];

const BidWinnerSplash = ({ info, seatAssignments, playSound, onDone }) => {
    const [flying, setFlying] = useState(false);
    const callbacksRef = useRef({ playSound, onDone });
    callbacksRef.current = { playSound, onDone };

    const { playerName: bidderName, bid, trumpSuit } = info;
    const { BID_SOUND_AT, SUIT_SOUND_AT, FLY_AT, DONE_AT } = BID_SPLASH_TIMING;

    useEffect(() => {
        const timers = [
            setTimeout(() => callbacksRef.current.playSound(BID_SOUNDS[bid]), BID_SOUND_AT),
            setTimeout(() => setFlying(true), FLY_AT),
            setTimeout(() => callbacksRef.current.onDone(), DONE_AT)
        ];
        if (bid === 'Solo' && SUIT_SOUNDS[trumpSuit]) {
            timers.push(setTimeout(() => callbacksRef.current.playSound(SUIT_SOUNDS[trumpSuit]), SUIT_SOUND_AT));
        }
        return () => timers.forEach(clearTimeout);
    }, [bid, trumpSuit]);

    // Defenders come from the round's active players (passed by the trigger);
    // seat-derived fallback for safety. Never includes the 4-player dealer.
    const defenders = (info.defenders && info.defenders.length > 0)
        ? info.defenders
        : [
            seatAssignments.self,
            seatAssignments.opponentLeft,
            seatAssignments.opponentRight,
            seatAssignments.opponentAcross
        ].filter(name => name && name !== bidderName);

    const posStyle = (vsPos, name) => {
        const target = flying ? seatAnchorForPlayer(name, seatAssignments) : null;
        return {
            left: `${target ? target.anchorX : vsPos.x}vw`,
            top: `${target ? target.anchorY : vsPos.y}vh`
        };
    };

    return (
        <div className={`bid-splash-overlay${flying ? ' flying' : ''}`}>
            <div className="bid-splash-name bidder" style={posStyle(BIDDER_POS, bidderName)}>
                <span className="bid-splash-playername">{bidderName}</span>
                <span className="bid-splash-bid">
                    {bid.toUpperCase()}
                    {trumpSuit && (
                        <span className="bid-splash-suit" style={{ color: SUIT_COLORS[trumpSuit] }}>
                            {' '}{SUIT_SYMBOLS[trumpSuit]}
                        </span>
                    )}
                </span>
            </div>
            <div className="bid-splash-vs">VS</div>
            {defenders.slice(0, DEFENDER_POS.length).map((name, i) => (
                <div key={name} className="bid-splash-name defender" style={posStyle(DEFENDER_POS[i], name)}>
                    <span className="bid-splash-playername">{name}</span>
                </div>
            ))}
        </div>
    );
};

export default BidWinnerSplash;
