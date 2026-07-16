import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSeason, getSeasons } from '../services/api';
import './SeasonRecapsView.css';

const seasonKey = season => String(season?.slug ?? season?.id ?? '');

const finalizedTime = season => {
    const time = Date.parse(season?.finalizedAt || '');
    return Number.isFinite(time) ? time : 0;
};

const signedValue = value => {
    const number = Number(value);
    if (!Number.isFinite(number)) return '0.00';
    if (number > 0) return `+${number.toFixed(2)}`;
    return number.toFixed(2);
};

const plainValue = value => {
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(2) : '0.00';
};

const rankingValue = (value, rankingMethod) => (
    rankingMethod === 'game_token_net' ? signedValue(value) : plainValue(value)
);

const recordText = row => {
    const wins = Number(row?.wins) || 0;
    const losses = Number(row?.losses) || 0;
    const washes = Number(row?.washes) || 0;
    return `${wins}W · ${losses}L · ${washes} wash${washes === 1 ? '' : 'es'}`;
};

const gameCount = row => {
    const explicit = Number(row?.gamesPlayed);
    if (Number.isFinite(explicit)) return explicit;
    return (Number(row?.wins) || 0) + (Number(row?.losses) || 0) + (Number(row?.washes) || 0);
};

const formatFinalizedDate = value => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    }).format(date);
};

const rankingRuleText = season => {
    if (season?.rankingMethod === 'wallet_balance') {
        return 'Ranked by final wallet balance. Ties are ordered by player name.';
    }
    const minimumGames = Number(season?.rules?.minimumSettledGames);
    const eligibility = Number.isInteger(minimumGames) && minimumGames > 0
        ? ` At least ${minimumGames} settled game${minimumGames === 1 ? '' : 's'} required for a rank.`
        : '';
    return `Ranked by net tokens from settled season games.${eligibility} Ties are ordered by player name.`;
};

