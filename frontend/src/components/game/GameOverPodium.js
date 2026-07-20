import React, { useEffect, useId, useState } from 'react';
import { PLACEHOLDER_ID_CLIENT } from '../../constants';
import { useModalFocus } from '../../hooks/useModalFocus';
import './GameOverPodium.css';

const GENERIC_WINNER_LABELS = new Set([
    '',
    'draw',
    'forfeit',
    'n/a',
    'no winner'
]);

const CONFETTI = Object.freeze([
    ['6%', '-1.8s', '7.2s', '-4vw', '540deg', '#e8bd58', '15%'],
    ['12%', '-5.4s', '8.6s', '5vw', '-620deg', '#4f8bd6', '42%'],
    ['18%', '-3.1s', '6.9s', '-2vw', '480deg', '#f4e1a4', '68%'],
    ['24%', '-7.2s', '9.1s', '6vw', '-700deg', '#c9902f', '26%'],
    ['30%', '-0.9s', '7.8s', '-6vw', '640deg', '#78a9e6', '82%'],
    ['36%', '-4.6s', '8.2s', '3vw', '-520deg', '#e8bd58', '54%'],
    ['42%', '-2.4s', '7.1s', '-5vw', '580deg', '#f7ebc5', '10%'],
    ['48%', '-6.3s', '9.4s', '4vw', '-680deg', '#3d73b9', '74%'],
    ['54%', '-1.2s', '7.5s', '-3vw', '560deg', '#d7a33e', '34%'],
    ['60%', '-5.8s', '8.9s', '6vw', '-740deg', '#8bb7eb', '90%'],
    ['66%', '-3.7s', '7.3s', '-4vw', '620deg', '#f4e1a4', '60%'],
    ['72%', '-7.9s', '9.7s', '5vw', '-760deg', '#d39b35', '18%'],
    ['78%', '-2.0s', '8.0s', '-5vw', '600deg', '#5b91d1', '48%'],
    ['84%', '-4.9s', '7.6s', '3vw', '-560deg', '#f7ebc5', '78%'],
    ['90%', '-6.7s', '9.0s', '-3vw', '720deg', '#e8bd58', '30%'],
    ['95%', '-3.4s', '8.4s', '4vw', '-640deg', '#6ea2df', '66%']
]);

const normalizeName = value => String(value || '').trim().toLocaleLowerCase();

const normalizeCents = (value, { allowNegative = false } = {}) => {
    const numericValue = Number(value);
    if (!Number.isSafeInteger(numericValue)) return null;
    if (!allowNegative && numericValue < 0) return null;
    return numericValue;
};

const formatTokenAmount = cents => `${(Math.abs(cents) / 100).toFixed(2)} tokens`;

const formatTokenNet = cents => {
    if (cents > 0) return `+${formatTokenAmount(cents)}`;
    if (cents < 0) return `-${formatTokenAmount(cents)}`;
    return formatTokenAmount(0);
};

const tokenOutcomeLabel = (tokenOutcome, netChangeCents, grossReturnCents) => {
    const normalizedOutcome = String(tokenOutcome || '').trim().toLocaleLowerCase();
    if (['wash', 'washes', 'buy-in returned', 'returned'].includes(normalizedOutcome)) {
        return 'Buy-in returned';
    }
    if (['loss', 'losses', 'lost', 'no return'].includes(normalizedOutcome)) {
        return grossReturnCents > 0 ? 'Partial return' : 'No return';
    }
    if (['win', 'wins', 'won', 'gain'].includes(normalizedOutcome)) {
        return 'Token gain';
    }
    if (netChangeCents > 0) return 'Token gain';
    if (netChangeCents < 0) return grossReturnCents > 0 ? 'Partial return' : 'No return';
    return 'Even';
};

