import { useMemo, useState, type ReactNode } from 'react'
import {
  Boxes,
  Brain,
  CircleCheckBig,
  Eye,
  Info,
  Layers,
  Loader2,
  Lock,
  PlugZap,
  Search,
  ServerCog,
  Wrench,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { ErrorState, EmptyState } from '@/components/ui/state'
import { formatTokens } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ConnectProviderDialog, type ConnectStatus } from './ConnectProviderDialog'
import { ProviderBrandIcon } from './providerBrandIcons'
import { resolveProviderBrand } from './providerBrands'
import type { AuxiliaryTask, ModelEntry, ModelsResponse, ProviderConnectResult } from './types'

/**
 * The Models surface (read-only, v1). Lists the configured models grouped by
 * vendor family and clearly highlights the active one. Presentational: it takes
 * a status discriminated union so loading / error / empty / success are all
 * exercisable in tests. The route wrapper (ModelsRoute) feeds it from `useModels`.
 *
 * Design language: warm-void teal surfaces, single sky-blue accent for the active
 * model (left bar + tinted row + Active badge), lifted hairline borders, vendor
 * grouping so the list reads as a considered roster — not a dropdown rendered as
 * a page. Calm skeletons (never spinners), generous radius.
 */
/**
 * The "Connect a provider" feature, owned by the route (which holds the mutation)
 * and threaded through so the action is available in every status (you can connect
 * even when the list is empty or errored). Optional so tests/demos can omit it.
 */
export interface ConnectFeature {
  status: ConnectStatus
  result?: ProviderConnectResult
  error?: string
  onConnect: (vars: { provider: string; apiKey: string }) => void
  /** Called when the dialog opens/closes, so the route can reset its mutation. */
  onOpenChange?: (open: boolean) => void
  /**
   * LIVE OAuth-capable provider slugs (from `GET /api/agent-deck/provider-oauth`),
   * so the dialog's browser-sign-in set tracks the running Hermes.
   */
  oauthProviders?: ReadonlySet<string>
  /**
   * Called when OAuth sign-in completes, so the route refreshes the roster (the
   * OAuth mirror of the api-key path's invalidate).
   */
  onOAuthConnected?: (provider: string) => void
  /** Re-probe whether the just-OAuthed provider now reports a usable model. */
  probeOAuthModel?: (provider: string) => Promise<boolean>
}

/**
 * The "Set as active" feature, owned by the route (which holds the
 * `useSetModel` mutation) and threaded down so each usable, non-active model row
 * can switch the active model. `pendingId` is the `qualifiedId` of the model
 * whose switch is in flight (so its row shows a busy state + the others lock out
 * a concurrent switch). Optional so tests/demos can render the page read-only.
 */
export interface SetActiveFeature {
  status: ConnectStatus
  /** The `qualifiedId` whose switch is in flight, when one is. */
  pendingId?: string
  onSetActive: (vars: { provider: string; model: string }) => void
}

export type ModelsPageProps = {
  connect?: ConnectFeature
  setActive?: SetActiveFeature
  /**
   * When true the control renders WITHOUT its full-page chrome (the centered
   * page wrapper + the "Models" PageHeader), so it nests cleanly as the "Model"
   * section inside Settings. The Connect action moves inline above the roster.
   */
  embedded?: boolean
} & (
  | { status: 'pending' }
  | { status: 'error'; onRetry?: () => void }
  | { status: 'success'; data: ModelsResponse }
)

export function ModelsPage(props: ModelsPageProps) {
  const [connectOpen, setConnectOpen] = useState(false)
  const connect = props.connect
  const embedded = props.embedded ?? false

  const setOpen = (next: boolean) => {
    setConnectOpen(next)
    connect?.onOpenChange?.(next)
  }

  const connectButton = connect ? (
    <Button type="button" onClick={() => setOpen(true)}>
      <PlugZap aria-hidden />
      Connect a provider
    </Button>
  ) : undefined

  // Embedded in Settings: no centered page wrapper, no PageHeader — Settings owns
  // the "Model" section header. The Connect action sits inline above the roster.
  const containerClass = embedded
    ? 'flex w-full flex-col'
    : 'mx-auto flex w-full max-w-[760px] flex-col px-6 pt-8 pb-12'

  return (
    <div className={containerClass}>
      {embedded ? (
        connectButton && <div className="mb-4 flex justify-end">{connectButton}</div>
      ) : (
        <PageHeader
          icon={Boxes}
          title="Models"
          subtitle="The models your agent can use. The checked model is the default for new conversations."
          actions={connectButton}
        />
      )}
      {props.status === 'pending' && <LoadingSkeleton />}
      {props.status === 'error' && (
        <ErrorState
          icon={ServerCog}
          title="Couldn’t load models"
          description="Agentdeck reads this list from the agent runtime, which may be offline."
          onRetry={props.onRetry}
          retryLabel="Try again"
        />
      )}
      {props.status === 'success' && (
        <Loaded data={props.data} setActive={props.setActive} hasConnectAction={!!connect} />
      )}
      {connect && (
        <ConnectProviderDialog
          open={connectOpen}
          onOpenChange={setOpen}
          status={connect.status}
          result={connect.result}
          error={connect.error}
          onConnect={connect.onConnect}
          oauthProviders={connect.oauthProviders}
          onOAuthConnected={connect.onOAuthConnected}
          probeOAuthModel={connect.probeOAuthModel}
        />
      )}
    </div>
  )
}

