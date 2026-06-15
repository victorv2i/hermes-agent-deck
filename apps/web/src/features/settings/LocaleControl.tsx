import { Languages } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { useTranslation, LOCALES, type Locale } from '@/i18n'

/**
 * LocaleControl — the in-browser language switcher. It drives the real i18n
 * layer ({@link useTranslation}): selecting a locale switches the active
 * language app-wide and persists the choice to localStorage.
 *
 * HONEST UI: only 'en' ships today, so the radiogroup currently has a single
 * (already-selected) option, and a quiet line states "More languages coming —
 * contributions welcome." The plumbing is real — once a sibling catalog is
 * registered the new option appears here with no further wiring. Nothing here is
 * a fake/placeholder control.
 *
 * Mirrors {@link DensityControl}'s card + radiogroup shape: governed `--primary`
 * marks the active option; the neutral glyph tile is never the accent.
 */

/** Human-readable language names, keyed by locale code. Sourced from the catalog
 * so each name is itself translatable (`locale.name.<code>`). */
const LOCALE_LABEL_KEY = {
  en: 'locale.name.en',
} as const satisfies Record<Locale, `locale.name.${string}`>

export function LocaleControl() {
  const { t, locale, setLocale } = useTranslation()

  return (
    <Card className="ad-raised gap-0 py-0">
      <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-heading text-base leading-snug font-medium text-foreground">
            <span
              aria-hidden
              className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-muted text-muted-foreground"
            >
              <Languages className="size-4" />
            </span>
            {t('settings.locale.title')}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t('settings.locale.description')}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-foreground-tertiary">
            {t('settings.locale.comingSoon')}
          </p>
        </div>

        <div
          role="radiogroup"
          aria-label={t('settings.locale.title')}
          className="ad-surface inline-flex shrink-0 rounded-md bg-surface-1 p-1"
        >
          {LOCALES.map((code) => {
            const checked = locale === code
            return (
              <button
                key={code}
                type="button"
                role="radio"
                aria-checked={checked}
                onClick={() => setLocale(code)}
                className={cn(
                  // min-h-11 keeps a 44px touch target on mobile, relaxed to the
                  // compact density on sm+ (touch-manipulation drops tap delay).
                  'inline-flex min-h-11 touch-manipulation items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-13 font-medium transition-colors sm:min-h-0',
                  'focus-visible:ad-focus',
                  checked
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t(LOCALE_LABEL_KEY[code])}
              </button>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
