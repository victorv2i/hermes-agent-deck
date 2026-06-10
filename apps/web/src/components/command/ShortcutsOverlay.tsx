import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { useTranslation, type TranslateFn } from '@/i18n'
import { usePlatformModKey } from './platformMod'

/**
 * The keyboard-shortcuts reference (opened with `?`). A calm, scannable map of
 * every global binding so the app feels learnable. Mirrors design-language §8.
 *
 * The modifier accelerator (⌘ on Mac, Ctrl elsewhere) comes from the shared
 * {@link usePlatformModKey} helper — the SAME source the ⌘K command palette
 * reads, so the two surfaces never disagree about which key it is.
 */

interface Shortcut {
  keys: string[]
  label: string
}

function shortcuts(mod: string, t: TranslateFn): Shortcut[] {
  return [
    { keys: [mod, 'K'], label: t('shortcutsOverlay.shortcut.commandPalette') },
    { keys: [mod, '⇧', 'V'], label: t('shortcutsOverlay.shortcut.togglePreviewPanel') },
    { keys: [mod, 'B'], label: t('shortcutsOverlay.shortcut.toggleSessionsPane') },
    { keys: [mod, 'N'], label: t('shortcutsOverlay.shortcut.newChat') },
    { keys: ['j', 'k'], label: t('shortcutsOverlay.shortcut.moveThroughSessions') },
    { keys: ['↵'], label: t('shortcutsOverlay.shortcut.openFocusedSession') },
    { keys: ['/'], label: t('shortcutsOverlay.shortcut.openComposerCommandMenu') },
    { keys: ['Esc'], label: t('shortcutsOverlay.shortcut.abortOrClose') },
    { keys: ['?'], label: t('shortcutsOverlay.shortcut.showReference') },
  ]
}

export function ShortcutsOverlay({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const mod = usePlatformModKey()
  const { t } = useTranslation()
  const SHORTCUTS = shortcuts(mod, t)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('shortcutsOverlay.title')}</DialogTitle>
          <DialogDescription>{t('shortcutsOverlay.description')}</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col divide-y divide-border">
          {SHORTCUTS.map((s) => (
            <li key={s.label} className="flex min-w-0 items-center justify-between gap-4 py-2.5">
              <span className="min-w-0 text-sm text-foreground/90 [overflow-wrap:anywhere]">
                {s.label}
              </span>
              <span
                className="flex shrink-0 flex-wrap items-center justify-end gap-1"
                aria-label={s.keys.join(' ')}
              >
                {s.keys.map((k) => (
                  <kbd
                    key={k}
                    className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-border bg-muted px-1.5 font-mono text-[11px] text-muted-foreground"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
