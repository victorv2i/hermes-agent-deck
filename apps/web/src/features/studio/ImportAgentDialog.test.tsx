import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ImportAgentDialog } from './ImportAgentDialog'

// Drive the import mutation + the file→base64 read so we exercise the dialog's
// validation/flow (not the network or FileReader).
const importMutate = vi.fn().mockResolvedValue({ name: 'imported' })
const navigate = vi.fn()

vi.mock('./hooks', () => ({
  useImportStudioProfile: () => ({ mutateAsync: importMutate, isPending: false, reset: vi.fn() }),
}))
vi.mock('./data/api', () => ({
  fileToBase64: vi.fn().mockResolvedValue('YmFzZTY0LWJ5dGVz'),
}))
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}))

beforeEach(() => {
  importMutate.mockClear()
  navigate.mockClear()
})

function renderDialog(existingNames: string[] = ['mercury']) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ImportAgentDialog open onOpenChange={vi.fn()} existingNames={existingNames} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** Pick a fake .tar.gz file in the hidden file input. */
async function pickFile(name = 'atlas.tar.gz') {
  const file = new File([new Uint8Array([1, 2, 3])], name, { type: 'application/gzip' })
  const input = screen.getByTestId('studio-import-file') as HTMLInputElement
  await userEvent.upload(input, file)
  return file
}

describe('ImportAgentDialog', () => {
  it('keeps Import disabled until a file is chosen and the name is valid', async () => {
    renderDialog()
    expect(screen.getByTestId('studio-import-submit')).toBeDisabled()
    await pickFile()
    // The name is auto-suggested from the file (atlas), which is valid → enabled.
    expect(screen.getByTestId('studio-import-submit')).toBeEnabled()
  })

  it('suggests a sanitized agent id from the chosen file name', async () => {
    renderDialog()
    await pickFile('My Cool Agent.tar.gz')
    // Spaces → dashes, lowercased, .tar.gz stripped.
    expect(screen.getByLabelText(/new agent id/i)).toHaveValue('my-cool-agent')
  })

  it('blocks a name that collides with an existing agent', async () => {
    renderDialog(['atlas'])
    await pickFile('atlas.tar.gz')
    // The suggested name (atlas) already exists → invalid → disabled + a message.
    expect(screen.getByTestId('studio-import-submit')).toBeDisabled()
    expect(screen.getByText(/already exists/i)).toBeInTheDocument()
  })

  it('blocks importing over the reserved default id', async () => {
    renderDialog([])
    await pickFile('whatever.tar.gz')
    const nameInput = screen.getByLabelText(/new agent id/i)
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'default')
    expect(screen.getByTestId('studio-import-submit')).toBeDisabled()
    expect(screen.getByText(/built-in agent/i)).toBeInTheDocument()
  })

  it('imports the file as base64 under the chosen name, then opens the new agent', async () => {
    renderDialog([])
    await pickFile('atlas.tar.gz')
    await userEvent.click(screen.getByTestId('studio-import-submit'))
    await waitFor(() =>
      expect(importMutate).toHaveBeenCalledWith({
        name: 'atlas',
        archiveBase64: 'YmFzZTY0LWJ5dGVz',
      }),
    )
    expect(navigate).toHaveBeenCalledWith('/profiles/imported')
  })

  it('says credentials are not included in an export (honest note)', () => {
    renderDialog()
    expect(screen.getByText(/provider keys are not included/i)).toBeInTheDocument()
  })
})
