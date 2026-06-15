import { Check, Loader2, RotateCcw, ServerCog } from 'lucide-react'
import type { ModelOptionsResponse } from '@agent-deck/protocol'
import { Badge } from '@/components/ui/badge'
import { ErrorState } from '@/components/ui/state'
import { cn } from '@/lib/utils'

/**
 * ModelSection — the per-agent model picker in the Studio workbench. Reads the
 * profile-scoped `GET /api/model/options` shape and writes through the per-profile
 * model route (`PUT /api/profiles/{name}/model`), which clears stale
 * base_url/context_length on Hermes's side (preferred over patching config).
 *
 * Presentational: the options/loading/error + the `onSet` write arrive as props,
 * so the route owns the scoped query/mutation and this stays hermetically
 * testable. The chosen model is the single amber-accented "on" state (per the
 * design spine); everything else is neutral. The config takes effect on the
 * profile's NEXT session, so an honest restart line rides the header (never a
 * fake instant activation).
 */
export interface ModelSectionProps {
  options: ModelOptionsResponse | undefined
  isLoading: boolean
  error: string | null
  /** Set the agent's provider + model. The route runs the scoped mutation. */
  onSet: (next: { provider: string; model: string }) => void | Promise<void>
  /** True while a set is in flight (locks the picker, shows a spinner). */
  isSetting?: boolean
}

export function ModelSection({
  options,
  isLoading,
  error,
  onSet,
  isSetting = false,
}: ModelSectionProps) {
  if (error) {
    return (
      <ErrorState
        icon={ServerCog}
        title="Couldn't load models"
        description={error}
        className="items-start px-4 py-5 text-left"
      />
    )
  }
  if (isLoading || !options) return <ModelSkeleton />

  const providers = options.providers
  return (
    <div className="flex flex-col gap-4">
      <div
        data-testid="studio-model-current"
        className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-13"
      >
        <span className="text-foreground-tertiary">Current model</span>
        {options.model ? (
          <span className="font-mono font-medium text-foreground">{options.model}</span>
        ) : (
          <span className="text-foreground-tertiary">none selected</span>
        )}
        {options.provider ? (
          <Badge variant="muted" className="font-mono">
            {options.provider}
          </Badge>
        ) : null}
        {isSetting && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />}
      </div>

      {/* Config applies on the agent's NEXT session, so the running gateway must
          restart to pick up a model change. One honest line, never fake instant. */}
      <p className="inline-flex items-center gap-1.5 text-xs text-foreground-tertiary">
        <RotateCcw className="size-3 shrink-0" aria-hidden />
        Restart your agent to apply a model change.
      </p>

      {providers.length === 0 ? (
        <p className="text-sm text-foreground-tertiary">
          No providers are configured yet. Add a provider key on the Env section or in Connections.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {providers.map((p) => (
            <li
              key={p.slug}
              data-testid={`studio-model-provider-${p.slug}`}
              className="ad-surface rounded-xl bg-card px-4 py-3.5"
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-13 font-medium text-foreground">{p.name}</span>
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                  {p.slug}
                </code>
                {p.is_current && (
                  <Badge variant="outline" className="gap-1">
                    Current
                  </Badge>
                )}
                {p.authenticated === false && (
                  <Badge variant="muted" className="text-[10px]">
                    Not configured
                  </Badge>
                )}
              </div>
              {p.models.length === 0 ? (
                <p className="text-xs text-foreground-tertiary">
                  {p.warning ?? 'No models available for this provider yet.'}
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {p.models.map((model) => {
                    const isActive =
                      options.provider === p.slug && options.model === model
                    return (
                      <button
                        key={model}
                        type="button"
                        aria-pressed={isActive}
                        disabled={isSetting || isActive}
                        data-testid={`studio-model-${p.slug}-${model}`}
                        onClick={() => void onSet({ provider: p.slug, model })}
                        className={cn(
                          'inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 py-1 font-mono text-[12px] transition-colors',
                          'focus-visible:ad-focus disabled:cursor-default',
                          isActive
                            ? 'bg-primary/12 text-primary'
                            : 'bg-surface-1 text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {isActive && <Check className="size-3.5" aria-hidden />}
                        {model}
                      </button>
                    )
                  })}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ModelSkeleton() {
  return (
    <div data-testid="studio-model-skeleton" className="flex flex-col gap-3" aria-hidden>
      {[0, 1].map((i) => (
        <div key={i} className="h-20 animate-pulse rounded-xl bg-foreground/[0.06] ring-1 ring-border" />
      ))}
    </div>
  )
}
