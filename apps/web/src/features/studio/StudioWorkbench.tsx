import { useCallback, useId, useState, type KeyboardEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/toast'
import { fetchMemoryProvider, setMemoryProvider } from '@/features/system/memoryApi'
import type { ProfileSummary } from '@/features/profiles/types'
import { STUDIO_SECTIONS, type StudioSection } from './state/selection'
import {
  useModelOptions,
  useSetProfileModel,
  useSoul,
  useStudioConfig,
  useStudioEnv,
  useStudioSkills,
  useSetStudioEnv,
  useToggleStudioSkill,
  useWriteSoul,
  useWriteStudioConfig,
} from './hooks'
import { IdentitySection } from './workbench/IdentitySection'
import { SoulSection } from './workbench/SoulSection'
import { ModelSection } from './workbench/ModelSection'
import { AdvancedModelSection } from './workbench/AdvancedModelSection'
import { ToolsSection } from './workbench/ToolsSection'
import { MemorySection } from './workbench/MemorySection'
import { SkillsSection } from './workbench/SkillsSection'
import { EnvSection } from './workbench/EnvSection'

const SECTION_LABELS: Record<StudioSection, string> = {
  identity: 'Identity',
  soul: 'Soul',
  model: 'Model',
  tools: 'Tools',
  memory: 'Memory',
  skills: 'Skills',
  env: 'Env',
}

const MEMORY_PROVIDER_KEY = ['memory-provider'] as const

function errMsg(isError: boolean, error: unknown, fallback: string): string | null {
  if (!isError) return null
  return error instanceof Error ? error.message : fallback
}

/**
 * StudioWorkbench — the per-agent workbench (the "detail" column). The tab strip
 * picks one of the seven sections; each section is wired to Hermes through the
 * profile-scoped Studio hooks (so two agents never share a cache entry and every
 * write reconciles with Hermes's truth). The selected section is controlled by
 * the parent (driven by the URL `?section=`), so a refresh/deep link lands back
 * on the same section.
 *
 * Skills are authored per-agent through the profile-scoped Studio hooks (the
 * route threads `?profile=`), so any agent's skills can be toggled. The memory
 * PROVIDER selector stays active-profile scoped (stock Hermes tracks one provider),
 * alongside the per-profile `memory.*` config the Studio authors.
 */
export interface StudioWorkbenchProps {
  /** The selected agent (a Hermes profile name). */
  agent: string
  /** The full roster row for the selected agent (drives Identity + active scope). */
  profile: ProfileSummary
  section: StudioSection
  onSectionChange: (section: StudioSection) => void
}

export function StudioWorkbench({
  agent,
  profile,
  section,
  onSectionChange,
}: StudioWorkbenchProps) {
  const baseId = useId()
  const tabId = (s: StudioSection) => `${baseId}-tab-${s}`
  const panelId = (s: StudioSection) => `${baseId}-panel-${s}`

  // Roving arrow-key nav across the tab strip (a real tablist), mirroring the
  // app's other tab strips so keyboard parity holds.
  const onTabKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = STUDIO_SECTIONS.indexOf(section)
    if (i === -1) return
    let next: number | null = null
    if (e.key === 'ArrowRight') next = (i + 1) % STUDIO_SECTIONS.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + STUDIO_SECTIONS.length) % STUDIO_SECTIONS.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = STUDIO_SECTIONS.length - 1
    if (next === null) return
    e.preventDefault()
    const nextSection = STUDIO_SECTIONS[next]!
    onSectionChange(nextSection)
    e.currentTarget.querySelector<HTMLButtonElement>(`#${CSS.escape(tabId(nextSection))}`)?.focus()
  }

  return (
    <div className="flex min-h-0 flex-col">
      {/* The section switcher pins to the top of the page scroll container (the
          AppShell <main> overflow-y-auto), so the tabs stay reachable on a long
          section instead of scrolling away. The wrapper carries the panel's own
          bg-card and cancels the Card's padding with negative margins so the
          masking band spans gutter-to-gutter (content never bleeds under the
          strip); the Studio Card opts into overflow-visible so this can escape it. */}
      <div className="sticky top-0 z-10 -mx-5 -mt-5 overflow-x-auto bg-card px-5 pt-5 pb-2 sm:-mx-6 sm:-mt-6 sm:px-6 sm:pt-6">
        <div
          role="tablist"
          aria-label="Workbench sections"
          aria-orientation="horizontal"
          onKeyDown={onTabKeyDown}
          className="ad-surface inline-flex rounded-md bg-surface-1 p-1"
        >
          {STUDIO_SECTIONS.map((s) => {
            const selected = s === section
            return (
              <button
                key={s}
                type="button"
                role="tab"
                id={tabId(s)}
                aria-selected={selected}
                aria-controls={panelId(s)}
                tabIndex={selected ? 0 : -1}
                onClick={() => onSectionChange(s)}
                className={cn(
                  'inline-flex min-h-11 items-center justify-center rounded-[7px] px-3.5 py-1.5 text-13 font-medium transition-colors sm:min-h-9',
                  'focus-visible:ad-focus',
                  selected
                    ? 'bg-primary/12 text-primary-hover'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {SECTION_LABELS[s]}
              </button>
            )
          })}
        </div>
      </div>

      <div role="tabpanel" id={panelId(section)} aria-labelledby={tabId(section)} className="pt-3">
        <SectionPanel agent={agent} profile={profile} section={section} />
      </div>
    </div>
  )
}

/** Renders + wires the active workbench section to its profile-scoped hooks. */
function SectionPanel({
  agent,
  profile,
  section,
}: {
  agent: string
  profile: ProfileSummary
  section: StudioSection
}) {
  switch (section) {
    case 'identity':
      return <IdentitySection profile={profile} />
    case 'soul':
      return <SoulPanel agent={agent} />
    case 'model':
      return <ModelPanel agent={agent} />
    case 'tools':
      return <ToolsPanel agent={agent} />
    case 'memory':
      return <MemoryPanel agent={agent} isActiveAgent={profile.isActive} />
    case 'skills':
      // Per-agent: the scoped hooks read/toggle THIS agent's skills (the route
      // threads ?profile=), so any agent's skills can be changed without switching.
      // Authoring (create/edit/delete + hub) is active-profile only, so the panel
      // gates those on `profile.isActive`.
      return <SkillsPanel agent={agent} isActive={profile.isActive} />
    case 'env':
      return <EnvPanel agent={agent} />
  }
}

function SoulPanel({ agent }: { agent: string }) {
  const soul = useSoul(agent)
  const write = useWriteSoul(agent)
  return (
    <SoulSection
      soul={soul.data}
      isLoading={soul.isLoading}
      error={errMsg(soul.isError, soul.error, "Couldn't load the soul.")}
      isSaving={write.isPending}
      onSave={async (content) => {
        try {
          await write.mutateAsync(content)
          toast.success('Soul saved')
        } catch (err) {
          toast.error("Couldn't save the soul", {
            description: err instanceof Error ? err.message : 'Please try again.',
          })
          throw err
        }
      }}
    />
  )
}

function ModelPanel({ agent }: { agent: string }) {
  const options = useModelOptions(agent)
  const setModel = useSetProfileModel(agent)
  // The advanced block (context length + auxiliary/delegation routing) reads +
  // writes the per-agent config subset, the same scoped hooks Tools/Memory use.
  const config = useStudioConfig(agent)
  const writeConfig = useWriteStudioConfig(agent)
  return (
    <div className="flex flex-col gap-6">
      <ModelSection
        options={options.data}
        isLoading={options.isLoading}
        error={errMsg(options.isError, options.error, "Couldn't load models.")}
        isSetting={setModel.isPending}
        onSet={async ({ provider, model }) => {
          try {
            await setModel.mutateAsync({ provider, model })
            toast.success(`Model set to ${model}`)
          } catch (err) {
            toast.error("Couldn't set the model", {
              description: err instanceof Error ? err.message : 'Please try again.',
            })
          }
        }}
      />
      <div className="border-t border-border pt-5">
        <AdvancedModelSection
          config={config.data}
          isLoading={config.isLoading}
          error={errMsg(config.isError, config.error, "Couldn't load advanced options.")}
          isSaving={writeConfig.isPending}
          onSave={async (patch) => {
            try {
              await writeConfig.mutateAsync(patch)
              toast.success('Saved', { description: 'Restart your agent to apply.' })
            } catch (err) {
              toast.error("Couldn't save advanced options", {
                description: err instanceof Error ? err.message : 'Please try again.',
              })
            }
          }}
        />
      </div>
    </div>
  )
}

function ToolsPanel({ agent }: { agent: string }) {
  const config = useStudioConfig(agent)
  const write = useWriteStudioConfig(agent)
  return (
    <ToolsSection
      config={config.data}
      isLoading={config.isLoading}
      error={errMsg(config.isError, config.error, "Couldn't load tools.")}
      isSaving={write.isPending}
      onToggle={async (patch) => {
        try {
          await write.mutateAsync(patch)
        } catch (err) {
          toast.error("Couldn't update tools", {
            description: err instanceof Error ? err.message : 'Please try again.',
          })
        }
      }}
    />
  )
}

function MemoryPanel({ agent, isActiveAgent }: { agent: string; isActiveAgent: boolean }) {
  const config = useStudioConfig(agent)
  const write = useWriteStudioConfig(agent)
  const queryClient = useQueryClient()
  // The memory PROVIDER is active-profile scoped in stock Hermes; read it from
  // the shared `/api/memory` route (not profile-scoped) and let the section gate
  // its controls on `isActiveAgent`.
  const provider = useQuery({
    queryKey: MEMORY_PROVIDER_KEY,
    queryFn: ({ signal }) => fetchMemoryProvider(signal),
    staleTime: 5_000,
  })
  const [switchRestart, setSwitchRestart] = useState(false)
  const switchProvider = useMutation({
    mutationFn: setMemoryProvider,
    onSuccess: async (result) => {
      setSwitchRestart(result.restart_required)
      await queryClient.invalidateQueries({ queryKey: MEMORY_PROVIDER_KEY })
    },
    onError: (err) => {
      toast.error("Couldn't switch the memory provider", {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    },
  })

  return (
    <MemorySection
      memory={config.data?.memory}
      isLoading={config.isLoading}
      error={errMsg(config.isError, config.error, "Couldn't load memory settings.")}
      isSavingConfig={write.isPending}
      onChangeConfig={async (patch) => {
        try {
          await write.mutateAsync(patch)
        } catch (err) {
          toast.error("Couldn't update memory settings", {
            description: err instanceof Error ? err.message : 'Please try again.',
          })
        }
      }}
      providerStatus={provider.data ?? null}
      isActiveAgent={isActiveAgent}
      isSwitchingProvider={switchProvider.isPending}
      providerSwitchRestartRequired={switchRestart}
      onSwitchProvider={(name) => {
        if (isActiveAgent) switchProvider.mutate(name)
      }}
    />
  )
}

function SkillsPanel({ agent, isActive }: { agent: string; isActive: boolean }) {
  const skills = useStudioSkills(agent)
  const toggle = useToggleStudioSkill(agent)
  // Track which skills have a toggle in flight so only those switches lock.
  const [pending, setPending] = useState<Set<string>>(() => new Set())

  const onToggle = useCallback(
    (name: string, next: boolean) => {
      setPending((prev) => new Set(prev).add(name))
      toggle.mutate(
        { name, enabled: next },
        {
          onError: () => {
            toast.error(`Couldn't ${next ? 'enable' : 'disable'} ${name}`, {
              description: 'The change was reverted. The hermes dashboard may be offline.',
            })
          },
          onSettled: () => {
            setPending((prev) => {
              const copy = new Set(prev)
              copy.delete(name)
              return copy
            })
          },
        },
      )
    },
    [toggle],
  )

  return (
    <SkillsSection
      agent={agent}
      isActive={isActive}
      skills={skills.data}
      isLoading={skills.isLoading}
      error={errMsg(skills.isError, skills.error, "Couldn't load skills.")}
      pending={pending}
      onToggle={onToggle}
    />
  )
}

function EnvPanel({ agent }: { agent: string }) {
  const env = useStudioEnv(agent)
  const setEnv = useSetStudioEnv(agent)
  return (
    <EnvSection
      env={env.data}
      isLoading={env.isLoading}
      error={errMsg(env.isError, env.error, "Couldn't load environment.")}
      isSetting={setEnv.isPending}
      onSet={async ({ key, value }) => {
        try {
          const result = await setEnv.mutateAsync({ key, value })
          toast.success(`Saved ${result.key}`, {
            description: result.restartRequired ? 'Restart your agent to apply.' : undefined,
          })
        } catch (err) {
          toast.error("Couldn't save the key", {
            description: err instanceof Error ? err.message : 'Please try again.',
          })
        }
      }}
    />
  )
}
