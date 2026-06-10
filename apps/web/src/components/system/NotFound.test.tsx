import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { NotFound } from './NotFound'

describe('NotFound (404)', () => {
  it('shows a calm not-found message and a link home', () => {
    render(
      <MemoryRouter>
        <NotFound />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: /page not found/i })).toBeInTheDocument()
    const home = screen.getByRole('link', { name: /back to home/i })
    expect(home).toHaveAttribute('href', '/')
  })
})
