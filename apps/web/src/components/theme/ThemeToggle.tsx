import { lazy, Suspense } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTheme } from './theme-context'
import type { ThemeMode } from './theme-context'

// The animated icon swap (the only framer-motion user here) is lazy-loaded into
// its own chunk so the library stays off the eager entry path. The Suspense
// fallback is the static current icon — correct and instant; the crossfade
// upgrades once the chunk lands.
const ThemeToggleIcon = lazy(() => import('./ThemeToggleIcon'))

/** Cycle order for the single-button mode control: light → dark → system → … */
const ORDER: readonly ThemeMode[] = ['light', 'dark', 'system'] as const

function nextMode(mode: ThemeMode): ThemeMode {
  const i = ORDER.indexOf(mode)
  return ORDER[(i + 1) % ORDER.length] as ThemeMode
}

function modeName(mode: ThemeMode): string {
  return mode === 'system' ? 'system' : mode === 'dark' ? 'dark' : 'light'
}

/**
 * The header theme control. A single icon button that CYCLES the mode through
 * Light → Dark → System (recognition by glyph: Sun / Moon / Monitor). System
 * follows the OS; while it's selected the glyph still previews the resolved
 * light/dark (so the control reflects what actually paints), and the label names
 * both the selection and — for system — the resolved theme. This is the only
 * place that can SET 'system' from the chrome, so a saved system choice survives.
 */
export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme()
  const next = nextMode(theme)
  // While following the system, announce the resolved theme too, so the control
  // is honest about what's painting right now.
  const current = theme === 'system' ? `system (currently ${resolvedTheme})` : modeName(theme)
  const label = `Theme: ${current}. Switch to ${modeName(next)} theme`

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => setTheme(next)}
      aria-label={label}
      title={label}
      className="size-11 text-muted-foreground hover:text-foreground sm:size-10"
    >
      <Suspense fallback={<ModeGlyph mode={theme} />}>
        <ThemeToggleIcon mode={theme} />
      </Suspense>
    </Button>
  )
}

/** The static current glyph (Suspense fallback + reduced-motion path). */
export function ModeGlyph({ mode }: { mode: ThemeMode }) {
  // 'system' reads as a Monitor ("follow OS"); the concrete modes show their own
  // glyph. The resolved-theme preview is carried by the button's label/title.
  const Icon = mode === 'system' ? Monitor : mode === 'dark' ? Moon : Sun
  return (
    <span className="grid place-items-center">
      <Icon className="size-4" />
    </span>
  )
}
