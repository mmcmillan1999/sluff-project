// frontend/src/components/AdminView.js
import React, { useState } from 'react';
import AdminGameRecoveryCard from './AdminGameRecoveryCard';
import BotInsuranceStats from './BotInsuranceStats';
import Alpha2WalletResetCard from './Alpha2WalletResetCard';
import { finalizeSeasonRollover, getSeasonRolloverPreview } from '../services/api';

const seasonName = season => {
    if (!season) return '';
    return season.name
        || season.displayName
        || season.slug
        || (season.id == null ? 'Season' : `Season ${season.id}`);
};

const podiumPlayers = preview => {
    const source = Array.isArray(preview?.podium) && preview.podium.length
        ? preview.podium
        : preview?.standings;

    if (!Array.isArray(source)) return [];
    return source
        .filter(player => Number(player.rank ?? player.position) >= 1 && Number(player.rank ?? player.position) <= 3)
        .sort((left, right) => Number(left.rank ?? left.position) - Number(right.rank ?? right.position))
        .slice(0, 3);
};

const playerName = player => player?.displayName || player?.username || 'Unknown player';

const AdminView = ({ onReturnToLobby, handleHardReset }) => {
    const [showBotStats, setShowBotStats] = useState(false);
    const [rolloverPreview, setRolloverPreview] = useState(null);
    const [rolloverResult, setRolloverResult] = useState(null);
    const [rolloverError, setRolloverError] = useState('');
    const [previewLoading, setPreviewLoading] = useState(false);
    const [finalizing, setFinalizing] = useState(false);
    const [prerequisitesConfirmed, setPrerequisitesConfirmed] = useState(false);

    const loadRolloverPreview = async () => {
        setPreviewLoading(true);
        setRolloverError('');
        setRolloverResult(null);
        setPrerequisitesConfirmed(false);
        try {
            setRolloverPreview(await getSeasonRolloverPreview());
        } catch (error) {
            setRolloverPreview(null);
            setRolloverError(error.message || 'Could not prepare the season rollover preview.');
        } finally {
            setPreviewLoading(false);
        }
    };

    const finalizeRollover = async () => {
        if (!rolloverPreview || finalizing || rolloverResult) return;

        const currentName = seasonName(rolloverPreview.season) || 'the current season';
        const nextName = seasonName(rolloverPreview.nextSeason) || 'the next season';
        const confirmed = window.confirm(
            `FINALIZE SEASON ROLLOVER?\n\n${currentName} will be permanently archived and ${nextName} will become active. Seasonal standings will reset. Wallet balances and career stats will be preserved.\n\nThis archive cannot be edited after finalization. Continue?`,
        );
        if (!confirmed) return;

        setFinalizing(true);
        setRolloverError('');
        try {
            const result = await finalizeSeasonRollover({
                expectedPreviewHash: rolloverPreview.previewHash,
                expectedSeasonId: rolloverPreview.season?.id,
            });
            setRolloverResult(result);
        } catch (error) {
            setRolloverError(error.message || 'Could not finalize the season rollover.');
        } finally {
            setFinalizing(false);
        }
    };

    const activeGameCount = Number(rolloverPreview?.inProgressGames) || 0;
    const previewPodium = podiumPlayers(rolloverPreview);
    const archivedPlayerCount = Number(
        rolloverPreview?.playerCount
        ?? rolloverPreview?.standings?.length
        ?? rolloverPreview?.season?.playerCount
        ?? 0,
    );
    const canFinalize = Boolean(
        rolloverPreview?.canFinalize
        && rolloverPreview?.previewHash
        && rolloverPreview?.season?.id != null
        && activeGameCount === 0
        && prerequisitesConfirmed
        && !rolloverResult,
    );
    const finalizedName = seasonName(rolloverResult?.finalizedSeason || rolloverResult?.season);
    const activeName = seasonName(rolloverResult?.activeSeason || rolloverResult?.nextSeason);

    return (
        <div className="admin-view">
            <header className="admin-header">
                <h2>Admin Control Panel</h2>
                <button onClick={onReturnToLobby} className="admin-button back-button">Back to Lobby</button>
            </header>
            <div className="admin-actions-container">
                <AdminGameRecoveryCard />
                <Alpha2WalletResetCard />
                <section className="admin-action-card season-rollover-card" aria-labelledby="season-rollover-heading">
                    <h3 id="season-rollover-heading">Season Rollover</h3>
                    <p className="season-rollover-intro">
                        Permanently archive the current standings and open the next season. Player wallets and career stats are preserved; only seasonal standings start fresh.
                    </p>

                    {!rolloverPreview && !rolloverResult && (
                        <button
                            type="button"
                            onClick={loadRolloverPreview}
                            className="admin-button"
                            disabled={previewLoading}
                        >
                            {previewLoading ? 'Preparing Preview...' : 'Review Season Rollover'}
                        </button>
                    )}

                    {rolloverPreview && !rolloverResult && (
                        <div className="season-rollover-preview" aria-live="polite">
                            <div className="season-rollover-route">
                                <strong>{seasonName(rolloverPreview.season)}</strong>
                                <span aria-hidden="true">-&gt;</span>
                                <strong>{seasonName(rolloverPreview.nextSeason)}</strong>
                            </div>
                            <p><strong>{archivedPlayerCount}</strong> player{archivedPlayerCount === 1 ? '' : 's'} will be preserved in the archive.</p>
                            {previewPodium.length > 0 && (
                                <ol className="season-rollover-podium" aria-label="Archived podium preview">
                                    {previewPodium.map(player => (
                                        <li key={`${player.rank ?? player.position}-${playerName(player)}`}>
                                            <span>{player.rank ?? player.position}.</span> {playerName(player)}
                                        </li>
                                    ))}
                                </ol>
                            )}
                            {activeGameCount > 0 ? (
                                <p className="season-rollover-blocker" role="alert">
                                    Rollover blocked: {activeGameCount} game{activeGameCount === 1 ? ' is' : 's are'} still in progress.
                                </p>
                            ) : (
                                <>
                                    <p className="season-rollover-ready">No games are in progress. This preview is ready for final review.</p>
                                    <label className="season-rollover-prerequisite">
                                        <input
                                            type="checkbox"
                                            checked={prerequisitesConfirmed}
                                            onChange={event => setPrerequisitesConfirmed(event.target.checked)}
                                        />
                                        <span>I have completed a fresh database backup and reviewed the token-accounting audit.</span>
                                    </label>
                                </>
                            )}
                            <div className="season-rollover-actions">
                                <button
                                    type="button"
                                    onClick={loadRolloverPreview}
                                    className="admin-button back-button"
                                    disabled={previewLoading || finalizing}
                                >
                                    {previewLoading ? 'Refreshing...' : 'Refresh Preview'}
                                </button>
                                <button
                                    type="button"
                                    onClick={finalizeRollover}
                                    className="admin-button danger-button"
                                    disabled={!canFinalize || previewLoading || finalizing}
                                >
                                    {finalizing ? 'Finalizing...' : `Finalize ${seasonName(rolloverPreview.season)}`}
                                </button>
                            </div>
                        </div>
                    )}

                    {rolloverResult && (
                        <div className="season-rollover-success" role="status">
                            <strong>Season rollover complete.</strong>
                            <span>{finalizedName || 'The previous season'} is permanently archived.</span>
                            <span>{activeName || 'The next season'} is now active.</span>
                            <button type="button" className="admin-button" disabled>Rollover Finalized</button>
                        </div>
                    )}

                    {rolloverError && <p className="season-rollover-error" role="alert">{rolloverError}</p>}
                </section>
                <div className="admin-action-card">
                    <h3>Hard Server Reset</h3>
                    <p>Forcefully reset all game tables, boot all players, and clear all in-progress games. Use with extreme caution.</p>
                    <button onClick={handleHardReset} className="admin-button danger-button">
                        Hard Reset Server
                    </button>
                </div>
                <div className="admin-action-card">
                    <h3>Bot Insurance Stats</h3>
                    <p>View detailed statistics on how bots are performing with insurance decisions and their learning progress.</p>
                    <button onClick={() => setShowBotStats(true)} className="admin-button">
                        View Bot Stats
                    </button>
                </div>
            </div>
            
            {showBotStats && (
                <BotInsuranceStats onClose={() => setShowBotStats(false)} />
            )}
        </div>
    );
};

export default AdminView;
