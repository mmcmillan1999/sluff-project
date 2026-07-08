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
const BID_SOUND_AT = 400;    // replay lands just as the names hit their marks
const SUIT_SOUND_AT = 1100;  // Solo only: suit announce a beat after the bid
const FLY_AT = 3250;         // bidder leaves first; team follows 0.35s later (CSS)
const DONE_AT = 4200;        // parent unmounts the overlay

const BID_SOUNDS = { 'Frog': 'bidFrog', 'Solo': 'bidSolo', 'Heart Solo': 'bidHeartSolo' };
const SUIT_SOUNDS = { S: 'suitSpades', C: 'suitClubs', D: 'suitDiamonds' };

// VS-layout positions (vw/vh), roughly centered on the table oval
const BIDDER_POS = { x: 50, y: 28 };
const DEFENDER_POS = [{ x: 50, y: 54 }, { x: 50, y: 62 }];

const BidWinnerSplash = ({ info, seatAssignments, playSound, onDone }) => {
    const [flying, setFlying] = useState(false);
    const callbacksRef = useRef({ playSound, onDone });
    callbacksRef.current = { playSound, onDone };

    const { playerName: bidderName, bid, trumpSuit } = info;

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

    const seatAnchorFor = (name) => {
        if (name === seatAssignments.self) return PLAYER_SEAT_CONFIG.south;
        if (name === seatAssignments.opponentLeft) return PLAYER_SEAT_CONFIG.west;
        if (name === seatAssignments.opponentRight) return PLAYER_SEAT_CONFIG.east;
        if (name === seatAssignments.opponentAcross) return PLAYER_SEAT_CONFIG.north;
        return { anchorX: 50, anchorY: 45 };
    };

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
        const target = flying ? seatAnchorFor(name) : null;
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
