import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getTokenLedger } from '../services/api';
import './TokenLedgerView.css';

const PAGE_SIZE = 25;

const ACTIVITY_LABELS = {
    buy_in: 'Game buy-in',
    win_payout: 'Game payout',
    wash_payout: 'Buy-in returned',
    forfeit_loss: 'Forfeit loss',
    forfeit_payout: 'Forfeit payout',
    free_token_mercy: 'Mercy token',
    abandoned_refund: 'Abandoned-game refund',
    admin_adjustment: 'Account adjustment',
};

const FILTER_OPTIONS = [
    { value: 'all', label: 'All activity' },
    { value: 'game', label: 'Buy-ins & payouts' },
    { value: 'mercy', label: 'Mercy tokens' },
    { value: 'refund', label: 'Refunds' },
    { value: 'adjustment', label: 'Adjustments' },
];

const toSafeCents = value => {
    const cents = Number(value);
    return Number.isSafeInteger(cents) ? cents : null;
};

const decimalToCents = value => {
    const amount = Number(value);
    return Number.isFinite(amount) ? Math.round(amount * 100) : null;
};

const centsFrom = (object, camelKey, snakeKey, decimalKey = null) => {
    const centsValue = object?.[camelKey] ?? object?.[snakeKey];
    if (centsValue !== null && centsValue !== undefined) return toSafeCents(centsValue);
    return decimalKey ? decimalToCents(object?.[decimalKey]) : null;
};

export const formatTokenCents = (value, { signed = false, suffix = false } = {}) => {
    const cents = toSafeCents(value);
    if (cents === null) return '—';
    const sign = signed && cents > 0 ? '+' : cents < 0 ? '-' : '';
    const amount = `${sign}${(Math.abs(cents) / 100).toFixed(2)}`;
    return suffix ? `${amount} tokens` : amount;
};

export const tokenActivityLabel = type => (
    ACTIVITY_LABELS[String(type || '').trim().toLowerCase()] || 'Token activity'
);

const EXPECTED_DEBIT_TYPES = new Set(['buy_in', 'forfeit_loss']);
const EXPECTED_CREDIT_TYPES = new Set([
    'win_payout',
    'wash_payout',
    'forfeit_payout',
    'abandoned_refund',
]);
const KNOWN_TYPES = new Set([...Object.keys(ACTIVITY_LABELS)]);

export const isUnexpectedLedgerEntry = entry => {
    const type = String(entry?.type || '').trim().toLowerCase();
    const cents = toSafeCents(entry?.amountCents);
    if (!KNOWN_TYPES.has(type) || cents === null || cents === 0) return true;
    if (EXPECTED_DEBIT_TYPES.has(type)) return cents >= 0;
    if (EXPECTED_CREDIT_TYPES.has(type)) return cents <= 0;
    if (type === 'free_token_mercy') return cents !== 100;
    return false;
};

export const normalizeTokenLedgerEntry = entry => ({
    id: entry?.id ?? entry?.transactionId ?? entry?.transaction_id ?? null,
    occurredAt: entry?.occurredAt ?? entry?.occurred_at ?? entry?.transactionTime
        ?? entry?.transaction_time ?? null,
    type: entry?.type ?? entry?.transactionType ?? entry?.transaction_type ?? '',
    amountCents: centsFrom(entry, 'amountCents', 'amount_cents', 'amount'),
    balanceAfterCents: centsFrom(
        entry,
        'balanceAfterCents',
        'balance_after_cents',
        entry?.balanceAfter !== undefined ? 'balanceAfter' : 'balance_after'
    ),
    gameNetCents: centsFrom(
        entry,
        'gameNetCents',
        'game_net_cents',
        entry?.gameNet !== undefined ? 'gameNet' : 'game_net'
    ),
    description: typeof entry?.description === 'string' ? entry.description : '',
    gameId: entry?.gameId ?? entry?.game_id ?? null,
    gameTheme: entry?.gameTheme ?? entry?.game_theme ?? null,
    gameOutcome: entry?.gameOutcome ?? entry?.game_outcome ?? null,
});

