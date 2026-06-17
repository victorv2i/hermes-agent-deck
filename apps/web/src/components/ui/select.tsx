import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export type SelectProps = React.ComponentProps<'select'>

/**
 * Select — the one themed dropdown: a native `<select>` (fully accessible and
 * keyboard-operable by default) wearing the shared Input chrome (hairline
 * surface, the canonical `.ad-focus` ring) with a neutral chevron. Extracted
 * from the hand-rolled `SELECT_CLASS` copies in the Voice / Models surfaces so
 * every dropdown looks and focuses identically. Pass `<option>`s as children.
 * The sky-blue `--primary` is never used here — choosing a value is not an action.
 */
export function Select({ className, children, ...props }: SelectProps) {
  return (
    <div className="relative">
      <select
        data-slot="select"
        className={cn(
          'ad-surface h-10 w-full min-w-0 cursor-pointer touch-manipulation appearance-none rounded-lg bg-surface-1 py-2 pr-9 pl-3 text-sm text-foreground shadow-xs transition-[color,box-shadow] outline-none',
          'focus-visible:border-ring focus-visible:ad-focus',
          'disabled:cursor-not-allowed disabled:opacity-60',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-2.5 my-auto size-4 text-foreground-tertiary"
      />
    </div>
  )
}
