import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { ChevronRight, CircleDot, IdCard, Plus, Server, Star } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState, ErrorState } from '@/components/ui/state'
import { cn } from '@/lib/utils'
import { useProfiles } from './useProfiles'
import { resolveAvatar } from './avatarForProfile'
import { NewAgentDialog } from './NewAgentDialog'
import type { ProfileSummary } from './types'

/**
 * Agents — the roster + entry point to each agent's HUB.
 *
 * "Singular by default, growing feels natural": ONE agent reads as *your agent*
 * (a character sheet to open), not "your agents (1)" — and the always-present,
 * never-pushy "New agent" affordance teaches the possibility so adding a second
 * is a natural next step, not a buried setting. Same shape at 1 and N.
 *
 * Each row is an avatar (`resolveAvatar` → ONE face everywhere) + name + facts,
 * linking to `/profiles/:name`. Switching is real + HONEST (writes
 * `active_profile`, then says "restart the gateway to apply") on the detail hub —
 * the list just routes you in. Amber stays on actions only; the avatar is never
 * the accent.
 */

const META_DESCRIPTION = 'Each agent has its own model, skills, memory, and a face you tend.'

export function ProfilesPage() {
  const { data, loading, error, refetch } = useProfiles()
  const reduceMotion = useReducedMotion()
  const [creating, setCreating] = useState(false)

  return (
    <div className="mx-auto w-full max-w-[920px] px-6 py-10 sm:px-8">
      <PageHeader
        icon={IdCard}
        title="Agents"
        subtitle={META_DESCRIPTION}
        actions={
          <Button type="button" size="sm" onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            New agent
          </Button>
        }
      />

      {loading && <ProfilesSkeleton />}

      {!loading && error && (
        <ErrorState
          icon={Server}
          title="Couldn’t load agents"
          description={error}
          onRetry={() => void refetch()}
        />
      )}

      {!loading && !error && data && (data.profiles ?? []).length === 0 && (
        <EmptyState
          icon={IdCard}
          title="No agents yet"
          description="Hatch your first agent: give it a name and a face, and it gets its own model, skills, and memory."
          action={
            <Button type="button" onClick={() => setCreating(true)}>
              <Plus aria-hidden />
              New agent
            </Button>
          }
        />
      )}

      {!loading && !error && data && (data.profiles ?? []).length > 0 && (
        <motion.ul
          className="grid gap-3"
          initial={reduceMotion ? false : 'hidden'}
          animate="show"
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }}
        >
          {(data.profiles ?? []).map((profile) => (
            <ProfileRow key={profile.name} profile={profile} reduceMotion={!!reduceMotion} />
          ))}
        </motion.ul>
      )}

      <NewAgentDialog open={creating} onOpenChange={setCreating} />
    </div>
  )
}

function ProfileRow({ profile, reduceMotion }: { profile: ProfileSummary; reduceMotion: boolean }) {
  // The accurate name: a user-chosen displayName, else the agent's REAL profile
  // name (the built-in agent reads as "default") — identical to every surface.
  const friendlyName = profile.displayName?.trim() || profile.name
  return (
    <motion.li
      data-testid={`profile-card-${profile.name}`}
      variants={{
        hidden: { opacity: 0, y: 12 },
        show: { opacity: 1, y: 0, transition: { duration: 0.18, ease: 'easeOut' } },
      }}
      initial={reduceMotion ? false : undefined}
    >
      <Card
        size="sm"
        className={cn(
          'transition-colors',
          // Active state uses the governed identity pattern (strong border +
          // surface tint), NOT the action accent — identity is never the accent.
          profile.isActive && 'border-[var(--border-strong)] bg-surface-2',
        )}
      >
        <Link
          to={`/profiles/${encodeURIComponent(profile.name)}`}
          className="flex items-center gap-3.5 rounded-xl px-4 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Open ${friendlyName}`}
        >
          <Avatar avatarId={resolveAvatar(profile)} name={profile.name} size={44} />

          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="truncate font-heading text-[15px] font-medium text-foreground">
                {friendlyName}
              </span>
              {profile.isDefault && (
                <Badge variant="outline" className="gap-1">
                  <Star className="size-3" aria-hidden />
                  Default
                </Badge>
              )}
              {profile.isActive && (
                <Badge variant="active" className="gap-1">
                  <CircleDot className="size-3" aria-hidden />
                  Active
                </Badge>
              )}
            </span>
            <span className="flex min-w-0 items-center gap-2 text-[12px] text-foreground-tertiary">
              <span className="truncate font-mono">{profile.model ?? 'model unknown'}</span>
              {profile.provider && (
                <>
                  <span aria-hidden>·</span>
                  <span className="truncate">{profile.provider}</span>
                </>
              )}
              <span aria-hidden>·</span>
              <span className="shrink-0">
                {profile.skillCount} {profile.skillCount === 1 ? 'skill' : 'skills'}
              </span>
            </span>
          </div>

          <ChevronRight className="size-4 shrink-0 text-foreground-tertiary" aria-hidden />
        </Link>
      </Card>
    </motion.li>
  )
}

function ProfilesSkeleton() {
  return (
    <div data-testid="profiles-loading" className="grid gap-3" aria-busy="true">
      {[0, 1].map((i) => (
        <Card key={i} size="sm">
          <div className="flex items-center gap-3.5 px-4 py-1">
            <Skeleton circle className="size-11" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}
