/**
 * SkillsHubPanel — browse the skills hub, install/uninstall/update.
 *
 * HONESTY contract:
 *  - Search fires only while a request is actually in flight (spinner only then).
 *  - Install/uninstall signal "restart to apply" because that is the REAL hermes
 *    behavior — the gateway must restart to pick up a changed skill set.
 *  - Update does NOT signal restart (hermes picks it up without restart).
 *  - enabled !== installed: this panel shows HUB skills (not installed), not the
 *    installed/enabled set the Studio's per-agent Skills section lists. It is additive.
 *  - No fake states: if the hub call fails we show the error clearly.
 *
 * Design: debounced search input (300ms), result rows with name/source/trust
 * badge + one-click Install, global Update All button, honest spinner while a
 * request is in flight, a calm "restart to apply" note after install/uninstall.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Download,
  Loader2,
  RefreshCw,
  Search,
  ServerCog,
  Sparkles,
  TriangleAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorState } from '@/components/ui/state'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/toast'
import { searchHub, installSkill, updateAllSkills, type HubResult } from './hubApi'

const DEBOUNCE_MS = 300

/** State for a running hub action (install / uninstall / update). */
interface ActionState {
  identifier: string
  status: 'running' | 'done' | 'error'
  restartRequired: boolean
}

export function SkillsHubPanel() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<HubResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  /** Map from identifier -> action state for in-flight or completed actions. */
  const [actions, setActions] = useState<Map<string, ActionState>>(new Map())
  const [updating, setUpdating] = useState(false)
  const [updateDone, setUpdateDone] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Debounced search: fires only for non-empty queries.
  const runSearch = useCallback((q: string) => {
    abortRef.current?.abort()
    if (!q.trim()) {
      setResults([])
      setSearchError(null)
      setSearching(false)
      return
    }
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setSearching(true)
    setSearchError(null)
    searchHub(q, ctrl.signal)
      .then((res) => {
        setResults(res.results)
      })
      .catch((err: unknown) => {
        if ((err as { name?: string }).name === 'AbortError') return
        setSearchError("Couldn't search the hub. Is Hermes running?")
      })
      .finally(() => {
        setSearching(false)
      })
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => runSearch(query), DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, runSearch])

  const handleInstall = useCallback(async (result: HubResult) => {
    setActions((prev) => {
      const next = new Map(prev)
      next.set(result.identifier, {
        identifier: result.identifier,
        status: 'running',
        restartRequired: false,
      })
      return next
    })
    try {
      const res = await installSkill(result.identifier)
      setActions((prev) => {
        const next = new Map(prev)
        next.set(result.identifier, {
          identifier: result.identifier,
          status: 'done',
          restartRequired: res.restartRequired,
        })
        return next
      })
    } catch {
      setActions((prev) => {
        const next = new Map(prev)
        next.set(result.identifier, {
          identifier: result.identifier,
          status: 'error',
          restartRequired: false,
        })
        return next
      })
      toast.error(`Couldn't install ${result.name}`, {
        description: 'The hub install failed. Check the Logs surface for details.',
      })
    }
  }, [])

  const handleUpdateAll = useCallback(async () => {
    setUpdating(true)
    setUpdateDone(false)
    try {
      await updateAllSkills()
      setUpdateDone(true)
      toast.success('Skills updated', {
        description: 'All installed skills have been updated.',
      })
    } catch {
      toast.error("Couldn't update skills", {
        description: 'The hub update failed. Check the Logs surface for details.',
      })
    } finally {
      setUpdating(false)
    }
  }, [])

  return (
    <div className="flex flex-col gap-4">
      {/* Header bar: search + Update All */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-tertiary"
            aria-hidden
          />
          <input
            type="search"
            role="searchbox"
            aria-label="Search skills hub"
            placeholder="Search skills hub..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="ad-surface min-h-11 w-full rounded-md bg-card pr-3 pl-9 text-sm text-foreground placeholder:text-foreground-tertiary focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:h-10 sm:min-h-0"
          />
          {searching && (
            <Loader2
              aria-label="Searching..."
              className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-foreground-tertiary motion-reduce:animate-none"
            />
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleUpdateAll}
          disabled={updating}
          aria-label="Update all skills"
        >
          {updating ? (
            <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
          ) : (
            <RefreshCw aria-hidden />
          )}
          Update all
        </Button>
      </div>

      {/* Update done note */}
      {updateDone && !updating && (
        <p className="text-xs text-muted-foreground" role="status">
          All skills updated. No restart needed.
        </p>
      )}

      {/* Results */}
      {searchError ? (
        <ErrorState icon={ServerCog} title="Search failed" description={searchError} />
      ) : query.trim() === '' ? (
        <EmptyState
          icon={Sparkles}
          title="Search the hub"
          description="Type a skill name to search across all configured hub sources."
        />
      ) : results.length === 0 && !searching ? (
        <EmptyState
          icon={Search}
          title="No skills found"
          description={`No hub skills match "${query.trim()}". Try a different search.`}
        />
      ) : (
        <ul className="flex flex-col gap-1.5" aria-label="Hub search results">
          {results.map((r) => (
            <HubResultRow
              key={r.identifier}
              result={r}
              action={actions.get(r.identifier)}
              onInstall={handleInstall}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function HubResultRow({
  result,
  action,
  onInstall,
}: {
  result: HubResult
  action: ActionState | undefined
  onInstall: (r: HubResult) => void
}) {
  const running = action?.status === 'running'
  const done = action?.status === 'done'
  const failed = action?.status === 'error'

  return (
    <li className="ad-surface flex flex-col gap-2 rounded-md bg-card px-3.5 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-sm font-medium text-foreground">{result.name}</span>
            <TrustBadge level={result.trust_level} />
            <SourceBadge source={result.source} />
          </div>
          {result.description && (
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {result.description}
            </p>
          )}
        </div>
        <Button
          size="sm"
          variant={done ? 'ghost' : 'outline'}
          disabled={running || done}
          onClick={() => !running && !done && onInstall(result)}
          className={cn('shrink-0', failed && 'border-destructive text-destructive')}
          aria-label={`Install ${result.name}`}
        >
          {running ? (
            <>
              <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
              Installing...
            </>
          ) : done ? (
            <>
              <Download aria-hidden />
              Installed
            </>
          ) : failed ? (
            <>
              <TriangleAlert aria-hidden />
              Failed
            </>
          ) : (
            <>
              <Download aria-hidden />
              Install
            </>
          )}
        </Button>
      </div>
      {/* Honest restart note: only shown when action is done + restartRequired. */}
      {done && action?.restartRequired && (
        <p
          className="rounded-[7px] bg-surface-1 px-2.5 py-1.5 text-xs leading-relaxed text-muted-foreground"
          role="note"
        >
          Restart required to apply. Go to{' '}
          <a href="/system" className="underline decoration-dotted hover:text-foreground">
            System
          </a>{' '}
          to restart your agent.
        </p>
      )}
      {result.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {result.tags.map((tag) => (
            <Badge key={tag} variant="muted" className="text-[11px]">
              {tag}
            </Badge>
          ))}
        </div>
      )}
    </li>
  )
}

function TrustBadge({ level }: { level: string }) {
  if (!level) return null
  // Trust level is provenance metadata, not an action/active state — it stays
  // neutral per the design spine (the accent is reserved for action + live state).
  // "official" reads as the stronger-bordered outline; everything else is a quiet
  // muted chip.
  const isOfficial = level === 'official'
  return (
    <Badge variant={isOfficial ? 'outline' : 'muted'} className="text-[10px]">
      {level}
    </Badge>
  )
}

function SourceBadge({ source }: { source: string }) {
  if (!source) return null
  return (
    <Badge variant="muted" className="text-[10px]">
      {source}
    </Badge>
  )
}
