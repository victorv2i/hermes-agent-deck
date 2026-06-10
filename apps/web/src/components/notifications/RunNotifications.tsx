/**
 * RunNotifications (A1) — a render-null mount point for {@link
 * useRunNotifications}. Drop it once alongside the app chrome (e.g. next to the
 * <Toaster/>); it renders nothing and simply runs the subscriber that surfaces a
 * run finishing / failing / blocking on an approval when the operator isn't
 * looking at the conversation.
 *
 * It is self-contained: the default collaborators probe the live DOM (route,
 * focus, visibility) and the browser Notification API, so no props are required.
 */
import { useEffect, useRef } from 'react'
import { useProfiles } from '@/features/profiles/useProfiles'
import { resolveAvatar } from '@/features/profiles/avatarForProfile'
import {
  useRunNotifications,
  type NotifyAgent,
  type UseRunNotificationsOptions,
} from './useRunNotifications'

export function RunNotifications(props: UseRunNotificationsOptions = {}): null {
  // The active agent's identity, kept in a ref so the headless subscriber reads the
  // LATEST name/avatar at emit time (a finished-run notice reads "Sol
  // finished" with the agent's face) WITHOUT re-subscribing on every roster poll.
  // Written in an effect (never during render) so the ref stays a side-effect.
  const { data } = useProfiles()
  const agentRef = useRef<NotifyAgent | null>(null)
  useEffect(() => {
    agentRef.current = resolveActiveAgent(data)
  }, [data])

  useRunNotifications({ getAgent: () => agentRef.current, ...props })
  return null
}

/** The active agent's name + avatar for the notification, or null when the roster
 * hasn't loaded or the active agent is the unnamed default (→ faceless copy, but
 * the face still rides as the icon). */
function resolveActiveAgent(data: ReturnType<typeof useProfiles>['data']): NotifyAgent | null {
  const profiles = data?.profiles
  if (!profiles || profiles.length === 0) return null
  const activeName = data?.active
  const active =
    profiles.find((p) => p.name === activeName) ?? profiles.find((p) => p.isDefault) ?? profiles[0]
  if (!active) return null
  // Prefer the user-chosen displayName; fall back to the profile id for non-default
  // agents. The default/unnamed agent stays the honest faceless "Run finished" copy.
  const displayName = active.displayName?.trim()
  const isNonDefault = !(active.isDefault || active.name === 'default')
  const name = displayName || (isNonDefault ? active.name.trim() : undefined)
  return {
    // Only a REAL name personalizes the notification title.
    ...(name ? { name } : {}),
    avatarId: resolveAvatar(active),
  }
}
