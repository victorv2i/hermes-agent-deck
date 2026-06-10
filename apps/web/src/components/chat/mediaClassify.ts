/**
 * Media classification for agent-rendered links (used by {@link MediaEmbed}).
 * Kept in its own module so the component file only exports components
 * (react-refresh/only-export-components).
 */

const AUDIO_EXT = /\.(mp3|wav|ogg|m4a|flac|aac)$/i
const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv)$/i

/** Media kind a URL points at, by extension / data-MIME. `null` ⇒ not media. */
export type MediaKind = 'audio' | 'video' | 'image'

/** The pathname portion of a URL, with the query/hash stripped, so an extension
 * in `?file=clip.mp4` can't masquerade as a media path. Uses `new URL()` for
 * absolute hrefs (guarded against throws) and falls back to a manual strip. */
function pathnameOf(href: string): string {
  try {
    return new URL(href, 'https://x.invalid/').pathname
  } catch {
    // Odd/relative inputs new URL() can't parse: drop the query/hash by hand.
    return href.split(/[?#]/, 1)[0]!
  }
}

/** Classify a URL as audio/video/image media, or `null` for a normal link. Reads
 * the path extension for http(s)/relative URLs and the MIME for `data:` URLs. */
export function classifyMedia(href: string): MediaKind | null {
  const trimmed = href.trim()
  if (trimmed === '') return null
  // data: URLs carry their type in the MIME, not an extension.
  const dataMime = /^data:(audio|video|image)\//i.exec(trimmed)
  if (dataMime) return dataMime[1]!.toLowerCase() as MediaKind
  // Only the pathname decides media-ness — an extension in the query/hash
  // (e.g. ?file=clip.mp4) is a normal link, not a playable source.
  const path = pathnameOf(trimmed)
  if (AUDIO_EXT.test(path)) return 'audio'
  if (VIDEO_EXT.test(path)) return 'video'
  return null
}

/** True for a source the browser can fetch+play directly (`data:` or http(s)). */
export function isPlayableSource(href: string): boolean {
  return /^(https?:|data:)/i.test(href.trim())
}
