import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  buildRunNotice,
  createTitleController,
  BrowserNotifier,
  type RunOutcome,
} from './runNotify'

describe('buildRunNotice (pure)', () => {
  it.each<[RunOutcome, string]>([
    ['completed', '●'],
    ['failed', '✖'],
    ['approval', '!'],
  ])('builds a %s notice with a title badge', (outcome, badge) => {
    const notice = buildRunNotice(outcome)
    expect(notice.titleBadge).toBe(badge)
    expect(notice.toastMessage).toBeTruthy()
    expect(notice.notificationTitle).toBeTruthy()
  })

  it('maps each outcome to the right toast variant', () => {
    expect(buildRunNotice('completed').toastVariant).toBe('success')
    expect(buildRunNotice('failed').toastVariant).toBe('error')
    expect(buildRunNotice('approval').toastVariant).toBe('warning')
  })

  it('threads a failure detail into the toast description and the notification body', () => {
    const notice = buildRunNotice('failed', { detail: 'rate limited' })
    expect(notice.toastDescription).toBe('rate limited')
    expect(notice.notificationBody).toContain('rate limited')
  })

  it('omits the description when no detail is given', () => {
    expect(buildRunNotice('completed').toastDescription).toBeUndefined()
  })

  it('personalizes the notification with the agent name + a task hint (A3)', () => {
    const notice = buildRunNotice('completed', {
      agentName: 'Sol',
      taskHint: 'repo summary ready',
    })
    // "Sol finished — repo summary ready" beats a faceless "Run finished".
    expect(notice.notificationTitle).toBe('Sol finished: repo summary ready')
  })

  it('attaches the agent avatar as the notification icon (A3)', () => {
    const notice = buildRunNotice('completed', { agentName: 'Sol', avatarId: 'v3' })
    // Avatars resolve to /avatars/<id>.webp (served public path).
    expect(notice.icon).toBe('/avatars/v3.webp')
  })

  it('keeps the honest faceless copy when no agent identity is supplied', () => {
    const notice = buildRunNotice('completed')
    expect(notice.notificationTitle).toBe('Run finished')
    expect(notice.icon).toBeUndefined()
  })

  it('still names the agent on failure + approval, keeping the detail (A3)', () => {
    const failed = buildRunNotice('failed', { agentName: 'Sol', detail: 'rate limited' })
    expect(failed.notificationTitle).toContain('Sol')
    expect(failed.notificationBody).toContain('rate limited')

    const approval = buildRunNotice('approval', { agentName: 'Sol', detail: 'rm -rf build' })
    expect(approval.notificationTitle).toContain('Sol')
    expect(approval.notificationBody).toContain('rm -rf build')
  })
})

describe('createTitleController', () => {
  let originalTitle: string
  beforeEach(() => {
    originalTitle = document.title
    document.title = 'Agent Deck'
  })
  afterEach(() => {
    document.title = originalTitle
  })

  it('flips the document title with a badge and restores it exactly', () => {
    const ctl = createTitleController()
    ctl.flip(buildRunNotice('completed'))
    expect(document.title).toMatch(/^●/)
    ctl.restore()
    expect(document.title).toBe('Agent Deck')
  })

  it('captures the base title from the first flip, not from a stale flip', () => {
    const ctl = createTitleController()
    ctl.flip(buildRunNotice('completed'))
    // A second flip (e.g. approval after completion) must not bake the badged
    // title in as the base — restore still returns the original.
    ctl.flip(buildRunNotice('approval'))
    expect(document.title).toMatch(/^!/)
    ctl.restore()
    expect(document.title).toBe('Agent Deck')
  })

  it('restore is a no-op when nothing was flipped', () => {
    const ctl = createTitleController()
    ctl.restore()
    expect(document.title).toBe('Agent Deck')
  })
})