export const normalizeTokenSettlement = (tokenSettlement) => {
    if (tokenSettlement === null || tokenSettlement === undefined) return null;
    if (!tokenSettlement || typeof tokenSettlement !== 'object'
        || ['failed', 'error'].includes(String(tokenSettlement.status || '').toLocaleLowerCase())) {
        return { available: false, entries: [] };
    }

    const buyInCents = normalizeCents(tokenSettlement.buyInCents);
    const potCents = normalizeCents(tokenSettlement.potCents);
    const sourceEntries = Array.isArray(tokenSettlement.entries) ? tokenSettlement.entries : [];
    const entries = sourceEntries
        .filter(entry => entry && typeof entry === 'object'
            && typeof entry.playerName === 'string' && entry.playerName.trim())
        .map(entry => {
            const playerName = entry.playerName.trim();
            const funded = entry.funded !== false;
            if (!funded) {
                return {
                    playerName,
                    funded: false,
                    available: true,
                    outcomeLabel: 'Even',
                };
            }

            const grossReturnCents = normalizeCents(entry.grossReturnCents);
            const netChangeCents = normalizeCents(entry.netChangeCents, { allowNegative: true });
            const available = grossReturnCents !== null && netChangeCents !== null;
            return {
                playerName,
                funded: true,
                available,
                grossReturnCents,
                netChangeCents,
                outcomeLabel: available
                    ? tokenOutcomeLabel(entry.tokenOutcome, netChangeCents, grossReturnCents)
                    : 'Settlement unavailable',
            };
        });

    return {
        available: entries.length > 0,
        buyInCents,
        potCents,
        entries,
    };
};

const declaredWinnerNames = (gameWinner) => {
    const rawWinner = String(gameWinner || '').trim();
    const normalizedWinner = normalizeName(rawWinner);
    if (!rawWinner
        || GENERIC_WINNER_LABELS.has(normalizedWinner)
        || /^\d+-way tie$/i.test(rawWinner)) {
        return [];
    }
    return rawWinner.split(/\s*&\s*/).map(name => name.trim()).filter(Boolean);
};

const scoreSort = (left, right) => {
    if (left.score === null && right.score !== null) return 1;
    if (left.score !== null && right.score === null) return -1;
    if (left.score !== right.score) return (right.score || 0) - (left.score || 0);
    return left.name.localeCompare(right.name);
};

const forfeitNameFrom = (forfeit) => {
    if (typeof forfeit === 'string') return forfeit.trim();
    return forfeit?.forfeitingPlayerName?.trim?.() || '';
};

const winnerNamesFrom = (gameWinner, players, forfeitName) => {
    const rawWinner = String(gameWinner || '').trim();
    const normalizedWinner = normalizeName(rawWinner);
    const winnerParts = rawWinner
        .split(/\s*&\s*/)
        .map(normalizeName)
        .filter(Boolean);

    const namedWinners = players
        .filter(player => (
            normalizeName(player.name) === normalizedWinner
            || winnerParts.includes(normalizeName(player.name))
        ))
        .map(player => player.name);
    if (namedWinners.length > 0) return namedWinners;

    if (forfeitName) {
        const normalizedForfeit = normalizeName(forfeitName);
        return players
            .filter(player => normalizeName(player.name) !== normalizedForfeit)
            .map(player => player.name);
    }

    const isScoreTieLabel = /^\d+-way tie$/i.test(rawWinner);
    if (normalizedWinner && GENERIC_WINNER_LABELS.has(normalizedWinner) && !isScoreTieLabel) return [];

    const scoredPlayers = players.filter(player => player.score !== null);
    if (scoredPlayers.length === 0) return [];
    const topScore = Math.max(...scoredPlayers.map(player => player.score));
    return scoredPlayers
        .filter(player => player.score === topScore)
        .map(player => player.name);
};

const ordinal = (rank) => {
    if (rank === 1) return '1st';
    if (rank === 2) return '2nd';
    if (rank === 3) return '3rd';
    return `${rank}th`;
};

const visualOrderForIndex = index => [2, 1, 3, 4][index] || index + 1;

