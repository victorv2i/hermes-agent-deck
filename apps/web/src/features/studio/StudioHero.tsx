/**
 * StudioHero — the Agent Studio's hero band: a retro low-bit PIXEL-ART Greek
 * GATEWAY (a warm glowing portal in a columned temple, a colonnade reaching to
 * both edges) in soft sky-blue tones. Two versions (a night banner for dark mode
 * and a daytime banner for light mode) are served
 * from `public/studio-hero-night.webp` / `studio-hero-day.webp` and swapped by
 * theme through the `--studio-hero-art` token.
 *
 * Purely decorative (`aria-hidden`) — it sets a calm, premium, architectural tone
 * for Home without competing with the launchpad below it. The art is a BACKGROUND
 * (not an `<img>`) on a fixed slim-banner aspect (7:2): the source is composed for
 * exactly this crop — the gateway + colonnade sit low with open sky above and a
 * floor below; `bg-cover` + a `center 70%` position bias the crop DOWN so the
 * gateway stays grounded on its floor (a plain `center` clipped the column bases)
 * while the pediment and a strip of sky still read. A
 * dark surface fill backs it so the band never flashes empty before the webp
 * loads.
 */
export function StudioHero() {
  return (
    <div
      aria-hidden
      className="ad-surface ad-raised relative aspect-[7/2] w-full select-none overflow-hidden rounded-2xl bg-surface-1 bg-cover bg-no-repeat"
      style={{ backgroundImage: 'var(--studio-hero-art)', backgroundPosition: 'center 70%' }}
    />
  )
}
