# Agent identity avatars (built-in set)

The built-in agent-avatar set for the identity feature: **6 flat two-tone EMBLEM
avatars**, each a single bold celestial or classical Hermes symbol on its own solid
color ground, in a varied jewel palette. Every avatar uses **two colors by design**
(a flat figure on a flat ground), so it reads cleanly at any size. Rendered as
**identity** color, **never** the amber `--primary` action accent; identity rings use
`--border-strong`.

The set:

- `v1`: **Hermes wings** (winged crest) on navy, sky-blue figure
- `v2`: **orbital** (a ringed planet) on dark teal, mint figure
- `v3`: **constellation** (five linked stars) on plum, lilac figure
- `v4`: **lyre** on wine, rose figure
- `v5`: **north star** (eight-point compass star) on forest green, sage figure
- `v6`: **caduceus** (winged staff) on indigo, ivory figure

Files:

- `v1.png … v6.png` (here): **archival 384² source** PNGs. Source of truth; committed
  so the set is never lost.
- `apps/web/public/avatars/v1.webp … v6.webp`: the **served, optimized 256²** webp the
  app references.

Regenerate by running `.design-gen/gen-flat-avatars.sh`, which generates each emblem
individually with gpt-image-2 (flat, two-tone, centered) into `.design-gen/avatars-flat-v4/`,
then resizing each to the served 256² webp and the archival 384² png:

```sh
for n in 1 2 3 4 5 6; do
  magick .design-gen/avatars-flat-v4/v$n.png -resize 256x256 -define webp:lossless=true apps/web/public/avatars/v$n.webp
  magick .design-gen/avatars-flat-v4/v$n.png -resize 384x384 assets/avatars/v$n.png
done
```

Keep the ids in sync with `BUILTIN_AVATAR_IDS` in `packages/protocol/src/identity.ts`.