/**
 * The vendor "family" a model belongs to — the prefix of a provider-qualified
 * id (`anthropic/claude-opus-4` → `anthropic`). Falls back to the serving
 * provider so ungrouped ids still land somewhere sensible.
 */
function vendorOf(model: ModelEntry): string {
  const slash = model.id.indexOf('/')
  if (slash > 0) return model.id.slice(0, slash)
  return model.provider || 'other'
}

/** The bare model name with the vendor prefix stripped, for a cleaner row label. */
function shortName(model: ModelEntry): string {
  const slash = model.label.indexOf('/')
  if (slash > 0 && slash < model.label.length - 1) return model.label.slice(slash + 1)
  return model.label
}

function titleCase(s: string): string {
  if (!s) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Map a raw model source slug to a user-facing label, or return an empty string
 * to suppress the subtitle entirely for sources that add no value to newcomers.
 * "hermes", "static", and "built-in" are implementation details — they don't
 * explain anything a non-technical user needs to know.
 */
function humanizeSource(source: string): string {
  if (!source || source === 'static' || source === 'built-in' || source === 'hermes') return ''
  if (source === 'user-config') return 'Added by you'
  if (source === 'current') return ''
  // Canonical / other known sources: drop rather than expose a raw slug.
  return ''
}

interface VendorGroup {
  vendor: string
  models: ModelEntry[]
}

/**
 * Group models by vendor family, sorted so the group holding the active model
 * floats to the top, then alphabetically. Within a group the active model leads.
 */
function groupByVendor(models: ModelEntry[]): VendorGroup[] {
  const byVendor = new Map<string, ModelEntry[]>()
  for (const m of models) {
    const v = vendorOf(m)
    const list = byVendor.get(v)
    if (list) list.push(m)
    else byVendor.set(v, [m])
  }
  const groups: VendorGroup[] = [...byVendor.entries()].map(([vendor, list]) => ({
    vendor,
    models: [...list].sort((a, b) => Number(b.active) - Number(a.active)),
  }))
  groups.sort((a, b) => {
    const aActive = a.models.some((m) => m.active)
    const bActive = b.models.some((m) => m.active)
    if (aActive !== bActive) return aActive ? -1 : 1
    return a.vendor.localeCompare(b.vendor)
  })
  return groups
}

/**
 * Above this many models the list grows long enough (e.g. an OpenRouter roster
 * runs to hundreds) that an unfiltered scroll stops being usable, so we surface
 * a search field. Small rosters stay clean — no control they don't need.
 */
const SEARCH_THRESHOLD = 8

/**
 * Filter models by a free-text query against the model's name, full id, and
 * vendor family, so a user can type "claude", "gpt", "google", or part of an id
 * and narrow the roster. Case-insensitive; an empty query returns everything.
 */
function filterModels(models: ModelEntry[], query: string): ModelEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return models
  return models.filter((m) => {
    const haystack = `${m.label} ${m.id} ${vendorOf(m)} ${m.provider}`.toLowerCase()
    return haystack.includes(q)
  })
}

