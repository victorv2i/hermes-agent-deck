/**
 * Local session labels — an honest rename overlay for History.
 *
 * Stock Hermes does not currently expose a session-title mutation route. Agent
 * Deck still needs the daily-driver affordance, so labels are browser-local:
 * stored in localStorage, keyed by session id, and always described as local in
 * the UI. They never overwrite Hermes' own title/preview.
 */
import { useSyncExternalStore } from 'react'

export const SESSION_LABELS_STORAGE_KEY = 'agent-deck-session-labels'

export type SessionLabelMap = Readonly<Record<string, string>>

function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').slice(0, 120)
}

export function readStoredSessionLabels(): Record<string, string> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(SESSION_LABELS_STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const labels: Record<string, string> = {}
    for (const [id, value] of Object.entries(parsed)) {
      if (typeof id !== 'string' || typeof value !== 'string') continue
      const label = normalizeLabel(value)
      if (id.trim() && label) labels[id] = label
    }
    return labels
  } catch {
    return {}
  }
}

let current: Record<string, string> = readStoredSessionLabels()
let snapshot: SessionLabelMap = current
const listeners = new Set<() => void>()

export function getSessionLabelsSnapshot(): SessionLabelMap {
  return snapshot
}

function persist(labels: Record<string, string>): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(SESSION_LABELS_STORAGE_KEY, JSON.stringify(labels))
  } catch {
    // Storage can fail in private mode/quota conditions; the in-memory label is
    // still useful for the current tab.
  }
}

function commit(next: Record<string, string>): void {
  current = next
  snapshot = next
  persist(next)
  for (const listener of listeners) listener()
}

export function setSessionLabel(id: string, label: string): void {
  const cleanId = id.trim()
  if (!cleanId) return
  const cleanLabel = normalizeLabel(label)
  const next = { ...current }
  if (cleanLabel) next[cleanId] = cleanLabel
  else delete next[cleanId]
  commit(next)
}

export function clearSessionLabel(id: string): void {
  setSessionLabel(id, '')
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSessionLabels(): SessionLabelMap {
  return useSyncExternalStore(subscribe, getSessionLabelsSnapshot, getSessionLabelsSnapshot)
}
