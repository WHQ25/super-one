/** @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { chatActions, activeSessionState, editorState, useChatStore, mentionPopup, sessionScope, goalState } = vi.hoisted(() => {
  const mentionPopup = {
    props: null as null | { query: string; onResultState?: (q: string, isEmpty: boolean) => void },
  }
  const activeSessionState = {
    draftText: '',
    status: 'idle' as const,
    attachments: [] as Array<{ mimeType: string; base64: string; name: string }>,
    browserAnnotations: [] as Array<{ id: string }>,
    mentions: [] as Array<{ kind: 'file' | 'directory' | 'agent'; value: string; displayName: string }>,
    permissionMode: 'default' as const,
    hasPendingInteraction: false,
    queuedMessages: [] as Array<{ id: string }>,
    miniAppContexts: {} as Record<string, never>,
    userSelections: [] as string[],
    projectAdditionalDirs: [] as string[],
    userAdditionalDirs: [] as string[],
    additionalDirs: [] as string[],
    messages: [] as unknown[],
    cwd: '/project' as string,
    homedir: '/home/user' as string,
    slashCommands: [] as Array<{ name: string; description: string; argumentHint: string; isSkill: boolean }>,
    preferredProvider: 'claude' as 'claude' | 'codex' | 'acp' | 'opencode' | 'cursor',
    sessionProvider: null as 'claude' | 'codex' | 'acp' | 'opencode' | 'cursor' | null,
    acpSlashCommands: [] as Array<{ name: string; description: string; argumentHint: string; isSkill: boolean }>,
    acpSlashCommandsStatus: 'idle' as 'idle' | 'loading' | 'ready' | 'error',
    acpAgentId: null as string | null,
    agents: [] as Array<{ name: string }>,
    selectedCodexCollaborationMode: 'default' as const,
    codexPlanRejectHintActive: false,
    chatInputFocusNonce: 0,
    chatInputRestoreFocusNonce: 0,
    promptSuggestion: null as string | null,
    showDirManager: false,
    showReviewPanel: false,
    _activeSessionId: 'session-1',
    slashCommandOutput: null as { command: string; content: string; mode?: 'overlay' | 'popup' } | null,
  }

  const chatActions = {
    setDraftText: vi.fn((text: string) => {
      activeSessionState.draftText = text
    }),
    setDraftJson: vi.fn(),
    sendMessage: vi.fn(async () => undefined),
    editQueuedMessage: vi.fn(),
    interrupt: vi.fn(),
    toggleOpen: vi.fn(),
    addAttachment: vi.fn(),
    removeAttachment: vi.fn(),
    clearAttachments: vi.fn(),
    addMention: vi.fn(),
    removeMention: vi.fn(),
    dismissSlashCommandOutput: vi.fn(),
    setShowDirManager: vi.fn((show: boolean) => {
      activeSessionState.showDirManager = show
    }),
    setShowReviewPanel: vi.fn((show: boolean) => {
      activeSessionState.showReviewPanel = show
    }),
    toggleMiniAppContext: vi.fn(),
    clearMiniAppContext: vi.fn(),
    removeUserSelectionAt: vi.fn(),
    clearUserSelections: vi.fn(),
    activeProject: '/project',
    isOpen: true,
    harnessResources: {
      claude: null,
      codex: null,
      acp: { agents: [], selectedAgentId: null },
      opencode: { models: [], agents: [], commands: [] },
    },
    ensureAcpSlashCommands: vi.fn(),
    _cursorSlashItems: [] as Array<{ name: string; description: string; argumentHint: string; isSkill: boolean; promptBody?: string }>,
  }

  const useChatStore = Object.assign(
    (selector: (state: typeof chatActions) => unknown) => selector(chatActions),
    {
      getState: () => ({
        ...chatActions,
        setSelectedCodexCollaborationMode: vi.fn(),
      }),
    },
  )

  const editorState = {
    text: '',
    onUpdate: null as null | ((payload: { editor: unknown }) => void),
    handleKeyDown: null as null | ((view: unknown, event: KeyboardEvent) => boolean),
    editor: null as unknown,
    composing: false,
    destroyed: false,
  }

  const sessionScope = {
    value: null as { projectPath: string; sessionId: string } | null,
  }

  const goalState = {
    threadId: undefined as string | undefined,
    getGoal: vi.fn(),
  }

  return { chatActions, activeSessionState, editorState, useChatStore, mentionPopup, sessionScope, goalState }
})

vi.mock('@tiptap/react', () => {
  const stripHtml = (value: string) => value.replace(/<[^>]+>/g, '')

  const createEditor = () => {
    const editor = {
      storage: {
        slashDecoration: { slashCommands: [] as unknown[] },
        promptSuggestion: { suggestion: null as string | null },
        sessionMentionDecoration: { projects: [] as unknown[] },
      },
      getText: () => {
        if (editorState.destroyed) throw new Error('Destroyed editor accessed')
        return editorState.text
      },
      getJSON: () => ({ type: 'doc', content: [{ type: 'paragraph', content: editorState.text ? [{ type: 'text', text: editorState.text }] : [] }] }),
      chain: () => {
        const textFromContent = (value: unknown) => {
          if (typeof value === 'string') return stripHtml(value)
          if (!value || typeof value !== 'object') return ''
          const doc = value as { content?: Array<{ content?: Array<{ type: string; text?: string }> }> }
          const nodes = doc.content?.[0]?.content ?? []
          return nodes.map((node) => (node.type === 'hardBreak' ? '\n' : node.text ?? '')).join('')
        }
        const chain = {
          focus: () => chain,
          setContent: (value: unknown) => {
            editorState.text = textFromContent(value)
            return chain
          },
          clearContent: () => {
            editorState.text = ''
            return chain
          },
          insertContent: () => chain,
          insertContentAt: () => chain,
          deleteRange: () => chain,
          setHardBreak: () => chain,
          scrollIntoView: () => chain,
          run: () => {
            editorState.onUpdate?.({ editor })
            return true
          },
        }
        return chain
      },
      commands: {
        focus: vi.fn(),
        clearContent: vi.fn(() => {
          editorState.text = ''
          editorState.onUpdate?.({ editor })
        }),
        setContent: vi.fn((value: string) => {
          editorState.text = stripHtml(value)
          editorState.onUpdate?.({ editor })
        }),
        blur: vi.fn(),
        setHardBreak: vi.fn(),
      },
      state: {
        selection: { from: editorState.text.length },
        doc: {
          get firstChild() {
            return {
              content: { size: editorState.text.length },
              forEach: () => {},
            }
          },
          descendants: (callback: (node: { isText: boolean; text: string; type: { name: string }; isBlock: boolean }, pos: number) => boolean | void) => {
            if (!editorState.text) return
            callback({ isText: true, text: editorState.text, type: { name: 'text' }, isBlock: false }, 1)
          },
          resolve: () => ({
            parent: { textBetween: () => editorState.text },
            parentOffset: editorState.text.length,
            start: () => 1,
          }),
        },
      },
      view: {
        dispatch: vi.fn(),
        hasFocus: vi.fn(() => false),
        dom: { classList: { toggle: vi.fn() } },
        get composing() {
          return editorState.composing
        },
      },
      get isDestroyed() {
        return editorState.destroyed
      },
    }

    Object.defineProperty(editor, 'isEmpty', {
      get: () => editorState.text.length === 0,
    })

    return editor
  }

  return {
    useEditor: (config: {
      onUpdate?: (payload: { editor: unknown }) => void
      editorProps?: { handleKeyDown?: (view: unknown, event: KeyboardEvent) => boolean }
    }) => {
      editorState.onUpdate = config.onUpdate ?? null
      editorState.handleKeyDown = config.editorProps?.handleKeyDown ?? null
      editorState.editor = createEditor()
      return editorState.editor
    },
    EditorContent: () => (
      <div
        data-testid="editor"
        contentEditable
        suppressContentEditableWarning
        onInput={(e) => {
          editorState.text = e.currentTarget.textContent ?? ''
          if (editorState.editor) editorState.onUpdate?.({ editor: editorState.editor })
        }}
      >
        {editorState.text}
      </div>
    ),
  }
})

vi.mock('@tiptap/starter-kit', () => ({
  default: { configure: () => ({}) },
}))

vi.mock('@tiptap/extension-placeholder', () => ({
  default: { configure: () => ({}) },
}))

vi.mock('./mention-node', () => ({
  MentionNode: {},
}))

vi.mock('./paste-chip-node', () => ({
  PasteChipNode: {},
  PASTE_CHIP_LINE_THRESHOLD: 10,
  PASTE_CHIP_CHAR_THRESHOLD: 1000,
}))

vi.mock('./slash-decoration', () => ({
  SlashDecoration: { configure: () => ({}) },
}))

vi.mock('./prompt-suggestion', () => ({
  PromptSuggestion: {},
}))

vi.mock('@/stores/chat', () => ({
  CODEX_REJECT_PLAN_PLACEHOLDER: 'reject-plan',
  CLAUDE_INTERCEPTED_COMMAND_NAMES: new Set(['clear', 'provider', 'mcp', 'workflows']),
  runClaudeInterceptedCommand: vi.fn(),
  useChatStore,
  useActiveSession: (selector: (state: typeof activeSessionState) => unknown) => selector(activeSessionState),
  useIsRemoteLocked: () => false,
  useSessionScope: () => sessionScope.value,
  selectCodexPrompts: () => [],
  selectActiveCodexSkills: () => [],
  selectActiveCursorSlashItems: (state: typeof chatActions) => state._cursorSlashItems,
  selectOpenCodeCommands: (state: typeof chatActions) => state.harnessResources.opencode.commands,
  getLatestCodexThreadId: () => goalState.threadId,
}))

vi.mock('@/stores/app', () => ({
  useEffectiveProjectRoot: () => null,
  selectEffectiveProjectRoot: () => null,
  useAppStore: (selector: (state: { recentFolders: unknown[] }) => unknown) =>
    selector({ recentFolders: [] }),
}))

vi.mock('./ContextUsage', () => ({
  ContextUsage: () => null,
}))

vi.mock('./MentionPopup', () => ({
  MentionPopup: (props: { query: string; onResultState?: (q: string, isEmpty: boolean) => void }) => {
    mentionPopup.props = props
    return <div data-testid="mention-popup" data-query={props.query} />
  },
}))

vi.mock('./AttachmentChipNode', () => ({
  AttachmentChipNode: () => null,
}))

vi.mock('./ContextBar', () => ({
  ContextBar: () => null,
}))

vi.mock('./ModelSelector', () => ({
  ModelSelector: () => null,
}))

vi.mock('./CodexGoalIndicator', () => ({
  CodexGoalIndicator: ({ goal }: { goal: { objective: string } }) => (
    <div data-testid="codex-goal-indicator">{goal.objective}</div>
  ),
}))

vi.mock('./ProviderSlashPopup', () => ({
  ProviderSlashPopup: () => null,
}))

vi.mock('./DirManagerPanel', () => ({
  DirManagerPanel: () => null,
}))

vi.mock('./ReviewPanel', () => ({
  ReviewPanel: () => <div>review panel</div>,
}))

vi.mock('./StopButton', () => ({
  StopButton: () => null,
}))

vi.mock('@/components/ui/HighlightedText', () => ({
  HighlightedText: ({ text }: { text: string }) => <span>{text}</span>,
}))

import { ChatInput } from './ChatInput'

beforeEach(() => {
  vi.clearAllMocks()
  editorState.text = ''
  editorState.onUpdate = null
  editorState.handleKeyDown = null
  editorState.editor = null
  editorState.composing = false
  editorState.destroyed = false
  activeSessionState.draftText = ''
  activeSessionState.attachments = []
  activeSessionState.mentions = []
  activeSessionState.preferredProvider = 'claude'
  activeSessionState.sessionProvider = null
  chatActions._cursorSlashItems = []
  activeSessionState.showDirManager = false
  activeSessionState.showReviewPanel = false
  activeSessionState._activeSessionId = 'session-1'
  sessionScope.value = null
  goalState.threadId = undefined
  goalState.getGoal.mockReset()
  Object.assign(window, {
    app: {
      ...window.app,
      codexGetGoal: goalState.getGoal,
    },
  })
  mentionPopup.props = null
})

function typeInEditor(value: string) {
  const editor = screen.getByTestId('editor')
  editor.textContent = value
  fireEvent.input(editor)
}

describe('ChatInput', () => {
  it('does not access a destroyed editor while Activity restores effects', () => {
    editorState.destroyed = true
    expect(() => render(<ChatInput />)).not.toThrow()
  })

  it('opens the Codex review panel after switching providers without remounting', () => {
    const { rerender } = render(<ChatInput />)

    activeSessionState.preferredProvider = 'codex'
    rerender(<ChatInput />)

    const editor = screen.getByTestId('editor')
    editor.textContent = '/review'
    fireEvent.input(editor)

    rerender(<ChatInput />)

    chatActions.setDraftText.mockClear()
    chatActions.setShowReviewPanel.mockClear()

    const slashButton = screen.getAllByText('/review').map((node) => node.closest('button')).find(Boolean) ?? null
    expect(slashButton).toBeTruthy()

    fireEvent.mouseDown(slashButton!)

    expect(chatActions.setShowReviewPanel).toHaveBeenCalledWith(true)
  })

  it('does not subscribe or refocus when the project focus changes outside a scoped pane', () => {
    sessionScope.value = { projectPath: '/project', sessionId: 'session-1' }
    let projectActiveSessionId = 'session-1'
    const readProjectActiveSessionId = vi.fn(() => projectActiveSessionId)
    Object.defineProperty(activeSessionState, '_activeSessionId', {
      configurable: true,
      get: readProjectActiveSessionId,
      set: (value: string) => { projectActiveSessionId = value },
    })

    try {
      const { rerender } = render(<ChatInput />)
      const firstEditor = editorState.editor as { commands: { focus: ReturnType<typeof vi.fn> } }
      firstEditor.commands.focus.mockClear()

      activeSessionState._activeSessionId = 'session-2'
      rerender(<ChatInput />)

      const nextEditor = editorState.editor as { commands: { focus: ReturnType<typeof vi.fn> } }
      expect(readProjectActiveSessionId).not.toHaveBeenCalled()
      expect(firstEditor.commands.focus).not.toHaveBeenCalled()
      expect(nextEditor.commands.focus).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(activeSessionState, '_activeSessionId', {
        configurable: true,
        writable: true,
        value: projectActiveSessionId,
      })
    }
  })

  it('shows a persisted Goal next to the Codex model controls', async () => {
    activeSessionState.preferredProvider = 'codex'
    goalState.threadId = 'thread-1'
    goalState.getGoal.mockResolvedValue({
      threadId: 'thread-1',
      objective: 'Ship the goal UX',
      status: 'active',
      tokenBudget: null,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAt: 1,
      updatedAt: 1,
    })

    render(<ChatInput />)

    await waitFor(() => {
      expect(goalState.getGoal).toHaveBeenCalledWith('session-1', 'thread-1')
    })
    expect(screen.getByTestId('codex-goal-indicator')).toHaveTextContent('Ship the goal UX')
  })

  it('passes the mosaic session scope as the sendMessage target', () => {
    sessionScope.value = { projectPath: '/project', sessionId: 'sid-new' }
    activeSessionState.draftText = 'hello from tile'
    editorState.text = 'hello from tile'

    render(<ChatInput />)

    // Footer send control is the ArrowUp icon button (last icon-button in the composer).
    const send = document.querySelector('button .lucide-arrow-up')?.closest('button')
    expect(send).toBeTruthy()
    fireEvent.click(send!)

    expect(chatActions.sendMessage).toHaveBeenCalledWith(
      'hello from tile',
      expect.any(Array),
      expect.any(Array),
      expect.any(Array),
      { projectPath: '/project', sessionId: 'sid-new' },
    )
  })
})

describe('ChatInput @-mention no-match suppression', () => {
  it('keeps the popup hidden while typing further past a query that returned no matches', () => {
    render(<ChatInput />)

    typeInEditor('@zzz')
    expect(screen.getByTestId('mention-popup')).toHaveAttribute('data-query', 'zzz')

    mentionPopup.props!.onResultState!('zzz', true)

    typeInEditor('@zzzz')
    expect(screen.queryByTestId('mention-popup')).toBeNull()

    typeInEditor('@zzzzz')
    expect(screen.queryByTestId('mention-popup')).toBeNull()
  })

  it('does not re-flash the popup on each backspace, only re-showing once the query is below the no-match length', () => {
    render(<ChatInput />)

    typeInEditor('@zzz')
    expect(screen.getByTestId('mention-popup')).toHaveAttribute('data-query', 'zzz')
    mentionPopup.props!.onResultState!('zzz', true)

    typeInEditor('@zzzz')
    expect(screen.queryByTestId('mention-popup')).toBeNull()

    typeInEditor('@zzz')
    expect(screen.queryByTestId('mention-popup')).toBeNull()

    typeInEditor('@zz')
    expect(screen.getByTestId('mention-popup')).toHaveAttribute('data-query', 'zz')
  })

  it('re-shows the popup when the user backspaces and retypes different characters past a prior no-match prefix', () => {
    render(<ChatInput />)

    typeInEditor('@claudesessoi')
    expect(screen.getByTestId('mention-popup')).toHaveAttribute('data-query', 'claudesessoi')
    mentionPopup.props!.onResultState!('claudesessoi', true)

    typeInEditor('@claudesessoix')
    expect(screen.queryByTestId('mention-popup')).toBeNull()

    typeInEditor('@claudesessio')
    expect(screen.getByTestId('mention-popup')).toHaveAttribute('data-query', 'claudesessio')
  })

  it('keeps the popup open during IME composition even when transient pinyin exceeds the prior no-match length', () => {
    const { rerender } = render(<ChatInput />)

    editorState.composing = true
    typeInEditor('@chu')
    rerender(<ChatInput />)
    expect(screen.getByTestId('mention-popup')).toHaveAttribute('data-query', 'chu')

    mentionPopup.props!.onResultState!('chu', true)

    typeInEditor("@chu'su")
    rerender(<ChatInput />)
    expect(screen.getByTestId('mention-popup')).toHaveAttribute('data-query', "chu'su")

    editorState.composing = false
    typeInEditor('@出宿')
    rerender(<ChatInput />)
    expect(screen.getByTestId('mention-popup')).toHaveAttribute('data-query', '出宿')
  })

  it('tracks the no-match length per @ token so a later @ is not suppressed by an earlier one', () => {
    const { rerender } = render(<ChatInput />)

    typeInEditor('@aaa')
    rerender(<ChatInput />)
    expect(screen.getByTestId('mention-popup')).toHaveAttribute('data-query', 'aaa')
    mentionPopup.props!.onResultState!('aaa', true)

    typeInEditor('@aaa@bbb')
    rerender(<ChatInput />)

    expect(screen.getByTestId('mention-popup')).toHaveAttribute('data-query', 'bbb')
  })

  it('keeps the popup closed after Escape and treats further typing as plain text', () => {
    const { rerender } = render(<ChatInput />)

    typeInEditor('@session')
    rerender(<ChatInput />)
    expect(screen.getByTestId('mention-popup')).toHaveAttribute('data-query', 'session')

    expect(editorState.handleKeyDown).toBeTruthy()
    let handled = false
    act(() => {
      const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      handled = editorState.handleKeyDown!(null, esc)
    })
    expect(handled).toBe(true)
    rerender(<ChatInput />)
    expect(screen.queryByTestId('mention-popup')).toBeNull()

    // Same @ token — continue typing must not re-open the popup.
    typeInEditor('@session more')
    rerender(<ChatInput />)
    expect(screen.queryByTestId('mention-popup')).toBeNull()

    // Removing the @ clears dismissal; a fresh @ re-enables matching.
    typeInEditor('plain text')
    rerender(<ChatInput />)
    expect(screen.queryByTestId('mention-popup')).toBeNull()

    typeInEditor('@file')
    rerender(<ChatInput />)
    expect(screen.getByTestId('mention-popup')).toHaveAttribute('data-query', 'file')
  })
})

describe('ChatInput slash command grouping', () => {
  it('splits the slash popup into Slash commands and Skills sections with commands listed first', () => {
    activeSessionState.slashCommands = [
      { name: 'release', description: 'Release the app', argumentHint: '', isSkill: true },
      { name: 'clear', description: 'Clear conversation', argumentHint: '', isSkill: false },
      { name: 'tdd', description: 'Run the TDD workflow', argumentHint: '', isSkill: true },
      { name: 'compact', description: 'Compact the context', argumentHint: '', isSkill: false },
    ]

    const { rerender } = render(<ChatInput />)
    typeInEditor('/')
    rerender(<ChatInput />)

    expect(screen.getByText('Slash commands')).toBeInTheDocument()
    expect(screen.getByText('Skills')).toBeInTheDocument()

    const order = screen
      .getAllByRole('button')
      .map((b) => b.querySelector('.font-medium')?.textContent)
      .filter((name): name is string => typeof name === 'string' && name.startsWith('/'))

    expect(order.slice(0, 2).sort()).toEqual(['/clear', '/compact'])
    expect(order.slice(2, 4).sort()).toEqual(['/release', '/tdd'])
  })

  it('limits slash command and skill descriptions to two lines', () => {
    activeSessionState.slashCommands = [
      { name: 'clear', description: 'Clear conversation', argumentHint: '', isSkill: false },
      { name: 'release', description: 'Release the app', argumentHint: '', isSkill: true },
    ]

    const { rerender } = render(<ChatInput />)
    typeInEditor('/')
    rerender(<ChatInput />)

    expect(screen.getByText('Clear conversation')).toHaveClass('line-clamp-2')
    expect(screen.getByText('Release the app')).toHaveClass('line-clamp-2')
  })

  it('keeps slash command names single-line and lets argument hints compress', () => {
    activeSessionState.slashCommands = [
      {
        name: 'execute-plan',
        description: 'Execute a PR Plan DAG',
        argumentHint: '<design-doc-path> [--effort N] [--concurrency N] [--dry-run]',
        isSkill: false,
      },
    ]

    const { rerender } = render(<ChatInput />)
    typeInEditor('/')
    rerender(<ChatInput />)

    // Command name is split across highlight spans — match the outer wrapper by classes.
    const commandName = screen.getByText((_, el) =>
      el?.classList.contains('shrink-0') === true
      && el.classList.contains('whitespace-nowrap')
      && el.textContent === '/execute-plan',
    )
    expect(commandName).toBeTruthy()
    const argumentHint = screen.getByText(/<design-doc-path>/)
    expect(argumentHint).toHaveClass('truncate', 'min-w-0', 'flex-1')
  })

  it('drops the per-row skill badge now that skills have their own section', () => {
    activeSessionState.slashCommands = [
      { name: 'clear', description: 'Clear conversation', argumentHint: '', isSkill: false },
      { name: 'release', description: 'Release the app', argumentHint: '', isSkill: true },
    ]

    const { rerender } = render(<ChatInput />)
    typeInEditor('/')
    rerender(<ChatInput />)

    expect(screen.getByText('Slash commands')).toBeInTheDocument()
    expect(screen.queryByText('skill')).toBeNull()
  })

  it('does not show Claude project skills/commands when provider is ACP', () => {
    activeSessionState.preferredProvider = 'acp'
    activeSessionState.sessionProvider = 'acp'
    activeSessionState.slashCommands = [
      { name: 'compact', description: 'Claude compact', argumentHint: '', isSkill: false },
      { name: 'tdd', description: 'Claude skill', argumentHint: '', isSkill: true },
      { name: 'release', description: 'Claude skill', argumentHint: '', isSkill: true },
    ]
    activeSessionState.acpSlashCommands = [
      { name: 'web', description: 'ACP web search', argumentHint: 'q', isSkill: false },
    ]

    const { rerender } = render(<ChatInput />)
    typeInEditor('/')
    rerender(<ChatInput />)

    const labels = screen
      .getAllByRole('button')
      .map((b) => b.querySelector('.font-medium')?.textContent ?? '')
      .filter(Boolean)

    expect(labels.some((label) => label.startsWith('/web'))).toBe(true)
    expect(labels.some((label) => label.startsWith('/clear'))).toBe(true)
    expect(labels.some((label) => label.startsWith('/compact'))).toBe(false)
    expect(labels.some((label) => label.startsWith('/tdd'))).toBe(false)
    expect(labels.some((label) => label.startsWith('/release'))).toBe(false)
    expect(screen.queryByText('Skills')).toBeNull()
  })

  it('shows host /recap for Grok ACP and hides it for other ACP agents', () => {
    activeSessionState.preferredProvider = 'acp'
    activeSessionState.sessionProvider = 'acp'
    activeSessionState.acpAgentId = 'grok-build'
    activeSessionState.acpSlashCommands = []

    const { rerender } = render(<ChatInput />)
    typeInEditor('/')
    rerender(<ChatInput />)

    let labels = screen
      .getAllByRole('button')
      .map((b) => b.querySelector('.font-medium')?.textContent ?? '')
      .filter(Boolean)
    expect(labels.some((label) => label.startsWith('/recap'))).toBe(true)
    expect(labels.some((label) => label.startsWith('/clear'))).toBe(true)

    activeSessionState.acpAgentId = 'opencode'
    rerender(<ChatInput />)
    typeInEditor('/')
    rerender(<ChatInput />)

    labels = screen
      .getAllByRole('button')
      .map((b) => b.querySelector('.font-medium')?.textContent ?? '')
      .filter(Boolean)
    expect(labels.some((label) => label.startsWith('/recap'))).toBe(false)
    expect(labels.some((label) => label.startsWith('/clear'))).toBe(true)
  })

  it('shows Cursor host commands and scanned skills, not Claude or workflows', () => {
    activeSessionState.preferredProvider = 'cursor'
    activeSessionState.sessionProvider = 'cursor'
    activeSessionState.slashCommands = [
      { name: 'compact', description: 'Claude compact', argumentHint: '', isSkill: false },
      { name: 'tdd', description: 'Claude skill', argumentHint: '', isSkill: true },
    ]
    chatActions._cursorSlashItems = [
      { name: 'review', description: 'Review the diff', argumentHint: '', isSkill: true },
      { name: 'ship', description: 'Ship it', argumentHint: '', isSkill: false },
    ]

    const { rerender } = render(<ChatInput />)
    typeInEditor('/')
    rerender(<ChatInput />)

    const labels = screen
      .getAllByRole('button')
      .map((b) => b.querySelector('.font-medium')?.textContent ?? '')
      .filter(Boolean)

    expect(labels.some((label) => label.startsWith('/clear'))).toBe(true)
    expect(labels.some((label) => label.startsWith('/mcp'))).toBe(true)
    expect(labels.some((label) => label.startsWith('/review'))).toBe(true)
    expect(labels.some((label) => label.startsWith('/ship'))).toBe(true)
    expect(labels.some((label) => label.startsWith('/workflows'))).toBe(false)
    expect(labels.some((label) => label.startsWith('/compact'))).toBe(false)
    expect(labels.some((label) => label.startsWith('/tdd'))).toBe(false)
  })

  it('expands a Cursor command body including newlines into the editor', () => {
    activeSessionState.preferredProvider = 'cursor'
    activeSessionState.sessionProvider = 'cursor'
    chatActions._cursorSlashItems = [
      {
        name: 'ship',
        description: 'Ship it',
        argumentHint: '',
        isSkill: false,
        promptBody: 'Ship the current branch.\nThen tag the release.',
      },
    ]

    const { rerender } = render(<ChatInput />)
    typeInEditor('/')
    rerender(<ChatInput />)

    chatActions.setDraftText.mockClear()
    fireEvent.mouseDown(screen.getByText('Ship it').closest('button')!)

    expect(chatActions.setDraftText.mock.calls.at(-1)?.[0]).toBe(
      'Ship the current branch.\nThen tag the release.',
    )
  })

  it('lists a Cursor skill and command with the same name and expands only the command', () => {
    activeSessionState.preferredProvider = 'cursor'
    activeSessionState.sessionProvider = 'cursor'
    chatActions._cursorSlashItems = [
      { name: 'review', description: 'Skill review', argumentHint: '', isSkill: true },
      {
        name: 'review',
        description: 'Command review',
        argumentHint: '',
        isSkill: false,
        promptBody: 'Review the diff.',
      },
    ]

    const { rerender } = render(<ChatInput />)
    typeInEditor('/')
    rerender(<ChatInput />)

    expect(screen.getByText('Skill review')).toBeTruthy()
    expect(screen.getByText('Command review')).toBeTruthy()

    chatActions.setDraftText.mockClear()
    fireEvent.mouseDown(screen.getByText('Command review').closest('button')!)
    expect(chatActions.setDraftText.mock.calls.at(-1)?.[0]).toBe('Review the diff.')

    chatActions.setDraftText.mockClear()
    fireEvent.mouseDown(screen.getByText('Skill review').closest('button')!)
    expect(chatActions.setDraftText.mock.calls.at(-1)?.[0]).toBe('/review ')
  })
})
