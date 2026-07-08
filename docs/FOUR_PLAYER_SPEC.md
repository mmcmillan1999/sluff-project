# 4-Player Sluff — Rules Specification

Agreed with Matt, 2026-07-07. This is the authoritative description of how
4-player mode is supposed to work. The guiding principle: **each round of a
4-player game IS a 3-player round** — the dealer sits out, everything else is
identical to 3-player Sluff.

## Core loop

- 4 players, same buy-in each, everyone starts at 120 points.
- Each round the **dealer deals and sits out**. The other 3 play a standard
  round: 11 cards each, 3-card widow, normal bidding (Frog / Solo / Heart
  Solo), normal trick play and trump rules. Bidding starts left of the dealer.
- The dealer rotates one seat per round, so every player sits out every 4th
  round.

## The sitting-out dealer

- Cannot bid, cannot play cards, does not participate in insurance.
- **Widow peek**: the dealer — only the dealer, and only in 4-player mode —
  may tap the widow pile to view its cards, the same interaction as peeking
  at the last trick on a trick pile. Available throughout the round.
  On a Frog round the peek shows **both** the original widow and, once the
  bidder exchanges, the bidder's 3 discards.
- **Scoring — the dealer can never lose points:**
  - Bidder fails (< 60): the dealer collects the same `exchangeValue` share
    as each defender. The bidder pays 3 shares (two defenders + dealer).
    This is the 4-player equivalent of the 3-player ScoreAbsorber.
  - Bidder succeeds (> 60): bidder collects from the two active defenders
    only (2 shares). Dealer untouched.
  - Exactly 60, or an executed insurance deal: dealer untouched.

## Insurance

Active in every round, identical to 3-player: the bidder and the two active
defenders negotiate. The dealer is not a party (no offer slot, no
requirement, no payout).

## Game end and payouts

- Game-over conditions are unchanged from 3-player.
- Pot = 4 buy-ins, split by final ranking **3 : 1 : 0 : 0**
  (1st takes 3 parts, 2nd takes 1 part, 3rd and 4th get nothing).
- **Ties**: players tied across ranks pool those ranks' parts and split them
  evenly — e.g. a tie for 1st pays (3+1)/2 = 2 parts each; a tie for 2nd pays
  ½ part each.
- 4-player draw votes include all four players (everyone has tokens at
  stake).

## Table presentation

- **Fixed seats for the whole game.** The four players sit in a fixed circle;
  every client renders itself at the bottom seat with left / across (top) /
  right constant all game. The seat that shows the "Widow" nameplate in
  3-player is a **normal player seat** in 4-player.
- **Dealer marker**: the current dealer's player seat gets a **black border**.
  The marker rotates around the table each round; players never change seats.
- The **widow pile** renders in its own position (as in 3-player, independent
  of any seat) and is no longer hidden in 4-player. It is the dealer's peek
  tap target.
- Bid-winner splash, round summary, and end-of-round celebration must account
  for all four players (the dealer appears in the summary when they gained a
  share).
