import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useChatStore } from '@/state/useChatStore'
import { initialChatState } from '@/state/chatStore'
import { RunNotifications } from './RunNotifications'

/**
 * The render-null mount point drives the subscriber: when mounted and the
 * operator isn't viewing chat, a run completing fires a toast. (Full transition
 * coverage lives in useRunNotifications.test.ts; this asserts the component wires
 * the hook and renders nothing.)
 */

const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn() }

describe('RunNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useChatStore.setState({ ...initialChatState })
  })
  afterEach(() => {
    useChatStore.setState({ ...initialChatState })
  })

  it('renders nothing and runs the subscriber', () => {
    // The component reads the active agent via useProfiles (TanStack Query) to
    // personalize the notification, so it needs a QueryClient. No BFF in jsdom →
    // the roster stays empty (faceless fallback), which is fine for this assertion.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <RunNotifications
          isViewingChat={() => false}
          isTabBlurred={() => false}
          toast={toast}
          notifier={{ ensurePermission: vi.fn().mockResolvedValue(false), notify: vi.fn() }}
        />
      </QueryClientProvider>,
    )
    expect(container).toBeEmptyDOMElement()

    act(() => useChatStore.setState({ runStatus: 'running' }))
    act(() => useChatStore.setState({ runStatus: 'idle' }))
    expect(toast.success).toHaveBeenCalledTimes(1)
  })
})
