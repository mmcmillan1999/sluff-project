import React, { useState } from 'react';
import {
    applyAlpha2WalletReset,
    getAlpha2WalletResetPreview,
} from '../services/api';

const firstDefined = (...values) => values.find(value => value !== undefined && value !== null);

const seasonName = season => (
    season?.name
    || season?.displayName
    || season?.slug
    || (season?.id == null ? 'Alpha Season 2' : `Season ${season.id}`)
);

const summaryNumber = (payload, ...keys) => {
    const summary = payload?.summary || {};
    return firstDefined(...keys.map(key => summary[key]), ...keys.map(key => payload?.[key]));
};

const accountCount = payload => Number(summaryNumber(
    payload,
    'accountCount',
    'totalAccounts',
    'accountsCount',
)) || (Array.isArray(payload?.accounts) ? payload.accounts.length : 0);

const changedAccountCount = payload => {
    const explicit = summaryNumber(
        payload,
        'changedAccountCount',
        'changedAccounts',
        'accountsChanged',
    );
    if (explicit !== undefined && explicit !== null && !Array.isArray(explicit)) {
        return Number(explicit) || 0;
    }
    if (!Array.isArray(payload?.accounts)) return 0;
    return payload.accounts.filter(account => {
        const before = Number(firstDefined(account?.beforeTokens, account?.currentTokens, account?.oldTokens));
        const after = Number(firstDefined(account?.afterTokens, account?.targetTokens, account?.newTokens));
        return Number.isFinite(before) && Number.isFinite(after) && before !== after;
    }).length;
};

const tokenAmount = value => {
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(2) : '—';
};

const signedTokenAmount = value => {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    if (number > 0) return `+${number.toFixed(2)}`;
    return number.toFixed(2);
};

const resetFigures = payload => ({
    oldSupply: summaryNumber(
        payload,
        'oldSupply',
        'currentSupply',
        'beforeSupply',
        'currentTotalTokens',
        'tokensBefore',
    ),
    newSupply: summaryNumber(
        payload,
        'newSupply',
        'projectedSupply',
        'afterSupply',
        'projectedTotalTokens',
        'tokensAfter',
    ),
    minted: summaryNumber(payload, 'minted', 'tokensMinted', 'mintedTokens'),
    burned: summaryNumber(payload, 'burned', 'tokensBurned', 'burnedTokens'),
    net: summaryNumber(payload, 'net', 'netChange', 'netTokenChange', 'tokenDelta'),
});

const ResetSummary = ({ payload }) => {
    const figures = resetFigures(payload);
    const totalAccounts = accountCount(payload);
    const changedAccounts = changedAccountCount(payload);

    return (
        <dl className="wallet-reset-summary" aria-label="Wallet reset totals">
            <div>
                <dt>Accounts</dt>
                <dd>{totalAccounts}</dd>
            </div>
            <div>
                <dt>Balances changing</dt>
                <dd>{changedAccounts}</dd>
            </div>
            <div>
                <dt>Current supply</dt>
                <dd>{tokenAmount(figures.oldSupply)}</dd>
            </div>
            <div>
                <dt>Supply after reset</dt>
                <dd>{tokenAmount(figures.newSupply)}</dd>
            </div>
            <div>
                <dt>Minted</dt>
                <dd className="is-minted">+{tokenAmount(figures.minted)}</dd>
            </div>
            <div>
                <dt>Burned</dt>
                <dd className="is-burned">-{tokenAmount(figures.burned)}</dd>
            </div>
            <div className="wallet-reset-net">
                <dt>Net supply change</dt>
                <dd>{signedTokenAmount(figures.net)}</dd>
            </div>
        </dl>
    );
};

