/**
 * Provider brand MARKS for the Models surface.
 *
 * Renders each model vendor's ACCURATE official logo from the MIT-licensed
 * `@lobehub/icons` package (accurate AI brand marks) — used NOMINATIVELY to
 * identify a model's vendor (Anthropic, Google/Gemini, OpenAI, xAI/Grok, Meta,
 * Mistral, Qwen, DeepSeek, OpenRouter, Cohere, Perplexity, Ollama, …), consistent
 * with the repo's existing trademark notice. We do NOT hand-author marks (a
 * hand-drawn logo is unreliable; a garbled mark is worse than a clean monogram).
 *
 * DESIGN SPINE — a brand mark is IDENTITY, never the amber `--primary` action
 * accent. Marks render in `currentColor` (neutral, inheriting the section header's
 * foreground, AA on light + dark), never wired to amber. For the Mono variant we
 * use `currentColor`; for the Color variant where used, the brand's own color
 * reads as identity, not the app's action accent.
 *
 * HONESTY over decoration: a vendor whose icon is genuinely absent from all
 * accurate sources has NO entry here, so {@link resolveProviderBrand} flags it
 * `isFallback` and we render a tasteful neutral monogram (a readable initial in a
 * soft square) instead — a wrong/ambiguous mark is worse than a clean monogram.
 *
 * Resolution (alias folding, fallback decision) lives in the render-free sibling
 * `providerBrands.ts`; this file maps the resolved brand `key` to its mark.
 */
import {
  Anthropic,
  Cohere,
  DeepSeek,
  Gemini,
  Meta,
  Mistral,
  Ollama,
  OpenAI,
  OpenRouter,
  Perplexity,
  Qwen,
  XAI,
} from '@lobehub/icons'
import { resolveProviderBrand } from './providerBrands'

/** Props the @lobehub/icons Mono components accept at runtime. */
type LobehubIconProps = {
  size?: number | string
  className?: string
  style?: React.CSSProperties
  'aria-hidden'?: boolean | 'true' | 'false'
}

type MarkFn = (props: LobehubIconProps) => React.ReactElement

/**
 * Wrap a @lobehub/icons Mono component into our MarkFn interface. The Mono
 * variant renders in `currentColor` so it inherits the surrounding foreground
 * (AA on light + dark, never wired to the amber `--primary` accent).
 */
function fromLobehub(Icon: React.ComponentType<LobehubIconProps>): MarkFn {
  return (props) => <Icon {...props} />
}

/**
 * Resolved-brand `key` → accurate `@lobehub/icons` Mono mark. ONLY brands whose
 * official icon is accurate in @lobehub/icons live here. A resolved brand `key`
 * with NO entry falls through to the neutral monogram — never a garbled logo.
 *
 * All Mono variants render in `currentColor` so they read the same across all four
 * theme families (Clay&Sky, Ember, Warm Void, Indigo) in both light + dark modes.
 */
const MARKS: Record<string, MarkFn> = {
  anthropic: fromLobehub(Anthropic),
  google: fromLobehub(Gemini),
  meta: fromLobehub(Meta),
  mistral: fromLobehub(Mistral),
  qwen: fromLobehub(Qwen),
  deepseek: fromLobehub(DeepSeek),
  openai: fromLobehub(OpenAI),
  xai: fromLobehub(XAI),
  cohere: fromLobehub(Cohere),
  perplexity: fromLobehub(Perplexity),
  ollama: fromLobehub(Ollama),
  openrouter: fromLobehub(OpenRouter),
}

/**
 * A tasteful neutral monogram for a vendor we have no accurate mark for: the
 * initial in a soft rounded square. Neutral `currentColor` only — identity, not
 * the amber accent. A clean monogram beats a wrong/ambiguous logo.
 */
const MonogramMark = (slug: string): MarkFn => {
  const initial = (slug.match(/[a-z0-9]/i)?.[0] ?? '?').toUpperCase()
  return ({ size = 16, className, 'aria-hidden': ariaHidden = true }) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden={ariaHidden as true}
      focusable={false}
      className={className}
    >
      <rect
        x="2.5"
        y="2.5"
        width="19"
        height="19"
        rx="5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        opacity={0.55}
      />
      <text
        x="12"
        y="12"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="11"
        fontWeight={600}
        fill="currentColor"
      >
        {initial}
      </text>
    </svg>
  )
}

/**
 * Render a provider's brand mark inline. Decorative by default (`aria-hidden`) —
 * the adjacent text label carries the accessible name. Neutral `currentColor`
 * (identity), never the amber action accent. A vendor with no accurate mark
 * renders the neutral monogram fallback (never a garbled logo).
 */
export function ProviderBrandIcon({
  provider,
  className,
  size = 16,
}: {
  provider: string
  className?: string
  size?: number
}) {
  const brand = resolveProviderBrand(provider)
  const Mark = (!brand.isFallback && MARKS[brand.key]) || MonogramMark(brand.slug)
  return Mark({ className, size, 'aria-hidden': true })
}
