import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BudgetControl } from './BudgetControl'
import { getBudget, setBudget } from '@/features/budget/budgetStore'

beforeEach(() => {
  setBudget({ daily: null, monthly: null })
  localStorage.clear()
})

afterEach(() => {
  setBudget({ daily: null, monthly: null })
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('BudgetControl', () => {
  it('renders both unset caps with placeholders and the honest framing', () => {
    render(<BudgetControl />)
    expect(screen.getByText('Cost')).toBeInTheDocument()
    // Honest copy: it warns, it does not stop the agent.
    expect(screen.getByText(/warning, not a hard stop/i)).toBeInTheDocument()
    const inputs = screen.getAllByRole('spinbutton')
    expect(inputs).toHaveLength(2)
    inputs.forEach((i) => expect(i).toHaveValue(null))
  })

  it('persists a daily cap to the store as the user types', async () => {
    const user = userEvent.setup()
    render(<BudgetControl />)
    const daily = screen.getByLabelText(/spend more than dollars per day/i)
    await user.type(daily, '10')
    expect(getBudget().daily).toBe(10)
  })

  it('clearing a field unsets that cap', async () => {
    const user = userEvent.setup()
    setBudget({ monthly: 300 })
    render(<BudgetControl />)
    const monthly = screen.getByLabelText(/dollars per month/i)
    expect(monthly).toHaveValue(300)
    await user.clear(monthly)
    expect(getBudget().monthly).toBeNull()
  })

  it('reflects an existing stored budget', () => {
    setBudget({ daily: 12, monthly: 360 })
    render(<BudgetControl />)
    expect(screen.getByLabelText(/dollars per day/i)).toHaveValue(12)
    expect(screen.getByLabelText(/dollars per month/i)).toHaveValue(360)
  })
})
