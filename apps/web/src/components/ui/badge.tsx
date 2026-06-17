import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'

import { cn } from '@/lib/utils'

/*
  GOVERNED badge vocabulary (color = meaning):
  - `active`  sky-blue, solid — the ONE live/active/primary marker. Brightens on
    hover. (`default` aliases it so existing call sites stay correct.)
  - `muted`   a quiet neutral chip — the everyday metadata pill (no color).
  - `success` / `warning` / `info` / `destructive` — semantic status only,
    rendered as a tinted chip with a same-hue label.
  - `outline` / `secondary` / `ghost` / `link` — structural variants retained.
  The action accent is reserved for `active`; never use it as decoration.
*/
const badgeVariants = cva(
  // tabular-nums (P2.6): badges are the app's numeric chip (counts/metrics) — fixed-width
  // digits stop the chip from shimmying as values change. Harmless for text labels.
  'group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border border-transparent px-2 py-0.5 text-xs font-medium tabular-nums whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ad-focus has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground [a]:hover:bg-primary-hover',
        active: 'bg-primary text-primary-foreground [a]:hover:bg-primary-hover',
        muted: 'bg-muted text-muted-foreground [a]:hover:text-foreground',
        secondary: 'bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80',
        success: 'bg-success/12 text-success [a]:hover:bg-success/20',
        warning: 'bg-warning/12 text-warning [a]:hover:bg-warning/20',
        info: 'bg-info/12 text-info [a]:hover:bg-info/20',
        destructive:
          'bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20',
        outline: 'border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground',
        ghost: 'hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50',
        link: 'text-primary underline-offset-4 hover:underline',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function Badge({
  className,
  variant = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span'

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
