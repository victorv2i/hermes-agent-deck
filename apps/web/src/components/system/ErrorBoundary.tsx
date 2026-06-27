/**
 * Global React error boundary.
 *
 * A surface that throws during render (a bad payload, a programming error)
 * would otherwise blank the entire app. This boundary catches it and shows a
 * calm, on-brand fallback with a way to recover (reload), so the user never
 * faces a white screen of death.
 *
 * React error boundaries must be class components (the only place
 * `componentDidCatch` / `getDerivedStateFromError` exist). The fallback UI is a
 * plain function component themed to the default palette.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ErrorBoundaryProps {
  children: ReactNode
  /** Optional custom fallback; defaults to {@link DefaultFallback}. */
  fallback?: (reset: () => void) => ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface to the console for diagnosis; never leak details into the UI.
    console.error('Unhandled UI error:', error, info.componentStack)
  }

  private reset = (): void => {
    this.setState({ hasError: false })
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return this.props.fallback ? (
        this.props.fallback(this.reset)
      ) : (
        <DefaultFallback onReload={() => window.location.reload()} />
      )
    }
    return this.props.children
  }
}

function DefaultFallback({ onReload }: { onReload: () => void }) {
  return (
    <div
      role="alert"
      className="flex min-h-dvh w-full flex-col items-center justify-center gap-4 bg-background px-6 text-center text-foreground"
    >
      <TriangleAlert className="size-8 text-destructive" aria-hidden />
      <div className="space-y-1.5">
        <h1 className="font-heading text-xl font-medium tracking-tight">Something went wrong</h1>
        <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">
          The app hit an unexpected error. Reloading usually clears it. If it keeps happening, check
          the console for details.
        </p>
      </div>
      <Button variant="outline" onClick={onReload}>
        Reload
      </Button>
    </div>
  )
}
