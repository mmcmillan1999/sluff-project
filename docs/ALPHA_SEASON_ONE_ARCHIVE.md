# Alpha Season 1 archive plan

Alpha Season 1 is still in progress. The in-game Bulletin may celebrate McSaddle now, but it must not claim final ranks or final leaderboard totals until the season is officially closed.

The current leaderboard contains lifetime totals and the database does not yet assign games to a season. Before calling any result an Alpha Season 1 result, define its baseline. The simplest defensible choice may be "all recorded Sluff history through the Alpha 1 close," but that remains a product decision. A different start date requires a verified historical baseline; it cannot be reconstructed reliably from the current lifetime counters alone.

## What the permanent archive should preserve

- The complete ranked leaderboard, not only the podium.
- The displayed username, bot status, wins, losses, washes, games played, and exact token balance at the moment the season closes.
- The final first-, second-, and third-place entries.
- A separate McSaddle season spotlight. If McSaddle finishes in the top three, the final presentation should avoid repeating the name as though it represented two different players.
- The ranking and eligibility rules used for the snapshot.

The archive must be an immutable snapshot. It must not read its historical names or ranks from the changing live leaderboard after finalization.

## Decisions to make before closing the season

- Confirm whether ranking remains token balance descending with username as the deterministic tie-breaker.
- Confirm the minimum-games requirement, if any.
- Confirm whether persistent bots compete in the archived standings.
- Finish the token-accounting review and record any necessary corrections as new ledger adjustments before taking the snapshot.
- Choose the official close time and make sure no games or settlements are still in progress.
- Define the Alpha 1 start or explicitly adopt all recorded history as the season baseline.

## Safe finalization outline

1. Preview the exact final standings without changing data.
2. Review the accounting audit and the Alpha eligibility rules.
3. Close new Alpha play, wait for active settlements, and acquire a settlement-compatible finalization lock.
4. Freeze every ranked row in one guarded, repeatable-read database transaction and store it in dedicated season snapshot tables.
5. Store snapshot display names so later renames or account cleanup cannot rewrite history.
6. Mark the season finalized and reject any attempt to overwrite it.
7. Serve the complete archived standings through a read-only season leaderboard endpoint.
8. Replace every provisional Bulletin state: podium names, ticker copy, hero text, archive note, footer, and accessibility labels.

Future game-history records should carry a season identifier so later seasons can be reconstructed independently of lifetime player totals.
