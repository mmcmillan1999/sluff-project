// frontend/src/components/BrandHeader.js
// Sluff-branded top strip in the fixed 7.5vh header slot the ad banner used
// (the lobby and game layouts are tuned around that offset — see
// GameTableView.css "just below the 7.5vh header"). Shows the season brand,
// then every few seconds tips forward like a cube to reveal the current
// season's top three players, one per face.
//
// The cube is a real 4-sided prism that only ever rotates FORWARD — the
// rotation angle grows 90deg per turn and is never reset. Face contents are
// reassigned only while their slot is hidden (top/back of the prism), so
// there is no snap-back frame at all; the flicker-free behavior is
// structural, not timing-dependent (iOS Chrome flickered on the old
// animate-then-reset approach even when Safari didn't).
// When monetization returns, swap this back for AdvertisingHeader.
import React, { useEffect, useMemo, useState } from 'react';
import { getCurrentSeasonStandings } from '../services/api';
import './BrandHeader.css';

const FACE_INTERVAL_MS = 5000;
const SLOT_NAMES = ['front', 'bottom', 'back', 'top'];

const PLACE_LABELS = { 1: '1st', 2: '2nd', 3: '3rd' };

const recordLine = (player) => {
    const wins = Number(player?.wins) || 0;
    const losses = Number(player?.losses) || 0;
    return `${wins}W · ${losses}L this season`;
};

const BrandFace = () => (
    <>
        <img className="brand-header-logo" src="/SluffLogo.png" alt="" aria-hidden="true" />
        <div className="brand-header-text">
            <span className="brand-header-season">Alpha Season 2</span>
            <span className="brand-header-tagline">The leaderboard is live</span>
        </div>
    </>
);

const PlayerFace = ({ face }) => (
    <>
        <span className={`brand-header-place brand-header-place--${face.place}`}>
            {PLACE_LABELS[face.place]}
        </span>
        <div className="brand-header-text">
            <span className="brand-header-season">{face.name}</span>
            <span className="brand-header-tagline">{face.record}</span>
        </div>
    </>
);

const FaceContent = ({ face }) => (
    face?.type === 'player' ? <PlayerFace face={face} /> : <BrandFace />
);

const BrandHeader = ({ viewType = 'default' }) => {
    const [topThree, setTopThree] = useState([]);
    const [turns, setTurns] = useState(0);

    useEffect(() => {
        let cancelled = false;
        const loadStandings = async () => {
            try {
                const payload = await getCurrentSeasonStandings();
                if (cancelled || !payload || !Array.isArray(payload.standings)) return;
                const ranked = payload.standings
                    .filter(row => Number.isFinite(Number(row?.rank)) && Number(row.rank) >= 1)
                    .sort((a, b) => Number(a.rank) - Number(b.rank))
                    .slice(0, 3);
                setTopThree(ranked);
            } catch (error) {
                // Header stays on the brand face if standings are unavailable.
            }
        };
        loadStandings();
        return () => {
            cancelled = true;
        };
    }, []);

    const faces = useMemo(() => ([
        { type: 'brand' },
        ...topThree.map((player, index) => ({
            type: 'player',
            place: index + 1,
            name: player.displayName || player.username || 'Unknown player',
            record: recordLine(player),
        })),
    ]), [topThree]);

    const faceCount = faces.length;

    useEffect(() => {
        if (faceCount < 2) return undefined;
        const interval = setInterval(() => setTurns(current => current + 1), FACE_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [faceCount]);

    // Slot s (mounted at rotateX(-90s)) faces the viewer whenever the turn
    // count ≡ s (mod 4). Anchor the 4-turn content window at turns-1 so the
    // face rotating OUT keeps its old content through the whole animation and
    // the face rotating IN already had its content before the turn started —
    // visible faces never change content mid-flight.
    const slotFace = (slot) => {
        const anchor = turns - 1;
        const visibleAtTurn = anchor + ((((slot - anchor) % 4) + 4) % 4);
        return faces[(((visibleAtTurn % faceCount) + faceCount) % faceCount)];
    };

    return (
        <div className={`brand-header brand-header--${viewType}`}>
            <div className="brand-cube-viewport">
                <div
                    className="brand-cube"
                    style={{ transform: `translateZ(-3.75vh) rotateX(${turns * 90}deg)` }}
                >
                    {SLOT_NAMES.map((name, slot) => (
                        <div
                            className={`brand-cube-face brand-cube-face--${name}`}
                            key={name}
                            aria-hidden={turns % 4 === slot ? undefined : 'true'}
                        >
                            <FaceContent face={slotFace(slot)} />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default BrandHeader;
