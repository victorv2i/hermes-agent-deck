/**
 * Tests for the WorkPanel store.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useWorkPanelStore } from './workPanelStore'

function reset() {
  useWorkPanelStore.setState({ open: false, artifact: null })
}

describe('workPanelStore', () => {
  beforeEach(reset)

  it('starts closed with no artifact', () => {
    const s = useWorkPanelStore.getState()
    expect(s.open).toBe(false)
    expect(s.artifact).toBeNull()
  })

  it('openArtifact sets an artifact and opens the panel', () => {
    useWorkPanelStore.getState().openArtifact({
      type: 'code',
      title: 'src/index.ts',
      lang: 'typescript',
      content: 'const x = 1',
    })
    const s = useWorkPanelStore.getState()
    expect(s.open).toBe(true)
    expect(s.artifact).not.toBeNull()
    expect(s.artifact?.title).toBe('src/index.ts')
    expect(s.artifact?.type).toBe('code')
  })

  it('close sets open to false but keeps the artifact (so reopen returns to it)', () => {
    useWorkPanelStore.getState().openArtifact({
      type: 'markdown',
      title: 'README.md',
      content: '# Hello',
    })
    useWorkPanelStore.getState().close()
    const s = useWorkPanelStore.getState()
    expect(s.open).toBe(false)
    expect(s.artifact?.title).toBe('README.md')
  })

  it('toggle flips open when an artifact is already set', () => {
    useWorkPanelStore.getState().openArtifact({
      type: 'code',
      title: 'app.py',
      lang: 'python',
      content: 'print("hi")',
    })
    expect(useWorkPanelStore.getState().open).toBe(true)
    useWorkPanelStore.getState().toggle()
    expect(useWorkPanelStore.getState().open).toBe(false)
    useWorkPanelStore.getState().toggle()
    expect(useWorkPanelStore.getState().open).toBe(true)
  })

  it('openArtifact replaces an existing artifact', () => {
    useWorkPanelStore.getState().openArtifact({
      type: 'code',
      title: 'first.ts',
      lang: 'typescript',
      content: 'const a = 1',
    })
    useWorkPanelStore.getState().openArtifact({
      type: 'markdown',
      title: 'second.md',
      content: '# Second',
    })
    const s = useWorkPanelStore.getState()
    expect(s.artifact?.title).toBe('second.md')
    expect(s.artifact?.type).toBe('markdown')
  })

  it('supports html artifact type', () => {
    useWorkPanelStore.getState().openArtifact({
      type: 'html',
      title: 'page.html',
      content: '<h1>Hello</h1>',
    })
    const s = useWorkPanelStore.getState()
    expect(s.artifact?.type).toBe('html')
  })
})
