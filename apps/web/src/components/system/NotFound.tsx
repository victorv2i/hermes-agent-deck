/**
 * Catch-all 404 surface. Rendered by the router for any unmatched path inside
 * the app shell, so an unknown URL shows a calm, on-brand "not found" with a way
 * back home — never a blank page.
 */
import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function NotFound() {
  return (
    <div className="flex min-h-full w-full flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <Compass className="size-8 text-foreground-tertiary" aria-hidden />
      <div className="space-y-1.5">
        <h1 className="font-heading text-xl font-medium tracking-tight text-foreground">
          Page not found
        </h1>
        <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">
          We couldn’t find that page. It may have moved, or the link might be wrong.
        </p>
      </div>
      <Button asChild variant="outline">
        <Link to="/">Back to home</Link>
      </Button>
    </div>
  )
}
