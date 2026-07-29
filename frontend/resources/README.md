# Art masters

Source art that is not itself shipped. Nothing here is served to the web — this
directory sits outside `public/`, so committing a large master costs repo size
and nothing else.

- **This file** — app icon and splash masters, consumed by `@capacitor/assets`.
- **`venue-sources/`** — the originals the lobby venue banners were cropped
  from. Not built from; kept because they are the only copies.

## App icon and splash masters

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

## Status: done

`icon.svg`, `icon-mark.svg` and `icon-background.svg` are the vector masters.
They are hand-drawn rather than generated, so they scale losslessly and carry
the app's own colours (`#0b1711` is the PWA theme colour; the golds match the
action-prompt palette).

Regenerate the PNG masters after editing any SVG:

```bash
node resources/build-icons.cjs   # SVG -> icon/foreground/background/splash PNGs
npm run assets                   # PNGs -> every iOS, Android and PWA size
npx cap sync
```

### Design constraints these encode

- **No rounded corners, no border.** The platforms apply their own mask. The
  previous 512px icon baked in a gold frame, which would have been
  double-rounded and clipped.
- **The mark sits inside the middle 62%.** Android crops adaptive icons to a
  circle or squircle. The correction transform in `icon.svg` is measured, not
  eyeballed — recompute it if either card rotation changes.
- **No wordmark.** "SLUFF" spanning the icon is illegible at 29x29, which is
  the size that decides whether an icon works. Two cards and a suit pip read at
  any size.
- **The splash plate drops the felt weave.** At 2732px the texture is invisible
  per-pixel grain that PNG cannot compress — it cost 5.8MB per splash against
  0.33MB without, across sixteen Android densities.

### Checking it

The only test that matters is the small one. Render `icon.png` at 29x29 and see
whether you can still tell what it is.
