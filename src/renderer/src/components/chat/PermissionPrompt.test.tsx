/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

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
}

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: typeof chatState) => unknown) => selector(chatState),
  useActiveSession: (selector: (state: typeof activeSessionState) => unknown) => selector(activeSessionState),
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

vi.mock('./tool-display', () => ({
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

vi.mock('lucide-react', () => ({
  Bot: () => <span>bot</span>,
  Circle: () => <span>circle</span>,
  CheckCircle2: () => <span>check</span>,
  ChevronDown: () => <span>chevron-down</span>,
  ChevronUp: () => <span>chevron-up</span>,
  ShieldAlert: () => <span>alert</span>,
}))


import { PermissionPrompt } from './PermissionPrompt'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PermissionPrompt', () => {
  it('shows four codex decision buttons without feedback input', () => {
    render(<PermissionPrompt />)

    expect(screen.getByText('Allow').closest('button')).toBeTruthy()
    expect(screen.getByRole('button', { name: /allow for this session/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /decline/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeTruthy()
    expect(screen.queryByPlaceholderText('Deny reason (optional, Enter to submit)')).toBeNull()
  })

  it('sends decline when pressing Escape in the codex prompt', () => {
    render(<PermissionPrompt />)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(chatState.respondToPermission).toHaveBeenCalledWith('req-1', false, undefined, undefined)
  })

  it('sends allow for this session when pressing Shift+Enter in the codex prompt', () => {
    render(<PermissionPrompt />)

    fireEvent.keyDown(window, { key: 'Enter', shiftKey: true })

    expect(chatState.respondToPermission).toHaveBeenCalledWith('req-1', true, true)
  })

  it('sends cancel through the codex permission action', () => {
    render(<PermissionPrompt />)

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

    expect(chatState.respondToPermission).toHaveBeenCalledWith('req-1', false, undefined, undefined, undefined, 'cancel')
  })
})
