import { useContext, useSyncExternalStore } from 'react'
import { Check, Moon, Sun } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { usePalette } from '@/features/themes/palette'
import { PALETTES, type ThemePalette } from '@/features/themes/palette-registry'
import { ThemeContext, type ResolvedTheme } from '@/components/theme/theme-context'

/**
 * Read + write the light/dark MODE, preferring the app's ThemeProvider so we share
 * its ONE persisted source of truth. The control was deliberately built to render
 * in isolation (no provider) too — so when there is no provider (hermetic tests /
 * Storybook), we degrade gracefully: read the mode off `<html data-theme>` and
 * write it via the same DOM mechanism the provider uses, WITHOUT persisting (there
 * is no live app to persist for). Production always has the provider, so the real
 * persisted path is used.
 */
function useMode(): { mode: ResolvedTheme; setMode: (mode: ResolvedTheme) => void } {
  const ctx = useContext(ThemeContext)
  // Track the DOM attribute so the fallback path re-renders when the mode flips.
  const domMode = useSyncExternalStore(subscribeToDomTheme, readDomMode, () => 'dark' as const)
  if (ctx) return { mode: ctx.resolvedTheme, setMode: ctx.setTheme }
  return {
    mode: domMode,
    setMode: (next) => {
      if (typeof document === 'undefined') return
      const root = document.documentElement
      root.classList.toggle('dark', next === 'dark')
      root.setAttribute('data-theme', next)
      root.style.colorScheme = next
      // Notify our DOM subscribers so the no-provider path re-renders.
      for (const l of domThemeListeners) l()
    },
  }
}

const domThemeListeners = new Set<() => void>()
function subscribeToDomTheme(listener: () => void): () => void {
  domThemeListeners.add(listener)
  return () => domThemeListeners.delete(listener)
}
function readDomMode(): ResolvedTheme {
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
}

/**
 * PaletteControl — the THEME picker on the Settings surface, presented as a clean
 * SWATCH GRID (recognition, not a dropdown): one labeled color swatch per FAMILY,
 * plus a light/dark MODE toggle. There are three families (Clay & Sky default,
 * Warm Void · Nous, Indigo Atelier); each ships a real light AND dark
 * variant, so the same grid + the mode toggle compose to every look.
 *
 * Two governed dimensions, colocated:
 *   - FAMILY: a radiogroup of swatch tiles. Each tile re-themes the whole app via
 *     `data-palette` on <html> (features/themes/palette.ts), preserving governance
 *     (one action accent, semantic = status, lifted hairlines). Selection applies
 *     LIVE (no Apply button) + persists. The active tile carries a neutral
 *     border-strong selection ring (NOT amber — only focus rings are amber) + an
 *     amber "active" check.
 *   - MODE: a light/dark segmented toggle that drives the ONE app-mode source of
 *     truth (the ThemeProvider via useTheme) — never a divergent local copy — so a
 *     swatch previews the exact tone it will paint in the chosen mode.
 */
export function PaletteControl() {
  const { palette, setPalette } = usePalette()
  // Preview swatches in the active mode (read off the one mode source of truth).
  const { mode, setMode } = useMode()

  return (
    <Card className="ad-raised gap-0 py-0">
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-heading text-base leading-snug font-medium text-foreground">
              Theme
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Pick a family, then choose light or dark. Changes apply instantly and persist.
            </p>
          </div>
          <ModeToggle mode={mode} onSetMode={setMode} />
        </div>

        <div
          role="radiogroup"
          aria-label="Theme"
          className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3"
        >
          {PALETTES.map((p) => (
            <PaletteTile
              key={p.id}
              palette={p}
              checked={palette === p.id}
              mode={mode}
              onSelect={() => setPalette(p.id)}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

const MODE_OPTIONS = [
  { value: 'light' as ResolvedTheme, label: 'light', icon: Sun },
  { value: 'dark' as ResolvedTheme, label: 'dark', icon: Moon },
]

/**
 * The light/dark MODE toggle — a governed two-option segmented radiogroup
 * (recognition over a hidden switch). It drives the real app mode via setTheme, so
 * it shares the persisted single source of truth with the header toggle + ⌘K.
 */
function ModeToggle({
  mode,
  onSetMode,
}: {
  mode: ResolvedTheme
  onSetMode: (mode: ResolvedTheme) => void
}) {
  return (
    <SegmentedControl
      value={mode}
      onValueChange={onSetMode}
      options={MODE_OPTIONS}
      aria-label="Mode"
    />
  )
}

function PaletteTile({
  palette,
  checked,
  mode,
  onSelect,
}: {
  palette: ThemePalette
  checked: boolean
  mode: ResolvedTheme
  onSelect: () => void
}) {
  // Preview the variant that matches the current mode, so the swatch reads as
  // what it will actually apply.
  const primary = mode === 'light' ? palette.swatch.primary.light : palette.swatch.primary.dark
  const secondary =
    mode === 'light' ? palette.swatch.secondary.light : palette.swatch.secondary.dark

  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={cn(
        'ad-surface group relative flex items-center gap-3 rounded-md bg-surface-1 p-3 text-left transition-colors',
        'focus-visible:ad-focus',
        // A persistent SELECTION ring must be neutral border-strong, never amber
        // (focus-visible rings stay --ring; only those are amber). §2.
        checked
          ? 'border-[var(--border-strong)] ring-1 ring-[var(--border-strong)]'
          : 'hover:border-border-strong',
      )}
    >
      {/* Swatch: the governed action accent over a surface tone. */}
      <span
        aria-hidden
        className="grid size-9 shrink-0 place-items-center rounded-[7px]"
        style={{ backgroundColor: secondary }}
      >
        <span
          data-swatch-primary
          className="size-4 rounded-full"
          style={{ backgroundColor: primary }}
        />
      </span>

      <span className="min-w-0 flex-1">
        {/* The theme NAME owns its own line so it's never truncated/covered. */}
        <span className="block text-13 font-medium text-foreground">{palette.label}</span>
        {/* The recommended/default badge sits BELOW the name — smaller + muted, a
            governed (never-accent) tone — so it can't crowd out the name. */}
        {(palette.isRecommended || palette.isDefault) && (
          <span className="mt-0.5 block text-[10px] tracking-wide text-foreground-tertiary uppercase">
            {palette.isRecommended ? 'Recommended default' : 'Default'}
          </span>
        )}
        <span className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
          {palette.description}
        </span>
      </span>

      {checked && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
    </button>
  )
}