const normalizeLedgerResponse = data => {
    const sourceEntries = Array.isArray(data?.entries)
        ? data.entries
        : Array.isArray(data?.transactions) ? data.transactions : [];
    const nextCursor = data?.nextCursor ?? data?.next_cursor ?? null;
    return {
        currentBalanceCents: centsFrom(
            data,
            'currentBalanceCents',
            'current_balance_cents',
            data?.currentBalance !== undefined ? 'currentBalance' : 'current_balance'
        ),
        entries: sourceEntries.map(normalizeTokenLedgerEntry),
        nextCursor,
        hasMore: typeof data?.hasMore === 'boolean'
            ? data.hasMore
            : typeof data?.has_more === 'boolean' ? data.has_more : Boolean(nextCursor),
    };
};

const formatActivityTime = value => {
    if (!value) return 'Time unavailable';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Time unavailable';
    return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    }).format(date);
};

const entryKey = (entry, index) => (
    entry.id !== null && entry.id !== undefined
        ? `transaction-${entry.id}`
        : `${entry.occurredAt || 'unknown'}-${entry.type || 'activity'}-${index}`
);

const mergeUniqueEntries = (currentEntries, nextEntries) => {
    const ids = new Set(
        currentEntries
            .map(entry => entry.id)
            .filter(id => id !== null && id !== undefined)
            .map(String)
    );
    return [
        ...currentEntries,
        ...nextEntries.filter(entry => {
            if (entry.id === null || entry.id === undefined) return true;
            const id = String(entry.id);
            if (ids.has(id)) return false;
            ids.add(id);
            return true;
        }),
    ];
};