export const rankPodiumPlayers = ({ gameWinner, finalScores, forfeit } = {}) => {
    const players = Object.entries(finalScores || {})
        .filter(([name]) => name && name !== PLACEHOLDER_ID_CLIENT)
        .map(([name, rawScore]) => {
            const hasScore = rawScore !== null
                && rawScore !== undefined
                && String(rawScore).trim() !== '';
            const numericScore = Number(rawScore);
            return {
                name,
                score: hasScore && Number.isFinite(numericScore) ? numericScore : null
            };
        });

    for (const declaredName of declaredWinnerNames(gameWinner)) {
        if (!players.some(player => normalizeName(player.name) === normalizeName(declaredName))) {
            players.push({ name: declaredName, score: null });
        }
    }

    const forfeitName = forfeitNameFrom(forfeit);
    const winnerNames = winnerNamesFrom(gameWinner, players, forfeitName);
    const normalizedWinners = new Set(winnerNames.map(normalizeName));
    const winners = players
        .filter(player => normalizedWinners.has(normalizeName(player.name)))
        .sort(scoreSort);
    const remaining = players
        .filter(player => !normalizedWinners.has(normalizeName(player.name)))
        .sort(scoreSort);
    const ordered = [...winners, ...remaining];

    let previousNonWinnerScore;
    let previousNonWinnerRank;
    return ordered.map((player, index) => {
        const isWinner = normalizedWinners.has(normalizeName(player.name));
        let rank;
        if (isWinner) {
            rank = 1;
        } else if (index > winners.length && player.score === previousNonWinnerScore) {
            rank = previousNonWinnerRank;
        } else {
            rank = index + 1;
        }
        if (!isWinner) {
            previousNonWinnerScore = player.score;
            previousNonWinnerRank = rank;
        }

        return {
            ...player,
            isWinner,
            rank,
            rankLabel: ordinal(rank),
            visualOrder: visualOrderForIndex(index)
        };
    });
};

const outcomeCopy = (entries, forfeit, gameWinner) => {
    const winners = entries.filter(entry => entry.isWinner);
    const forfeitName = forfeitNameFrom(forfeit);
    if (forfeitName && winners.length > 0) {
        return {
            heading: 'Victory by Forfeit',
            detail: `${forfeitName} forfeited. ${winners.map(entry => entry.name).join(' & ')} take the top step.`
        };
    }
    if (winners.length === 1) {
        return {
            heading: `${winners[0].name} Wins`,
            detail: 'Champion of Sluff'
        };
    }
    if (winners.length > 1) {
        return {
            heading: 'Shared Victory',
            detail: `${winners.map(entry => entry.name).join(' & ')} finish together on top.`
        };
    }
    if (normalizeName(gameWinner) === 'draw') {
        return { heading: 'Game Drawn', detail: 'Final standings' };
    }
    return { heading: 'Final Standings', detail: 'Game complete' };
};

const Confetti = () => (
    <div className="game-over-podium__confetti" aria-hidden="true">
        {CONFETTI.map(([x, delay, duration, drift, spin, color, staticY], index) => (
            <span
                // Position and timing are deterministic so remounts do not jump.
                key={`${x}-${index}`}
                className="game-over-podium__confetti-piece"
                style={{
                    '--confetti-x': x,
                    '--confetti-delay': delay,
                    '--confetti-duration': duration,
                    '--confetti-drift': drift,
                    '--confetti-spin': spin,
                    '--confetti-color': color,
                    '--confetti-static-y': staticY
                }}
            />
        ))}
    </div>
);

const BID_ABBR = { Frog: 'Frog', Solo: 'Solo', 'Heart Solo': 'H.Solo' };

