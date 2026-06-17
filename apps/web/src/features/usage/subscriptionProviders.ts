/**
 * Subscription-vs-metered provider classifier – the authoritative billing signal
 * the cost pair alone cannot give us.
 *
 * The /api/analytics/usage rollup only carries an estimated/actual cost pair; a
 * FLAT SUBSCRIPTION (e.g. a ChatGPT/Codex plan logged in via OAuth) has NO
 * per-call dollar amount, so under a subscription BOTH est and actual are $0.
 * Inferring billing mode from cost alone therefore mislabels a busy subscription
 * window as "local / no billed cost" – the exact bug this fixes.
 *
 * The active PROVIDER is the honest signal: a subscription/OAuth provider bills
 * by a flat plan (no metered key), so its usage is "included in your
 * subscription", not free and not per-call. We classify by the provider slug
 * stock reports (`/api/agent-deck/models` → `provider.id`).
 *
 * This is a curated allow-list, not a guess: only providers we KNOW are flat
 * subscription / OAuth seats are tagged `subscription`. Anything unknown returns
 * `false`, falling back to the cost-based inference – so we never invent a label.
 */

/**
 * Provider slugs that bill by a FLAT SUBSCRIPTION / OAuth seat (no per-call
 * meter). Stock hermes authenticates these via OAuth and they carry no metered
 * API key, so the usage rollup reports $0 even when the plan is fully exercised.
 * Matched case-insensitively against the active provider slug; a slug that
 * merely CONTAINS one of these (e.g. `openai-codex`) also counts, so plan
 * variants don't slip through.
 */
const SUBSCRIPTION_PROVIDER_SLUGS = [
  'openai-codex', // ChatGPT / Codex subscription (OAuth, no metered key)
  'codex',
  'claude-max', // Claude Max subscription (OAuth)
  'claude-pro',
  'copilot', // GitHub Copilot subscription seat
  'chatgpt',
] as const

/**
 * True when the active provider is a known flat-subscription / OAuth provider –
 * its tokens are "included in your subscription", not billed per call. Unknown
 * providers return `false` so the caller falls back to cost-based inference.
 */
export function isSubscriptionProvider(providerId: string | null | undefined): boolean {
  if (typeof providerId !== 'string' || providerId.trim() === '') return false
  const slug = providerId.trim().toLowerCase()
  return SUBSCRIPTION_PROVIDER_SLUGS.some((known) => slug.includes(known))
}