const SeasonRecapsView = ({ onReturnToLobby }) => {
    const headingRef = useRef(null);
    const recapRequestRef = useRef(0);
    const [seasons, setSeasons] = useState([]);
    const [selectedSeasonKey, setSelectedSeasonKey] = useState('');
    const [recap, setRecap] = useState(null);
    const [isIndexLoading, setIsIndexLoading] = useState(true);
    const [isRecapLoading, setIsRecapLoading] = useState(false);
    const [indexError, setIndexError] = useState('');
    const [recapError, setRecapError] = useState('');

    useEffect(() => {
        headingRef.current?.focus();
    }, []);

    const loadSeasonIndex = useCallback(async () => {
        setIsIndexLoading(true);
        setIndexError('');
        try {
            const payload = await getSeasons();
            const finalizedSeasons = (Array.isArray(payload?.seasons) ? payload.seasons : [])
                .filter(season => season?.finalizedAt)
                .sort((left, right) => finalizedTime(right) - finalizedTime(left));

            setSeasons(finalizedSeasons);
            setSelectedSeasonKey(previous => {
                if (finalizedSeasons.some(season => seasonKey(season) === previous)) return previous;
                return seasonKey(finalizedSeasons[0]);
            });
            if (finalizedSeasons.length === 0) setRecap(null);
        } catch (error) {
            setIndexError(error?.message || 'Season history could not be loaded.');
            setSeasons([]);
            setSelectedSeasonKey('');
            setRecap(null);
        } finally {
            setIsIndexLoading(false);
        }
    }, []);

    useEffect(() => {
        loadSeasonIndex();
    }, [loadSeasonIndex]);

    const loadRecap = useCallback(async () => {
        if (!selectedSeasonKey) return;
        const requestId = recapRequestRef.current + 1;
        recapRequestRef.current = requestId;
        setIsRecapLoading(true);
        setRecapError('');
        try {
            const payload = await getSeason(selectedSeasonKey);
            if (recapRequestRef.current === requestId) setRecap(payload);
        } catch (error) {
            if (recapRequestRef.current === requestId) {
                setRecap(null);
                setRecapError(error?.message || 'This season recap could not be loaded.');
            }
        } finally {
            if (recapRequestRef.current === requestId) setIsRecapLoading(false);
        }
    }, [selectedSeasonKey]);

    useEffect(() => {
        loadRecap();
    }, [loadRecap]);

    const selectedSummary = useMemo(
        () => seasons.find(season => seasonKey(season) === selectedSeasonKey) || null,
        [seasons, selectedSeasonKey],
    );
    const season = recap?.season || selectedSummary;
    const standings = Array.isArray(recap?.standings) ? recap.standings : [];
    const rankingLabel = season?.rankingLabel || 'Season +/-';
    const podiumByRank = useMemo(() => {
        const entries = Array.isArray(recap?.podium) ? recap.podium : [];
        return new Map(entries.map(entry => [Number(entry?.rank), entry]));
    }, [recap]);

    return (
        <div className="season-recaps-view">
            <header className="season-recaps-header">
                <button type="button" className="season-recaps-back" onClick={onReturnToLobby}>
                    <span aria-hidden="true">&lsaquo;</span>
                    Lobby
                </button>
                <div className="season-recaps-brand" aria-label="Sluff season history">
                    <img src="/SluffLogo.png" alt="" aria-hidden="true" />
                    <span>Season History</span>
                </div>
                <span className="season-recaps-header-spacer" aria-hidden="true" />
            </header>

            <main className="season-recaps-main">
                <section className="season-recaps-intro" aria-labelledby="season-recaps-heading">
                    <p className="season-recaps-eyebrow">The Sluff record book</p>
                    <h1 id="season-recaps-heading" ref={headingRef} tabIndex="-1">Season Recaps</h1>
                    <p>Every finished season stays frozen here, exactly as the final scoreboard stood.</p>
                </section>

                {isIndexLoading ? (
                    <div className="season-recaps-state" role="status">Opening the record book…</div>
                ) : indexError ? (
                    <div className="season-recaps-state is-error" role="alert">
                        <strong>Couldn’t load season history</strong>
                        <span>{indexError}</span>
                        <button type="button" onClick={loadSeasonIndex}>Try again</button>
                    </div>
                ) : seasons.length === 0 ? (
                    <div className="season-recaps-state">
                        <strong>The first recap is being prepared.</strong>
                        <span>Final standings will appear here as soon as a season is officially closed.</span>
                    </div>
                ) : (
                    <>
                        <section className="season-recaps-picker" aria-label="Choose a completed season">
                            <label htmlFor="season-recap-select">Completed season</label>
                            <select
                                id="season-recap-select"
                                value={selectedSeasonKey}
                                onChange={event => setSelectedSeasonKey(event.target.value)}
                            >
                                {seasons.map(completedSeason => (
                                    <option value={seasonKey(completedSeason)} key={seasonKey(completedSeason)}>
                                        {completedSeason.name}
                                    </option>
                                ))}
                            </select>
                        </section>

                        {isRecapLoading ? (
                            <div className="season-recaps-state" role="status">Unveiling {selectedSummary?.name || 'season'}…</div>
                        ) : recapError ? (
                            <div className="season-recaps-state is-error" role="alert">
                                <strong>Couldn’t open this recap</strong>
                                <span>{recapError}</span>
                                <button type="button" onClick={loadRecap}>Try again</button>
                            </div>
                        ) : recap ? (
                            <>
                                <section className="season-recap-hero" aria-labelledby="selected-season-heading">
                                    <p className="season-recaps-eyebrow">Final standings</p>
                                    <h2 id="selected-season-heading">{season?.name || 'Completed Season'}</h2>
                                    <div className="season-recap-meta">
                                        {formatFinalizedDate(season?.finalizedAt) && (
                                            <span>Finalized {formatFinalizedDate(season.finalizedAt)}</span>
                                        )}
                                        <span>{season?.playerCount ?? standings.length} players recorded</span>
                                    </div>
                                    <p className="season-recap-rules">{rankingRuleText(season)}</p>

                                    <div className="season-podium" role="list" aria-label={`${season?.name || 'Season'} final podium`}>
                                        {[1, 2, 3].map(place => {
                                            const player = podiumByRank.get(place);
                                            return (
                                                <article
                                                    className={`season-podium-card place-${place}`}
                                                    role="listitem"
                                                    key={place}
                                                >
                                                    <span className="season-podium-medal" aria-hidden="true">{place}</span>
                                                    <strong>{player?.displayName || '—'}</strong>
                                                    <span className="season-podium-record">{player ? recordText(player) : 'No finisher'}</span>
                                                    <span className="season-podium-score">
                                                        {player ? rankingValue(player.rankingTokens, season?.rankingMethod) : '—'}
                                                        <small>{rankingLabel}</small>
                                                    </span>
                                                </article>
                                            );
                                        })}
                                    </div>
                                </section>

                                <section className="season-standings" aria-labelledby="frozen-standings-heading">
                                    <div className="season-standings-heading">
                                        <div>
                                            <p className="season-recaps-eyebrow">Permanent archive</p>
                                            <h2 id="frozen-standings-heading">Frozen scoreboard</h2>
                                        </div>
                                        <span>{standings.length} records</span>
                                    </div>

                                    {standings.length === 0 ? (
                                        <p className="season-standings-empty">No standings were recorded for this season.</p>
                                    ) : (
                                        <ol className="season-standings-list">
                                            {standings.map((player, index) => (
                                                <li
                                                    className="season-standing-row"
                                                    key={`${player.displayName || 'player'}-${player.rank ?? index}`}
                                                >
                                                    <span
                                                        className="season-standing-rank"
                                                        aria-label={player.rank == null ? 'Unranked' : `Rank ${player.rank}`}
                                                        title={player.rank == null ? 'Unranked' : `Rank ${player.rank}`}
                                                    >
                                                        {player.rank ?? '—'}
                                                    </span>
                                                    <span className="season-standing-player">
                                                        <strong>{player.displayName}</strong>
                                                        <small>
                                                            {player.rank == null ? 'Unranked · ' : ''}
                                                            {recordText(player)} · {gameCount(player)} games
                                                        </small>
                                                        {season?.rankingMethod !== 'wallet_balance' && (
                                                            <small className="season-standing-wallet">Wallet {plainValue(player.walletTokens)}</small>
                                                        )}
                                                    </span>
                                                    <span className="season-standing-score">
                                                        <strong>{rankingValue(player.rankingTokens, season?.rankingMethod)}</strong>
                                                        <small>{rankingLabel}</small>
                                                    </span>
                                                </li>
                                            ))}
                                        </ol>
                                    )}
                                </section>
                            </>
                        ) : null}
                    </>
                )}
            </main>
        </div>
    );
};

export default SeasonRecapsView;
