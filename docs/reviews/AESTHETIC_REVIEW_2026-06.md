# Sluff — Aesthetic & UX Review (June 2026)

*Produced by a product-design review agent that audited every screen's JSX + CSS from login through gameplay, plus the live bundle at playsluff.com.*

## Current state diagnosis

The engineering bones are genuinely good — the vh-based layout system, CardPhysicsEngine/CardSpacingEngine, and the gold-vs-blue team color concept are better than most hobby projects ever get. But the visual layer is an archaeology dig: **~170 unique hex values** across 39 CSS files, four different design systems pasted together (Bootstrap 4 `#007bff`, Bootstrap 5 `#0d6efd`, Tailwind `#3b82f6`/`#1f2937`, Material `#5c6bc0`/`#4CAF50`), ~17 distinct button treatments, 7 different modal styles, z-indexes from `-1` to `2147483647`. The single biggest tell: **the brand fonts never load** — `'Oswald'` is referenced 63 times and `'Merriweather'` 12 times, but there is no font loading anywhere (verified in the live bundle). Every user has been seeing fallback Arial/Times this whole time.

## TOP 5 highest-impact upgrades

### 1. Actually load the typography — Effort: S
`npm i @fontsource/oswald @fontsource/merriweather` (or swap body text to Inter), import in `src/index.js`, weights 400/500/600 Oswald + 400/700 body. Keep **Oswald** for headings/buttons/numbers; replace Merriweather body with **Inter** or system stack (serif body on dark UI reads dated). One global `font-family` on `body` in `src/index.css`; delete per-component `font-family: Arial` stragglers (`App.css` line 5, `AdvertisingHeader.css` 54/131). Kill the never-loading `'Creepster','Chiller'` stack in `WidowSeat.css` line 46.

### 2. Create `src/styles/tokens.css` and collapse the palette — Effort: M
Extend the `:root` block already started in `LobbyView.css` (lines 7–32) into a real token sheet:

```css
:root {
  /* Surfaces */
  --surface-0: #121212;  --surface-1: #1a1a1a;  --surface-2: #242424;
  --surface-3: #2e2e2e;  --border: rgba(255,255,255,0.12);
  /* Text */
  --text-hi: #f5f5f4;  --text-mid: #b6b6b3;  --text-low: #7d7d7a;
  /* One blue (kills ~13 different blues) */
  --primary: #3b82f6;  --primary-hover: #2563eb;
  /* Team identity (already coherent — promote to tokens) */
  --team-bidder: #f59e0b;   --team-bidder-glow: #fbbf24;
  --team-defender: #3b82f6; --team-defender-glow: #60a5fa;
  /* One green (kills 20+ greens) */
  --success: #22c55e;  --danger: #ef4444;  --warning: #f59e0b;
  --gold: #ffd700;  --felt: #0f4d2a;  --felt-dark: #0a3a1f;  --wood: #3e2723;
  /* Z-scale (current range is -1 → 2147483647) */
  --z-table: 10; --z-hud: 100; --z-header: 500; --z-modal: 1000; --z-toast: 1100;
}
```

Worst-offender files to sweep first: `App.css`, `LobbyView.css`, `LobbyTableCard.css`, `GameTableView.css`, `TableLayout.css`, `RoundSummaryModal.css`. **Real stacking bug found:** `.modal-overlay` is `z-index: 1000` (`GameTableView.css` 175) but `.advertising-header` is `z-index: 2000` — the ad banner floats above the Round Summary modal scrim.

### 3. Redesign card faces and felt — the 90% surface — Effort: M (paint-only, zero physics risk)
- **Card faces** (`GameTableView.js` `renderCard()` ~304, `.card-display` in `TableLayout.css` 613): drop the pastel suit backgrounds (`SUIT_BACKGROUNDS` in `src/constants.js` line 13 — no polished card game tints faces by suit). Use white stock `#fbfaf4` for all suits, suit colors `#c62828` (H/D) and `#1b1b1b` (C/S), bottom-right rotated mirror index, `border: 1px solid rgba(0,0,0,0.25)`, `box-shadow: 0 2px 6px rgba(0,0,0,0.35)`. Selection = `--primary` ring + lift instead of `#8bc3f7` fill.
- **Card back** (`TableLayout.css` 107–124): replace logo-rotated-(-70deg)-on-gray with a real back: deep red or navy field, thin double border inset, centered upright logo ~60% opacity.
- **Felt** (`.table-oval`, `TableLayout.css` 44): `background: radial-gradient(ellipse at 50% 35%, #15673a 0%, #0f4d2a 55%, #0a3a1f 100%)`; rim `linear-gradient(#5d4037, #3e2723)` with inner gold pinstripe (`box-shadow: inset 0 0 0 2px rgba(255,215,0,0.15), inset 0 0 6vh rgba(0,0,0,0.6)`). Darken the page backdrop to `--surface-0` so the felt is the brightest thing on screen.

