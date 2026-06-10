import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useChatStore } from '@/state/useChatStore'
import { initialChatState, type PendingApproval } from '@/state/chatStore'
import { setNotificationsEnabled } from './notificationPref'
import { useRunNotifications } from './useRunNotifications'

/**
 * A1 (run notifications): a run finishing / failing / raising an approval while
 * the operator is NOT viewing the conversation must surface a toast (+ optional
 * Notification + a blurred-tab title flip). When the operator IS watching chat in
 * the foreground, it stays silent — the transcript already shows it.
 */

const toast = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}
const notifier = {
  ensurePermission: vi.fn().mockResolvedValue(true),
  notify: vi.fn(),
}

let viewingChat = true
const titleFlip = vi.fn()
const titleRestore = vi.fn()

function mount(over?: Parameters<typeof useRunNotifications>[0]) {
  return renderHook(() =>
    useRunNotifications({
      isViewingChat: () => viewingChat,
      toast,
      notifier,
      title: { flip: titleFlip, restore: titleRestore },
      ...over,
    }),
  )
}

const APPROVAL: PendingApproval = {
  run_id: 'run_1',
  approval_id: 'ap_1',
  command: 'rm -rf /tmp',
  description: 'delete tmp',
  choices: ['once', 'deny'],
}

describe('useRunNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    notifier.ensurePermission.mockResolvedValue(true)
    viewingChat = true
    setNotificationsEnabled(true)
    useChatStore.setState({ ...initialChatState })
  })
  afterEach(() => {
    setNotificationsEnabled(true)
    useChatStore.setState({ ...initialChatState })
  })

  it('stays silent when the operator is viewing chat in the foreground', () => {
    viewingChat = true
    mount()
    act(() => useChatStore.setState({ runStatus: 'running' }))
    act(() => useChatStore.setState({ runStatus: 'idle' }))
    expect(toast.success).not.toHaveBeenCalled()
    expect(notifier.notify).not.toHaveBeenCalled()
    expect(titleFlip).not.toHaveBeenCalled()
  })

  it('the REAL default stays silent at /chat/:id (the URL carries the session id, not just /chat)', async () => {
    // Regression guard: the active conversation lives at /chat/<id>, so the default
    // "is viewing chat" check must match the whole chat surface by prefix — else a
    // run finishing while you WATCH the transcript would wrongly toast/notify.
    window.history.replaceState({}, '', '/chat/abc123')
    const focusSpy = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    renderHook(() =>
      useRunNotifications({ toast, notifier, title: { flip: titleFlip, restore: titleRestore } }),
    )
    act(() => useChatStore.setState({ runStatus: 'running' }))
    await act(async () => useChatStore.setState({ runStatus: 'idle', error: null }))
    expect(toast.success).not.toHaveBeenCalled()
    expect(notifier.notify).not.toHaveBeenCalled()
    expect(titleFlip).not.toHaveBeenCalled()
    focusSpy.mockRestore()
    window.history.replaceState({}, '', '/')
  })

  it('toasts + notifies + flips the title on completion when NOT viewing chat', async () => {
    viewingChat = false
    mount()
    act(() => useChatStore.setState({ runStatus: 'running' }))
    await act(async () => {
      useChatStore.setState({ runStatus: 'idle', error: null })
    })
    expect(toast.success).toHaveBeenCalledTimes(1)
    expect(titleFlip).toHaveBeenCalledTimes(1)
    expect(notifier.ensurePermission).toHaveBeenCalled()
    expect(notifier.notify).toHaveBeenCalledTimes(1)
  })

  it('personalizes a completed-run notification with the agent name + icon + task hint (A3)', async () => {
    viewingChat = false
    mount({ getAgent: () => ({ name: 'Sol', avatarId: 'v3' }) })
    act(() =>
      useChatStore.setState({
        runStatus: 'running',
        turns: [{ id: 'u1', role: 'user', content: 'Summarize the repo' }],
      }),
    )
    await act(async () => {
      useChatStore.setState({ runStatus: 'idle', error: null })
    })
    expect(notifier.notify).toHaveBeenCalledTimes(1)
    const notice = notifier.notify.mock.calls[0]![0]
    expect(notice.notificationTitle).toBe('Sol finished: Summarize the repo')
    expect(notice.icon).toBe('/avatars/v3.webp')
  })

  it('keeps the honest faceless notification when no agent identity is supplied', async () => {
    viewingChat = false
    mount()
    act(() => useChatStore.setState({ runStatus: 'running' }))
    await act(async () => {
      useChatStore.setState({ runStatus: 'idle', error: null })
    })
    const notice = notifier.notify.mock.calls[0]![0]
    expect(notice.notificationTitle).toBe('Run finished')
    expect(notice.icon).toBeUndefined()
  })

  it('routes a failed run to the error toast and threads the error detail', async () => {
    viewingChat = false
    mount()
    act(() => useChatStore.setState({ runStatus: 'running' }))
    await act(async () => {
      useChatStore.setState({ runStatus: 'idle', error: 'rate limited' })
    })
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.success).not.toHaveBeenCalled()
    const [, opts] = toast.error.mock.calls[0]!
    expect(opts).toMatchObject({ description: 'rate limited' })
  })

  it('warns on a pending approval that appears while NOT viewing chat', async () => {
    viewingChat = false
    mount()
    await act(async () => {
      useChatStore.setState({ runStatus: 'running', pendingApproval: APPROVAL })
    })
    expect(toast.warning).toHaveBeenCalledTimes(1)
    expect(notifier.notify).toHaveBeenCalledTimes(1)
  })

  it('does not re-fire for the same approval on an unrelated re-render', async () => {
    viewingChat = false
    mount()
    await act(async () => {
      useChatStore.setState({ runStatus: 'running', pendingApproval: APPROVAL })
    })
    expect(toast.warning).toHaveBeenCalledTimes(1)
    // An unrelated state change (a streamed token) must not re-toast the gate.
    act(() => useChatStore.setState({ error: null }))
    expect(toast.warning).toHaveBeenCalledTimes(1)
  })

  it('does not toast a run that ends while no run was active (no false positive)', () => {
    viewingChat = false
    mount()
    // Going idle->idle (e.g. a reset) must not look like a completion.
    act(() => useChatStore.setState({ runStatus: 'idle' }))
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('restores the title when the operator returns focus to the tab', async () => {
    viewingChat = false
    mount()
    act(() => useChatStore.setState({ runStatus: 'running' }))
    await act(async () => {
      useChatStore.setState({ runStatus: 'idle' })
    })
    expect(titleFlip).toHaveBeenCalled()
    // Focus returns -> the title is restored.
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(titleRestore).toHaveBeenCalled()
  })

  it('still toasts when notification permission is denied (graceful degrade)', async () => {
    viewingChat = false
    notifier.ensurePermission.mockResolvedValue(false)
    mount()
    act(() => useChatStore.setState({ runStatus: 'running' }))
    await act(async () => {
      useChatStore.setState({ runStatus: 'idle' })
    })
    expect(toast.success).toHaveBeenCalledTimes(1)
    // ensurePermission resolved false -> we never post.
    expect(notifier.notify).not.toHaveBeenCalled()
  })

  it('unsubscribes on unmount (no toast after teardown)', async () => {
    viewingChat = false
    const { unmount } = mount()
    unmount()
    act(() => useChatStore.setState({ runStatus: 'running' }))
    await act(async () => {
      useChatStore.setState({ runStatus: 'idle' })
    })
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('stays fully silent when the operator disabled notifications', async () => {
    viewingChat = false
    setNotificationsEnabled(false)
    mount()
    act(() => useChatStore.setState({ runStatus: 'running' }))
    await act(async () => {
      useChatStore.setState({ runStatus: 'idle' })
    })
    // Disabled => no toast, no title flip, no permission prompt, no notification.
    expect(toast.success).not.toHaveBeenCalled()
    expect(titleFlip).not.toHaveBeenCalled()
    expect(notifier.ensurePermission).not.toHaveBeenCalled()
    expect(notifier.notify).not.toHaveBeenCalled()
  })

  it('does not even prompt for permission for an approval when disabled', async () => {
    viewingChat = false
    setNotificationsEnabled(false)
    mount()
    await act(async () => {
      useChatStore.setState({ runStatus: 'running', pendingApproval: APPROVAL })
    })
    expect(toast.warning).not.toHaveBeenCalled()
    expect(notifier.ensurePermission).not.toHaveBeenCalled()
  })

  it('honors a mid-session toggle (re-enabled => notifies again)', async () => {
    viewingChat = false
    setNotificationsEnabled(false)
    mount()
    act(() => useChatStore.setState({ runStatus: 'running' }))
    await act(async () => {
      useChatStore.setState({ runStatus: 'idle' })
    })
    expect(toast.success).not.toHaveBeenCalled()
    // Operator flips it back on; the next completion notifies.
    act(() => setNotificationsEnabled(true))
    act(() => useChatStore.setState({ runStatus: 'running' }))
    await act(async () => {
      useChatStore.setState({ runStatus: 'idle' })
    })
    expect(toast.success).toHaveBeenCalledTimes(1)
  })
})
