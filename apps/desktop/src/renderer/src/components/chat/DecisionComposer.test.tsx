/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AskUserQuestionRequest, PermissionRequest } from '@superone/shared/agent-types'

const { session } = vi.hoisted(() => ({ session: {
  pendingPermissions: [{ requestId: 'p1' }, { requestId: 'p2' }] as PermissionRequest[],
  pendingQuestion: { requestId: 'q1', questions: [] } as AskUserQuestionRequest | null,
} }))
vi.mock('@/stores/chat', () => ({ useActiveSession: (select: (s: typeof session) => unknown) => select(session) }))
vi.mock('@superone/chat-view/mod-ui', () => ({ ModQuestionSite: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('./PermissionPrompt', () => ({ PermissionPrompt: ({ request }: { request: PermissionRequest }) => <button>Permission {request.requestId}</button> }))
vi.mock('./AskUserQuestionPrompt', () => ({ AskUserQuestionPrompt: ({ request }: { request: AskUserQuestionRequest }) => <div>Question {request.requestId}</div> }))
import { DecisionComposer } from './DecisionComposer'

describe('DecisionComposer', () => {
  it('shows one decision at a time without a position counter', () => {
    const { container, rerender } = render(<DecisionComposer />)
    expect(screen.getByText('Permission p1')).toBeInTheDocument()
    expect(screen.queryByText(/Question/)).toBeNull()
    expect(container.textContent).not.toMatch(/\d\s*\/\s*\d/)

    session.pendingPermissions = [session.pendingPermissions[1]!]
    rerender(<DecisionComposer />)
    expect(screen.getByText('Permission p2')).toBeInTheDocument()
    session.pendingPermissions = []
    rerender(<DecisionComposer />)
    expect(screen.getByText('Question q1')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/\d\s*\/\s*\d/)
  })

  it('guards a decision already pending when the chat root first mounts', () => {
    session.pendingPermissions = [{ requestId: 'initial', toolName: 'Bash', input: {}, allowAlwaysAllow: false }]
    session.pendingQuestion = null
    render(<div data-chat-root=""><DecisionComposer /></div>)
    const button = screen.getByRole('button', { name: 'Permission initial' })
    button.focus()
    expect(fireEvent.keyDown(button, { key: 'Enter' })).toBe(false)
  })

  it('takes the focus the replaced editor dropped on <body>, but not from another surface', () => {
    session.pendingPermissions = [{ requestId: 'focus', toolName: 'Read', input: {}, allowAlwaysAllow: false }]
    session.pendingQuestion = null
    ;(document.activeElement as HTMLElement | null)?.blur()
    const { unmount } = render(<div data-chat-root=""><DecisionComposer /></div>)
    expect(document.activeElement).toBe(screen.getByTestId('decision-composer'))
    unmount()

    const terminal = document.body.appendChild(document.createElement('textarea'))
    terminal.focus()
    render(<div data-chat-root=""><DecisionComposer /></div>)
    expect(document.activeElement).toBe(terminal)
    terminal.remove()
  })

  it('retains a resolved request for its exit animation and makes it inert', () => {
    const request = { requestId: 'outgoing', toolName: 'Bash', input: {}, allowAlwaysAllow: false }
    session.pendingPermissions = [request]
    session.pendingQuestion = null
    const item = { kind: 'permission' as const, request }
    const { rerender } = render(<DecisionComposer item={item} />)
    expect(screen.getByTestId('decision-composer')).not.toHaveAttribute('inert')
    session.pendingPermissions = [{ ...request, requestId: 'next' }]
    rerender(<DecisionComposer item={item} />)
    expect(screen.getByText('Permission outgoing')).toBeInTheDocument()
    expect(screen.getByTestId('decision-composer')).toHaveAttribute('inert')
    expect(screen.queryByText('Permission next')).toBeNull()
  })
})
