import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Input — the one themed text-field primitive (none existed; the New-agent
 * ceremony's name field is its first consumer). A native `<input>` styled with
 * the warm-void tokens: hairline border, layered surface, the governed
 * focus-visible ring (`--ring`, reserved for focus only). `aria-invalid` paints
 * the destructive ring so live validation reads without a second accent. The
 * sky-blue `--primary` is NEVER used here — text entry is not an action accent.
 */
export type InputProps = React.ComponentProps<'input'>

export function Input({ className, type = 'text', ...props }: InputProps) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'ad-surface flex h-10 w-full min-w-0 touch-manipulation rounded-lg bg-surface-1 px-3 py-2 text-sm text-foreground shadow-xs transition-[color,box-shadow] outline-none',
        'placeholder:text-foreground-tertiary',
        // The ONE canonical focus ring (.ad-focus) — shared by every primitive.
        'focus-visible:border-ring focus-visible:ad-focus',
        'disabled:pointer-events-none disabled:opacity-50',
        'aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20',
        className,
      )}
      {...props}
    />
  )
}
