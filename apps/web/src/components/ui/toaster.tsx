/**
 * The app's calm bottom toaster — sonner themed to the Refined Warm-Void system.
 *
 * Sonner reads CSS custom properties off the toaster element for its colors; we
 * map those onto the design tokens (card surface, lifted border, semantic
 * palette) so toasts match the rest of the app in BOTH themes, and drive its
 * `theme` from the ThemeProvider so it flips with the app. Bottom-center,
 * auto-dismiss, restrained — per design language §8.
 *
 * Semantic variants (`toast.success/error/...`) use sonner's `richColors` so the
 * tinted bg/border come from `--success`/`--destructive`/`--warning`/`--info` —
 * the governed semantic palette. Amber is intentionally NOT a toast color: it
 * stays reserved for primary action / live state.
 */
import { Toaster as SonnerToaster } from 'sonner'
import type { CSSProperties } from 'react'
import { useTheme } from '@/components/theme/theme-context'

// Warm-void surface mapping. These vars resolve against the active theme's
// tokens, so the same component themes both dark and light correctly.
const warmVoidStyle = {
  // Neutral (default) toast.
  '--normal-bg': 'var(--popover)',
  '--normal-text': 'var(--popover-foreground)',
  '--normal-border': 'var(--border-strong)',
  // Semantic (richColors) toasts → governed semantic palette, tinted.
  '--success-bg': 'color-mix(in oklch, var(--success) 14%, var(--popover))',
  '--success-text': 'var(--popover-foreground)',
  '--success-border': 'color-mix(in oklch, var(--success) 40%, var(--border-strong))',
  '--error-bg': 'color-mix(in oklch, var(--destructive) 14%, var(--popover))',
  '--error-text': 'var(--popover-foreground)',
  '--error-border': 'color-mix(in oklch, var(--destructive) 40%, var(--border-strong))',
  '--warning-bg': 'color-mix(in oklch, var(--warning) 14%, var(--popover))',
  '--warning-text': 'var(--popover-foreground)',
  '--warning-border': 'color-mix(in oklch, var(--warning) 40%, var(--border-strong))',
  '--info-bg': 'color-mix(in oklch, var(--info) 14%, var(--popover))',
  '--info-text': 'var(--popover-foreground)',
  '--info-border': 'color-mix(in oklch, var(--info) 40%, var(--border-strong))',
} as CSSProperties

export function Toaster() {
  const { resolvedTheme } = useTheme()

  return (
    <SonnerToaster
      theme={resolvedTheme}
      position="bottom-center"
      richColors
      closeButton
      gap={10}
      visibleToasts={4}
      style={warmVoidStyle}
      toastOptions={{
        duration: 4000,
        classNames: {
          toast:
            // Shared, theme-aware elevation token (P0.3/P0.4) — softer under light themes.
            'ad-surface !rounded-xl !border !text-[13px] !shadow-popover !font-sans',
          title: '!font-medium',
          description: '!text-muted-foreground',
          closeButton: '!bg-transparent !border-border hover:!bg-muted',
        },
      }}
    />
  )
}
