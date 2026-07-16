import React, { useCallback, useEffect, useState } from 'react';
import { getCurrentSeasonStandings, getLeaderboard } from '../services/api';
import PlayerProfileModal from './PlayerProfileModal';
import './LeaderboardView.css';

const numericValue = value => {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
};

const normalizeStandings = (rows, { legacy = false } = {}) => (
    (Array.isArray(rows) ? rows : []).map((row, index) => {
        const wins = numericValue(row?.wins);
        const losses = numericValue(row?.losses);
        const washes = numericValue(row?.washes);
        const explicitGames = Number(row?.gamesPlayed ?? row?.games_played);
        const hasExplicitRank = Object.prototype.hasOwnProperty.call(row || {}, 'rank');

        return {
            ...row,
            username: row?.username ?? row?.displayName ?? 'Unknown player',
            rank: hasExplicitRank
                ? (row?.rank == null ? null : numericValue(row.rank))
                : (legacy ? index + 1 : null),
            wins,
            losses,
            washes,
            gamesPlayed: Number.isFinite(explicitGames) ? explicitGames : wins + losses + washes,
            rankingTokens: numericValue(row?.rankingTokens ?? row?.tokens),
            walletTokens: numericValue(row?.walletTokens ?? row?.tokens),
        };
    })
);

const signedValue = value => {
    const number = numericValue(value);
    if (number > 0) return `+${number.toFixed(2)}`;
    return number.toFixed(2);
};

const rankingValue = (value, rankingMethod) => (
    rankingMethod === 'game_token_net' ? signedValue(value) : numericValue(value).toFixed(2)
);

const recordValue = (player, showPercent) => {
    if (!showPercent) return `${player.wins}-${player.losses}-${player.washes}`;
    if (!player.gamesPlayed) return '0 · 0 · 0%';
    const percentage = value => Math.round((value / player.gamesPlayed) * 100);
    return `${percentage(player.wins)} · ${percentage(player.losses)} · ${percentage(player.washes)}%`;
};

