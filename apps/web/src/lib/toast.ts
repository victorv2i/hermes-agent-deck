/**
 * The tiny app-wide toast API. A thin wrapper over `sonner` so call sites import
 * from one place (and sonner stays swappable), and so the semantic variants map
 * to the warm-void governed colors via the themed <Toaster> (lib/Toaster).
 *
 * Toasts are the app's calm, bottom, auto-dismiss feedback channel (design
 * language §8). Use them for the result of an async mutation — "Saved",
 * "Couldn't delete", a copied transcript — not for routine UI state.
 *
 * Usage:
 *   import { toast } from '@/lib/toast'
 *   toast.success('Copied to clipboard')
 *   toast.error('Couldn’t save', { description: err.message })
 */
import { toast as sonner, type ExternalToast } from 'sonner'

export type ToastOptions = ExternalToast

function notify(message: string, opts?: ToastOptions) {
  return sonner(message, opts)
}

/** Calm bottom toaster. Variants map to the governed semantic palette. */
export const toast = Object.assign(notify, {
  success: (message: string, opts?: ToastOptions) => sonner.success(message, opts),
  error: (message: string, opts?: ToastOptions) => sonner.error(message, opts),
  warning: (message: string, opts?: ToastOptions) => sonner.warning(message, opts),
  info: (message: string, opts?: ToastOptions) => sonner.message(message, opts),
  /** Imperatively dismiss a toast by id, or all toasts when called bare. */
  dismiss: (id?: string | number) => sonner.dismiss(id),
})
