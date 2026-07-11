# Sluff collaboration guardrails

These instructions apply across the repository.

## Card interaction is product identity

- A card is played only by an intentional flick or fling onto the table.
- Do not add tap-to-play, click-to-play, keyboard-to-play, or similar shortcuts.
- A card released without a deliberate flick may settle back into the player's hand. This is intentional: it lets a player recover from picking up the wrong card or changing their mind.
- Do not alter card-release thresholds, return-to-hand behavior, drag/touch handling, `PlayerHand`, or the card physics engine unless the user explicitly requests that specific work.
- If a security or integrity vulnerability intersects card play, discuss the proposed solution first and preserve the flick physics wherever possible.

## Game rules are product canon

- Do not change the rules, scoring, bidding hierarchy, legal-move logic, deck behavior, or round/game flow without discussing the change with the user first.
- Do not let a technical cleanup silently change gameplay semantics. Flag any unavoidable rules impact before implementation.

## Communication

- Treat these guardrails as understood. Do not repeat them in routine plans, progress updates, or handoffs unless the current work directly intersects one of them.
