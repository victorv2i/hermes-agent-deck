/**
 * The "While you were away" catch-up digest: an honest, dismissible on-return
 * summary computed from the sessions + cron history the app already loads. Public
 * surface: the connected hook, the presentational card, and the pure helper/types.
 */
export { useAwayDigest, type UseAwayDigest } from './useAwayDigest'
export { AwayDigestCard, type AwayDigestCardProps } from './AwayDigestCard'
export {
  computeAwayDigest,
  AWAY_THRESHOLD_MS,
  type AwayDigest,
  type AwayRunsSummary,
  type AwayCronsSummary,
} from './digest'
