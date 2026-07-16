import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getPlayerProfile } from '../services/api';
import { useModalFocus } from '../hooks/useModalFocus';
import './PlayerProfileModal.css';

const safeCount = value => {
    const count = Number(value);
    return Number.isFinite(count) && count >= 0 ? Math.trunc(count) : 0;
};

const formatRate = value => {
    if (value === null || value === undefined || value === '') return '—';
    const rate = Number(value);
    return Number.isFinite(rate) ? `${rate.toFixed(1)}%` : '—';
};

const Stat = ({ label, value, accent = false }) => (
    <div className={`player-profile-stat${accent ? ' accent' : ''}`}>
        <strong>{value}</strong>
        <span>{label}</span>
    </div>
);

const LoadingState = () => (
    <div className="player-profile-loading" role="status" aria-live="polite">
        <div className="player-profile-loading-mark" aria-hidden="true" />
        <p>Shuffling the record book…</p>
    </div>
);

const MatchupRecord = ({
    matchup,
    playerName,
    period,
    seasonName = '',
    isCurrentSeason = false,
}) => {
    const gamesPlayed = safeCount(matchup?.gamesPlayed);
    const emptyTitle = isCurrentSeason ? 'No shared games this season' : 'No shared games yet';
    const emptyDescription = isCurrentSeason
        ? 'Your current-season record will begin after you finish a game together.'
        : 'Your head-to-head record starts the first time you finish a game together.';
    const rateLabel = isCurrentSeason
        ? `Your current-season win rate against ${playerName}`
        : `Your win rate against ${playerName}`;
    const gamesLabel = `${gamesPlayed} game${gamesPlayed === 1 ? '' : 's'} together`;

    return (
        <section
            className={`player-profile-matchup-period${isCurrentSeason ? ' current-season' : ' lifetime'}`}
            aria-label={`${period} record against ${playerName}`}
        >
            <div className="player-profile-period-heading">
                <strong>{period}</strong>
                <span>{seasonName ? `${seasonName} · ${gamesLabel}` : gamesLabel}</span>
            </div>

            {gamesPlayed === 0 ? (
                <div className="player-profile-empty-matchup">
                    <strong>{emptyTitle}</strong>
                    <p>{emptyDescription}</p>
                </div>
            ) : (
                <>
                    <div className="player-profile-rate-callout">
                        <strong>{formatRate(matchup?.winRate)}</strong>
                        <span>{rateLabel}</span>
                    </div>
                    <div className="player-profile-stats matchup-stats">
                        <Stat label="Your wins" value={safeCount(matchup?.wins)} />
                        <Stat label="Your losses" value={safeCount(matchup?.losses)} />
                        <Stat label="Ties" value={safeCount(matchup?.ties)} />
                    </div>
                </>
            )}
        </section>
    );
};

const PlayerProfileModal = ({ playerName, currentUsername, onClose }) => {
    const show = Boolean(playerName);
    const [profile, setProfile] = useState(null);
    const [error, setError] = useState('');
    const [requestVersion, setRequestVersion] = useState(0);
    const dialogRef = useModalFocus(show, '.player-profile-close');

    const retry = useCallback(() => {
        setRequestVersion(version => version + 1);
    }, []);

    useEffect(() => {
        if (!show) return undefined;

        let active = true;
        setProfile(null);
        setError('');

        getPlayerProfile(playerName)
            .then(data => {
                if (active) setProfile(data);
            })
            .catch(requestError => {
                if (active) {
                    setError(requestError?.message || 'Could not load this player profile.');
                }
            });

        return () => {
            active = false;
        };
    }, [playerName, requestVersion, show]);

    useEffect(() => {
        if (!show) return undefined;
        const closeOnEscape = event => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', closeOnEscape);
        return () => document.removeEventListener('keydown', closeOnEscape);
    }, [onClose, show]);

    if (!show) return null;

    const player = profile?.player;
    const matchup = profile?.headToHead;
    const currentSeasonMatchup = profile?.currentSeasonHeadToHead ?? matchup?.currentSeason;
    const isSelf = matchup?.isSelf === true
        || currentSeasonMatchup?.isSelf === true
        || (player?.username && player.username === currentUsername);
    const careerGames = safeCount(player?.totalGames);
    const currentSeasonName = typeof currentSeasonMatchup?.season?.displayName === 'string'
        ? currentSeasonMatchup.season.displayName.trim()
        : '';
    const initial = (player?.username || playerName).trim().charAt(0).toUpperCase() || 'S';

    return createPortal(
        <div
            className="player-profile-overlay"
            onMouseDown={event => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <section
                className="player-profile-dialog"
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-label={`Player profile for ${playerName}`}
                tabIndex="-1"
            >
                <button
                    type="button"
                    className="player-profile-close"
                    onClick={onClose}
                    aria-label="Close player profile"
                >
                    ×
                </button>

                {!player && !error && <LoadingState />}

                {error && (
                    <div className="player-profile-error" role="alert">
                        <div className="player-profile-error-symbol" aria-hidden="true">!</div>
                        <h2 id="player-profile-title">Record book unavailable</h2>
                        <p>{error}</p>
                        <button type="button" onClick={retry}>Try again</button>
                    </div>
                )}

                {player && (
                    <>
                        <header className="player-profile-header">
                            <div className="player-profile-monogram" aria-hidden="true">{initial}</div>
                            <div>
                                <p className="player-profile-kicker">
                                    {isSelf ? 'Your Sluff profile' : 'Player profile'}
                                </p>
                                <h2 id="player-profile-title">{player.username}</h2>
                            </div>
                        </header>

                        <div className="player-profile-career" aria-label="Career record">
                            <div className="player-profile-section-heading">
                                <span>Career record</span>
                                {careerGames === 0 && <em>Fresh to the table</em>}
                            </div>
                            <div className="player-profile-stats career-stats">
                                <Stat label="Games" value={careerGames} />
                                <Stat label="Wins" value={safeCount(player.wins)} />
                                <Stat label="Losses" value={safeCount(player.losses)} />
                                <Stat label="Washes" value={safeCount(player.washes)} />
                                <Stat label="Win rate" value={formatRate(player.winRate)} accent />
                            </div>
                        </div>

                        {isSelf ? (
                            <div className="player-profile-self-note">
                                <span aria-hidden="true">♠</span>
                                <p>This is your public table record. Keep dealing to build your legacy.</p>
                            </div>
                        ) : (
                            <div className="player-profile-matchup" aria-label={`Your record against ${player.username}`}>
                                <div className="player-profile-section-heading">
                                    <span>Your matchup</span>
                                    <em>{currentSeasonMatchup ? 'Current season and lifetime' : 'Lifetime'}</em>
                                </div>

                                {currentSeasonMatchup && (
                                    <MatchupRecord
                                        matchup={currentSeasonMatchup}
                                        playerName={player.username}
                                        period="Current season"
                                        seasonName={currentSeasonName}
                                        isCurrentSeason
                                    />
                                )}
                                <MatchupRecord
                                    matchup={matchup}
                                    playerName={player.username}
                                    period="Lifetime"
                                />
                            </div>
                        )}
                    </>
                )}
            </section>
        </div>,
        document.body,
    );
};

export default PlayerProfileModal;