const LeaderboardView = ({ user, onReturnToLobby, handleShowAdmin }) => {
    const [leaderboardData, setLeaderboardData] = useState([]);
    const [season, setSeason] = useState(null);
    const [isLegacyFallback, setIsLegacyFallback] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [showPercent, setShowPercent] = useState(false);
    const [profilePlayerName, setProfilePlayerName] = useState(null);

    const fetchLeaderboard = useCallback(async () => {
        setIsLoading(true);
        setError('');
        try {
            const payload = await getCurrentSeasonStandings();
            if (!payload || !Array.isArray(payload.standings)) {
                throw new Error('Current season standings are not available yet.');
            }
            setSeason(payload?.season || null);
            setLeaderboardData(normalizeStandings(payload?.standings));
            setIsLegacyFallback(false);
        } catch (currentSeasonError) {
            try {
                const legacyRows = await getLeaderboard();
                setSeason(null);
                setLeaderboardData(normalizeStandings(legacyRows, { legacy: true }));
                setIsLegacyFallback(true);
            } catch (legacyError) {
                setSeason(null);
                setLeaderboardData([]);
                setIsLegacyFallback(false);
                setError(legacyError?.message || currentSeasonError?.message || 'Could not load the leaderboard.');
            }
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchLeaderboard();
    }, [fetchLeaderboard]);

    const currentUsername = user?.username;
    const currentUserRank = leaderboardData.find(player => player.username === currentUsername);
    const currentUserRankIndex = leaderboardData.findIndex(player => player.username === currentUsername);
    const rankingLabel = season?.rankingLabel || (isLegacyFallback ? 'Tokens' : 'Season +/-');
    const seasonName = season?.name || (isLegacyFallback ? 'Live standings' : 'Current season');
    const showSeparateWallet = isLegacyFallback || season?.rankingMethod === 'game_token_net';

    const renderPlayerRow = (player, index) => {
        const rankLabel = player.rank == null ? 'Unranked' : `Rank ${player.rank}`;

        return (
            <tr key={`${player.username}-${player.rank ?? index}`} className={player.username === currentUsername ? 'is-current-player' : ''}>
                <td className="leaderboard-rank-cell">
                    <span aria-label={rankLabel} title={rankLabel}>{player.rank ?? '—'}</span>
                </td>
                <td className="username-cell" title={player.username}>
                    <button
                        type="button"
                        className="leaderboard-player-link"
                        onClick={() => setProfilePlayerName(player.username)}
                        aria-label={player.username === currentUsername
                            ? 'View your player profile'
                            : `View ${player.username}'s player profile`}
                    >
                        {player.username}
                    </button>
                    {showSeparateWallet && (
                        <span className="leaderboard-wallet">Wallet {player.walletTokens.toFixed(2)}</span>
                    )}
                </td>
                <td className="leaderboard-record-cell">
                    <strong>{recordValue(player, showPercent)}</strong>
                    <small>{showPercent ? 'W · L · Wash' : `${player.gamesPlayed} games`}</small>
                </td>
                <td className="leaderboard-season-score">
                    <strong>{rankingValue(player.rankingTokens, season?.rankingMethod)}</strong>
                    <small>{rankingLabel}</small>
                </td>
            </tr>
        );
    };

    const renderLeaderboardTable = (rows, startIndex = 0, extraClass = '') => (
        <table className={`leaderboard-table ${extraClass}`.trim()}>
            <thead>
                <tr>
                    <th className="rank-col">#</th>
                    <th className="username-col">Player</th>
                    <th className="record-col">{showPercent ? '% W-L-Wash' : 'W-L-Wash'}</th>
                    <th className="season-score-col">{rankingLabel}</th>
                </tr>
            </thead>
            <tbody>
                {rows.map((player, index) => renderPlayerRow(player, startIndex + index))}
            </tbody>
        </table>
    );

    return (
        <div className="leaderboard-view">
            <header className="leaderboard-header">
                <div className="leaderboard-title-group">
                    <img src="/SluffLogo.png" alt="" aria-hidden="true" className="leaderboard-logo" />
                    <div>
                        <span className="leaderboard-kicker">Current season</span>
                        <h1 className="leaderboard-title">{seasonName}</h1>
                    </div>
                </div>
                <div className="leaderboard-header-buttons">
                    <button
                        type="button"
                        onClick={fetchLeaderboard}
                        className="leaderboard-refresh-button"
                        aria-label="Refresh leaderboard"
                        title="Refresh leaderboard"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24" aria-hidden="true"><path d="M0 0h24v24H0z" fill="none"/><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
                    </button>
                    <button
                        type="button"
                        onClick={() => setShowPercent(previous => !previous)}
                        className="leaderboard-toggle-button"
                    >
                        {showPercent ? 'Totals' : '%'}
                    </button>
                    <button type="button" onClick={onReturnToLobby} className="leaderboard-back-button">Lobby</button>
                </div>
            </header>

            <main className="leaderboard-main">
                {isLegacyFallback && !isLoading && !error && (
                    <p className="leaderboard-rollout-note" role="status">
                        Showing the live legacy standings while season records finish loading.
                    </p>
                )}

                {isLoading ? (
                    <p className="leaderboard-state" role="status">Loading standings…</p>
                ) : error ? (
                    <div className="leaderboard-state is-error" role="alert">
                        <span>{error}</span>
                        <button type="button" onClick={fetchLeaderboard}>Try again</button>
                    </div>
                ) : leaderboardData.length === 0 ? (
                    <div className="leaderboard-state">
                        <strong>The season is ready for its first result.</strong>
                        <span>Players appear here after the season begins.</span>
                    </div>
                ) : (
                    <>
                        {currentUserRank && (
                            <section className="current-user-section" aria-labelledby="your-standing-title">
                                <div className="leaderboard-section-heading">
                                    <h2 id="your-standing-title">Your standing</h2>
                                    {currentUserRank.rank == null && <span>Unranked until 1 settled game</span>}
                                </div>
                                {renderLeaderboardTable([currentUserRank], currentUserRankIndex, 'current-user-table')}
                            </section>
                        )}

                        <section className="full-leaderboard-container" aria-label={`${seasonName} leaderboard`}>
                            {renderLeaderboardTable(leaderboardData)}
                        </section>
                    </>
                )}
            </main>

            {user?.is_admin && (
                <footer className="leaderboard-footer">
                    <button type="button" onClick={handleShowAdmin} className="admin-button">Admin Panel</button>
                </footer>
            )}

            <PlayerProfileModal
                playerName={profilePlayerName}
                currentUsername={currentUsername}
                onClose={() => setProfilePlayerName(null)}
            />
        </div>
    );
};

export default LeaderboardView;
