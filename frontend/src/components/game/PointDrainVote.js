// frontend/src/components/game/PointDrainVote.js
//
// The table's vote on a point drain ("speed up the game"): someone proposed
// that every score drops by a percentage after each round, and every seat has
// thirty seconds to agree. Unlike the draw and deal-struck votes this is a
// docked card, not a modal — the server keeps the game running under an open
// vote, so the card must never cover the hand or stop a card being played.
//
// The same dock shows the outcome for a few seconds, and, as each round is
// dealt under an agreed drain, what it just took from everyone.

import React, { useEffect, useRef, useState } from 'react';
import './PointDrainVote.css';

const RESULT_MS = 4500;
const NOTICE_MS = 5000;

export const formatPercent = (percent) => `${Number(percent)}%`;

export const proposalSentence = (percent) => (
    Number(percent) > 0
        ? <>every score drops <strong>{formatPercent(percent)}</strong> after each round</>
        : <>scores <strong>stop dropping</strong> between rounds</>
);

const resultCopy = (vote) => {
    if (vote.resolution === 'agreed') {
        return Number(vote.percent) > 0
            ? `Agreed. Every score drops ${formatPercent(vote.percent)} after each round, starting with the next deal.`
            : 'Agreed. Scores stop dropping between rounds.';
    }
    if (vote.resolution === 'declined') return 'No change. Not everyone agreed.';
    if (vote.resolution === 'expired') return 'No change. The vote ran out of time.';
    return null;
};

// Seconds left, counted locally from the moment this vote first arrived: the
// server sends one endsAt instead of a state broadcast every second.
const useSecondsLeft = (vote, serverTime) => {
    const localEndRef = useRef({ endsAt: null, localEnd: 0 });
    const [, tick] = useState(0);
    if (vote?.isActive && localEndRef.current.endsAt !== vote.endsAt) {
        const lead = Number.isFinite(serverTime) ? vote.endsAt - serverTime : 30000;
        localEndRef.current = { endsAt: vote.endsAt, localEnd: Date.now() + Math.max(0, lead) };
    }
    useEffect(() => {
        if (!vote?.isActive) return undefined;
        const timer = setInterval(() => tick(n => n + 1), 500);
        return () => clearInterval(timer);
    }, [vote?.isActive, vote?.endsAt]);
    if (!vote?.isActive) return null;
    return Math.max(0, Math.ceil((localEndRef.current.localEnd - Date.now()) / 1000));
};

const PointDrainVote = ({ currentTableState, selfPlayerName, isSpectator, onVote }) => {
    const vote = currentTableState?.drainVote;
    const drain = currentTableState?.pointDrain;
    const secondsLeft = useSecondsLeft(vote, currentTableState?.serverTime);

    // The outcome lingers for a moment after the vote closes.
    const [resultFor, setResultFor] = useState(null);
    useEffect(() => {
        if (!vote?.resolvedAt || vote.isActive || !resultCopy(vote)) return undefined;
        setResultFor(vote.resolvedAt);
        const timer = setTimeout(() => setResultFor(null), RESULT_MS);
        return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [vote?.resolvedAt, vote?.isActive]);

    // What the drain just took, shown once as each round is dealt.
    const lastKey = drain?.last ? `${currentTableState?.tableId}:${drain.last.afterRound}` : null;
    const seenDropRef = useRef(lastKey);
    const [noticeKey, setNoticeKey] = useState(null);
    useEffect(() => {
        if (!lastKey || seenDropRef.current === lastKey) return undefined;
        seenDropRef.current = lastKey;
        setNoticeKey(lastKey);
        const timer = setTimeout(() => setNoticeKey(null), NOTICE_MS);
        return () => clearTimeout(timer);
    }, [lastKey]);

    if (vote?.isActive) {
        const entries = Object.entries(vote.votes || {});
        const agreed = entries.filter(([, v]) => v === 'yes').length;
        const myVote = vote.votes?.[selfPlayerName];
        const canVote = !isSpectator && myVote === null;
        // Once there is nothing left for this viewer to do, the card shrinks
        // to a strip: it sits over the widow and the trick piles, and a vote
        // can stay open for half a minute.
        if (!canVote) {
            return (
                <div className="point-drain-dock point-drain-dock--vote point-drain-dock--slim" role="status" aria-label="Table vote: speed up the game">
                    <p className="point-drain-eyebrow">Table vote · {secondsLeft}s</p>
                    <p className="point-drain-copy">
                        <strong>{vote.initiator}</strong>: {proposalSentence(vote.percent)}.
                    </p>
                    <p className="point-drain-waiting">
                        {myVote === 'yes' && 'You agreed. '}Waiting for the table… ({agreed}/{entries.length})
                    </p>
                </div>
            );
        }
        return (
            <div className="point-drain-dock point-drain-dock--vote" role="group" aria-label="Table vote: speed up the game">
                <p className="point-drain-eyebrow">Table vote · {secondsLeft}s</p>
                <p className="point-drain-copy">
                    <strong>{vote.initiator}</strong> proposes that {proposalSentence(vote.percent)}.
                    {Number(vote.percent) > 0 && ' Nobody can lose their last point that way.'}
                </p>
                <div className="point-drain-actions">
                    <button type="button" className="point-drain-btn point-drain-btn--yes" onClick={() => onVote('yes')}>AGREE</button>
                    <button type="button" className="point-drain-btn point-drain-btn--no" onClick={() => onVote('no')}>NO THANKS</button>
                </div>
            </div>
        );
    }

    if (resultFor && vote?.resolvedAt === resultFor) {
        return (
            <div className={`point-drain-dock point-drain-dock--${vote.resolution}`} role="status">
                <p className="point-drain-eyebrow">Table vote</p>
                <p className="point-drain-copy">{resultCopy(vote)}</p>
            </div>
        );
    }

    if (noticeKey && noticeKey === lastKey && drain?.last) {
        const drops = Object.entries(drain.last.drops || {});
        return (
            <div className="point-drain-dock point-drain-dock--notice" role="status">
                <p className="point-drain-eyebrow">Speed-up · scores drop {formatPercent(drain.last.percent)}</p>
                <p className="point-drain-copy point-drain-drops">
                    {drops.map(([name, drop]) => (
                        <span key={name} className="point-drain-drop">
                            {name === selfPlayerName ? 'You' : name} <strong>−{drop}</strong>
                        </span>
                    ))}
                </p>
            </div>
        );
    }

    return null;
};

export default PointDrainVote;
