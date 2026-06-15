/**
 * Home feature barrel — the standalone Home hero + dashboard were RETIRED when the
 * Agent Studio became Home (`/`). What survives is the pure "what your agent is
 * tending" summarizer, which the Studio's launchpad strip reuses to show the
 * agent's live tending status.
 */
export {
  summarizeTending,
  NEEDS_OK_COPY,
  type TendingSummary,
  type TendingInputs,
  type TendingConnection,
} from './tendingSummary'