describe('BrowserNotifier', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('degrades silently when the Notification API is unavailable', async () => {
    const notifier = new BrowserNotifier(undefined)
    // Should neither throw nor return a notification.
    await expect(notifier.ensurePermission()).resolves.toBe(false)
    expect(notifier.notify(buildRunNotice('completed'))).toBeNull()
  })

  it('requests permission lazily and only once when default', async () => {
    const requestPermission = vi.fn().mockResolvedValue('granted')
    const ctor = makeNotificationCtor('default', requestPermission)
    const notifier = new BrowserNotifier(ctor)

    expect(await notifier.ensurePermission()).toBe(true)
    expect(await notifier.ensurePermission()).toBe(true)
    // Asked the browser exactly once; the second call reused the resolved grant.
    expect(requestPermission).toHaveBeenCalledTimes(1)
  })

  it('does not re-prompt once permission was denied', async () => {
    const requestPermission = vi.fn().mockResolvedValue('denied')
    const ctor = makeNotificationCtor('default', requestPermission)
    const notifier = new BrowserNotifier(ctor)

    expect(await notifier.ensurePermission()).toBe(false)
    expect(await notifier.ensurePermission()).toBe(false)
    expect(requestPermission).toHaveBeenCalledTimes(1)
  })

  it('posts a Notification when already granted and never prompts', async () => {
    const requestPermission = vi.fn()
    const ctor = makeNotificationCtor('granted', requestPermission)
    const notifier = new BrowserNotifier(ctor)

    expect(await notifier.ensurePermission()).toBe(true)
    const n = notifier.notify(
      buildRunNotice('failed', { detail: 'boom' }),
    ) as FakeNotification | null
    expect(n).not.toBeNull()
    expect(n!.title).toContain('Run failed')
    expect(requestPermission).not.toHaveBeenCalled()
  })

  it('returns null from notify when permission is not granted', () => {
    const ctor = makeNotificationCtor('denied', vi.fn())
    const notifier = new BrowserNotifier(ctor)
    expect(notifier.notify(buildRunNotice('completed'))).toBeNull()
  })

  it('routes through the service worker when a registration is present', () => {
    const ctor = makeNotificationCtor('granted', vi.fn())
    const showNotification = vi.fn().mockResolvedValue(undefined)
    const getRegistration = vi.fn(() => ({ showNotification }))
    const notifier = new BrowserNotifier(ctor, getRegistration)

    const result = notifier.notify(buildRunNotice('failed', { detail: 'boom' }))

    // The SW path is preferred (works while the tab is backgrounded); the in-tab
    // `new Notification(...)` is NOT constructed.
    expect(showNotification).toHaveBeenCalledTimes(1)
    const [title, opts] = showNotification.mock.calls[0]!
    expect(title).toContain('Run failed')
    expect(opts).toMatchObject({ body: expect.stringContaining('boom') })
    // SW path resolves a Promise, not a Notification instance.
    expect(result).toBeNull()
  })

  it('passes the avatar icon through to the posted notification (A3)', () => {
    const ctor = makeNotificationCtor('granted', vi.fn())
    const showNotification = vi.fn().mockResolvedValue(undefined)
    const getRegistration = vi.fn(() => ({ showNotification }))
    const notifier = new BrowserNotifier(ctor, getRegistration)

    notifier.notify(buildRunNotice('completed', { agentName: 'Sol', avatarId: 'v3' }))

    const [, opts] = showNotification.mock.calls[0]!
    expect(opts).toMatchObject({ icon: '/avatars/v3.webp' })
  })

  it('falls back to the in-tab Notification when no SW registration is available', () => {
    const ctor = makeNotificationCtor('granted', vi.fn())
    const getRegistration = vi.fn(() => null)
    const notifier = new BrowserNotifier(ctor, getRegistration)

    const n = notifier.notify(buildRunNotice('completed')) as FakeNotification | null
    expect(n).not.toBeNull()
    expect(n!.title).toContain('Run finished')
  })

  it('does not touch the service worker when permission is not granted', () => {
    const ctor = makeNotificationCtor('denied', vi.fn())
    const showNotification = vi.fn()
    const getRegistration = vi.fn(() => ({ showNotification }))
    const notifier = new BrowserNotifier(ctor, getRegistration)

    expect(notifier.notify(buildRunNotice('completed'))).toBeNull()
    expect(showNotification).not.toHaveBeenCalled()
  })
})

// --- test doubles for the Notification API -------------------------------

class FakeNotification {
  static permission: NotificationPermission = 'default'
  static requestPermission: () => Promise<NotificationPermission>
  title: string
  options?: NotificationOptions
  constructor(title: string, options?: NotificationOptions) {
    this.title = title
    if (options) this.options = options
  }
}

function makeNotificationCtor(
  permission: NotificationPermission,
  requestPermission: () => Promise<NotificationPermission>,
) {
  class Ctor extends FakeNotification {}
  Ctor.permission = permission
  Ctor.requestPermission = requestPermission
  return Ctor as unknown as typeof Notification
}
