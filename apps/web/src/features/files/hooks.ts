/**
 * TanStack Query hooks for the Files surface.
 *
 * The directory tree and file reads are cached per (root, path); writes
 * invalidate the affected listing + file so the tree and preview stay fresh
 * after a save/create/rename/delete. Query keys are namespaced under `['files',
 * …]` for easy invalidation.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import {
  createEntry,
  deleteEntry,
  fetchFile,
  fetchListing,
  fetchRoots,
  renameEntry,
  writeFile,
  type FileContent,
  type FileListing,
  type FileRoot,
} from './api'

export const fileKeys = {
  all: ['files'] as const,
  roots: ['files', 'roots'] as const,
  listing: (root: string, path: string) => ['files', 'listing', root, path] as const,
  file: (root: string, path: string) => ['files', 'file', root, path] as const,
}

export function useRoots(): UseQueryResult<FileRoot[]> {
  return useQuery({
    queryKey: fileKeys.roots,
    queryFn: async ({ signal }) => (await fetchRoots(signal)).roots ?? [],
    staleTime: 60_000,
  })
}

export function useListing(root: string | null, path: string): UseQueryResult<FileListing> {
  return useQuery({
    queryKey: fileKeys.listing(root ?? '', path),
    queryFn: ({ signal }) => fetchListing(root!, path, signal),
    enabled: root !== null,
    staleTime: 5_000,
  })
}

export function useFileContent(
  root: string | null,
  path: string | null,
): UseQueryResult<FileContent> {
  return useQuery({
    queryKey: fileKeys.file(root ?? '', path ?? ''),
    queryFn: ({ signal }) => fetchFile(root!, path!, signal),
    enabled: root !== null && path !== null,
    // Files can change on disk; keep them reasonably fresh but cache within a view.
    staleTime: 2_000,
  })
}

/** Save edited content; invalidates the file + its containing listing. */
export function useWriteFile(root: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ path, content }: { path: string; content: string }) =>
      writeFile(root, path, content),
    onSuccess: (_res, { path }) => {
      qc.invalidateQueries({ queryKey: fileKeys.file(root, path) })
      qc.invalidateQueries({ queryKey: fileKeys.listing(root, parentOf(path)) })
    },
  })
}

export function useCreateEntry(root: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ path, kind }: { path: string; kind: 'file' | 'dir' }) =>
      createEntry(root, path, kind),
    onSuccess: (_res, { path }) => {
      qc.invalidateQueries({ queryKey: fileKeys.listing(root, parentOf(path)) })
    },
  })
}

export function useRenameEntry(root: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) => renameEntry(root, from, to),
    onSuccess: (_res, { from, to }) => {
      qc.invalidateQueries({ queryKey: fileKeys.listing(root, parentOf(from)) })
      qc.invalidateQueries({ queryKey: fileKeys.listing(root, parentOf(to)) })
    },
  })
}

export function useDeleteEntry(root: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ path }: { path: string }) => deleteEntry(root, path),
    onSuccess: (_res, { path }) => {
      qc.invalidateQueries({ queryKey: fileKeys.listing(root, parentOf(path)) })
    },
  })
}

/** Parent directory of a root-relative POSIX path ("a/b/c.txt" → "a/b"). */
export function parentOf(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const idx = trimmed.lastIndexOf('/')
  return idx === -1 ? '' : trimmed.slice(0, idx)
}