### 4. One modal system (use InsurancePrompt as the template) — Effort: L
Seven modal skins coexist (light Bootstrap RoundSummary/DrawVote, dark slate InsurancePrompt, navy SuperBotModal, parchment MercyWindow, charcoal Feedback/FrogDiscard, `#fefcbf` initial-prompt). Standardize on the InsurancePrompt look: scrim `rgba(0,0,0,0.7)` + `backdrop-filter: blur(4px)`, panel `linear-gradient(135deg, #1f2937, #111827)`, `border: 1px solid rgba(255,255,255,0.1)`, radius 16px, `z-index: var(--z-modal)`. Biggest lift: convert RoundSummaryModal (the most-seen modal) to dark surfaces while keeping its gold/blue pulsing team borders.

### 5. First impression: auth screen — Effort: S/M
`AuthForm.css` is flat `#333` page + `#444` rectangle + `#007bff` button. Fix: felt-vignette background (same radial gradient as the table) so the brand starts at login; panel `--surface-1` at 90% + border + radius 16 + `box-shadow: 0 25px 50px -12px rgba(0,0,0,0.8)`; dark inputs `#2c2c2c` with `--primary` focus ring; one primary CTA style (Oswald 600, radius 12); error state as bordered alert chip (reuse the lobby's `.error-message` pattern).

## Smaller polish items

1. Remove the raw server URL `wss://sluff-backend.onrender.com` from the lobby footer (`LobbyView.js` 340) — the #1 "hobby project" tell.
2. Replace text glyphs with SVG icons: `►`/`▼` carets (`LobbyView.js` 274/302/328), `👁️` spectate emoji, `✅` in Register.
3. Neutralize `App.css` globals — `body { text-align: center }`, global `button { background: #007bff }`, `h1 { color: #333 }` leak everywhere.
4. Loading/empty states: "Loading tables..." → 3 skeleton cards reusing the `loading-shimmer` keyframe; style the chat empty state.
5. Cap the glow budget — keep infinite pulse only for "your turn"; make seat/hand/trick/token/dealer/widow glows one-shot or static.
6. Exclude debug CSS from the production bundle — `LayoutDevPanel.css` (z-index 2147483647), `DebugWindow.css`, `CardDebugWindow.css`, `DraggableRuler.css`, `PlayerHandAnchorDebug.css` ship to users today.
7. Delete `src/components/LobbyView.css.backup` and dead commented keyframes in `AdvertisingHeader.css` (67–78).
8. LobbyTableCard status chips → colored dot + label using tokens; remove inline `#17a2b8` rejoin override (`LobbyTableCard.js` 54).
9. Touch targets: `.chat-close-button` and `.chat-minimize-btn` are well under 44px.
10. `.game-button` Material indigo gradient (`TableLayout.css` 19) matches nothing — move to `--primary`.

## Keep — these already work

1. **CardPhysicsEngine / CardSpacingEngine and the vh-based layout discipline** — everything above is paint-level; don't touch positioning math.
2. **The gold-bidder / blue-defender identity system** — applied consistently across seats, trick piles, hand glow, round summary. A real design language; promote to tokens and lean in harder.
3. **Mobile care** — `100dvh`, overscroll guards, touch-target vars, minimizable chat, `prefers-reduced-motion`/`prefers-contrast` blocks. Rare at this stage; preserve through any refactor.

**Suggested order:** #1 fonts (an afternoon) → #2 tokens → #3 cards/felt → #5 auth → #4 modals. Items #1, #3, and #5 alone move this from "hobbyist" to "credible" — they cover the first screen, every glyph of text, and 90% of play time.