const Alpha2WalletResetCard = () => {
    const [preview, setPreview] = useState(null);
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');
    const [previewLoading, setPreviewLoading] = useState(false);
    const [applying, setApplying] = useState(false);
    const [prerequisitesConfirmed, setPrerequisitesConfirmed] = useState(false);

    const loadPreview = async () => {
        if (previewLoading || applying || result) return;
        setPreviewLoading(true);
        setError('');
        setPrerequisitesConfirmed(false);
        try {
            const nextPreview = await getAlpha2WalletResetPreview();
            setPreview(nextPreview);
            if (nextPreview?.alreadyApplied) setResult(nextPreview);
        } catch (loadError) {
            setPreview(null);
            setError(loadError?.message || 'Could not prepare the Alpha Season 2 wallet reset preview.');
        } finally {
            setPreviewLoading(false);
        }
    };

    const applyReset = async () => {
        if (!preview || applying || result || preview.alreadyApplied) return;

        const confirmed = window.confirm(
            `RESET EVERY WALLET TO ${tokenAmount(preview.targetTokens || 8)} TOKENS?\n\n`
            + `This one-time ${seasonName(preview.season)} operation will change ${changedAccountCount(preview)} of ${accountCount(preview)} account balances. `
            + 'Season standings, career records, and archived seasons will not be changed.\n\n'
            + 'The wallet changes cannot be automatically undone. Continue?',
        );
        if (!confirmed) return;

        setApplying(true);
        setError('');
        try {
            const resetResult = await applyAlpha2WalletReset({
                expectedPreviewHash: preview.previewHash,
                expectedSeasonId: preview.season?.id,
            });
            setResult(resetResult || { alreadyApplied: true });
            setPrerequisitesConfirmed(false);
        } catch (applyError) {
            setError(applyError?.message || 'Could not apply the Alpha Season 2 wallet reset.');
            setPrerequisitesConfirmed(false);
        } finally {
            setApplying(false);
        }
    };

    const activeGameCount = Number(preview?.currentSeasonGameCount) || 0;
    const complete = Boolean(result || preview?.alreadyApplied);
    const completedPayload = result || preview;
    const canApply = Boolean(
        preview?.canApply
        && preview?.previewHash
        && preview?.season?.id != null
        && activeGameCount === 0
        && prerequisitesConfirmed
        && !complete
        && !applying,
    );

    return (
        <section className="admin-action-card wallet-reset-card" aria-labelledby="wallet-reset-heading">
            <h3 id="wallet-reset-heading">Alpha Season 2 Wallet Reset</h3>
            <p className="wallet-reset-intro">
                One-time season-opening operation: set every account wallet to 8 tokens. This changes wallet balances only; season standings, career records, and archived seasons stay intact.
            </p>

            {!preview && !complete && (
                <button
                    type="button"
                    onClick={loadPreview}
                    className="admin-button"
                    disabled={previewLoading}
                >
                    {previewLoading ? 'Preparing Preview…' : 'Review Wallet Reset'}
                </button>
            )}

            {preview && !complete && (
                <div className="wallet-reset-preview" aria-live="polite">
                    <p className="wallet-reset-target">
                        <strong>{seasonName(preview.season)}</strong>
                        <span>Every wallet → {tokenAmount(preview.targetTokens || 8)} tokens</span>
                    </p>
                    <ResetSummary payload={preview} />

                    {activeGameCount > 0 ? (
                        <p className="wallet-reset-blocker" role="alert">
                            Reset blocked: {activeGameCount} game{activeGameCount === 1 ? ' has' : 's have'} already started in {seasonName(preview.season)}. This baseline can only be applied before the season's first game.
                        </p>
                    ) : preview.canApply ? (
                        <>
                            <p className="wallet-reset-ready">No current-season games have started. The reviewed snapshot is ready.</p>
                            <label className="wallet-reset-prerequisite">
                                <input
                                    type="checkbox"
                                    checked={prerequisitesConfirmed}
                                    onChange={event => setPrerequisitesConfirmed(event.target.checked)}
                                />
                                <span>I have completed a fresh database backup and reviewed the token-accounting audit.</span>
                            </label>
                        </>
                    ) : (
                        <p className="wallet-reset-blocker" role="alert">
                            This reset cannot be applied to the current season state. Refresh the preview for the latest status.
                        </p>
                    )}

                    <div className="wallet-reset-actions">
                        <button
                            type="button"
                            onClick={loadPreview}
                            className="admin-button back-button"
                            disabled={previewLoading || applying}
                        >
                            {previewLoading ? 'Refreshing…' : 'Refresh Preview'}
                        </button>
                        <button
                            type="button"
                            onClick={applyReset}
                            className="admin-button danger-button"
                            disabled={!canApply || previewLoading}
                        >
                            {applying ? 'Resetting Wallets…' : 'Reset Every Wallet to 8'}
                        </button>
                    </div>
                </div>
            )}

            {complete && (
                <div className="wallet-reset-success" role="status">
                    <strong>Alpha Season 2 wallet reset complete.</strong>
                    <span>Every account is now covered by the one-time 8-token baseline operation.</span>
                    <ResetSummary payload={completedPayload} />
                    <button type="button" className="admin-button" disabled>Wallet Reset Applied</button>
                </div>
            )}

            {error && (
                <p className="wallet-reset-error" role="alert">
                    {error} Refresh the preview before trying again.
                </p>
            )}
        </section>
    );
};

export default Alpha2WalletResetCard;
