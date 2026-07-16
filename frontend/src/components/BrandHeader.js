// frontend/src/components/BrandHeader.js
// Sluff-branded top strip in the fixed 7.5vh header slot the ad banner used
// (the lobby and game layouts are tuned around that offset — see
// GameTableView.css "just below the 7.5vh header"). Shows the season brand,
// then every few seconds rotates like a cube tipping forward to reveal the
// current season's top three players, one per face.
// When monetization returns, swap this back for AdvertisingHeader.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentSeasonStandings } from '../services/api';
import './BrandHeader.css';

const FACE_INTERVAL_MS = 5000;
const ROTATE_DURATION_MS = 750; // must match the CSS transition time
const ROTATE_FALLBACK_MS = ROTATE_DURATION_MS + 250;

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
    const [faceIndex, setFaceIndex] = useState(0);
    const [isRotating, setIsRotating] = useState(false);
    const rotationPendingRef = useRef(false);
    const fallbackTimerRef = useRef(null);
    const faceCountRef = useRef(1);

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
    faceCountRef.current = faceCount;

    // Commit the face swap exactly once per rotation. Driven by the CSS
    // transitionend event so the snap-back can never land a frame before the
    // animation has finished painting (the source of a visible flicker); the
    // fallback timer only fires if the transition never completes (hidden tab).
    const finishRotation = useCallback(() => {
        if (!rotationPendingRef.current) return;
        rotationPendingRef.current = false;
        if (fallbackTimerRef.current) {
            clearTimeout(fallbackTimerRef.current);
            fallbackTimerRef.current = null;
        }
        setFaceIndex(current => (current + 1) % faceCountRef.current);
        setIsRotating(false);
    }, []);

    const handleTransitionEnd = (event) => {
        if (event.target !== event.currentTarget || event.propertyName !== 'transform') return;
        finishRotation();
    };

    useEffect(() => {
        if (faceCount < 2) return undefined;
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        const interval = setInterval(() => {
            if (reducedMotion) {
                setFaceIndex(current => (current + 1) % faceCountRef.current);
                return;
            }
            if (rotationPendingRef.current) return; // previous spin still settling
            rotationPendingRef.current = true;
            setIsRotating(true);
            fallbackTimerRef.current = setTimeout(finishRotation, ROTATE_FALLBACK_MS);
        }, FACE_INTERVAL_MS);

        return () => {
            clearInterval(interval);
            if (fallbackTimerRef.current) {
                clearTimeout(fallbackTimerRef.current);
                fallbackTimerRef.current = null;
            }
            rotationPendingRef.current = false;
        };
    }, [faceCount, finishRotation]);

    const frontFace = faces[faceIndex % faceCount];
    const bottomFace = faces[(faceIndex + 1) % faceCount];

    return (
        <div className={`brand-header brand-header--${viewType}`}>
            <div className="brand-cube-viewport">
                <div
                    className={`brand-cube${isRotating ? ' is-rotating' : ''}`}
                    onTransitionEnd={handleTransitionEnd}
                >
                    <div className="brand-cube-face brand-cube-face--front">
                        <FaceContent face={frontFace} />
                    </div>
                    <div className="brand-cube-face brand-cube-face--bottom" aria-hidden="true">
                        <FaceContent face={bottomFace} />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default BrandHeader;
