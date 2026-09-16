/** @vitest-environment jsdom */

import { createRef, type RefObject } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react'
import type { PermissionRequest } from '@superone/shared/agent-types'
import { ChatRootContext } from './is-focus-in-chat'

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
  }] as PermissionRequest[],
  sessionProvider: 'codex',
  cwd: '/repo',
  homedir: '/Users/test',
  selectedModel: 'model-1',
}

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: typeof chatState) => unknown) => selector(chatState),
  useActiveSession: (selector: (state: typeof activeSessionState) => unknown) => selector(activeSessionState),
  // The prompt reaches its replies through the scope-bound wrapper now; outside a
  // SessionScopeProvider it forwards to the same store actions.
  useScopedSessionActions: () => chatState,
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

/** Shortcuts only fire while focus is inside this pane's [data-chat-root]. */
function renderInChat(ui: ReactElement) {
  const rootRef = createRef<HTMLDivElement>()
  const result = render(
    <div ref={rootRef} data-chat-root="" tabIndex={-1}>
      <ChatRootContext.Provider value={rootRef as RefObject<HTMLElement | null>}>
        {ui}
      </ChatRootContext.Provider>
    </div>,
  )
  ;(result.container.querySelector('[data-chat-root]') as HTMLElement).focus()
  return result
}

