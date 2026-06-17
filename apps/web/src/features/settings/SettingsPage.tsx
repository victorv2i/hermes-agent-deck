import { createElement, useId, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowRight,
  Bot,
  Braces,
  Brain,
  ChevronDown,
  KeyRound,
  Lock,
  MessageSquare,
  Mic,
  Plug,
  ScrollText,
  Search,
  Settings2,
  Shield,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  Wrench,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { NotificationsControl } from '@/components/notifications'
import { PageHeader } from '@/components/ui/page-header'
import { useTranslation } from '@/i18n'
import { ErrorState, EmptyState } from '@/components/ui/state'
import { cn } from '@/lib/utils'
import { useSettings } from './useSettings'
import { PaletteControl } from './PaletteControl'
import { DensityControl } from './DensityControl'
import { LocaleControl } from './LocaleControl'
import { ReasoningVerbosityControl } from './ReasoningVerbosityControl'
import { ComposerPrefsControl } from './ComposerPrefsControl'
import { BudgetControl } from './BudgetControl'
import { ModelSection } from './ModelSection'
import { EditableConfigField } from './EditableConfigField'
import { isEditableField } from './editableConfig'
import { DedicatedConfigLink, ReadOnlyMarker } from './DedicatedConfigLink'
import { splitDedicatedSections, type DedicatedDomainId } from './dedicatedConfig'
import {
  filterSections,
  formatValue,
  isUnset,
  listItems,
  prettyCategory,
  prettyLabel,
  UNSET,
} from './format'
import type { SettingsField, SettingsSection } from './types'

/**
 * Sections with more fields than this start collapsed so the page opens scannable
 * rather than as one long scroll. Small sections stay open. A field-level search
 * overrides collapse for any matched section (T2.8).
 */
const COLLAPSE_THRESHOLD = 6

/**
 * Settings surface (`/settings`) — a calm, read-only view of the hermes
 * configuration grouped into designed Cards. Values come from the BFF with every
 * secret already redacted; the page never renders a raw credential, and secret
 * rows carry an explicit "Secret" marker so it's obvious what is masked.
 *
 * Design language: centered hero column, layered surface cards with a real
 * section header (Lucide icon + readable title), hairline-divided rows where the
 * label + description live on the left and the value breathes on the right
 * (wraps / chips instead of truncating). Empty values read as a muted "Not set",
 * never a bare em-dash. The action accent is reserved for the secret affordance per the
 * accent-governance rules. Loading uses skeletons, never spinners.
 */
export function SettingsPage() {
  const { t } = useTranslation()
  const { status, data, error, reload } = useSettings()
  const [query, setQuery] = useState('')

  const rawSections = useMemo(() => data?.sections ?? [], [data])
  // The active model/provider are surfaced by the dedicated Model section (the
  // picker), so we lift those top-level keys out of the generic config rows to
  // kill the duplication.
  // The coherence rule: domains that already own a dedicated surface (Voice,
  // Messaging, MCP, the agent's Brain/Memory) are LIFTED out of the dump and shown
  // as a single "Configured on the X page →" link instead of being duplicated.
  // Auxiliary model rows fold into the Model section. This split also feeds the
  // search path, so a dropped row can't reappear on search.
  const { sections, dropped } = useMemo(() => {
    const noModel = withoutModelRows(rawSections)
    const { kept, dropped } = splitDedicatedSections(noModel)
    return { sections: kept, dropped }
  }, [rawSections])
  const searching = query.trim() !== ''
  const filtered = useMemo(() => filterSections(sections, query), [sections, query])

  return (
    <div className="mx-auto w-full max-w-[920px] px-6 py-10 md:px-8">
      <PageHeader
        icon={SlidersHorizontal}
        title={t('settings.title')}
        subtitle={t('settings.subtitle')}
      />

      {/* GROUP 1 — "Your preferences": local, in-browser settings (theme, density,
          reasoning, composer, cost). Independent of the config load, so they're
          reachable even while the agent config is loading or errored. */}
      <GroupHeader
        title={t('settings.group.preferences.title')}
        description={t('settings.group.preferences.description')}
      />
      <div className="mb-8 flex flex-col gap-6">
        <PaletteControl />
        <DensityControl />
        <LocaleControl />
        <ReasoningVerbosityControl />
        <ComposerPrefsControl />
        <NotificationsControl />
        <BudgetControl />
        {/* Maintenance & logs — System (gateway restart + Hermes update) and the
            raw Logs surface were demoted out of the top-level rail; this is their
            home in Settings so they stay reachable (also in ⌘K). */}
        <MaintenanceLink />
      </div>

      {/* GROUP 2 — "Agent config": the hermes configuration. A short allowlist of
          safe scalar fields is editable here; the rest is read-only with an
          honest pointer to where it IS editable. */}
      <GroupHeader
        title={t('settings.group.agentConfig.title')}
        description={t('settings.group.agentConfig.description')}
      />

      <AgentConfigNotice />

      {/* The Model section — the active-model picker + provider connect + the
          auxiliary/task model assignments, folded in from the retired standalone
          /models page. It self-manages its own load (via useModels), so it renders
          regardless of the settings-config status. */}
      <div className="mb-6">
        <ModelSection />
      </div>

      {status === 'ready' && dropped.length > 0 && (
        <div className="mb-6 flex flex-col gap-3">
          {dropped.map((id) => {
            const link = DEDICATED_LINKS[id]
            return (
              <DedicatedConfigLink
                key={id}
                icon={link.icon}
                title={link.title}
                description={link.description}
                to={link.to}
                linkLabel={link.linkLabel}
              />
            )
          })}
        </div>
      )}

      {status === 'loading' && <SettingsSkeleton />}

      {status === 'error' && (
        <ErrorState
          icon={TriangleAlert}
          title="Couldn't load configuration"
          description={
            error?.message
              ? `Your agent didn't respond. (${error.message})`
              : "Your agent didn't respond."
          }
          onRetry={reload}
        />
      )}

      {status === 'ready' && data && (
        <div className="flex flex-col gap-6">
          {sections.length === 0 ? (
            <EmptyState
              icon={SlidersHorizontal}
              title="No configuration to show"
              description="Once your agent's configuration has values, they'll appear here grouped by section."
            />
          ) : (
            <>
              <SettingsSearch value={query} onChange={setQuery} />
              {filtered.length === 0 ? (
                <EmptyState
                  icon={Search}
                  title="No settings match your search"
                  description={
                    <>
                      Nothing matched "{query.trim()}". Try a different key, label, or section name.
                    </>
                  }
                />
              ) : (
                filtered.map((section) => (
                  <SectionCard key={section.category} section={section} searching={searching} />
                ))
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * The settings filter — a scoped search input (no shared Input primitive in this
 * surface dir) styled to the warm-void tokens with the governed sky-blue focus ring.
 * Filters across field key/label/description and the section name.
 */
function SettingsSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const id = useId()
  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-tertiary"
        aria-hidden
      />
      <Input
        id={id}
        type="search"
        role="searchbox"
        aria-label="Search settings"
        placeholder="Search settings…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-card pr-3 pl-9"
      />
    </div>
  )
}

/**
 * A convenience path to the Maintenance dock (`/system`) + raw Logs (`/logs`).
 * System is a visible rail row again; Logs stays off the rail, so this card (and
 * ⌘K) is how you reach it. Two calm links out (System restarts the gateway +
 * updates Hermes; Logs is the raw output): navigation, not config, so no
 * "Read-only" marker. Neutral glyph tile (decoration is never the sky-blue accent);
 * the accent stays on the focus rings.
 */
function MaintenanceLink() {
  return (
    <Card className="ad-raised gap-0 py-0">
      <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3 p-5">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span
            aria-hidden
            className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-muted text-muted-foreground"
          >
            <Wrench className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Maintenance &amp; logs</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              Restart your agent, check for updates, and read the raw logs.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            to="/system"
            className="ad-surface ad-surface-hover inline-flex items-center gap-1.5 rounded-md bg-card px-3 py-2 text-13 font-medium text-foreground transition-colors focus-visible:ad-focus"
          >
            <Wrench className="size-3.5" aria-hidden />
            System
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
          <Link
            to="/logs"
            className="ad-surface ad-surface-hover inline-flex items-center gap-1.5 rounded-md bg-card px-3 py-2 text-13 font-medium text-foreground transition-colors focus-visible:ad-focus"
          >
            <ScrollText className="size-3.5" aria-hidden />
            Logs
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}

/** A section-group heading that splits the surface into "Your preferences" vs
 * "Agent config". Quiet, non-accent — pure structure. */
function GroupHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-3">
      <h2 className="ad-section-label">{title}</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
    </div>
  )
}

/**
 * The HONEST framing for the agent-config group: it explains that a couple of
 * safe fields are editable inline, and points at where the REST is editable —
 * the `hermes config` CLI command (and the native hermes dashboard). No fake
 * control, no dead-end: a clear, copyable pointer to the real editing surface.
 */
function AgentConfigNotice() {
  return (
    <div className="mb-6 flex items-start gap-2.5 rounded-md bg-surface-1 px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
      <Lock className="mt-px size-3.5 shrink-0 text-foreground-tertiary" aria-hidden />
      <p>
        Fields with an <span className="font-medium text-foreground">Edit</span> button can be
        changed here and save straight to your agent's configuration. Everything else is read-only;
        edit it with{' '}
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
          hermes config
        </code>{' '}
        from a terminal, or in the native agent dashboard. Secrets are masked and never leave the
        server.
      </p>
    </div>
  )
}

/** The top-level config keys the dedicated Active-model card owns — lifted out of
 * the generic rows so the model/provider aren't shown twice. Case-insensitive,
 * exact match only (so nested keys like `auxiliary.vision.model` are untouched). */
const MODEL_ROW_KEYS = new Set(['model', 'provider'])

function isModelRowKey(key: string): boolean {
  return MODEL_ROW_KEYS.has(key.toLowerCase())
}

/** Where each dedicated domain actually lives — the copy + destination for the
 * "Configured on the X page →" link Settings shows instead of duplicating it.
 * Model/provider has its own richer Active-model row; auxiliary models fold into
 * that row's note (so they aren't a domain here). */
const DEDICATED_LINKS: Record<
  DedicatedDomainId,
  { icon: LucideIcon; title: string; description: string; to: string; linkLabel: string }
> = {
  voice: {
    icon: Mic,
    title: 'Voice',
    description: 'Text-to-speech, speech-to-text, and the gateway auto-speak toggle.',
    to: '/?view=connections&tab=voice',
    linkLabel: 'Configured on the Voice page',
  },
  messaging: {
    icon: MessageSquare,
    title: 'Messaging',
    description: 'Telegram, Discord, and Slack bot tokens and pairing.',
    to: '/?view=connections&tab=messaging',
    linkLabel: 'Configured on the Messaging page',
  },
  mcp: {
    icon: Plug,
    title: 'Connections (MCP)',
    description: 'Connected tools and data sources your agent can reach (Model Context Protocol).',
    to: '/?view=connections&tab=mcp',
    linkLabel: 'Configured on the MCP page',
  },
  memory: {
    icon: Brain,
    title: 'Memory',
    description:
      'How your agent remembers things between conversations: provider and limits, set per profile.',
    to: '/?section=memory',
    linkLabel: 'Configured on the Memory tab',
  },
}

/** The config sections with the top-level model/provider rows removed (they live
 * in the dedicated Model section now). Empty sections are dropped. */
function withoutModelRows(sections: SettingsSection[]): SettingsSection[] {
  const out: SettingsSection[] = []
  for (const section of sections) {
    const fields = section.fields.filter((f) => !isModelRowKey(f.key))
    if (fields.length > 0) out.push({ ...section, fields })
  }
  return out
}

/** Pick a fitting Lucide line icon component for a config category. */
function categoryIcon(category: string): LucideIcon {
  const key = category.toLowerCase()
  if (key.includes('aux') || key.includes('vision')) return Sparkles
  if (key.includes('tts') || key.includes('voice') || key.includes('audio')) return Mic
  if (key.includes('tool')) return Wrench
  if (key.includes('security') || key.includes('auth') || key.includes('permission')) return Shield
  if (key.includes('model') || key.includes('agent') || key.includes('llm')) return Bot
  if (key.includes('general') || key.includes('core')) return Settings2
  return Braces
}

/**
 * Render the category glyph as an element. Uses `createElement` rather than a
 * render-local `<Icon/>` so the icon type can vary by data without tripping the
 * "component created during render" lint heuristic.
 */
function CategoryIcon({ category }: { category: string }) {
  return createElement(categoryIcon(category), { className: 'size-4' })
}

function SectionCard({ section, searching }: { section: SettingsSection; searching: boolean }) {
  const count = section.fields.length
  // Large sections start collapsed so the page opens scannable. While searching,
  // a surfaced section is always shown so results aren't hidden behind a collapse.
  const defaultOpen = count <= COLLAPSE_THRESHOLD
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const open = searching || (userOpen ?? defaultOpen)
  const bodyId = useId()

  return (
    <Card className="ad-raised gap-0 py-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        // Searching forces the section open; the toggle is inert in that mode.
        onClick={() => !searching && setUserOpen(!open)}
        className={cn(
          'flex w-full items-center gap-3 px-5 py-4 text-left transition-colors',
          !searching && 'hover:bg-muted/40',
          open && 'border-b border-border',
        )}
      >
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-muted text-muted-foreground"
        >
          <CategoryIcon category={section.category} />
        </span>
        <h2 className="font-heading text-base leading-snug font-medium text-foreground">
          {prettyCategory(section.category)}
        </h2>
        <span className="ml-auto text-xs tabular-nums text-foreground-tertiary">
          {count} {count === 1 ? 'setting' : 'settings'}
        </span>
        {!searching && (
          <ChevronDown
            aria-hidden
            className={cn(
              'size-4 shrink-0 text-foreground-tertiary transition-transform motion-reduce:transition-none',
              open ? 'rotate-0' : '-rotate-90',
            )}
          />
        )}
      </button>
      {open && (
        <CardContent id={bodyId} className="p-0">
          <dl className="divide-y divide-border">
            {section.fields.map((field) => (
              <FieldRow key={field.key} field={field} />
            ))}
          </dl>
        </CardContent>
      )}
    </Card>
  )
}

function FieldRow({ field }: { field: SettingsField }) {
  const unset = isUnset(field.value)
  const chips = listItems(field.value)
  const display = formatValue(field.value)
  // Long scalar values (e.g. a redacted base URL, a long model id) wrap instead
  // of truncating so nothing is hidden behind an ellipsis.
  const isObject = field.type === 'object' && !unset
  // A small allowlist of safe, non-secret scalar fields is EDITABLE inline; a
  // secret is never editable (the allowlist excludes them). The editor writes
  // through the guarded BFF, so it only appears where a write can succeed.
  const editable = !field.isSecret && isEditableField(field.key)

  return (
    <div className="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] sm:gap-6">
      <div className="min-w-0">
        <dt className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-foreground">
          {field.isSecret && <KeyRound className="size-3.5 shrink-0 text-primary" aria-hidden />}
          {prettyLabel(field.label)}
          {/* Make editable-vs-read-only obvious: a quiet marker on the rows you
              can't change here. A secret already carries its own "Secret" badge. */}
          {!editable && !field.isSecret && <ReadOnlyMarker />}
        </dt>
        {field.description && field.description !== field.label && (
          <dd className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {field.description}
          </dd>
        )}
      </div>

      <dd className="flex min-w-0 flex-wrap items-start gap-1.5 sm:justify-end">
        {editable ? (
          <EditableConfigField field={field} />
        ) : (
          <FieldValue
            field={field}
            unset={unset}
            chips={chips}
            display={display}
            isObject={isObject}
          />
        )}
      </dd>
    </div>
  )
}

/** The read-only value cell: secret badge + masked/chips/object/scalar render. */
function FieldValue({
  field,
  unset,
  chips,
  display,
  isObject,
}: {
  field: SettingsField
  unset: boolean
  chips: string[]
  display: string
  isObject: boolean
}) {
  return (
    <>
      {field.isSecret && (
        <Badge
          variant="outline"
          // The "secret" marker is a sanctioned accent use (accent governance §2).
          className="self-start border-primary/30 text-primary"
          title="This value is a credential and is masked server-side."
        >
          <Lock aria-hidden />
          Secret
        </Badge>
      )}

      {unset ? (
        <span className="text-13 text-foreground-tertiary italic">{UNSET}</span>
      ) : chips.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 sm:justify-end">
          {chips.map((item, i) => (
            <Badge
              key={`${item}-${i}`}
              variant="muted"
              className="max-w-full font-mono text-[11px]"
              title={item}
            >
              <span className="truncate">{item}</span>
            </Badge>
          ))}
        </div>
      ) : isObject ? (
        <pre className="ad-surface max-w-full overflow-x-auto rounded-[8px] bg-surface-1 px-3 py-2 text-left font-mono text-[12px] leading-relaxed text-foreground/90">
          {display}
        </pre>
      ) : (
        <span
          className="font-mono text-13 leading-relaxed break-words text-foreground/90 sm:text-right"
          title={display}
        >
          {display}
        </span>
      )}
    </>
  )
}

function SettingsSkeleton() {
  return (
    <div data-testid="settings-loading" className="flex flex-col gap-6" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <Card key={i} className="ad-raised gap-0 py-0">
          <div className="flex items-center gap-3 border-b border-border px-5 py-4">
            <div className="size-8 shrink-0 animate-pulse rounded-[8px] bg-muted-foreground/15" />
            <div className="h-4 w-28 animate-pulse rounded bg-muted-foreground/15" />
          </div>
          <CardContent className="p-0">
            <dl className="divide-y divide-border">
              {[0, 1, 2].map((j) => (
                <div
                  key={j}
                  className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-6 px-5 py-4"
                >
                  <div className="flex flex-col gap-2">
                    <div className="h-3.5 w-28 animate-pulse rounded bg-muted-foreground/15" />
                    <div className="h-3 w-40 animate-pulse rounded bg-muted-foreground/10" />
                  </div>
                  <div className="h-3.5 w-24 animate-pulse justify-self-end rounded bg-muted-foreground/10" />
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
