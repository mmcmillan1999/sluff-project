# App icon and splash masters

`@capacitor/assets` generates every iOS and Android icon and splash size from
the masters in this directory. Put the source art here and run:

```bash
cd frontend
npm run assets          # generates into ios/ and android/
npx cap sync
```

## What is needed

| File | Size | Notes |
|---|---|---|
| `icon.png` | **1024×1024** | Square, no transparency, no rounded corners — the platforms mask it themselves. Anything inside the outer ~10% may be clipped on Android's circular mask. |
| `icon-foreground.png` | 1024×1024 | Android adaptive icon foreground. Keep the mark inside the middle 66%; the outer band is cropped on some launchers. Transparent background. |
| `icon-background.png` | 1024×1024 | Android adaptive icon background. A flat colour is fine. |
| `splash.png` | 2732×2732 | Centre the mark in the middle ~40%; the edges are cropped on almost every aspect ratio. |
| `splash-dark.png` | 2732×2732 | Optional. |

## Status: the master does not exist yet

The largest existing art is **512×512** (`frontend/public/sluff-app-icon-v1.png`),
and `SluffLogo.png` is 600×400. Neither is usable as a 1024 master.

**Do not upscale them.** App Store review rejects a blurry or artefacted icon,
and a 2× upscale of a 512 PNG is visibly soft at 1024. This needs to be redrawn
or re-exported at native size from whatever the original source was.

Two things already in the repo may be the right starting point, since both are
vector and scale losslessly:

- `frontend/src/components/game/McMillanCrest.js` — the crest, as inline SVG.
- `frontend/src/components/SluffIdent.js` — the boot ident artwork.

Until a master lands here, the platforms fall back to the default Capacitor
icon, which is an automatic rejection. This is tracked in `docs/IOS_DAY_ONE.md`
as an open blocker.
