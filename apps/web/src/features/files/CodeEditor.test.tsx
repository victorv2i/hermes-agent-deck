import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import CodeEditor from './CodeEditor'

interface KeyBinding {
  key: string
  preventDefault?: boolean
  run: () => boolean
}

const cm = vi.hoisted(() => ({
  keymapOf: vi.fn((bindings: KeyBinding[]) => ({ kind: 'keymap', bindings })),
  precHigh: vi.fn((extension: unknown) => ({ kind: 'high', extension })),
  precHighest: vi.fn((extension: unknown) => ({ kind: 'highest', extension })),
  props: [] as Array<{ extensions: unknown[]; readOnly?: boolean }>,
}))

vi.mock('@uiw/react-codemirror', () => ({
  default: (props: { extensions: unknown[]; readOnly?: boolean }) => {
    cm.props.push(props)
    return <textarea data-testid="code-editor" readOnly={props.readOnly} />
  },
  EditorView: {
    theme: vi.fn((spec: unknown) => ({ kind: 'theme', spec })),
    lineWrapping: { kind: 'lineWrapping' },
  },
  keymap: { of: cm.keymapOf },
  Prec: { high: cm.precHigh, highest: cm.precHighest },
}))

vi.mock('@/components/theme/theme-context', () => ({
  useTheme: () => ({ resolvedTheme: 'dark' as const }),
}))

function latestSaveBinding(): KeyBinding {
  const bindings = cm.keymapOf.mock.calls.at(-1)?.[0] ?? []
  const binding = bindings.find((candidate) => candidate.key === 'Mod-s')
  expect(binding).toBeDefined()
  return binding!
}

beforeEach(() => {
  cm.keymapOf.mockClear()
  cm.precHigh.mockClear()
  cm.props.length = 0
})

describe('CodeEditor', () => {
  it('registers Mod-s as an editor save command', () => {
    const onSave = vi.fn()
    render(<CodeEditor value="draft" onChange={vi.fn()} onSave={onSave} filename="README.md" />)

    const binding = latestSaveBinding()
    expect(binding.preventDefault).toBe(true)
    expect(binding.run()).toBe(true)
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('does not call save while read-only', () => {
    const onSave = vi.fn()
    render(
      <CodeEditor value="draft" onChange={vi.fn()} onSave={onSave} filename="README.md" readOnly />,
    )

    expect(latestSaveBinding().run()).toBe(true)
    expect(onSave).not.toHaveBeenCalled()
  })
})
