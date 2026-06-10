import { describe, it, expect } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { ImageLightbox } from './ImageLightbox'

const SRC = 'data:image/png;base64,AAAA'

function renderLightbox(alt = 'a diagram') {
  return render(
    <ThemeProvider>
      <ImageLightbox src={SRC} alt={alt} trigger={<img src={SRC} alt={alt} />} />
    </ThemeProvider>,
  )
}

describe('ImageLightbox', () => {
  it('renders the trigger thumbnail as a keyboard-operable enlarge button', () => {
    renderLightbox()
    const btn = screen.getByRole('button', { name: /enlarge image: a diagram/i })
    expect(btn).toBeInTheDocument()
    expect(btn).toHaveAttribute('aria-haspopup', 'dialog')
  })

  it('opens an accessible dialog showing the full image on click', async () => {
    const user = userEvent.setup()
    renderLightbox()
    await user.click(screen.getByRole('button', { name: /enlarge image/i }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeInTheDocument()
    // The dialog has an accessible name from the alt text.
    expect(dialog).toHaveAccessibleName('a diagram')
    // The full image is shown inside the dialog.
    const fullImg = within(dialog).getByRole('img', { name: 'a diagram' })
    expect(fullImg).toHaveAttribute('src', SRC)
  })

  it('closes on Escape (focus trap + Esc come from the Dialog primitive)', async () => {
    const user = userEvent.setup()
    renderLightbox()
    await user.click(screen.getByRole('button', { name: /enlarge image/i }))
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('still names the dialog when the alt is empty (never nameless)', async () => {
    const user = userEvent.setup()
    renderLightbox('')
    await user.click(screen.getByRole('button', { name: /enlarge image/i }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAccessibleName('Enlarged image')
  })

  it('gives the close affordance a guaranteed-contrast backing surface', async () => {
    const user = userEvent.setup()
    renderLightbox()
    await user.click(screen.getByRole('button', { name: /enlarge image/i }))
    const dialog = await screen.findByRole('dialog')
    const close = within(dialog).getByRole('button', { name: /close/i })
    // A solid disc backs the X so it reads over any image region, not relying on
    // the transparent dialog surface (which would leave the muted X invisible).
    expect(close.className).toMatch(/bg-black\/65/)
    expect(close.className).toMatch(/text-white/)
    // The custom close still closes via the Dialog primitive's contract.
    await user.click(close)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