beforeEach(() => {
  vi.clearAllMocks()
  activeSessionState.pendingPermissions = [{
    requestId: 'req-1',
    toolName: 'Bash',
    input: { command: 'ls', cwd: '/repo' },
    allowAlwaysAllow: true,
  }]
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

  it('opens a URL elicitation in the browser and keeps the waiting card', () => {
    activeSessionState.pendingPermissions = [{
      requestId: 'elicit-url',
      toolName: 'github',
      input: {},
      allowAlwaysAllow: false,
      requestKind: 'mcp_elicitation',
      serverName: 'github',
      message: 'Sign in to GitHub',
      elicitationUrl: 'https://github.com/login/oauth',
      elicitationId: 'e-1',
    }]
    const openExternal = vi.fn()
    ;(window as unknown as { app: { openExternalLink: typeof openExternal } }).app = {
      openExternalLink: openExternal,
    }

    renderInChat(<PermissionPrompt />)

    fireEvent.click(screen.getByRole('button', { name: /open in browser/i }))
    expect(openExternal).toHaveBeenCalledWith('https://github.com/login/oauth')
    expect(chatState.respondToPermission).not.toHaveBeenCalled()
    expect(screen.getByText(/waiting for authorization/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reopen/i })).toBeInTheDocument()
  })

  it('ignores Escape when focus is in a sibling mosaic chat pane', () => {
    const rootA = createRef<HTMLDivElement>()
    const rootB = createRef<HTMLDivElement>()
    render(
      <div>
        <div ref={rootA} data-chat-root="" tabIndex={-1}>
          <input data-testid="pane-a-input" />
        </div>
        <div ref={rootB} data-chat-root="" tabIndex={-1}>
          <ChatRootContext.Provider value={rootB as RefObject<HTMLElement | null>}>
            <PermissionPrompt />
          </ChatRootContext.Provider>
        </div>
      </div>,
    )

    act(() => {
      screen.getByTestId('pane-a-input').focus()
    })
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(chatState.respondToPermission).not.toHaveBeenCalled()
  })

  it('does not autofocus permission buttons when another chat pane owns focus', async () => {
    const rootA = createRef<HTMLDivElement>()
    const rootB = createRef<HTMLDivElement>()
    render(
      <div>
        <div ref={rootA} data-chat-root="" tabIndex={-1}>
          <input data-testid="pane-a-input" />
        </div>
        <div ref={rootB} data-chat-root="" tabIndex={-1}>
          <ChatRootContext.Provider value={rootB as RefObject<HTMLElement | null>}>
            <PermissionPrompt />
          </ChatRootContext.Provider>
        </div>
      </div>,
    )

    act(() => {
      screen.getByTestId('pane-a-input').focus()
    })
    // Flush the rAF autofocus scheduled on mount
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(r))
    })

    expect(document.activeElement).toBe(screen.getByTestId('pane-a-input'))
  })

  describe('defaultToNo (Claude SDK prompt hint)', () => {
    beforeEach(() => {
      activeSessionState.sessionProvider = 'claude'
      activeSessionState.pendingPermissions = [{
        requestId: 'req-no',
        toolName: 'Bash',
        input: { command: 'git push --force' },
        allowAlwaysAllow: false,
        defaultToNo: true,
      }]
    })

    it('autofocuses Deny instead of Allow', async () => {
      renderInChat(<PermissionPrompt />)
      await act(async () => {
        await new Promise((r) => requestAnimationFrame(r))
      })
      expect(document.activeElement).toBe(screen.getByRole('button', { name: /deny/i }))
    })

    it('rejects on a bare Enter rather than approving', () => {
      renderInChat(<PermissionPrompt />)
      fireEvent.keyDown(window, { key: 'Enter' })
      expect(chatState.respondToPermission).toHaveBeenCalledWith('req-no', false, undefined, undefined)
    })
  })

  describe('terminal command confirm', () => {
    beforeEach(() => {
      activeSessionState.pendingPermissions = [{
        requestId: 'req-term',
        toolName: 'mcp__superone__terminal_tabs',
        toolUseId: 'tu-term',
        input: { action: 'run', command: 'npm run dev', cwd: '/repo', rule: 'npm run:*' },
        allowAlwaysAllow: true,
        supportsAlwaysPersist: true,
        requestKind: 'terminal_command_confirm',
        serverName: 'superone',
        message: 'Run npm run dev?',
      }]
    })

    it('keeps Allow / Deny and offers the project rule as a toggle, off by default', () => {
      renderInChat(<PermissionPrompt />)
      expect(screen.getByRole('button', { name: /^allow/i })).toBeTruthy()
      expect(screen.getByRole('button', { name: /deny/i })).toBeTruthy()
      expect(screen.queryByRole('button', { name: /always allow in project/i })).toBeNull()
      const toggle = screen.getByRole('button', { pressed: false, name: /always allow npm run:\* in this project/i })
      expect(toggle).toBeTruthy()

      fireEvent.click(screen.getByRole('button', { name: /^allow/i }))
      expect(chatState.respondToPermission).toHaveBeenCalledWith('req-term', true)
    })

    it('stores the rule when the toggle is on and Allow is pressed', () => {
      renderInChat(<PermissionPrompt />)
      fireEvent.click(screen.getByRole('button', { name: /always allow npm run:\* in this project/i }))
      expect(screen.getByRole('button', { pressed: true })).toBeTruthy()

      fireEvent.keyDown(window, { key: 'Enter' })
      expect(chatState.respondToPermission).toHaveBeenCalledWith('req-term', true, true)
    })

    it('toggles the rule with the 1 key', () => {
      renderInChat(<PermissionPrompt />)
      fireEvent.keyDown(window, { key: '1' })
      expect(screen.getByRole('button', { pressed: true })).toBeTruthy()
      fireEvent.keyDown(window, { key: '1' })
      expect(screen.queryByRole('button', { pressed: true })).toBeNull()
    })

    it('shows no toggle when always-allow is not offered', () => {
      activeSessionState.pendingPermissions[0] = {
        ...activeSessionState.pendingPermissions[0]!,
        allowAlwaysAllow: false,
        input: { action: 'close', command: 'node', cwd: '/repo', tab: 'dev server' },
      }
      renderInChat(<PermissionPrompt />)
      expect(screen.queryByRole('button', { pressed: false })).toBeNull()
      expect(screen.queryByText(/always allow/i)).toBeNull()
    })
  })
})
