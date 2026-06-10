import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePinPalette } from './usePinPalette'
import * as palette from '@/features/themes/palette'
import { DEFAULT_PALETTE_ID } from '@/features/themes/palette-registry'

afterEach(() => vi.restoreAllMocks())

describe('usePinPalette — pin a palette for the wizard, restore on exit', () => {
  it('applies the pinned palette on mount WITHOUT persisting it (no clobber)', () => {
    const apply = vi.spyOn(palette, 'applyPalette').mockImplementation(() => {})
    const setP = vi.spyOn(palette, 'setPalette').mockImplementation(() => {})
    vi.spyOn(palette, 'getPalette').mockReturnValue('warm-void')

    renderHook(() => usePinPalette(DEFAULT_PALETTE_ID))

    // The pin is applied to the DOM only — never setPalette (which persists +
    // would clobber the owner's saved choice).
    expect(apply).toHaveBeenCalledWith(DEFAULT_PALETTE_ID)
    expect(setP).not.toHaveBeenCalled()
  })

  it("restores the user's SAVED palette on unmount (does not clobber it)", () => {
    const apply = vi.spyOn(palette, 'applyPalette').mockImplementation(() => {})
    // The owner's real saved palette at the moment the wizard opens.
    vi.spyOn(palette, 'getPalette').mockReturnValue('warm-void')

    const { unmount } = renderHook(() => usePinPalette(DEFAULT_PALETTE_ID))
    apply.mockClear()
    unmount()

    // On exit the SAVED palette is re-applied to the DOM, restoring the owner's
    // look exactly — never left on the pinned wizard palette.
    expect(apply).toHaveBeenCalledWith('warm-void')
  })

  it('captures the saved palette ONCE at mount, so a re-render does not lose it', () => {
    const apply = vi.spyOn(palette, 'applyPalette').mockImplementation(() => {})
    const getP = vi.spyOn(palette, 'getPalette').mockReturnValue('indigo-atelier')

    const { rerender, unmount } = renderHook(() => usePinPalette(DEFAULT_PALETTE_ID))
    // Even if getPalette would now report the pinned value (a naive read), the
    // hook must restore the value captured at MOUNT.
    getP.mockReturnValue(DEFAULT_PALETTE_ID)
    rerender()
    apply.mockClear()
    unmount()

    expect(apply).toHaveBeenCalledWith('indigo-atelier')
  })
})