const TokenLedgerView = ({ onReturnToLobby }) => {
    const [entries, setEntries] = useState([]);
    const [currentBalanceCents, setCurrentBalanceCents] = useState(null);
    const [category, setCategory] = useState('all');
    const [nextCursor, setNextCursor] = useState(null);
    const [hasMore, setHasMore] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [error, setError] = useState('');
    const requestSequenceRef = useRef(0);

    const loadLedger = useCallback(async ({ append = false, cursor = null } = {}) => {
        const requestSequence = ++requestSequenceRef.current;
        if (append) setIsLoadingMore(true);
        else setIsLoading(true);
        setError('');

        try {
            const response = await getTokenLedger({
                limit: PAGE_SIZE,
                cursor: append ? cursor : null,
                category,
            });
            if (requestSequence !== requestSequenceRef.current) return;

            const normalized = normalizeLedgerResponse(response);
            setCurrentBalanceCents(normalized.currentBalanceCents);
            setEntries(current => append
                ? mergeUniqueEntries(current, normalized.entries)
                : normalized.entries);
            setNextCursor(normalized.nextCursor);
            setHasMore(normalized.hasMore);
        } catch (err) {
            if (requestSequence !== requestSequenceRef.current) return;
            setError(err?.message || 'Could not load token activity.');
        } finally {
            if (requestSequence === requestSequenceRef.current) {
                setIsLoading(false);
                setIsLoadingMore(false);
            }
        }
    }, [category]);

    useEffect(() => {
        setEntries([]);
        setNextCursor(null);
        setHasMore(false);
        loadLedger();
    }, [loadLedger]);

    const refreshLedger = () => {
        setEntries([]);
        setNextCursor(null);
        setHasMore(false);
        loadLedger();
    };

    return (
        <div className="token-ledger-view">
            <header className="token-ledger-header">
                <button type="button" className="token-ledger-back" onClick={onReturnToLobby}>
                    <span aria-hidden="true">‹</span>
                    Lobby
                </button>
                <div className="token-ledger-title-group">
                    <img src="/Sluff_Token.png" alt="" aria-hidden="true" />
                    <h1>Token Ledger</h1>
                </div>
                <button
                    type="button"
                    className="token-ledger-refresh"
                    onClick={refreshLedger}
                    disabled={isLoading || isLoadingMore}
                    aria-label="Refresh token ledger"
                    title="Refresh token ledger"
                >
                    <span aria-hidden="true">↻</span>
                </button>
            </header>

            <main className="token-ledger-main" aria-busy={isLoading || isLoadingMore}>
                <section className="token-ledger-balance" aria-labelledby="token-ledger-balance-title">
                    <span id="token-ledger-balance-title">Current balance</span>
                    <strong>
                        <img src="/Sluff_Token.png" alt="Tokens" />
                        {formatTokenCents(currentBalanceCents)}
                    </strong>
                    <p>Use the filters below to trace every addition and deduction.</p>
                </section>

                <div className="token-ledger-toolbar">
                    <label htmlFor="token-ledger-filter">Show</label>
                    <select
                        id="token-ledger-filter"
                        value={category}
                        onChange={event => setCategory(event.target.value)}
                        disabled={isLoadingMore}
                    >
                        {FILTER_OPTIONS.map(option => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                </div>

                <div className="token-ledger-status" aria-live="polite" aria-atomic="true">
                    {isLoading && entries.length === 0 && <p>Loading token activity…</p>}
                    {error && (
                        <div className="token-ledger-error" role="alert">
                            <p>{error}</p>
                            <button type="button" onClick={() => loadLedger({ append: entries.length > 0, cursor: nextCursor })}>
                                Try again
                            </button>
                        </div>
                    )}
                </div>

                {!isLoading && !error && entries.length === 0 && (
                    <div className="token-ledger-empty">
                        <img src="/Sluff_Token.png" alt="" aria-hidden="true" />
                        <h2>No token activity yet</h2>
                        <p>Your token changes will appear here.</p>
                    </div>
                )}

                {entries.length > 0 && (
                    <section className="token-ledger-activity" aria-labelledby="token-ledger-activity-title">
                        <h2 id="token-ledger-activity-title">Activity</h2>
                        <div className="token-ledger-list">
                            {entries.map((entry, index) => {
                                const amountClass = entry.amountCents > 0
                                    ? 'is-credit'
                                    : entry.amountCents < 0 ? 'is-debit' : 'is-neutral';
                                const isUnexpected = isUnexpectedLedgerEntry(entry);
                                return (
                                    <article
                                        className={`token-ledger-entry${isUnexpected ? ' is-unexpected' : ''}`}
                                        key={entryKey(entry, index)}
                                    >
                                        <div className="token-ledger-entry-primary">
                                            <h3>{isUnexpected ? 'Legacy / unexpected entry' : tokenActivityLabel(entry.type)}</h3>
                                            <span
                                                className={`token-ledger-entry-amount ${amountClass}`}
                                                aria-label={`Change ${formatTokenCents(entry.amountCents, { signed: true, suffix: true })}`}
                                            >
                                                {formatTokenCents(entry.amountCents, { signed: true })}
                                            </span>
                                        </div>

                                        <div className="token-ledger-entry-meta">
                                            <time dateTime={entry.occurredAt || undefined}>
                                                {formatActivityTime(entry.occurredAt)}
                                            </time>
                                            <span>
                                                Balance after <strong>{formatTokenCents(entry.balanceAfterCents)}</strong>
                                            </span>
                                        </div>

                                        {isUnexpected && (
                                            <p className="token-ledger-entry-warning">
                                                Its saved type and amount do not match today&apos;s accounting rules.
                                                The raw amount is still included in your balance.
                                            </p>
                                        )}

                                        {entry.description && (
                                            <p className="token-ledger-entry-description">{entry.description}</p>
                                        )}

                                        {(entry.gameId !== null || entry.gameNetCents !== null) && (
                                            <div className="token-ledger-entry-game">
                                                {entry.gameId !== null && (
                                                    <span>
                                                        Game #{entry.gameId}
                                                        {entry.gameTheme ? ` · ${entry.gameTheme}` : ''}
                                                        {entry.gameOutcome ? ` · ${entry.gameOutcome}` : ''}
                                                    </span>
                                                )}
                                                {entry.gameNetCents !== null && (
                                                    <span>Game net {formatTokenCents(entry.gameNetCents, { signed: true })}</span>
                                                )}
                                            </div>
                                        )}

                                        {(entry.id !== null || entry.type) && (
                                            <details className="token-ledger-entry-details">
                                                <summary>Details</summary>
                                                <dl>
                                                    {entry.id !== null && (
                                                        <>
                                                            <dt>Transaction</dt>
                                                            <dd>#{entry.id}</dd>
                                                        </>
                                                    )}
                                                    {entry.type && (
                                                        <>
                                                            <dt>Type</dt>
                                                            <dd>{entry.type}</dd>
                                                        </>
                                                    )}
                                                </dl>
                                            </details>
                                        )}
                                    </article>
                                );
                            })}
                        </div>
                    </section>
                )}

                {hasMore && entries.length > 0 && !error && (
                    <button
                        type="button"
                        className="token-ledger-load-more"
                        onClick={() => loadLedger({ append: true, cursor: nextCursor })}
                        disabled={isLoadingMore}
                    >
                        {isLoadingMore ? 'Loading older activity…' : 'Load older activity'}
                    </button>
                )}
            </main>
        </div>
    );
};

export default TokenLedgerView;