function Loaded({
  data,
  setActive,
  hasConnectAction = false,
}: {
  data: ModelsResponse
  setActive?: SetActiveFeature
  hasConnectAction?: boolean
}) {
  const [query, setQuery] = useState('')
  const showSearch = data.models.length > SEARCH_THRESHOLD
  const filtered = useMemo(
    () => (showSearch ? filterModels(data.models, query) : data.models),
    [showSearch, data.models, query],
  )

  if (data.models.length === 0) {
    return (
      <EmptyState
        icon={Boxes}
        title="No models configured"
        description={
          hasConnectAction
            ? 'Use Connect a provider to add an API key or sign in. Your agent stores provider credentials; Agentdeck only shows setup status.'
            : 'No models are set up yet. Use "Connect a provider" to add one, or check your agent configuration.'
        }
      />
    )
  }
  const groups = groupByVendor(filtered)
  // A switch is in flight somewhere → lock the OTHER rows' actions out, so a
  // double pick can't race two /model/set calls.
  const switching = setActive?.status === 'submitting'
  return (
    <div className="flex flex-col gap-6">
      {data.providerStatusUnknown && <ProviderStatusBanner />}
      <SummaryStrip data={data} />
      {showSearch && (
        <ModelSearch
          query={query}
          onQueryChange={setQuery}
          total={data.models.length}
          shown={filtered.length}
        />
      )}
      {groups.length === 0 ? (
        <NoMatches query={query} onClear={() => setQuery('')} />
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <ProviderSection
              key={group.vendor}
              group={group}
              setActive={setActive}
              switching={switching}
            />
          ))}
        </div>
      )}
      {data.auxiliary.length > 0 && <AuxiliarySection tasks={data.auxiliary} />}
      <ReadOnlyFooter readOnly={!setActive} />
    </div>
  )
}

/**
 * Search/filter for a long model roster. A quiet, labelled text field with a
 * leading glyph (neutral, never the accent) and a live "showing X of Y" count
 * so the result of a filter is never a mystery. Keyboard + SR reachable; a
 * clear button appears once there is a query to clear.
 */
function ModelSearch({
  query,
  onQueryChange,
  total,
  shown,
}: {
  query: string
  onQueryChange: (next: string) => void
  total: number
  shown: number
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="relative min-w-0 flex-1">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-tertiary"
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search models"
          aria-label="Search models"
          spellCheck={false}
          autoComplete="off"
          className="h-9 w-full min-w-0 rounded-md border border-border bg-card pr-9 pl-9 text-sm text-foreground outline-none transition-colors placeholder:text-foreground-tertiary focus-visible:border-ring focus-visible:ad-focus"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQueryChange('')}
            aria-label="Clear search"
            className="absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 place-items-center rounded-md text-foreground-tertiary transition-colors hover:text-foreground focus-visible:ad-focus"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground" aria-live="polite">
        {query ? (
          <>
            <span className="font-medium text-foreground">{shown}</span> of {total}
          </>
        ) : (
          <>
            <span className="font-medium text-foreground">{total}</span>{' '}
            {total === 1 ? 'model' : 'models'}
          </>
        )}
      </span>
    </div>
  )
}

/** Honest no-results state when a search query matches nothing. */
function NoMatches({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <div
      data-testid="models-no-matches"
      role="status"
      className="ad-surface flex flex-col items-center gap-2 rounded-xl bg-card px-4 py-8 text-center"
    >
      <Search className="size-5 text-foreground-tertiary" aria-hidden />
      <p className="text-sm text-muted-foreground">
        No models match <span className="font-medium text-foreground">{query}</span>.
      </p>
      <Button type="button" variant="outline" size="sm" onClick={onClear}>
        Clear search
      </Button>
    </div>
  )
}

/**
 * One provider section: the vendor's REAL brand mark (identity — neutral, never
 * the sky-blue accent) + its label, with the vendor's models listed beneath, so the
 * roster reads by provider at a glance. An unknown vendor falls back to a neutral
 * monogram mark + the raw slug (titlecased), never a garbled logo.
 */
function ProviderSection({
  group,
  setActive,
  switching,
}: {
  group: VendorGroup
  setActive?: SetActiveFeature
  switching: boolean
}) {
  const brand = resolveProviderBrand(group.vendor)
  // A real brand carries its proper name (e.g. "OpenAI", "xAI"); a monogram
  // fallback shows the raw vendor slug, titlecased.
  const heading = brand.isFallback ? titleCase(group.vendor) : brand.label
  return (
    <section role="region" aria-label={`${heading} models`}>
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <h2 className="ad-section-label flex items-center gap-2">
          <span
            data-testid={`provider-mark-${group.vendor}`}
            className="grid size-[18px] shrink-0 place-items-center text-muted-foreground"
          >
            <ProviderBrandIcon provider={group.vendor} size={16} />
          </span>
          {heading}
        </h2>
        <span className="text-xs tabular-nums text-foreground-tertiary">{group.models.length}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {group.models.map((m) => (
          <ModelRow key={m.qualifiedId} model={m} setActive={setActive} switching={switching} />
        ))}
      </div>
    </section>
  )
}

