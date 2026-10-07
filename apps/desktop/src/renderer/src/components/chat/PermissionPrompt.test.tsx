/** @vitest-environment jsdom */

import { createRef, type RefObject } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react'
import type { PermissionRequest } from '@superone/shared/agent-types'
import { elicitationFormRequest } from '@superone/shared/schema-form'
import { ChatRootContext } from './is-focus-in-chat'
import { setDecisionKeyboardPolicy } from './composer-slot/decision-composer-policy'

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
  return { ...result, rootRef }
}

beforeEach(() => {
  vi.clearAllMocks()
  activeSessionState.sessionProvider = 'codex'
  activeSessionState.pendingPermissions = [{
    requestId: 'req-1',
    toolName: 'Bash',
    input: { command: 'ls', cwd: '/repo' },
    allowAlwaysAllow: true,
  }]
})

afterEach(() => vi.useRealTimers())

describe('PermissionPrompt', () => {
  it('reviews a scoped remembered grant before replying, supports cancellation, and never submits on key repeat', async () => {
    activeSessionState.sessionProvider = 'opencode'
    activeSessionState.pendingPermissions = [{ requestId: 'per_scope', toolName: 'external_directory', input: {}, allowAlwaysAllow: true,
      permissionDetails: { action: 'external_directory', resources: ['/outside/reference/*'], save: ['/outside/*'] } }]
    renderInChat(<PermissionPrompt />)
    act(() => screen.getByRole('button', { name: /allow once/i }).focus())
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(screen.getByText('Remember Permission in This Project?')).toBeVisible()
    expect(chatState.respondToPermission).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('button', { name: /confirm & remember/i })).toHaveFocus())
    fireEvent.click(screen.getByText('Remember Permission in This Project?'))
    expect(screen.getByText('/outside/*')).toBeVisible()
    expect(screen.queryByText('/outside/reference/*')).toBeNull()
    fireEvent.click(screen.getByText('Remember Permission in This Project?'))
    await waitFor(() => expect(screen.getByRole('button', { name: /confirm & remember/i })).toHaveFocus())
    fireEvent.keyDown(window, { key: 'Enter', repeat: true })
    expect(chatState.respondToPermission).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByRole('button', { name: /allow once/i })).toBeVisible()
    expect(chatState.respondToPermission).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /remember for this project/i }))
    fireEvent.click(screen.getByRole('button', { name: /confirm & remember/i }))
    expect(chatState.respondToPermission).toHaveBeenCalledExactlyOnceWith('per_scope', true, true)
  })

  it('does not carry a remembered approval into the next request or offer persistence without save patterns', () => {
    activeSessionState.sessionProvider = 'opencode'
    const request: PermissionRequest = { requestId: 'per_old', toolName: 'external_directory', input: {}, allowAlwaysAllow: true,
      permissionDetails: { action: 'external_directory', resources: ['/outside/*'], save: ['/outside/*'] } }
    const view = renderInChat(<PermissionPrompt request={request} />)
    fireEvent.click(screen.getByRole('button', { name: /remember for this project/i }))
    view.rerender(<div ref={view.rootRef} data-chat-root="" tabIndex={-1}>
      <ChatRootContext.Provider value={view.rootRef as RefObject<HTMLElement | null>}>
        <PermissionPrompt request={{ ...request, requestId: 'per_new', permissionDetails: { action: 'external_directory', resources: ['/second/*'] } }} />
      </ChatRootContext.Provider>
    </div>)
    expect(screen.queryByRole('button', { name: /remember for this project/i })).toBeNull()
    expect(screen.queryByText('Remember Permission in This Project?')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /allow once/i }))
    expect(chatState.respondToPermission).toHaveBeenCalledExactlyOnceWith('per_new', true)
  })

  it('submits high-risk feedback on Command+Enter without approving the command', () => {
    activeSessionState.sessionProvider = 'claude'
    renderInChat(<PermissionPrompt />)
    const input = screen.getByRole('textbox')
    act(() => input.focus())
    fireEvent.change(input, { target: { value: 'Choose a safer command' } })
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true })
    expect(chatState.respondToPermission).toHaveBeenCalledExactlyOnceWith(
      'req-1', false, undefined, 'Choose a safer command',
    )
  })

  it.each([{ shiftKey: true }, { altKey: true }])('keeps high-risk feedback editable with composer newline shortcuts %j', (modifier) => {
    vi.useFakeTimers()
    activeSessionState.sessionProvider = 'claude'
    const { rootRef } = renderInChat(<PermissionPrompt />)
    const clear = setDecisionKeyboardPolicy(rootRef.current!, 'permission:feedback', true)
    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    act(() => input.focus())
    fireEvent.change(input, { target: { value: 'Use a safer command' } })
    input.setSelectionRange(input.value.length, input.value.length)

    fireEvent.keyDown(input, { key: 'Enter', ...modifier })
    expect(input.value).toBe('Use a safer command\n')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(chatState.respondToPermission).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(501))
    fireEvent.change(input, { target: { value: `${input.value}Keep the existing files` } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(chatState.respondToPermission).toHaveBeenCalledWith(
      'req-1', false, undefined, 'Use a safer command\nKeep the existing files',
    )
    clear()
  })

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

  it('ignores an arriving decision shortcut and requires Command+Enter for a risky command', () => {
    vi.useFakeTimers()
    const { rootRef } = renderInChat(<PermissionPrompt />)
    const clearPolicy = setDecisionKeyboardPolicy(rootRef.current!, 'permission:req-1', true)
    try {
      fireEvent.keyDown(window, { key: 'Enter' })
      expect(chatState.respondToPermission).not.toHaveBeenCalled()

      vi.advanceTimersByTime(501)
      fireEvent.keyDown(window, { key: 'Enter' })
      expect(chatState.respondToPermission).not.toHaveBeenCalled()

      fireEvent.keyDown(window, { key: 'Enter', metaKey: true })
      expect(chatState.respondToPermission).toHaveBeenCalledWith('req-1', true)
    } finally {
      clearPolicy()
    }
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

  it('shows Always on an ACP prompt when the agent offers allow_always', () => {
    activeSessionState.sessionProvider = 'acp'
    renderInChat(<PermissionPrompt />)

    expect(screen.getByRole('button', { name: /allow for this session/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /decline/i })).toBeTruthy()
    expect(screen.queryByPlaceholderText('Deny reason (optional, Enter to submit)')).toBeNull()
  })

  it('sends alwaysAllow on ACP Shift+Enter without flipping yolo', () => {
    activeSessionState.sessionProvider = 'acp'
    renderInChat(<PermissionPrompt />)

    fireEvent.keyDown(window, { key: 'Enter', shiftKey: true })

    expect(chatState.respondToPermission).toHaveBeenCalledWith('req-1', true, true)
    expect(chatState.setPermissionMode).not.toHaveBeenCalled()
  })

  it('keeps ACP elicitation off the four-button Always row', () => {
    activeSessionState.sessionProvider = 'acp'
    activeSessionState.pendingPermissions = [{
      requestId: 'elicit-1',
      toolName: 'github',
      input: {},
      allowAlwaysAllow: true,
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

    expect(screen.getByRole('button', { name: /open in browser/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /allow for this session/i })).toBeNull()
  })

  it('answers a form elicitation with the composer content', () => {
    activeSessionState.sessionProvider = 'codex'
    activeSessionState.pendingPermissions = [{
      requestId: 'elicit-form',
      toolName: 'bits-and-bolts',
      input: {},
      allowAlwaysAllow: false,
      requestKind: 'mcp_elicitation',
      serverName: 'bits-and-bolts',
      message: 'Choose a CAD part',
      ...elicitationFormRequest({
        type: 'object',
        required: ['part'],
        properties: { part: { type: 'string', title: 'Part', oneOf: [{ const: 'hex', title: 'Hex bolt' }] } },
      }),
    }]

    renderInChat(<PermissionPrompt />)
    fireEvent.click(screen.getByRole('radio', { name: /Hex bolt/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Submit/ }))

    expect(chatState.respondToPermission).toHaveBeenCalledWith('elicit-form', true, false, undefined, undefined, undefined, { part: 'hex' })
  })

  it('leaves Space and Enter in a form field to the form, never answering without content', () => {
    activeSessionState.sessionProvider = 'codex'
    activeSessionState.pendingPermissions = [{
      requestId: 'elicit-text',
      toolName: 'bits-and-bolts',
      input: {},
      allowAlwaysAllow: false,
      requestKind: 'mcp_elicitation',
      serverName: 'bits-and-bolts',
      message: 'Review a CAD reference',
      ...elicitationFormRequest({ type: 'object', required: ['note'], properties: { note: { type: 'string', title: 'Note' } } }),
    }]

    renderInChat(<PermissionPrompt />)
    const note = screen.getByLabelText(/Note/)
    note.focus()
    fireEvent.keyDown(note, { key: ' ' })
    fireEvent.keyDown(note, { key: 'Enter' })

    expect(screen.getByLabelText(/Note/)).toBeTruthy()
    expect(screen.getByText('Required')).toBeTruthy()
    expect(chatState.respondToPermission).not.toHaveBeenCalled()
    fireEvent.change(note, { target: { value: 'looks good' } })
    fireEvent.keyDown(note, { key: 'Enter' })
    expect(chatState.respondToPermission).toHaveBeenCalledWith('elicit-text', true, false, undefined, undefined, undefined, { note: 'looks good' })
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
        input: { action: 'run', command: 'npm run dev', cwd: '/repo', rule: 'npm run( .*)?' },
        allowAlwaysAllow: true,
        supportsAlwaysPersist: true,
        requestKind: 'terminal_command_confirm',
        serverName: 'superone',
        message: 'Run npm run dev?',
      }]
    })

    const sessionRow = () => screen.getByRole('button', { name: /allow npm run\( \.\*\)\? for this session/i })
    const projectRow = () => screen.getByRole('button', { name: /always allow npm run\( \.\*\)\? in this project/i })
    // Terminal approvals use the explicit Command+Enter shortcut.
    const allowButton = () => screen.getByRole('button', { name: /^allow(\+1)?⌘↵$/i })

    it('keeps Allow / Deny and offers the rule for the session or the project, both off by default', () => {
      renderInChat(<PermissionPrompt />)
      expect(allowButton()).toBeTruthy()
      expect(screen.getByRole('button', { name: /deny/i })).toBeTruthy()
      expect(screen.queryByRole('button', { name: /always allow in project/i })).toBeNull()
      expect(sessionRow().getAttribute('aria-pressed')).toBe('false')
      expect(projectRow().getAttribute('aria-pressed')).toBe('false')

      fireEvent.click(allowButton())
      expect(chatState.respondToPermission).toHaveBeenCalledWith('req-term', true)
    })

    it('stores the rule for the project when that row is on and Allow is pressed', () => {
      renderInChat(<PermissionPrompt />)
      fireEvent.click(projectRow())
      expect(projectRow().getAttribute('aria-pressed')).toBe('true')

      fireEvent.keyDown(window, { key: 'Enter' })
      expect(chatState.respondToPermission).toHaveBeenCalledWith('req-term', true, true, undefined, undefined, undefined, { scope: 'project' })
    })

    it('keeps the rule for the session only when that row is on', () => {
      renderInChat(<PermissionPrompt />)
      fireEvent.click(sessionRow())
      fireEvent.click(allowButton())
      expect(chatState.respondToPermission).toHaveBeenCalledWith('req-term', true, false, undefined, undefined, undefined, { scope: 'session' })
    })

    it('toggles the rows with the 1 / 2 keys, one at a time', () => {
      renderInChat(<PermissionPrompt />)
      fireEvent.keyDown(window, { key: '1' })
      expect(sessionRow().getAttribute('aria-pressed')).toBe('true')
      fireEvent.keyDown(window, { key: '2' })
      expect(sessionRow().getAttribute('aria-pressed')).toBe('false')
      expect(projectRow().getAttribute('aria-pressed')).toBe('true')
      fireEvent.keyDown(window, { key: '2' })
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
      expect(screen.queryByText(/for this session/i)).toBeNull()
    })
  })
})
