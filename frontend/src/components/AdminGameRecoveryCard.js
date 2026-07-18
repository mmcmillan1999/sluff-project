import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    getAbandonedGameRecoveryPreview,
    refundAbandonedGames,
} from '../services/api';

const tokenAmount = cents => (Number(cents || 0) / 100).toFixed(2);

const friendlyTheme = value => {
    if (!value) return 'Unknown table';
    return String(value)
        .split('-')
        .filter(Boolean)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
};

const friendlyDate = value => {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Unknown time';
};

const inactiveMinutes = (lastActivityAt, generatedAt) => {
    const lastActivity = new Date(lastActivityAt).getTime();
    const generated = new Date(generatedAt).getTime();
    if (!Number.isFinite(lastActivity) || !Number.isFinite(generated) || generated < lastActivity) return null;
    return Math.floor((generated - lastActivity) / 60000);
};

const friendlyInactivity = (lastActivityAt, generatedAt) => {
    const minutes = inactiveMinutes(lastActivityAt, generatedAt);
    if (minutes === null) return '';
    return ` (${minutes} minute${minutes === 1 ? '' : 's'} ago)`;
};

const isNewRefund = item => (
    item?.status === 'abandoned_refunded' && item?.alreadyReconciled !== true
);

const recoveryStatusLabel = item => {
    if (item?.status === 'abandoned_refunded' && item?.alreadyReconciled === true) {
        return 'Already refunded';
    }
    const value = item?.status || item?.code || 'Status not reported';
    const words = String(value).replace(/[_-]+/g, ' ').toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
};

const candidateBuyIns = candidate => (
    Array.isArray(candidate?.sourceBuyIns) && candidate.sourceBuyIns.length > 0
        ? candidate.sourceBuyIns
        : (candidate?.fundedPlayers || [])
);

