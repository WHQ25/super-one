/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react'

const chatState = {
  respondToPermission: vi.fn(),
  setPermissionMode: vi.fn(),
}

const activeSessionState = {
  pendingPermissions: [{
    requestId: 'req-1',
    toolName: 'Bash',
    input: { command: 'ls', cwd: '/repo' },
    allowAlwaysAllow: true,
  }],
  sessionProvider: 'codex',
  cwd: '/repo',
  homedir: '/Users/test',
  selectedModel: 'model-1',
}

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: typeof chatState) => unknown) => selector(chatState),
  useActiveSession: (selector: (state: typeof activeSessionState) => unknown) => selector(activeSessionState),
  selectClaudeModels: () => [],
  selectClaudeAccount: () => ({}),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}))

vi.mock('@/components/ui/kbd', () => ({
  Kbd: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}))

vi.mock('./ToolIcon', () => ({
  ToolIcon: () => <span>icon</span>,
}))

vi.mock('./tool-display', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getToolDisplay: () => ({ icon: 'terminal', summary: 'ls' }),
  extractPartialToolInput: () => ({}),
  parseMcpToolName: (name: string) => {
    const m = name.match(/^mcp__(.+?)__(.+)$/)
    return m ? { serverName: m[1], mcpToolName: m[2] } : null
  },
}))

vi.mock('@/stores/miniapp', () => ({
  useMiniAppStore: (selector: (state: { apps: Array<{ id: string; manifest: Record<string, unknown> }> }) => unknown) =>
    selector({ apps: [] }),
}))

vi.mock('@/components/miniapp/MiniAppIcon', () => ({
  MiniAppIcon: () => <span>app-icon</span>,
}))

vi.mock('./PermissionModeSelector', () => ({
  modes: [],
}))

import { PermissionPrompt } from './PermissionPrompt'

/** Shortcuts only fire while focus is inside [data-chat-root]. */
function renderInChat(ui: ReactElement) {
  const result = render(<div data-chat-root="" tabIndex={-1}>{ui}</div>)
  ;(result.container.querySelector('[data-chat-root]') as HTMLElement).focus()
  return result
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PermissionPrompt', () => {
  it('shows four codex decision buttons without feedback input', () => {
    renderInChat(<PermissionPrompt />)

    expect(screen.getByText('Allow').closest('button')).toBeTruthy()
    expect(screen.getByRole('button', { name: /allow for this session/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /decline/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeTruthy()
    expect(screen.queryByPlaceholderText('Deny reason (optional, Enter to submit)')).toBeNull()
  })

  it('sends decline when pressing Escape in the codex prompt', () => {
    renderInChat(<PermissionPrompt />)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(chatState.respondToPermission).toHaveBeenCalledWith('req-1', false, undefined, undefined)
  })

  it('sends allow for this session when pressing Shift+Enter in the codex prompt', () => {
    renderInChat(<PermissionPrompt />)

    fireEvent.keyDown(window, { key: 'Enter', shiftKey: true })

    expect(chatState.respondToPermission).toHaveBeenCalledWith('req-1', true, true)
  })

  it('ignores Escape when focus is outside the chat pane', () => {
    render(<PermissionPrompt />)
    // Default jsdom focus is body — outside [data-chat-root].
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(chatState.respondToPermission).not.toHaveBeenCalled()
  })

  it('sends cancel through the codex permission action', () => {
    renderInChat(<PermissionPrompt />)

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

    expect(chatState.respondToPermission).toHaveBeenCalledWith('req-1', false, undefined, undefined, undefined, 'cancel')
  })
})
