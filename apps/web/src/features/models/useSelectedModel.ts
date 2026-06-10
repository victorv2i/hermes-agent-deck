import { useCallback, useMemo, useState } from 'react'

/** localStorage key holding the composer's explicitly-chosen model id. */
export const SELECTED_MODEL_STORAGE_KEY = 'agent-deck:selected-model'

function readStored(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage.getItem(SELECTED_MODEL_STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStored(id: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(SELECTED_MODEL_STORAGE_KEY, id)
  } catch {
    // Quota / disabled storage — persistence is best-effort.
  }
}

/**
 * The composer's persisted model choice (T1.2). Identifiers here are
 * `qualifiedId`s (`<provider>/<id>`), unique across providers — NOT bare model
 * ids, which collide (e.g. `gpt-5.4` under two providers). Resolves to:
 *  1. an explicit pick (this session or persisted) IF it's still in `availableIds`,
 *  2. otherwise the gateway's `activeId`,
 *  3. otherwise null (no models resolved yet).
 *
 * A stale persisted id (a model that's since been removed) is silently ignored
 * so the picker never shows a phantom selection. The choice is written to
 * localStorage on `select` so it survives reloads.
 */
export function useSelectedModel(
  availableIds: string[],
  activeId: string | null,
): { selected: string | null; select: (id: string) => void } {
  // The explicit pick (lazy-init from storage). Null = "follow the active model".
  const [picked, setPicked] = useState<string | null>(() => readStored())

  const selected = useMemo(() => {
    const available = new Set(availableIds)
    if (picked && available.has(picked)) return picked
    if (activeId && (available.size === 0 || available.has(activeId))) return activeId
    return null
  }, [picked, activeId, availableIds])

  const select = useCallback((id: string) => {
    setPicked(id)
    writeStored(id)
  }, [])

  return { selected, select }
}