/**
 * Honest fail-open notice: the BFF couldn't verify provider status (the
 * `/api/providers/oauth` probe failed), so per-model `usable` flags failed OPEN
 * — every model is shown as usable rather than disabling everything off a
 * transient error. We say so plainly instead of presenting unverified usability
 * as truth. A SEMANTIC info indicator (not the sky-blue action accent), dismissible
 * by the user. Reduced-motion safe (no animation); keyboard + SR reachable.
 */
function ProviderStatusBanner() {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null
  return (
    <div
      data-testid="provider-status-unknown"
      role="status"
      className="ad-surface flex items-start gap-2.5 rounded-xl bg-card px-4 py-3 text-sm"
    >
      <Info className="mt-px size-4 shrink-0 text-info" aria-hidden />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium text-foreground">Provider status couldn’t be verified</span>
        <span className="text-muted-foreground">
          The provider sign-in check didn’t respond, so some models may not actually be usable. The
          list is shown anyway; a switch that can’t connect will report the failure.
        </span>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="-mr-1 -mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md text-foreground-tertiary transition-colors hover:text-foreground focus-visible:ad-focus"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  )
}

/**
 * Serving provider · context window · active-model capabilities · model count,
 * as quiet metadata. No accent decoration. Capabilities + the effective context
 * window come from stock's `/api/model/info`; a chip is shown only when its
 * capability is true. The context window is humanized ("200K").
 */
