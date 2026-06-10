import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { NlSchedulePicker } from './NlSchedulePicker'

function renderPicker(props: Partial<Parameters<typeof NlSchedulePicker>[0]> = {}) {
  const onApply = props.onApply ?? vi.fn()
  render(
    <ThemeProvider>
      <NlSchedulePicker onApply={onApply} {...props} />
    </ThemeProvider>,
  )
  return { onApply }
}

describe('NlSchedulePicker', () => {
  it('shows the parsed cron verbatim for a recognized phrase (honesty)', async () => {
    const user = userEvent.setup()
    renderPicker()
    const input = screen.getByLabelText(/plain.language|describe.*schedule/i)
    await user.type(input, 'every morning at 8')
    // The exact cron it becomes is shown, so the user sees the truth.
    expect(screen.getByText('0 8 * * *')).toBeInTheDocument()
  })

  it('renders an honest "next runs" preview for a recognized phrase', async () => {
    const user = userEvent.setup()
    renderPicker()
    const input = screen.getByLabelText(/plain.language|describe.*schedule/i)
    await user.type(input, 'every day at 9am')
    const preview = screen.getByTestId('nl-next-runs')
    // At least one upcoming time is listed (we don't assert the wording, just that
    // the preview is populated — it's computed from the real cron).
    expect(preview.textContent?.length ?? 0).toBeGreaterThan(0)
  })

  it('applies the parsed cron via onApply (the real schedule string)', async () => {
    const user = userEvent.setup()
    const { onApply } = renderPicker()
    const input = screen.getByLabelText(/plain.language|describe.*schedule/i)
    await user.type(input, 'every weekday at 9am')
    await user.click(screen.getByRole('button', { name: /use this|apply/i }))
    expect(onApply).toHaveBeenCalledWith('0 9 * * 1-5')
  })

  it('disables apply and says it is not understood for an unknown phrase (fallback, no guess)', async () => {
    const user = userEvent.setup()
    const { onApply } = renderPicker()
    const input = screen.getByLabelText(/plain.language|describe.*schedule/i)
    await user.type(input, 'whenever I feel like it')
    expect(
      screen.getByText(/didn.t understand|not understood|couldn.t read|use the cron field/i),
    ).toBeInTheDocument()
    const apply = screen.getByRole('button', { name: /use this|apply/i })
    expect(apply).toBeDisabled()
    expect(onApply).not.toHaveBeenCalled()
  })

  it('shows nothing parsed (no cron, apply disabled) when empty', () => {
    renderPicker()
    expect(screen.queryByTestId('nl-next-runs')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /use this|apply/i })).toBeDisabled()
  })

  it('the input is at least 40px tall (touch target)', async () => {
    renderPicker()
    const input = screen.getByLabelText(/plain.language|describe.*schedule/i)
    expect(input.className).toMatch(/h-10|min-h-\[40|h-11|h-12/)
  })
})
