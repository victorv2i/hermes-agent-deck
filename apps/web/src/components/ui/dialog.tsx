import * as React from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { X } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * Themed Dialog primitives on radix-ui's Dialog (keyboard + focus-trap + ARIA
 * built in). Re-styled to the warm-void palette — hairline border, layered
 * popover surface, soft elevation, generous radius. The overlay/content use
 * `tw-animate-css` fade/zoom classes which are no-ops under
 * `prefers-reduced-motion` (the utility honors the media query), so motion is
 * respected for free.
 */

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-black/55',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
        className,
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showClose = true,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { showClose?: boolean }) {
  // Consumers open dialogs CONTROLLED, without a <DialogTrigger> (the command
  // palette, New Agent, the row-action popover). Radix only snapshots the opener
  // when its OWN Trigger is used, and a parent re-render can swap the node Radix
  // snapshotted, so on close it can't restore focus and it falls to <body>
  // (WCAG 2.4.3). We snapshot the focused element ourselves in onOpenAutoFocus
  // (which Radix fires while the opener is still focused, just before it moves
  // focus into the dialog) and restore it in onCloseAutoFocus.
  const openerRef = React.useRef<HTMLElement | null>(null)
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        onOpenAutoFocus={(event) => {
          // Capture the opener BEFORE Radix moves focus inward. Compose any
          // consumer handler first; if it opts out (preventDefault) we still want
          // our snapshot, so we capture regardless.
          const active = document.activeElement
          openerRef.current =
            active instanceof HTMLElement && active !== document.body ? active : null
          onOpenAutoFocus?.(event)
        }}
        // Restore focus to the captured opener on close (preventDefault so Radix
        // doesn't first send it to <body>). Compose any consumer handler: theirs
        // runs first and can preventDefault to opt out of our restore.
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event)
          if (event.defaultPrevented) return
          event.preventDefault()
          const opener = openerRef.current
          if (opener && opener.isConnected) {
            opener.focus()
          } else {
            // Fallback: keep focus in the document (not on <body>) so keyboard
            // users keep a sane tab origin even if the opener is gone.
            const fallback = document.querySelector<HTMLElement>('#main-content')
            fallback?.focus()
          }
        }}
        className={cn(
          'fixed top-[clamp(3rem,15vh,8rem)] left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 gap-4',
          // Never exceed the viewport on short/mobile-landscape screens — the body
          // scrolls inside the dialog so action rows always stay reachable.
          'max-h-[calc(100dvh-9rem)] overflow-y-auto overscroll-contain',
          // Shared, theme-aware elevation token (P0.3/P0.4) — softer under light themes.
          'rounded-xl border border-border bg-popover p-5 text-popover-foreground shadow-popover',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
          'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
          className,
        )}
        {...props}
      >
        {children}
        {showClose && (
          <DialogPrimitive.Close
            className="absolute top-2.5 right-2.5 grid size-11 touch-manipulation place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ad-focus"
            aria-label="Close"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex flex-col gap-1.5 text-left', className)}
      {...props}
    />
  )
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('font-heading text-base font-medium text-foreground', className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
