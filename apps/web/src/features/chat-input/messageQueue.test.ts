import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { enqueue, cancel, takeNext, type QueuedMessage, useMessageQueue } from './messageQueue'

// --- Pure queue core ---------------------------------------------------------
// FIFO semantics with stable ids: enqueue appends, cancel removes by id, takeNext
// pops the head. These are the load-bearing invariants the UI relies on (a queued
// message is clearly pending and cancel really removes it before it sends).
describe('messageQueue core', () => {
  const items = (q: QueuedMessage[]) => q.map((m) => m.text)

  it('enqueue appends to the tail (FIFO order)', () => {
    let q: QueuedMessage[] = []
    q = enqueue(q, 'first')
    q = enqueue(q, 'second')
    q = enqueue(q, 'third')
    expect(items(q)).toEqual(['first', 'second', 'third'])
  })

  it('enqueue assigns a stable, unique id per item', () => {
    let q: QueuedMessage[] = []
    q = enqueue(q, 'a')
    q = enqueue(q, 'a')
    expect(q).toHaveLength(2)
    expect(q[0]!.id).not.toEqual(q[1]!.id)
  })

  it('enqueue ignores empty / whitespace-only text', () => {
    let q: QueuedMessage[] = []
    q = enqueue(q, '   ')
    q = enqueue(q, '')
    expect(q).toHaveLength(0)
  })

  it('enqueue stores the text verbatim (no trimming of inner content)', () => {
    const q = enqueue([], '  hello world  ')
    // The raw text is preserved; trimming is the send path's job, matching the
    // composer's own behavior so a queued send is byte-identical to a live one.
    expect(q[0]!.text).toBe('  hello world  ')
  })

  it('cancel removes the matching id and leaves the rest in order', () => {
    let q: QueuedMessage[] = []
    q = enqueue(q, 'first')
    q = enqueue(q, 'second')
    q = enqueue(q, 'third')
    const targetId = q[1]!.id
    q = cancel(q, targetId)
    expect(items(q)).toEqual(['first', 'third'])
  })

  it('cancel is a no-op for an unknown id', () => {
    let q: QueuedMessage[] = []
    q = enqueue(q, 'only')
    const before = q
    q = cancel(q, 'does-not-exist')
    expect(items(q)).toEqual(['only'])
    expect(q).toEqual(before)
  })

  it('takeNext pops the head (FIFO) and returns the remaining tail', () => {
    let q: QueuedMessage[] = []
    q = enqueue(q, 'first')
    q = enqueue(q, 'second')
    const { next, rest } = takeNext(q)
    expect(next?.text).toBe('first')
    expect(items(rest)).toEqual(['second'])
  })

  it('takeNext on an empty queue returns null next and an empty rest', () => {
    const { next, rest } = takeNext([])
    expect(next).toBeNull()
    expect(rest).toEqual([])
  })
})