const GameOverPodium = ({
    show = true,
    gameWinner,
    finalScores,
    forfeit = null,
    onRematch,
    onLobby,
    rematchLabel = 'Rematch',
    lobbyLabel = 'Lobby',
    statusMessage = null,
    actionsDisabled = false,
    tokenSettlement = null,
    roundHistory = null
}) => {
    const headingId = useId();
    const detailId = useId();
    const tokenSettlementHeadingId = useId();
    const roundHistoryHeadingId = useId();
    const dialogRef = useModalFocus(show, 'button:not(:disabled)');
    const [submitted, setSubmitted] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);

    useEffect(() => {
        if (!show) return;
        setSubmitted(false);
    }, [show, actionsDisabled]);

    if (!show) return null;

    const entries = rankPodiumPlayers({ gameWinner, finalScores, forfeit });
    const outcome = outcomeCopy(entries, forfeit, gameWinner);
    const rounds = Array.isArray(roundHistory) ? roundHistory : [];
    // Column order follows the podium standings so a player can scan one row.
    const historyPlayers = entries.map(e => e.name).filter(name => name !== PLACEHOLDER_ID_CLIENT);
    const normalizedTokenSettlement = normalizeTokenSettlement(tokenSettlement);
    const podiumCount = Math.min(4, Math.max(3, entries.length || 3));
    const invokeAction = (callback, { requiresReady = false } = {}) => {
        if (submitted
            || (requiresReady && actionsDisabled)
            || typeof callback !== 'function') return;
        setSubmitted(true);
        callback();
    };

    return (
        <div
            ref={dialogRef}
            className="game-over-podium"
            role="dialog"
            aria-modal="true"
            aria-labelledby={headingId}
            aria-describedby={detailId}
            tabIndex={-1}
        >
            <Confetti />
            <section className="game-over-podium__panel">
                <header className="game-over-podium__header">
                    <p className="game-over-podium__eyebrow">Game Over</p>
                    <h1 id={headingId}>{outcome.heading}</h1>
                    <p id={detailId} className="game-over-podium__outcome">{outcome.detail}</p>
                </header>

                {statusMessage && (
                    <p className="game-over-podium__status" role="status">
                        {statusMessage}
                    </p>
                )}

                {entries.length > 0 ? (
                    <div
                        className="game-over-podium__stage"
                        style={{ '--podium-count': podiumCount }}
                        role="list"
                        aria-label="Final standings"
                    >
                        {entries.slice(0, 4).map(entry => (
                            <article
                                key={entry.name}
                                className={`game-over-podium__contestant${entry.isWinner ? ' game-over-podium__contestant--winner' : ''}`}
                                style={{ '--podium-order': entry.visualOrder }}
                                data-player-name={entry.name}
                                data-rank={entry.rank}
                                role="listitem"
                                aria-label={`${entry.name}, ${entry.rankLabel}, ${entry.score === null ? 'score unavailable' : `${entry.score} points`}`}
                            >
                                <div className="game-over-podium__player">
                                    <span className="game-over-podium__crown" aria-hidden="true">◆</span>
                                    <span className="game-over-podium__name" title={entry.name}>{entry.name}</span>
                                    <span className="game-over-podium__score">
                                        {entry.score === null ? '—' : entry.score}
                                        <span className="game-over-podium__score-unit"> pts</span>
                                    </span>
                                </div>
                                <div className={`game-over-podium__step game-over-podium__step--rank-${Math.min(entry.rank, 4)}`}>
                                    <span className="game-over-podium__rank">{entry.rankLabel}</span>
                                </div>
                            </article>
                        ))}
                    </div>
                ) : (
                    <p className="game-over-podium__unavailable">Final scores are unavailable.</p>
                )}

                {normalizedTokenSettlement && (
                    <section
                        className="game-over-podium__settlement"
                        aria-labelledby={tokenSettlementHeadingId}
                    >
                        <div className="game-over-podium__settlement-header">
                            <h2 id={tokenSettlementHeadingId}>Token settlement</h2>
                            {normalizedTokenSettlement.available && (
                                <p>
                                    {[
                                        normalizedTokenSettlement.buyInCents !== null
                                            ? `${formatTokenAmount(normalizedTokenSettlement.buyInCents)} buy-in`
                                            : null,
                                        normalizedTokenSettlement.potCents !== null
                                            ? `${formatTokenAmount(normalizedTokenSettlement.potCents)} pot`
                                            : null,
                                    ].filter(Boolean).join(' · ')}
                                </p>
                            )}
                        </div>

                        {normalizedTokenSettlement.available ? (
                            <ul
                                className="game-over-podium__settlement-list"
                                aria-label="Token settlement results"
                            >
                                {normalizedTokenSettlement.entries.map((entry, index) => (
                                    <li
                                        className="game-over-podium__settlement-entry"
                                        key={`${entry.playerName}-${index}`}
                                    >
                                        <span
                                            className="game-over-podium__settlement-name"
                                            title={entry.playerName}
                                        >
                                            {entry.playerName}
                                        </span>
                                        <span className="game-over-podium__settlement-result">
                                            <strong>{entry.outcomeLabel}</strong>
                                            {!entry.funded && <small>No token change</small>}
                                            {entry.funded && entry.available && (
                                                <small>
                                                    {formatTokenAmount(entry.grossReturnCents)} returned
                                                    {' · '}
                                                    net {formatTokenNet(entry.netChangeCents)}
                                                </small>
                                            )}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="game-over-podium__settlement-unavailable" role="status">
                                Token settlement details are unavailable.
                            </p>
                        )}
                    </section>
                )}

                {rounds.length > 0 && historyPlayers.length > 0 && (
                    <section className="game-over-podium__history" aria-labelledby={roundHistoryHeadingId}>
                        <button
                            type="button"
                            className="game-over-podium__history-toggle"
                            aria-expanded={historyOpen}
                            onClick={() => setHistoryOpen(open => !open)}
                        >
                            <h2 id={roundHistoryHeadingId}>Round-by-round</h2>
                            <span className="game-over-podium__history-chevron" aria-hidden="true">
                                {historyOpen ? '▲' : '▼'}
                            </span>
                        </button>
                        {historyOpen && (
                            <div className="game-over-podium__history-scroll">
                                <table className="game-over-podium__history-table">
                                    <thead>
                                        <tr>
                                            <th scope="col">Rd</th>
                                            <th scope="col">Bid</th>
                                            {historyPlayers.map(name => (
                                                <th scope="col" key={name} title={name}>{name}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rounds.map(round => {
                                            const isBidderBid = name => name === round.bidderName;
                                            return (
                                                <tr key={round.roundNumber}>
                                                    <td>{round.roundNumber}</td>
                                                    <td className="game-over-podium__history-bid">
                                                        <span title={`${round.bidderName} · ${round.bidType} · ${round.bidderCardPoints} card pts${round.dealExecuted ? ' · insured' : ''}`}>
                                                            {BID_ABBR[round.bidType] || round.bidType}
                                                            {round.dealExecuted && <span className="game-over-podium__history-ins" aria-label="insurance deal"> ⛨</span>}
                                                        </span>
                                                    </td>
                                                    {historyPlayers.map(name => {
                                                        const change = Number(round.pointChanges?.[name]) || 0;
                                                        return (
                                                            <td
                                                                key={name}
                                                                className={`game-over-podium__history-delta${change > 0 ? ' is-positive' : change < 0 ? ' is-negative' : ''}${isBidderBid(name) ? ' is-bidder' : ''}`}
                                                            >
                                                                {change > 0 ? `+${change}` : change}
                                                            </td>
                                                        );
                                                    })}
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </section>
                )}

                <footer className="game-over-podium__actions">
                    <button
                        type="button"
                        className="game-over-podium__button game-over-podium__button--primary"
                        onClick={() => invokeAction(onRematch, { requiresReady: true })}
                        disabled={actionsDisabled || submitted || typeof onRematch !== 'function'}
                    >
                        {rematchLabel}
                    </button>
                    <button
                        type="button"
                        className="game-over-podium__button game-over-podium__button--secondary"
                        onClick={() => invokeAction(onLobby)}
                        disabled={submitted || typeof onLobby !== 'function'}
                    >
                        {lobbyLabel}
                    </button>
                </footer>
            </section>
        </div>
    );
};

export default GameOverPodium;
