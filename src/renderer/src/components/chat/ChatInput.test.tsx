/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { chatActions, activeSessionState, editorState, useChatStore } = vi.hoisted(() => {
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
    slashCommands: [] as Array<{ name: string; description: string; argumentHint: string; isSkill: boolean }>,
    preferredProvider: 'claude' as 'claude' | 'codex',
    sessionProvider: null as 'claude' | 'codex' | null,
    agents: [] as Array<{ name: string }>,
    selectedCodexCollaborationMode: 'default' as const,
    codexPlanRejectHintActive: false,
    chatInputFocusNonce: 0,
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
  }

  return { chatActions, activeSessionState, editorState, useChatStore }
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
  selectCodexPrompts: () => [],
  selectActiveCodexSkills: () => [],
}))

vi.mock('@/stores/app', () => ({
  useAppStore: Object.assign(
    (selector: (state: { layoutMode: 'coding' | 'canvas' }) => unknown) => selector({ layoutMode: 'coding' }),
    {
      getState: () => ({ layoutMode: 'coding' as const }),
    },
  ),
}))

vi.mock('./ContextUsage', () => ({
  ContextUsage: () => null,
}))

vi.mock('./MentionPopup', () => ({
  MentionPopup: () => null,
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
  activeSessionState.draftText = ''
  activeSessionState.attachments = []
  activeSessionState.mentions = []
  activeSessionState.preferredProvider = 'claude'
  activeSessionState.sessionProvider = null
  activeSessionState.showDirManager = false
  activeSessionState.showReviewPanel = false
})

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
