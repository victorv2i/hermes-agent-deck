/**
 * LogsRoute — the Logs surface route element (mounted at `/logs` by the
 * integrator). Owns the filter state (file / min-level / keyword / auto-refresh)
 * and the react-query fetch via {@link useLogs}, then hands data + handlers to
 * the presentational {@link LogsPage}.
 *
 * Reads ride the single app-wide QueryClient (main.tsx); the converged retry
 * policy lives there. The keyword is debounced into the query so each keystroke
 * doesn't fire a server scan, while the page also filters client-side instantly.
 */
import { useEffect, useState } from 'react'
import type { LogFile } from '@agent-deck/protocol'
import { useLogs } from './useLogs'
import { LogsPage } from './LogsPage'
import { type LevelOption } from './types'

/** How many lines to request from the backend (the dashboard caps at 500). */
const REQUEST_LINES = 300
const KEYWORD_DEBOUNCE_MS = 300

export function LogsRoute() {
  const [file, setFile] = useState<LogFile>('agent')
  const [level, setLevel] = useState<LevelOption>('ALL')
  const [keyword, setKeyword] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)

  // Debounce the keyword into the server query; the page filters instantly on
  // its own, so typing stays responsive without a request per keystroke.
  const [debouncedKeyword, setDebouncedKeyword] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedKeyword(keyword), KEYWORD_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [keyword])

  const query = useLogs(
    {
      file,
      lines: REQUEST_LINES,
      level: level === 'ALL' ? undefined : level,
      search: debouncedKeyword.trim() || undefined,
    },
    autoRefresh,
  )

  return (
    <LogsPage
      file={file}
      onFileChange={setFile}
      level={level}
      onLevelChange={setLevel}
      keyword={keyword}
      onKeywordChange={setKeyword}
      autoRefresh={autoRefresh}
      onAutoRefreshChange={setAutoRefresh}
      onRefresh={() => void query.refetch()}
      data={query.data}
      isLoading={query.isLoading}
      isFetching={query.isFetching}
      error={query.error}
    />
  )
}

export default LogsRoute
