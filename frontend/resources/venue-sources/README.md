# Venue art — source masters

The originals the shipped lobby banners were cropped from. Committed because a
project-wide hash sweep found **no other copy of either file**, so this is the
only backup they have.

Nothing builds from these automatically. They live here so a banner can be
re-cropped later without redrawing the art.

| Source | Size | Shipped as | Shipped size |
|---|---|---|---|
| `fort-creek.png` | 1983 × 793 | `public/assets/themes/fort-creek-lobby-v2.webp` | 1600 × 400 |
| `eaglewood.png` | 1540 × 440 | `public/assets/themes/eaglewood-lobby-v2.webp` | 1600 × 400 |

`fort-creek.png` is worth keeping in particular: at 1983 × 793 it holds roughly
twice the pixels of the banner cut from it, so a taller crop or a retina export
is still possible. `eaglewood.png` is close to parity with its banner and has
less headroom.

Both arrived in the repo root on 2026-07-16, minutes before the `-lobby-v2.webp`
files appeared — the crop step, not the art step. `eaglewood.png` had no file
extension at all until it was filed here; it was always a PNG.

The other two venues (`academy-lobby-v2.webp`, `shirecliff-lobby-v2.webp`) have
no masters in the repo. If you still have theirs, this is where they go.

## Re-cropping

The banners are 4:1. Crop, then export to WebP — the shipped files run 47–116 KB,
which is the quality bar to match:

```bash
# whatever tool you prefer; the target is 1600x400 WebP
```

Do not commit a re-export over the master. The master is the thing that cannot
be recovered.
