# Alpha Season 1 archive and Alpha Season 2 rollover

## Status

Alpha Season 1 was finalized and Alpha Season 2 was activated in production on July 16, 2026 through the guarded operator flow. The immutable Alpha Season 1 snapshot is now the historical record. Deploying season code must never finalize a season automatically.

The separate one-time Alpha Season 2 opening-wallet baseline is documented in `OPERATIONS.md`; it preserves this archive and is not part of the season rollover itself.

## Approved season rules

### Alpha Season 1

- Alpha Season 1 covers all recorded Sluff history through the official close.
- Its final standings preserve the exact live leaderboard at the close: every current account is ordered by wallet token balance descending, then username ascending as the deterministic tie-breaker.
- There is no retroactive minimum-games filter. Applying one would change the leaderboard being memorialized.
- Persistent bot accounts compete under the same rules as every other account. The public leaderboard and archive must not label or otherwise distinguish them as bots. An internal snapshot may retain account classification only for private audit purposes.
- The snapshot records each final position, displayed username, wins, losses, washes, games played, and exact wallet token balance.

### Alpha Season 2

- The rollover itself carried wallet balances forward unchanged. A separately authorized, one-time Alpha Season 2 opening baseline then sets every current account to 8 tokens with append-only administrative ledger adjustments before the season's first game; those balances remain the balances used to enter tables.
- Existing wins, losses, and washes remain lifetime career totals. They are not erased or repurposed as seasonal fields.
- Alpha Season 2 starts with separate per-season wins, losses, and washes at zero for every account.
- Alpha Season 2 rank is based on net game-linked token movement from Alpha Season 2 games, ordered descending, then username ascending. Starting grants, mercy tokens, and unrelated administrative adjustments do not improve season rank.
- An account needs at least one settled Alpha Season 2 game to receive a numbered rank. Accounts with no settled games may remain visible as unranked.
- The live leaderboard must identify the ranking value as **Season +/-** and show the carried wallet balance separately as **Wallet**. A lifetime wallet balance must not be presented as though it were the Alpha Season 2 ranking value.

This is a logical competitive reset, not a destructive data reset. The separate wallet baseline adds auditable deltas rather than rewriting history. Together they keep player-profile career records accurate, preserve the accountable token ledger, and avoid making established accounts appear inactive to maintenance tools that use lifetime game counts.

## Permanent legacy page

The Season Archive must be backed by immutable database snapshots rather than hardcoded names or the changing live leaderboard. Each finalized season page should contain:

- A podium built from the stored first-, second-, and third-place rows.
- The complete frozen standings beneath the podium.
- The season name, close time, ranking method, eligibility rule, and deterministic tie-breaker.
- Snapshot display names and values that survive later account renames or deletion.
- The separate McSaddle Alpha Season 1 spotlight. If McSaddle also finishes on the podium, the presentation should avoid implying that the spotlight and podium entry represent different players.

The public archive must not expose internal bot classification. Once a season is finalized, neither a deploy nor an administrative retry may overwrite or rebuild its stored standings from current account data.

## Data boundaries

- Every game-history row must carry a season identifier. Existing history is assigned to Alpha Season 1; games created after the rollover are assigned to Alpha Season 2.
- Per-season player statistics are stored separately from lifetime career totals.
- Final standings store frozen ranks, names, statistics, wallet balances, and the ranking value used for that season.
- Alpha Season 1 uses closing wallet balance as its ranking value. Alpha Season 2 uses net tokens from game-linked ledger entries in that season.
- Token transactions remain the source of truth for wallet balances. Finalization must not delete, rewrite, or zero ledger history.

## Safe production rollover

1. Deploy and test the season schema, season-aware game creation and settlement, live Alpha Season 2 leaderboard, read-only archive endpoint, and legacy-season page while Alpha Season 1 remains active. Confirm the deploy is complete and no old backend instance can still accept game traffic before finalizing; an old settlement path does not write the new per-season statistics.
2. Verify that every newly created game is assigned to Alpha Season 1 before attempting the close.
3. Create a fresh full database backup in the approved external, access-restricted backup location.
4. Run the token-accounting audit and a read-only Alpha Season 1 preview. Together they must show the accounting blockers, complete ordered standings, podium, row count, and canonical snapshot hash without changing production data.
5. Review and retain the preview hash. Resolve or explicitly reconcile every abandoned, quarantined, or manual-review game before continuing.
6. Stop new Alpha Season 1 games and allow existing games and settlements to finish. Finalization requires zero in-progress games.
7. Acquire the season lifecycle lock and perform one guarded database transaction that:
   - Rechecks the season status and confirms that no game or settlement remains active.
   - Recomputes the exact standings and rejects the operation if they no longer match the reviewed preview hash.
   - Writes the complete immutable Alpha Season 1 snapshot.
   - Creates zeroed Alpha Season 2 per-season records while leaving carried wallet balances intact in the accountable ledger.
   - Marks Alpha Season 1 finalized and activates Alpha Season 2.
   - Leaves lifetime career totals and every wallet balance unchanged.
8. Commit all rollover changes together. Any error must roll back the snapshot, Alpha Season 2 activation, and all associated season changes.
9. Verify the stored podium and complete archive against the reviewed preview, verify the live leaderboard reports Alpha Season 2, and verify the Bulletin automatically switches from provisional copy to the final results and archive link.

Finalization must be idempotent: retrying a successfully completed command returns the existing result and cannot duplicate or replace the snapshot.

## Production gate

The Alpha Season 1 production finalization is complete. Retain these gates for every future season rollover:

- The implementation is deployed and verified.
- The external backup succeeds.
- The accounting audit and complete preview have been reviewed.
- The preview hash is confirmed.
- Alpha Season 1 has zero active games.
- The operator intentionally confirms the explicit Alpha Season 1 to Alpha Season 2 finalization action.