// --- useMessageQueue hook ----------------------------------------------------
// The hook is the thin LAYER over the run pump: while a run is active, enqueue()
// holds messages; when `running` falls to false it auto-fires the next queued
// message via the supplied send(), ONE AT A TIME, in FIFO order. It never touches
// the pump internals — it only observes the `running` boolean the host derives
// from runStatus.
describe('useMessageQueue', () => {
  it('holds messages while running and does not send them', () => {
    const send = vi.fn()
    const { result } = renderHook(({ running }) => useMessageQueue({ running, send }), {
      initialProps: { running: true },
    })
    act(() => {
      result.current.enqueue('one')
      result.current.enqueue('two')
    })
    expect(send).not.toHaveBeenCalled()
    expect(result.current.queue.map((m) => m.text)).toEqual(['one', 'two'])
  })

  it('flushes ONE message when the run completes (running → false)', () => {
    const send = vi.fn()
    const { result, rerender } = renderHook(({ running }) => useMessageQueue({ running, send }), {
      initialProps: { running: true },
    })
    act(() => {
      result.current.enqueue('one')
      result.current.enqueue('two')
    })
    // Run completes: exactly the head flushes; the rest stays queued (one at a time).
    rerender({ running: false })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('one')
    expect(result.current.queue.map((m) => m.text)).toEqual(['two'])
  })

  it('flushes the queue FIFO across successive completions', () => {
    const send = vi.fn()
    const { result, rerender } = renderHook(({ running }) => useMessageQueue({ running, send }), {
      initialProps: { running: true },
    })
    act(() => {
      result.current.enqueue('one')
      result.current.enqueue('two')
      result.current.enqueue('three')
    })
    // First completion fires 'one'. The flush starts a new run, so the host flips
    // running back to true (a fresh run is in flight for the flushed message).
    rerender({ running: false })
    expect(send).toHaveBeenLastCalledWith('one')
    rerender({ running: true })
    // Second completion fires 'two'.
    rerender({ running: false })
    expect(send).toHaveBeenLastCalledWith('two')
    rerender({ running: true })
    // Third completion fires 'three' and drains the queue.
    rerender({ running: false })
    expect(send).toHaveBeenLastCalledWith('three')
    expect(send).toHaveBeenCalledTimes(3)
    expect(result.current.queue).toEqual([])
  })

  it('cancel removes a queued message before it can send', () => {
    const send = vi.fn()
    const { result, rerender } = renderHook(({ running }) => useMessageQueue({ running, send }), {
      initialProps: { running: true },
    })
    act(() => {
      result.current.enqueue('one')
      result.current.enqueue('two')
    })
    const headId = result.current.queue[0]!.id
    act(() => {
      result.current.cancel(headId)
    })
    expect(result.current.queue.map((m) => m.text)).toEqual(['two'])
    // On completion only the surviving message flushes; the cancelled one is gone.
    rerender({ running: false })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('two')
  })

  it('does not send when the queue is empty on completion', () => {
    const send = vi.fn()
    const { rerender } = renderHook(({ running }) => useMessageQueue({ running, send }), {
      initialProps: { running: true },
    })
    rerender({ running: false })
    expect(send).not.toHaveBeenCalled()
  })

  it('does not re-flush on unrelated re-renders while idle', () => {
    const send = vi.fn()
    const { result, rerender } = renderHook(({ running }) => useMessageQueue({ running, send }), {
      initialProps: { running: false },
    })
    // Enqueue while idle is unusual (the composer enqueues only while running), but
    // if it happens we must not double-fire on every idle render. The head flushes
    // once on the next render tick, then stays drained.
    act(() => {
      result.current.enqueue('one')
    })
    rerender({ running: false })
    rerender({ running: false })
    expect(send).toHaveBeenCalledTimes(1)
  })

  // --- canFlush gating -------------------------------------------------------
  // A run that ENDS IN ERROR/CANCEL (or a disconnected channel) flips `canFlush`
  // false: the run-completion edge must NOT fire the queued message into a dead /
  // just-failed channel. The message is HELD; it flushes only once the channel is
  // healthy again (canFlush → true) — never dropped, never resent into a failure.
  it('does NOT flush when the run ends but canFlush is false (failed/cancelled run)', () => {
    const send = vi.fn()
    const { result, rerender } = renderHook(
      ({ running, canFlush }) => useMessageQueue({ running, send, canFlush }),
      { initialProps: { running: true, canFlush: true } },
    )
    act(() => {
      result.current.enqueue('one')
    })
    // The run completes by FAILING: running → false AND canFlush → false (the host
    // gates on the last run's error). The queued message must stay put.
    rerender({ running: false, canFlush: false })
    expect(send).not.toHaveBeenCalled()
    expect(result.current.queue.map((m) => m.text)).toEqual(['one'])
  })

  it('flushes the held message once canFlush rises (reconnect / a clean run clears the error)', () => {
    const send = vi.fn()
    const { result, rerender } = renderHook(
      ({ running, canFlush }) => useMessageQueue({ running, send, canFlush }),
      { initialProps: { running: true, canFlush: true } },
    )
    act(() => {
      result.current.enqueue('one')
    })
    // Failed end: held while idle + not-flushable.
    rerender({ running: false, canFlush: false })
    expect(send).not.toHaveBeenCalled()
    // The channel recovers (reconnect, or a fresh clean run cleared the error)
    // while still idle: the held head flushes on the canFlush rising edge.
    rerender({ running: false, canFlush: true })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('one')
    expect(result.current.queue).toEqual([])
  })

  it('does not flush into a disconnected composer (canFlush stays false across the idle window)', () => {
    const send = vi.fn()
    const { result, rerender } = renderHook(
      ({ running, canFlush }) => useMessageQueue({ running, send, canFlush }),
      { initialProps: { running: true, canFlush: false } },
    )
    act(() => {
      result.current.enqueue('one')
    })
    // Disconnected for the whole window: completes but never becomes flushable.
    rerender({ running: false, canFlush: false })
    rerender({ running: false, canFlush: false })
    expect(send).not.toHaveBeenCalled()
    expect(result.current.queue.map((m) => m.text)).toEqual(['one'])
  })
})