const AdminGameRecoveryCard = () => {
    const [preview, setPreview] = useState(null);
    const [result, setResult] = useState(null);
    const [selectedGameIds, setSelectedGameIds] = useState([]);
    const [reviewConfirmed, setReviewConfirmed] = useState(false);
    const [loading, setLoading] = useState(false);
    const [refunding, setRefunding] = useState(false);
    const [error, setError] = useState('');
    const [requiresRefresh, setRequiresRefresh] = useState(false);
    const selectAllRef = useRef(null);

    const candidates = Array.isArray(preview?.candidates) ? preview.candidates : [];
    const selectedSet = useMemo(() => new Set(selectedGameIds), [selectedGameIds]);
    const selectedCandidates = candidates.filter(candidate => selectedSet.has(candidate.gameId));
    const selectedRefundCents = selectedCandidates.reduce(
        (sum, candidate) => sum + Number(candidate.refundTotalCents || 0),
        0,
    );
    const selectedBuyInCount = selectedCandidates.reduce(
        (sum, candidate) => sum + candidateBuyIns(candidate).length,
        0,
    );
    const selectedUniquePlayerCount = new Set(
        selectedCandidates.flatMap(candidate => (
            candidateBuyIns(candidate).map(player => player.userId)
        )),
    ).size;
    const allSelected = candidates.length > 0 && selectedCandidates.length === candidates.length;
    const someSelected = selectedCandidates.length > 0 && !allSelected;
    const interactionLocked = loading || refunding || requiresRefresh;

    useEffect(() => {
        if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected;
    }, [someSelected]);

    const resultItems = Array.isArray(result?.results) ? result.results : [];
    const resultErrors = Array.isArray(result?.errors) ? result.errors : [];
    const refundedResultIds = new Set(
        resultItems.filter(isNewRefund).map(item => Number(item.gameId)),
    );
    const unresolvedByGameId = new Map();
    resultItems.filter(item => !isNewRefund(item)).forEach(item => {
        unresolvedByGameId.set(Number(item.gameId), item);
    });
    resultErrors.forEach(item => {
        unresolvedByGameId.set(Number(item.gameId), item);
    });
    if (result) {
        selectedGameIds.forEach(gameId => {
            if (!refundedResultIds.has(gameId) && !unresolvedByGameId.has(gameId)) {
                unresolvedByGameId.set(gameId, { gameId, status: 'status_not_reported' });
            }
        });
    }
    const unresolvedGames = [...unresolvedByGameId.values()];
    const requestedGameCount = Number.isSafeInteger(Number(result?.requestedGameCount))
        ? Number(result.requestedGameCount)
        : selectedGameIds.length;
    const refundedGameCount = Number(result?.refundedGameCount) || 0;
    const explicitRefundedSourceCount = result?.refundedSourceCount ?? result?.refundedBuyInCount;
    const refundedBuyInCount = Number(
        explicitRefundedSourceCount ?? result?.refundedPlayerCount,
    ) || 0;
    const explicitUniquePlayerCount = result?.refundedUniquePlayerCount
        ?? (explicitRefundedSourceCount == null ? null : result?.refundedPlayerCount);
    const refundedUniquePlayerCount = explicitUniquePlayerCount != null
        && Number.isSafeInteger(Number(explicitUniquePlayerCount))
        ? Number(explicitUniquePlayerCount)
        : null;
    const batchFullyRefunded = Boolean(
        result
        && requestedGameCount > 0
        && refundedGameCount === requestedGameCount
        && unresolvedGames.length === 0,
    );

    const loadPreview = async () => {
        if (loading || refunding) return;
        setLoading(true);
        setError('');
        setResult(null);
        setPreview(null);
        setSelectedGameIds([]);
        setReviewConfirmed(false);
        try {
            const nextPreview = await getAbandonedGameRecoveryPreview();
            const nextCandidates = Array.isArray(nextPreview?.candidates) ? nextPreview.candidates : [];
            setPreview(nextPreview);
            setSelectedGameIds(nextCandidates.map(candidate => candidate.gameId));
            setRequiresRefresh(false);
        } catch (loadError) {
            setError(loadError.message || 'Could not prepare the abandoned-game refund preview.');
        } finally {
            setLoading(false);
        }
    };

    const toggleGame = gameId => {
        if (interactionLocked) return;
        setReviewConfirmed(false);
        setSelectedGameIds(current => (
            current.includes(gameId)
                ? current.filter(id => id !== gameId)
                : [...current, gameId].sort((left, right) => left - right)
        ));
    };

    const toggleAll = () => {
        if (interactionLocked) return;
        setReviewConfirmed(false);
        setSelectedGameIds(allSelected ? [] : candidates.map(candidate => candidate.gameId));
    };

    const issueRefunds = async () => {
        if (!preview?.previewHash
            || selectedCandidates.length === 0
            || !reviewConfirmed
            || refunding
            || requiresRefresh) return;
        const confirmed = window.confirm(
            `REFUND ABANDONED GAMES?\n\n${selectedCandidates.length} game${selectedCandidates.length === 1 ? '' : 's'}, `
            + `${selectedBuyInCount} buy-in refund${selectedBuyInCount === 1 ? '' : 's'} `
            + `for ${selectedUniquePlayerCount} player${selectedUniquePlayerCount === 1 ? '' : 's'}, `
            + `${tokenAmount(selectedRefundCents)} total tokens.\n\n`
            + 'The server will revalidate every selected game, close each one that is still eligible, '
            + 'and issue auditable buy-in refunds. Continue?',
        );
        if (!confirmed) return;

        setRefunding(true);
        setError('');
        try {
            const recoveryResult = await refundAbandonedGames({
                gameIds: selectedCandidates.map(candidate => candidate.gameId),
                expectedPreviewHash: preview.previewHash,
            });
            setResult(recoveryResult);
            setReviewConfirmed(false);
        } catch (refundError) {
            const message = refundError.message || 'Could not refund the selected abandoned games.';
            if (refundError.recoveryResult) {
                setResult(refundError.recoveryResult);
                setError('');
            } else {
                setError(`${message}${/refresh/i.test(message) ? '' : ' Refresh the preview before trying again.'}`);
            }
            setReviewConfirmed(false);
            setRequiresRefresh(true);
        } finally {
            setRefunding(false);
        }
    };

    return (
        <section className="admin-action-card game-recovery-card" aria-labelledby="game-recovery-heading">
            <h3 id="game-recovery-heading">Abandoned Game Refunds</h3>
            <p className="game-recovery-intro">
                Find interrupted Season 2+ games whose ledgers contain funded buy-ins only. Live tables and Alpha Season 1 are always excluded.
            </p>

            <div className="game-recovery-filters" role="list" aria-label="Recovery filters">
                <span role="listitem">Season 2+</span>
                <span role="listitem">Inactive more than 10 minutes</span>
                <span role="listitem">Funded buy-ins only</span>
                <span role="listitem">No payout, refund, or adjustment rows</span>
            </div>

            {!preview && !result && (
                <button
                    type="button"
                    className="admin-button"
                    onClick={loadPreview}
                    disabled={loading}
                >
                    {loading ? 'Checking Games...' : 'Review Abandoned Games'}
                </button>
            )}

            {preview && !result && (
                <div className="game-recovery-preview">
                    {candidates.length === 0 ? (
                        <div className="game-recovery-empty" role="status">
                            No Season 2+ games currently match the refund rules.
                        </div>
                    ) : (
                        <>
                            <div className="game-recovery-summary" role="status">
                                <strong>{candidates.length} eligible game{candidates.length === 1 ? '' : 's'}</strong>
                                <span>{tokenAmount(preview.totalRefundCents)} total tokens</span>
                            </div>

                            <label className="game-recovery-select-all">
                                <input
                                    ref={selectAllRef}
                                    type="checkbox"
                                    checked={allSelected}
                                    onChange={toggleAll}
                                    disabled={interactionLocked}
                                    aria-checked={someSelected ? 'mixed' : allSelected}
                                />
                                <span>Select every eligible game</span>
                            </label>

                            <div className="game-recovery-list">
                                {candidates.map(candidate => (
                                    <article className="game-recovery-game" key={candidate.gameId}>
                                        <label className="game-recovery-game-heading">
                                            <input
                                                type="checkbox"
                                                checked={selectedSet.has(candidate.gameId)}
                                                onChange={() => toggleGame(candidate.gameId)}
                                                disabled={interactionLocked}
                                                aria-label={`Select game #${candidate.gameId}`}
                                            />
                                            <span>
                                                <strong>Game #{candidate.gameId}</strong>
                                                <small>{friendlyTheme(candidate.theme)} · Season {candidate.seasonNumber}</small>
                                            </span>
                                            <b>+{tokenAmount(candidate.refundTotalCents)}</b>
                                        </label>
                                        <div className="game-recovery-times">
                                            <span>
                                                Started: <time dateTime={candidate.startTime}>{friendlyDate(candidate.startTime)}</time>
                                            </span>
                                            <span>
                                                Last activity: <time dateTime={candidate.lastActivityAt}>{friendlyDate(candidate.lastActivityAt)}</time>
                                                {friendlyInactivity(candidate.lastActivityAt, preview.generatedAt)}
                                            </span>
                                        </div>
                                        <ul aria-label={`Refunds for game #${candidate.gameId}`}>
                                            {candidateBuyIns(candidate).map((player, index) => (
                                                <li key={`${candidate.gameId}-${player.sourceTransactionId ?? `${player.userId}-${index}`}`}>
                                                    <span>{player.username}</span>
                                                    <strong>+{tokenAmount(player.buyInCents)}</strong>
                                                </li>
                                            ))}
                                        </ul>
                                    </article>
                                ))}
                            </div>

                            <div className="game-recovery-selection" aria-live="polite">
                                Selected: {selectedCandidates.length} game{selectedCandidates.length === 1 ? '' : 's'}, {' '}
                                {selectedBuyInCount} buy-in refund{selectedBuyInCount === 1 ? '' : 's'} for {' '}
                                {selectedUniquePlayerCount} player{selectedUniquePlayerCount === 1 ? '' : 's'}, {' '}
                                {tokenAmount(selectedRefundCents)} tokens
                            </div>

                            <label className="game-recovery-prerequisite">
                                <input
                                    type="checkbox"
                                    checked={reviewConfirmed}
                                    onChange={event => setReviewConfirmed(event.target.checked)}
                                    disabled={selectedCandidates.length === 0 || interactionLocked}
                                />
                                <span>I have a fresh database backup and reviewed every selected buy-in refund.</span>
                            </label>
                        </>
                    )}

                    {preview.truncated && (
                        <p className="game-recovery-warning" role="alert">
                            More eligible games exist than this preview can show. Complete this reviewed batch, then refresh.
                        </p>
                    )}

                    <div className="game-recovery-actions">
                        <button
                            type="button"
                            className="admin-button back-button"
                            onClick={loadPreview}
                            disabled={loading || refunding}
                        >
                            {loading ? 'Refreshing...' : 'Refresh Preview'}
                        </button>
                        {candidates.length > 0 && (
                            <button
                                type="button"
                                className="admin-button danger-button"
                                onClick={issueRefunds}
                                disabled={!reviewConfirmed || selectedCandidates.length === 0 || interactionLocked}
                            >
                                {refunding ? 'Issuing Refunds...' : 'Refund Selected Games'}
                            </button>
                        )}
                    </div>
                </div>
            )}

            {result && (
                <div
                    className={batchFullyRefunded ? 'game-recovery-success' : 'game-recovery-result-warning'}
                    role={batchFullyRefunded ? 'status' : 'alert'}
                >
                    <strong>
                        {batchFullyRefunded
                            ? 'Abandoned-game recovery complete.'
                            : 'Recovery batch needs review.'}
                    </strong>
                    <span>
                        {refundedGameCount} of {requestedGameCount} selected game{requestedGameCount === 1 ? '' : 's'} refunded.
                    </span>
                    <span>{refundedBuyInCount} buy-in refund{refundedBuyInCount === 1 ? '' : 's'} issued.</span>
                    {refundedUniquePlayerCount !== null && (
                        <span>
                            {refundedUniquePlayerCount} unique player{refundedUniquePlayerCount === 1 ? '' : 's'} reimbursed.
                        </span>
                    )}
                    <span>{tokenAmount(result.refundTotalCents)} tokens returned.</span>
                    {unresolvedGames.length > 0 && (
                        <ul className="game-recovery-unresolved" aria-label="Games requiring review">
                            {unresolvedGames.map((item, index) => (
                                <li key={`${item.gameId ?? 'unknown'}-${index}`}>
                                    <strong>
                                        {Number.isSafeInteger(Number(item.gameId))
                                            ? `Game #${item.gameId}`
                                            : 'Unknown game'}
                                    </strong>
                                    <span>{recoveryStatusLabel(item)}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                    {!batchFullyRefunded && (
                        <span>
                            {result.message || 'Refresh the preview before issuing any further refunds.'}
                        </span>
                    )}
                    <button type="button" className="admin-button" onClick={loadPreview} disabled={loading}>
                        {loading ? 'Refreshing...' : 'Review Again'}
                    </button>
                </div>
            )}

            {error && <p className="game-recovery-error" role="alert">{error}</p>}
        </section>
    );
};

export default AdminGameRecoveryCard;
