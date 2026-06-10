/**
 * TanStack Query hooks for the Memory/Soul surface.
 *
 * Each profile file (soul/memory/user) is cached per (profile, kind); a SOUL save
 * invalidates that file so the viewer reflects the write. Keys are namespaced
 * under `['memory', …]`.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { fetchProfileFile, writeProfileFile, type ProfileFile, type ProfileFileKind } from './api'

export const memoryKeys = {
  all: ['memory'] as const,
  file: (profile: string, kind: ProfileFileKind) => ['memory', profile, kind] as const,
}

export function useProfileFile(
  profile: string | null,
  kind: ProfileFileKind,
): UseQueryResult<ProfileFile> {
  return useQuery({
    queryKey: memoryKeys.file(profile ?? '', kind),
    queryFn: ({ signal }) => fetchProfileFile(profile!, kind, signal),
    enabled: profile !== null,
    // These files change on disk (the agent rewrites MEMORY); keep them fresh but
    // cache within a view so tab-switching is instant.
    staleTime: 2_000,
  })
}

/**
 * Save one of a profile's editable files (soul/memory/user); invalidates that
 * file so the viewer reflects the write. All three are editable symmetrically —
 * the route guards the write and the UI surfaces the honest MEMORY boundary note.
 */
export function useWriteProfileFile(profile: string, kind: ProfileFileKind) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (content: string) => writeProfileFile(profile, kind, content),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: memoryKeys.file(profile, kind) })
    },
  })
}