function SummaryStrip({ data }: { data: ModelsResponse }) {
  const caps = data.capabilities
  const contextTokens = caps.effectiveContextLength || caps.contextWindow
  const capChips: Array<{ key: string; icon: ReactNode; label: string }> = []
  if (caps.supportsTools)
    capChips.push({ key: 'tools', icon: <Wrench className="size-3" aria-hidden />, label: 'Tools' })
  if (caps.supportsVision)
    capChips.push({ key: 'vision', icon: <Eye className="size-3" aria-hidden />, label: 'Vision' })
  if (caps.supportsReasoning)
    capChips.push({
      key: 'reasoning',
      icon: <Brain className="size-3" aria-hidden />,
      label: 'Reasoning',
    })

  return (
    <div className="ad-surface flex flex-col gap-3 rounded-xl bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <MetaItem icon={<ServerCog className="size-3.5" aria-hidden />} label="Provider">
          {data.provider.label}
        </MetaItem>
        {contextTokens > 0 && (
          <MetaItem icon={<Layers className="size-3.5" aria-hidden />} label="Context">
            {formatTokens(contextTokens)}
          </MetaItem>
        )}
        <span className="ml-auto text-sm text-muted-foreground">
          <span className="font-medium tabular-nums text-foreground">{data.models.length}</span>{' '}
          {data.models.length === 1 ? 'model' : 'models'}
        </span>
      </div>
      {capChips.length > 0 && (
        <div data-testid="model-capabilities" className="flex flex-wrap items-center gap-1.5">
          {capChips.map((c) => (
            <span
              key={c.key}
              className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
            >
              <span className="text-foreground-tertiary">{c.icon}</span>
              {c.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function MetaItem({
  icon,
  label,
  children,
}: {
  icon: ReactNode
  label: string
  children: ReactNode
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className="text-foreground-tertiary">{icon}</span>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium capitalize text-foreground">{children}</span>
    </span>
  )
}

function ModelRow({
  model,
  setActive,
  switching,
}: {
  model: ModelEntry
  setActive?: SetActiveFeature
  /** True while ANY model's switch is in flight (locks out a concurrent switch). */
  switching?: boolean
}) {
  const thisPending =
    setActive?.pendingId === model.qualifiedId && setActive?.status === 'submitting'
  return (
    <div
      data-testid={`model-row-${model.id}`}
      data-active={model.active ? 'true' : 'false'}
      className={cn(
        // active rows carry a 3px left sky-blue accent bar via ::before
        'relative flex items-center justify-between gap-3 overflow-hidden rounded-md px-4 py-3 transition-colors',
        model.active
          ? "bg-primary/[0.07] before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-primary before:content-['']"
          : 'ad-surface ad-surface-hover bg-card',
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden
          className={cn(
            'inline-block size-2 shrink-0 rounded-full',
            model.active ? 'bg-primary' : 'bg-foreground/25',
          )}
        />
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-mono text-sm text-foreground">{shortName(model)}</span>
          {model.active && (
            <span className="truncate text-xs text-muted-foreground">Active default</span>
          )}
          {!model.active && humanizeSource(model.source) && (
            <span className="truncate text-xs text-foreground-tertiary">
              {humanizeSource(model.source)}
            </span>
          )}
        </div>
      </div>
      {model.active ? (
        <Badge variant="active" className="shrink-0 gap-1">
          <CircleCheckBig className="size-3" aria-hidden />
          Active
        </Badge>
      ) : setActive ? (
        <SetActiveButton
          model={model}
          feature={setActive}
          pending={thisPending}
          // Lock out while a DIFFERENT row's switch is mid-flight.
          locked={!!switching && !thisPending}
        />
      ) : null}
    </div>
  )
}

/**
 * The Models page's primary action on a non-active row: switch the active model
 * (the previously-missing affordance). A USABLE model gets a real "Set as active"
 * button (the single sky-blue action accent); a NON-usable model is honestly
 * DISABLED with a "Connect <provider>" label — never a switch that can only fail.
 */
function SetActiveButton({
  model,
  feature,
  pending,
  locked,
}: {
  model: ModelEntry
  feature: SetActiveFeature
  pending: boolean
  locked: boolean
}) {
  if (!model.usable) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled
        title={`Connect ${model.provider} to use this model`}
        aria-label={`Connect ${model.provider} to use this model`}
        className="shrink-0"
      >
        <Lock aria-hidden />
        Connect {model.provider}
      </Button>
    )
  }
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending || locked}
      aria-busy={pending || undefined}
      onClick={() => feature.onSetActive({ provider: model.provider, model: model.id })}
      className="shrink-0"
    >
      {pending ? (
        <>
          <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
          Switching...
        </>
      ) : (
        'Set as active'
      )}
    </Button>
  )
}

/**
 * The auxiliary task assignments (hermes signature slots — vision / compression /
 * delegation / title / triage / …). Read-only, quiet metadata: each slot shows
 * its humanized name and either an explicit model id or "Main model" when the
 * slot follows the main model (provider `auto` + empty model).
 */
function AuxiliarySection({ tasks }: { tasks: AuxiliaryTask[] }) {
  return (
    <section data-testid="auxiliary-models" aria-label="Secondary task models">
      <div className="mb-2 flex items-start justify-between gap-3 px-1">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="ad-section-label">Secondary task models</h2>
          <p className="text-xs text-muted-foreground">
            Used for specific tasks like vision, compression, and summarization. Most slots follow
            the main model.
          </p>
        </div>
        <span className="text-xs tabular-nums text-foreground-tertiary">{tasks.length}</span>
      </div>
      <div className="ad-surface flex flex-col divide-y divide-border rounded-xl bg-card">
        {tasks.map((t) => {
          const followsMain = t.model === '' || t.provider === 'auto'
          return (
            <div
              key={t.task}
              className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
            >
              <span className="truncate text-muted-foreground">{humanizeSlot(t.task)}</span>
              <span
                title={followsMain ? undefined : t.model}
                className="min-w-0 truncate text-right font-mono text-xs text-foreground-tertiary"
              >
                {followsMain ? 'Main model' : `${t.model}`}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

/** Humanize an auxiliary slot name: `title_generation` → `Title generation`. */
function humanizeSlot(slot: string): string {
  const spaced = slot.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function ReadOnlyFooter({ readOnly }: { readOnly: boolean }) {
  return (
    <p className="mt-1 flex items-start gap-2 border-t border-border pt-4 text-xs text-foreground-tertiary">
      <Info className="mt-px size-3.5 shrink-0" aria-hidden />
      <span>
        {readOnly ? (
          <>
            This list is read-only. Pick the model for a run from the composer’s model selector, or
            change the default in your agent configuration.
          </>
        ) : (
          <>
            Set any usable model as the active default here, or pick the model for a single run from
            the composer’s model selector.
          </>
        )}
      </span>
    </p>
  )
}

function LoadingSkeleton() {
  return (
    <div data-testid="models-skeleton" className="flex flex-col gap-6" aria-hidden>
      <div className="h-[52px] animate-pulse rounded-xl bg-foreground/[0.06] ring-1 ring-border" />
      <div className="flex flex-col gap-5">
        {[0, 1].map((g) => (
          <div key={g} className="flex flex-col gap-2">
            <div className="h-3 w-24 animate-pulse rounded bg-foreground/[0.06]" />
            <div className="flex flex-col gap-1.5">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-[56px] animate-pulse rounded-md bg-foreground/[0.06] ring-1 ring-border"
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
