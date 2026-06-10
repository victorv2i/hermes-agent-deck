import { Wrench } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { ErrorState } from '@/components/ui/state'
import { ToolsetsPage } from './ToolsetsPage'
import { useToolsets, useToggleToolset } from './useToolsets'

/**
 * Route element for the Tools surface (`/tools`). Bridges the `useToolsets` read
 * + the `useToggleToolset` mutation to the presentational {@link ToolsetsPage}.
 * Real loading / error states here.
 */
export function ToolsetsRoute() {
  const query = useToolsets()
  const toggleMutation = useToggleToolset()

  if (query.status === 'pending') {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col px-6 pb-12 md:pb-16">
        <PageHeader
          icon={Wrench}
          title="Tools"
          subtitle="Capabilities your agent can use, like web search, file reading, or image generation. Turning them on or off is a one-time setup step."
        />
        <div className="flex flex-col gap-3" aria-hidden data-testid="toolsets-skeleton">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="ad-surface h-24 animate-pulse rounded-xl bg-card" />
          ))}
        </div>
      </div>
    )
  }

  if (query.status === 'error') {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col px-6 pb-12 md:pb-16">
        <PageHeader icon={Wrench} title="Tools" />
        <ErrorState
          icon={Wrench}
          title="Couldn't load toolsets"
          description="Agent Deck couldn't read your toolsets from Hermes. This doesn't affect chatting."
          onRetry={() => query.refetch()}
        />
      </div>
    )
  }

  const handleToggle = async (name: string, enabled: boolean) => {
    await toggleMutation.mutateAsync({ name, enabled })
    // Refetch so the list reflects the persisted config truth.
    await query.refetch()
  }

  return <ToolsetsPage toolsets={query.data} onToggle={handleToggle} />
}
