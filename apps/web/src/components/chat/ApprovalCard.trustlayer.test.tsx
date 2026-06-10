/**
 * Trust-layer test for ApprovalCard — item 6:
 * Description (human context) must appear ABOVE the raw command block,
 * so a newcomer reads what/why before the raw command to assess safety.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { PendingApproval } from '@/state/chatStore'
import { ApprovalCard } from './ApprovalCard'

const approval: PendingApproval = {
  run_id: 'run_1',
  command: 'rm -rf /tmp/cache',
  description: 'Delete the build cache to free up disk space',
  choices: ['once', 'deny'],
}

describe('ApprovalCard — description above command (item 6)', () => {
  it('renders the description above the command block in DOM order', () => {
    render(<ApprovalCard approval={approval} onRespond={() => {}} />)

    const description = screen.getByText('Delete the build cache to free up disk space')
    const command = screen.getByText('rm -rf /tmp/cache')

    // The description must come BEFORE the command in DOM order
    // (DOCUMENT_POSITION_FOLLOWING = 4, means command follows description)
    const descBeforeCmd =
      description.compareDocumentPosition(command) & Node.DOCUMENT_POSITION_FOLLOWING
    expect(descBeforeCmd).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('still renders both description and command', () => {
    render(<ApprovalCard approval={approval} onRespond={() => {}} />)
    expect(screen.getByText('Delete the build cache to free up disk space')).toBeInTheDocument()
    expect(screen.getByText('rm -rf /tmp/cache')).toBeInTheDocument()
  })

  it('renders correctly when description is absent', () => {
    const noDesc: PendingApproval = { ...approval, description: '' }
    render(<ApprovalCard approval={noDesc} onRespond={() => {}} />)
    expect(screen.getByText('rm -rf /tmp/cache')).toBeInTheDocument()
  })
})
