/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { chatActions, activeSessionState, editorState, useChatStore, mentionPopup } = vi.hoisted(() => {
  const mentionPopup = {
    props: null as null | { query: string; onResultState?: (q: string, isEmpty: boolean) => void },
  }
  const activeSessionState = {
    draftText: '',
    status: 'idle' as const,
    attachments: [] as Array<{ mimeType: string; base64: string; name: string }>,
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
    preferredProvider: 'claude' as 'claude' | 'codex',
    sessionProvider: null as 'claude' | 'codex' | null,
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
    sendMessage: vi.fn(),
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
    editor: null as unknown,
    composing: false,
  }

  return { chatActions, activeSessionState, editorState, useChatStore, mentionPopup }
})

vi.mock('@tiptap/react', () => {
  const stripHtml = (value: string) => value.replace(/<[^>]+>/g, '')

  const createEditor = () => {
    const editor = {
      storage: {
        slashDecoration: { slashCommands: [] as unknown[] },
        promptSuggestion: { suggestion: null as string | null },
      },
      getText: () => editorState.text,
      chain: () => {
        const chain = {
          focus: () => chain,
          setContent: (value: string) => {
            editorState.text = stripHtml(value)
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
    }

    Object.defineProperty(editor, 'isEmpty', {
      get: () => editorState.text.length === 0,
    })

    return editor
  }

  return {
    useEditor: (config: { onUpdate?: (payload: { editor: unknown }) => void }) => {
      editorState.onUpdate = config.onUpdate ?? null
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
  useChatStore,
  useActiveSession: (selector: (state: typeof activeSessionState) => unknown) => selector(activeSessionState),
  useIsRemoteLocked: () => false,
  useSessionScope: () => null,
  selectCodexPrompts: () => [],
  selectActiveCodexSkills: () => [],
  getLatestCodexThreadId: () => undefined,
}))

vi.mock('@/stores/app', () => ({
  useAppStore: Object.assign(
    (selector: (state: { layoutMode: 'coding' | 'canvas' }) => unknown) => selector({ layoutMode: 'coding' }),
    {
      getState: () => ({ layoutMode: 'coding' as const }),
    },
  ),
  useEffectiveProjectRoot: () => null,
  selectEffectiveProjectRoot: () => null,
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

vi.mock('./AttachmentBar', () => ({
  AttachmentBar: () => null,
}))

vi.mock('./ContextBar', () => ({
  ContextBar: () => null,
}))

vi.mock('./ModelSelector', () => ({
  ModelSelector: () => null,
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
  editorState.editor = null
  editorState.composing = false
  activeSessionState.draftText = ''
  activeSessionState.attachments = []
  activeSessionState.mentions = []
  activeSessionState.preferredProvider = 'claude'
  activeSessionState.sessionProvider = null
  activeSessionState.showDirManager = false
  activeSessionState.showReviewPanel = false
  mentionPopup.props = null
})

function typeInEditor(value: string) {
  const editor = screen.getByTestId('editor')
  editor.textContent = value
  fireEvent.input(editor)
}

describe('ChatInput', () => {
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
    expect(chatActions.setDraftText).toHaveBeenCalledWith('')
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
})

describe('ChatInput slash command grouping', () => {
  it('splits the slash popup into Commands and Skills sections with commands listed first', () => {
    activeSessionState.slashCommands = [
      { name: 'release', description: 'Release the app', argumentHint: '', isSkill: true },
      { name: 'clear', description: 'Clear conversation', argumentHint: '', isSkill: false },
      { name: 'tdd', description: 'Run the TDD workflow', argumentHint: '', isSkill: true },
      { name: 'compact', description: 'Compact the context', argumentHint: '', isSkill: false },
    ]

    const { rerender } = render(<ChatInput />)
    typeInEditor('/')
    rerender(<ChatInput />)

    expect(screen.getByText('Commands')).toBeInTheDocument()
    expect(screen.getByText('Skills')).toBeInTheDocument()

    const order = screen
      .getAllByRole('button')
      .map((b) => b.querySelector('.font-medium')?.textContent)
      .filter((name): name is string => typeof name === 'string' && name.startsWith('/'))

    expect(order.slice(0, 2).sort()).toEqual(['/clear', '/compact'])
    expect(order.slice(2, 4).sort()).toEqual(['/release', '/tdd'])
  })

  it('drops the per-row skill badge now that skills have their own section', () => {
    activeSessionState.slashCommands = [
      { name: 'clear', description: 'Clear conversation', argumentHint: '', isSkill: false },
      { name: 'release', description: 'Release the app', argumentHint: '', isSkill: true },
    ]

    const { rerender } = render(<ChatInput />)
    typeInEditor('/')
    rerender(<ChatInput />)

    expect(screen.getByText('Commands')).toBeInTheDocument()
    expect(screen.queryByText('skill')).toBeNull()
  })
})
