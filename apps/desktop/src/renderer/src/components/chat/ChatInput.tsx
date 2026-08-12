import { useRef, useState, useCallback, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { cn } from '@superone/ui/lib/utils'
import { CLAUDE_INTERCEPTED_COMMAND_NAMES, CODEX_REJECT_PLAN_PLACEHOLDER, getLatestCodexThreadId, runClaudeInterceptedCommand, selectActiveCodexSkills, selectCodexPrompts, selectOpenCodeCommands, useChatStore, useActiveSession, useIsRemoteLocked, useSessionScope } from '@/stores/chat'
import { useAppStore, useEffectiveProjectRoot } from '@/stores/app'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { ArrowUp, Loader2, Paperclip, X } from 'lucide-react'
import type { MentionKind } from '@/stores/chat'
import { ContextUsage } from './ContextUsage'
import { MentionPopup, type MentionPopupHandle } from './MentionPopup'
import { useShallow } from 'zustand/react/shallow'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { MentionNode } from './mention-node'
import { findMiniAppMentionMarkers } from '@superone/shared/miniapp-mention-marker'
import { useMiniAppStore } from '@/stores/miniapp'
import { PasteChipNode, PASTE_CHIP_LINE_THRESHOLD, PASTE_CHIP_CHAR_THRESHOLD } from './paste-chip-node'
import { SlashDecoration } from './slash-decoration'
import { SessionMentionDecoration, syncSessionMentionDismissed } from './session-mention-decoration'
import { PromptSuggestion } from './prompt-suggestion'
import { addBrowserImageToChat, extractDraggedImageUrl } from '../browser/browser-image'
import type { MentionNodeAttrs } from './mention-node'
import type { CodexGoal, SlashCommandInfo, ImageAttachment } from '@superone/shared/agent-types'
import { acpAgentDisplayName, isGrokAcpAgent } from '@superone/shared/acp-brand'
import type { InputSegment } from '@/stores/chat-store/types'
import { fuzzyMatch } from '@/lib/fuzzy-match'
import { HighlightedText } from '@superone/ui/components/ui/HighlightedText'
import { toMentionPath } from './chat-input-utils'
import { internalDragSource } from '@/components/sidebar/drag-drop-utils'
import { AttachmentNode } from './attachment-node'
import { BrowserAnnotationChips } from '../browser/BrowserAnnotationChips'
import { notifyAnnotationRemoved, notifyAnnotationsCleared } from '../browser/browser-annotate-flow'
import { useBrowserStore } from '@/stores/browser'
import { buildImageAttachment } from './image-compress'
import { ChatInputDirsHint } from './ChatInputDirsHint'
import { ContextBar } from './ContextBar'
import { ModelSelector } from './ModelSelector'
import { AddDirPopup, type AddDirPopupHandle } from './AddDirPopup'
import { WorkflowSlashPopup, type WorkflowSlashPopupHandle, type WorkflowApplyPayload } from './WorkflowSlashPopup'
import { parseWorkflowSlashLine } from './workflow-slash-suggest'
// import { ProviderSlashPopup } from './ProviderSlashPopup' // /provider popup retired — kept for reference
import { McpSlashPopup } from './McpSlashPopup'
import { WorkflowsSlashPopup } from './WorkflowsSlashPopup'
import { ReviewPanel } from './ReviewPanel'
import { SlashCommandContent } from './SlashCommandContent'
import { StopButton, harnessUsesSoftCancel } from './StopButton'
import { groupItems, PopupSectionHeader } from './popup-groups'
import { computeMatchingSlashCommands } from './chat-input/computeMatchingSlashCommands'
import { resolveSlashCommandsForProvider } from './chat-input/resolveSlashCommandsForProvider'
import { resolveChatInputPlaceholder } from './chat-input/resolveChatInputPlaceholder'
import { CodexGoalDialog } from './CodexGoalDialog'
import { CodexGoalIndicator } from './CodexGoalIndicator'
import { resolveProvider } from '@/stores/chat-store/helpers/provider-routing'
import { buildSessionProjectOptions, mentionQueryAllowsSpaces } from './session-mention-query'
import { wrapPathRefMention } from './user-mention-parser'

export const chatInputAPI: {
  insertMention: ((kind: MentionKind, value: string, displayName: string) => void) | null
  addImageFromPath: ((absPath: string) => void) | null
} = { insertMention: null, addImageFromPath: null }


export function ChatInput() {
    const { t } = useTranslation()
    const activeProject = useChatStore((s) => s.activeProject)
    const recentFolders = useAppStore((s) => s.recentFolders)
    const sessionProjectOptions = useMemo(
      () => buildSessionProjectOptions(recentFolders, activeProject),
      [recentFolders, activeProject],
    )
    const fileRoot = useEffectiveProjectRoot()
    const storeActions = useChatStore(useShallow((s) => ({
      setDraftText: s.setDraftText,
      setDraftJson: s.setDraftJson,
      sendMessage: s.sendMessage,
      editQueuedMessage: s.editQueuedMessage,
      interrupt: s.interrupt,
      addAttachment: s.addAttachment,
      removeAttachment: s.removeAttachment,
      removeAttachmentById: s.removeAttachmentById,
      clearAttachments: s.clearAttachments,
      removeBrowserAnnotation: s.removeBrowserAnnotation,
      clearBrowserAnnotations: s.clearBrowserAnnotations,
      addMention: s.addMention,
      removeMention: s.removeMention,
      dismissCommandPopup: s.dismissSlashCommandOutput,
      setShowReviewPanel: s.setShowReviewPanel,
      toggleMiniAppContext: s.toggleMiniAppContext,
      clearMiniAppContext: s.clearMiniAppContext,
      removeUserSelectionAt: s.removeUserSelectionAt,
      clearUserSelections: s.clearUserSelections,
      addDir: s.addDir,
      removeDir: s.removeDir,
    })))
    const { sendMessage, interrupt, setShowReviewPanel } = storeActions
    const sessionScope = useSessionScope()
    const { text, draftJson, status, attachments, browserAnnotations, mentions, permissionMode, hasPendingInteraction, queuedMessages, miniAppContexts, userSelections, userAdditionalDirs, projectAdditionalDirs, additionalDirs } =
      useActiveSession(useShallow((s) => ({
        text: s.draftText,
        draftJson: s.draftJson,
        status: s.status,
        attachments: s.attachments,
        browserAnnotations: s.browserAnnotations,
        mentions: s.mentions,
        permissionMode: s.permissionMode,
        hasPendingInteraction: s.hasPendingInteraction,
        queuedMessages: s.queuedMessages,
        miniAppContexts: s.miniAppContexts,
        userSelections: s.userSelections,
        userAdditionalDirs: s.userAdditionalDirs,
        projectAdditionalDirs: s.projectAdditionalDirs,
        additionalDirs: s.additionalDirs,
      })))
    const {
      slashCommands, preferredProvider, sessionProvider, agents,
      selectedCodexCollaborationMode, codexPlanRejectHintActive, chatInputFocusNonce, chatInputRestoreFocusNonce,
      promptSuggestion, showReviewPanel,
      displayedSessionId,
    } = useActiveSession(useShallow((s) => ({
      slashCommands: s.slashCommands,
      preferredProvider: s.preferredProvider,
      sessionProvider: s.sessionProvider,
      agents: s.agents,
      selectedCodexCollaborationMode: s.selectedCodexCollaborationMode,
      codexPlanRejectHintActive: s.codexPlanRejectHintActive,
      chatInputFocusNonce: s.chatInputFocusNonce,
      chatInputRestoreFocusNonce: s.chatInputRestoreFocusNonce,
      promptSuggestion: s.promptSuggestion,
      showReviewPanel: s.showReviewPanel,
      displayedSessionId: sessionScope?.sessionId ?? s._activeSessionId,
    })))
    const commandPopup = useActiveSession((s) => s.slashCommandOutput)
    // Every per-session write is routed to this pane's session, not the project's
    // active one — otherwise a non-active pane's write (e.g. the editor's draft
    // re-sync on remount) lands on whichever session happens to be active.
    const {
      setText, setDraftJson, editQueuedMessage, addAttachment, removeAttachment, removeAttachmentById, clearAttachments,
      removeBrowserAnnotation,
      clearBrowserAnnotations,
      addMention, removeMention, dismissCommandPopup, toggleMiniAppContext,
      clearMiniAppContext, removeUserSelectionAt, clearUserSelections, addDir, removeDir,
    } = useMemo(() => {
      const target = sessionScope ?? undefined
      return {
        setText: (value: string) => storeActions.setDraftText(value, target),
        setDraftJson: (json: object | null) => storeActions.setDraftJson(json, target),
        editQueuedMessage: (id: string) => storeActions.editQueuedMessage(id, target),
        addAttachment: (a: Parameters<typeof storeActions.addAttachment>[0]) => storeActions.addAttachment(a, target),
        removeAttachment: (i: number) => storeActions.removeAttachment(i, target),
        removeAttachmentById: (id: string) => storeActions.removeAttachmentById(id, target),
        clearAttachments: () => storeActions.clearAttachments(target),
        removeBrowserAnnotation: (id: string) => {
          storeActions.removeBrowserAnnotation(id, target)
          const bid = useBrowserStore.getState().annotatingId
          if (bid) notifyAnnotationRemoved(bid, id)
        },
        clearBrowserAnnotations: () => {
          storeActions.clearBrowserAnnotations(target)
          const bid = useBrowserStore.getState().annotatingId
          if (bid) notifyAnnotationsCleared(bid)
        },
        addMention: (m: Parameters<typeof storeActions.addMention>[0]) => storeActions.addMention(m, target),
        removeMention: (v: string) => storeActions.removeMention(v, target),
        dismissCommandPopup: () => storeActions.dismissCommandPopup(target),
        toggleMiniAppContext: (id: string) => storeActions.toggleMiniAppContext(id, target),
        clearMiniAppContext: (id: string) => storeActions.clearMiniAppContext(id, target),
        removeUserSelectionAt: (i: number) => storeActions.removeUserSelectionAt(i, target),
        clearUserSelections: () => storeActions.clearUserSelections(target),
        addDir: (p: string, scope: 'session' | 'project') => storeActions.addDir(p, scope, target),
        removeDir: (p: string, scope: 'session' | 'project') => storeActions.removeDir(p, scope, target),
      }
    }, [storeActions, sessionScope])
    const fileInputRef = useRef<HTMLInputElement>(null)

    const [slashIndex, setSlashIndex] = useState(-1)
    const [slashDismissed, setSlashDismissed] = useState(false)
    const slashItemRefs = useRef<Map<number, HTMLButtonElement>>(new Map())

    const [isDragging, setIsDragging] = useState(false)
    const dragCounterRef = useRef(0)

    const [mentionActive, setMentionActive] = useState(false)
    const [mentionIndex, setMentionIndex] = useState(0)
    const mentionRef = useRef<MentionPopupHandle>(null)
    const [hasPasteChips, setHasPasteChips] = useState(false)

    const [addDirIndex, setAddDirIndex] = useState(0)
    const addDirRef = useRef<AddDirPopupHandle>(null)
    const [workflowSlashIndex, setWorkflowSlashIndex] = useState(0)
    const workflowSlashRef = useRef<WorkflowSlashPopupHandle>(null)

    const mentionInfoRef = useRef<{ atPos: number; query: string } | null>(null)
    const mentionEmptyByAtRef = useRef<Map<number, string>>(new Map())
    /** @ token positions the user dismissed with Escape — treat as plain text until that `@` is gone. */
    const mentionDismissedAtRef = useRef<Set<number>>(new Set())
    const mentionActiveRef = useRef(mentionActive)
    mentionActiveRef.current = mentionActive
    const placeholderTextRef = useRef('')
    const slashCommandsRef = useRef(slashCommands)
    slashCommandsRef.current = slashCommands
    const mentionsRef = useRef(mentions)
    mentionsRef.current = mentions
    const attachmentsRef = useRef(attachments)
    attachmentsRef.current = attachments
    const draftJsonRef = useRef(draftJson)
    draftJsonRef.current = draftJson
    const removeAttachmentByIdRef = useRef(removeAttachmentById)
    removeAttachmentByIdRef.current = removeAttachmentById
    const setDraftJsonRef = useRef(setDraftJson)
    setDraftJsonRef.current = setDraftJson
    const removeMentionRef = useRef(removeMention)
    removeMentionRef.current = removeMention
    const addMentionRef = useRef(addMention)
    addMentionRef.current = addMention
    const processSelectedFilesRef = useRef<(files: FileList | File[]) => void>(() => {})
    const setTextRef = useRef(setText)
    setTextRef.current = setText
    const matchingCommandsRef = useRef<typeof matchingCommands>([])
    const slashDismissedRef = useRef(false)
    const handleKeyDownRef = useRef<(e: KeyboardEvent) => boolean>(() => false)
    const promptSuggestionRef = useRef(promptSuggestion)
    promptSuggestionRef.current = promptSuggestion

    useEffect(() => {
      if (slashIndex >= 0) {
        slashItemRefs.current.get(slashIndex)?.scrollIntoView({ block: 'nearest' })
      }
    }, [slashIndex])

    const isRemoteLocked = useIsRemoteLocked()
    const isStreaming = status === 'streaming'
    const activeProviderForResources = resolveProvider({ sessionProvider, preferredProvider })
    const isCodexPlanMode = activeProviderForResources === 'codex' && selectedCodexCollaborationMode === 'plan'
    const hasContent = text.trim().length > 0 || attachments.length > 0 || browserAnnotations.length > 0 || mentions.length > 0 || hasPasteChips
    const canSend = hasContent && !isRemoteLocked
    const showAgentMentions = activeProviderForResources === 'claude'

    const codexPrompts = useChatStore(selectCodexPrompts)
    const codexSkills = useChatStore(selectActiveCodexSkills)
    const openCodeSlashCommands = useChatStore(selectOpenCodeCommands)
    const codexThreadId = useActiveSession((s) => getLatestCodexThreadId(s.messages))
    const [codexGoal, setCodexGoal] = useState<CodexGoal | null>(null)
    const [goalDialogState, setGoalDialogState] = useState<{ open: boolean; prefill: string }>({ open: false, prefill: '' })

    useEffect(() => {
      if (activeProviderForResources !== 'codex' || !displayedSessionId || !codexThreadId) {
        setCodexGoal(null)
        return
      }
      let cancelled = false
      void window.app.codexGetGoal(displayedSessionId, codexThreadId)
        .then((goal) => {
          if (!cancelled) setCodexGoal(goal)
        })
        .catch(() => {})
      return () => { cancelled = true }
    }, [activeProviderForResources, displayedSessionId, codexThreadId, status])

    const codexSlashCommands = useMemo<SlashCommandInfo[]>(() => ([
      { name: 'help', description: t('chat.codexCommands.helpDesc'), argumentHint: '', isSkill: false },
      { name: 'reset', description: t('chat.codexCommands.resetDesc'), argumentHint: '', isSkill: false },
      { name: 'auth', description: t('chat.codexCommands.authDesc'), argumentHint: '', isSkill: false },
      { name: 'auth auto', description: t('chat.codexCommands.authAutoDesc'), argumentHint: '', isSkill: false },
      { name: 'auth chatgpt', description: t('chat.codexCommands.authChatgptDesc'), argumentHint: '', isSkill: false },
      { name: 'auth apikey', description: t('chat.codexCommands.authApiKeyDesc'), argumentHint: t('chat.codexCommands.authApiKeyArg'), isSkill: false },
      { name: 'review', description: t('chat.codexCommands.reviewDesc'), argumentHint: '', isSkill: false },
      { name: 'compact', description: t('chat.codexCommands.compactDesc'), argumentHint: '', isSkill: false },
      { name: 'plan', description: t('chat.codexCommands.planDesc'), argumentHint: '', isSkill: false },
      // /provider command retired — provider selection moved into the model selector (kept for reference)
      // { name: 'provider', description: t('chat.codexCommands.providerDesc'), argumentHint: '', isSkill: false },
      { name: 'mcp', description: t('chat.codexCommands.mcpDesc'), argumentHint: '', isSkill: false },
      { name: 'goal', description: t('chat.codexCommands.goalDesc'), argumentHint: t('chat.codexCommands.goalArg'), isSkill: false },
      ...codexPrompts,
      ...codexSkills.map((s): SlashCommandInfo => ({ name: s.name, description: s.description, argumentHint: '', isSkill: true })),
    ]), [t, codexPrompts, codexSkills])

    const acpSlashCommandsFromAgent = useActiveSession((s) => s.acpSlashCommands)
    const acpSlashCommandsStatus = useActiveSession((s) => s.acpSlashCommandsStatus)
    const acpAgentId = useActiveSession((s) => s.acpAgentId)
    const acpAgents = useChatStore((s) => s.harnessResources?.acp?.agents)
    const ensureAcpSlashCommands = useChatStore((s) => s.ensureAcpSlashCommands)
    // Catalog may be empty in a fresh mini-window; fall back to id-derived brand name.
    const acpAgentName = acpAgents?.find((a) => a.id === acpAgentId)?.name
      ?? (acpAgentId ? acpAgentDisplayName(acpAgentId) : null)
    const acpSlashCommands = useMemo<SlashCommandInfo[]>(() => {
      const local: SlashCommandInfo[] = [
        { name: 'clear', description: t('chat.acpCommands.clearDesc'), argumentHint: '', isSkill: false },
        {
          name: 'workflows',
          description: t('chat.acpCommands.workflowsDesc', 'Show workflow runs in this session'),
          argumentHint: '',
          isSkill: false,
        },
      ]
      // Host-only Grok `/recap` (x.ai/recap) — not an agent available_command.
      if (isGrokAcpAgent(acpAgentId)) {
        local.push({
          name: 'recap',
          description: t('chat.acpCommands.recapDesc'),
          argumentHint: '',
          isSkill: false,
        })
      }
      const seen = new Set(local.map((c) => c.name))
      const agentCmds = Array.isArray(acpSlashCommandsFromAgent) ? acpSlashCommandsFromAgent : []
      // Prefer host local entries (e.g. /workflows UI) over same-named agent commands.
      const fromAgent = agentCmds.filter((c) => {
        const name = c.name.replace(/^\//, '').trim()
        if (!name || seen.has(name)) return false
        seen.add(name)
        return true
      }).map((c) => ({
        ...c,
        name: c.name.replace(/^\//, '').trim(),
        // ACP available_commands are agent commands, never Claude project skills.
        isSkill: false,
      }))
      return [...fromAgent, ...local]
    }, [t, acpSlashCommandsFromAgent, acpAgentId])

    // Never fall through to project-level Claude slashCommands/skills for ACP.
    const activeSlashCommands = useMemo(
      () => resolveSlashCommandsForProvider(activeProviderForResources, {
        claude: slashCommands,
        codex: codexSlashCommands,
        acp: acpSlashCommands,
        opencode: openCodeSlashCommands,
      }),
      [activeProviderForResources, slashCommands, codexSlashCommands, acpSlashCommands, openCodeSlashCommands],
    )

    const matchingCommands = useMemo(
      () => computeMatchingSlashCommands(text, activeSlashCommands, activeProviderForResources),
      [activeProviderForResources, text, activeSlashCommands],
    )
    matchingCommandsRef.current = matchingCommands
    slashDismissedRef.current = slashDismissed

    // Lazy-load ACP slash commands only when the user opens the / popup.
    const acpSlashPopupOpen =
      activeProviderForResources === 'acp'
      && text.startsWith('/')
      && !slashDismissed
    useEffect(() => {
      if (!acpSlashPopupOpen) return
      ensureAcpSlashCommands()
    }, [acpSlashPopupOpen, ensureAcpSlashCommands, acpAgentId])

    const acpSlashInitialLoading =
      activeProviderForResources === 'acp'
      && acpSlashCommandsStatus === 'loading'
      && acpSlashCommandsFromAgent.length === 0
    const showSlashPopup =
      !slashDismissed
      && text.startsWith('/')
      && (matchingCommands.length > 0 || acpSlashInitialLoading)

    const slashGroups = useMemo(() => {
      const order: string[] = []
      for (const c of matchingCommands) {
        const key = c.isSkill ? 'skill' : 'command'
        if (!order.includes(key)) order.push(key)
      }
      return groupItems(matchingCommands, (c) => (c.isSkill ? 'skill' : 'command'), order)
    }, [matchingCommands])

    const editorRef = useRef<ReturnType<typeof useEditor>>(null)

    const replaceEditorTextPreservingTrailingSpace = useCallback((value: string) => {
      const ed = editorRef.current
      if (!ed) return
      if (!value) {
        ed.commands.clearContent()
        return
      }
      ed.chain()
        .focus()
        .setContent({
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }],
        })
        .run()
      ed.commands.focus('end')
    }, [])

    // Multi-line input is a single paragraph split by hardBreak nodes. Slash
    // command edits must stay confined to the first line: from the paragraph
    // content start (doc pos 1) up to the first hardBreak (or end of paragraph).
    const firstLineBoundary = useCallback(() => {
      const ed = editorRef.current
      if (!ed) return null
      const paragraph = ed.state.doc.firstChild
      if (!paragraph) return null
      let lineEnd = paragraph.content.size
      let hasBreak = false
      paragraph.forEach((node, offset) => {
        if (!hasBreak && node.type.name === 'hardBreak') {
          lineEnd = offset
          hasBreak = true
        }
      })
      return { ed, from: 1, to: 1 + lineEnd, hasBreak }
    }, [])

    const replaceFirstLineWith = useCallback((prefix: string) => {
      const info = firstLineBoundary()
      if (!info) return
      if (!info.hasBreak) {
        replaceEditorTextPreservingTrailingSpace(prefix)
        setText(prefix)
        return
      }
      info.ed.chain().focus().insertContentAt({ from: info.from, to: info.to }, prefix).run()
      setText(info.ed.getText())
    }, [firstLineBoundary, replaceEditorTextPreservingTrailingSpace, setText])

    const clearFirstLine = useCallback(() => {
      const info = firstLineBoundary()
      if (!info) return
      if (!info.hasBreak) {
        info.ed.commands.clearContent()
        setText('')
        return
      }
      // Also consume the trailing hardBreak so the next line becomes the first.
      info.ed.chain().focus().deleteRange({ from: info.from, to: info.to + 1 }).run()
      setText(info.ed.getText())
    }, [firstLineBoundary, setText])

    const selectSlashCommand = useCallback(
      (name: string) => {
        if (name === 'provider') {
          clearFirstLine()
          setSlashIndex(-1)
          useChatStore.getState().openProviderPopup()
          return
        }
        if (name === 'mcp') {
          clearFirstLine()
          setSlashIndex(-1)
          useChatStore.getState().openMcpPopup()
          return
        }
        if (
          name === 'workflows'
          && (activeProviderForResources === 'claude' || activeProviderForResources === 'acp')
        ) {
          clearFirstLine()
          setSlashIndex(-1)
          useChatStore.getState().openWorkflowsPopup()
          return
        }
        if (activeProviderForResources === 'claude' && CLAUDE_INTERCEPTED_COMMAND_NAMES.has(name)) {
          clearFirstLine()
          setSlashIndex(-1)
          void runClaudeInterceptedCommand(name)
          return
        }
        if (name === 'add-dir') {
          replaceFirstLineWith('/add-dir ')
          setSlashIndex(-1)
          return
        }
        if (name === 'plan' && activeProviderForResources === 'codex') {
          clearFirstLine()
          setSlashIndex(-1)
          useChatStore.getState().setSelectedCodexCollaborationMode('plan')
          return
        }
        if (name === 'review' && activeProviderForResources === 'codex') {
          clearFirstLine()
          clearAttachments()
          for (const mention of mentions) {
            removeMention(mention.value)
          }
          setSlashIndex(-1)
          setShowReviewPanel(true)
          return
        }
        replaceFirstLineWith(`/${name} `)
        setSlashIndex(-1)
      },
      [activeProviderForResources, clearAttachments, mentions, removeMention, setShowReviewPanel, clearFirstLine, replaceFirstLineWith]
    )

    const addDirParse = useMemo(() => {
      if (activeProviderForResources !== 'claude') return { active: false, argsText: '' }
      const firstLine = text.split('\n', 1)[0]
      const m = firstLine.match(/^\/add-dir(?:\s(.*))?$/)
      if (!m) return { active: false, argsText: '' }
      return { active: true, argsText: m[1] ?? '' }
    }, [text, activeProviderForResources])
    const addDirActive = addDirParse.active
    const addDirArgsText = addDirParse.argsText

    // Grok/ACP (and Claude if typed): dedicated `/workflow` picker after commit
    // (`/workflow ` via space or Tab/Enter selection) — not bare `/workflow`.
    const workflowSlashParse = useMemo(() => {
      if (activeProviderForResources !== 'acp' && activeProviderForResources !== 'claude') {
        return { active: false, argsText: '' }
      }
      return parseWorkflowSlashLine(text)
    }, [text, activeProviderForResources])
    const workflowSlashActive = workflowSlashParse.active
    const workflowSlashArgsText = workflowSlashParse.argsText

    const handleWorkflowSlashApply = useCallback((payload: string | WorkflowApplyPayload) => {
      const line = typeof payload === 'string' ? payload : payload.line
      const selectFrom = typeof payload === 'string' ? undefined : payload.selectFrom
      const selectTo = typeof payload === 'string' ? undefined : payload.selectTo
      const ed = editorRef.current
      if (ed && line) {
        const chain = ed.chain().focus().setContent({
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: line }] }],
        })
        if (
          selectFrom != null
          && selectTo != null
          && selectFrom >= 0
          && selectTo >= selectFrom
          && selectTo <= line.length
        ) {
          // ProseMirror text in a paragraph starts at position 1.
          chain.setTextSelection({ from: 1 + selectFrom, to: 1 + selectTo }).run()
        } else {
          chain.run()
          ed.commands.focus('end')
        }
      } else {
        replaceEditorTextPreservingTrailingSpace(line)
      }
      setText(line)
      setWorkflowSlashIndex(0)
    }, [setText, replaceEditorTextPreservingTrailingSpace])

    const handleAddDirScopeFill = useCallback((scope: 'project' | 'session') => {
      const next = `/add-dir ${scope} ../`
      replaceEditorTextPreservingTrailingSpace(next)
      setText(next)
      setAddDirIndex(0)
    }, [setText, replaceEditorTextPreservingTrailingSpace])

    const handleAddDirPathNavigate = useCallback((nextPathInput: string) => {
      const m = text.match(/^\/add-dir\s(project|session)\s/)
      if (!m) return
      const next = `/add-dir ${m[1]} ${nextPathInput}`
      replaceEditorTextPreservingTrailingSpace(next)
      setText(next)
      setAddDirIndex(0)
    }, [text, setText, replaceEditorTextPreservingTrailingSpace])

    const validateAndAddDir = useCallback(async (absolutePath: string, scope: 'project' | 'session'): Promise<boolean> => {
      if (!activeProject) return false
      const known = new Set([...userAdditionalDirs, ...projectAdditionalDirs, ...additionalDirs])
      if (known.has(absolutePath)) {
        toast.error(t('chat.addDir.errors.duplicate', { defaultValue: 'Directory is already added' }))
        return false
      }
      const res = await window.agent.validateAddDir(activeProject, absolutePath)
      if (!res.ok) {
        const messageMap: Record<string, string> = {
          'not-found': t('chat.addDir.errors.notFound', { defaultValue: 'Directory not found' }),
          'not-directory': t('chat.addDir.errors.notDirectory', { defaultValue: 'Path is not a directory' }),
          'same-as-project': t('chat.addDir.errors.sameAsProject', { defaultValue: 'Directory is the project itself' }),
          'same-repo': t('chat.addDir.errors.sameRepo', { defaultValue: 'Directory belongs to the same git repository as the project' }),
        }
        toast.error(messageMap[res.reason] ?? res.reason)
        return false
      }
      addDir(absolutePath, scope)
      return true
    }, [activeProject, addDir, additionalDirs, projectAdditionalDirs, userAdditionalDirs, t])

    const handleAddDirCommit = useCallback(async (absolutePath: string, scope: 'project' | 'session') => {
      const ok = await validateAndAddDir(absolutePath, scope)
      if (!ok) return
      clearFirstLine()
      setAddDirIndex(0)
    }, [validateAndAddDir, clearFirstLine])

    const handleAddDirPicker = useCallback(async (scope: 'project' | 'session') => {
      const folder = await window.app.selectFolder()
      if (!folder) return
      await validateAndAddDir(folder, scope)
    }, [validateAndAddDir])

    const handleAddDirRemove = useCallback((path: string, scope: 'project' | 'session') => {
      removeDir(path, scope)
    }, [removeDir])

    const handleMentionSelect = useCallback(
      (value: string, action: 'navigate' | 'select', kindHint?: MentionKind, displayNameHint?: string) => {
        const info = mentionInfoRef.current
        const ed = editorRef.current
        if (!info || !ed) return

        if (action === 'navigate') {
          ed.chain()
            .focus()
            .deleteRange({ from: info.atPos + 1, to: info.atPos + 1 + info.query.length })
            .insertContentAt(info.atPos + 1, [{ type: 'text', text: value }])
            .run()
          mentionInfoRef.current = { atPos: info.atPos, query: value }
          setMentionIndex(0)
          return
        }

        let kind: MentionKind
        let displayName: string
        let mentionValue = value
        if (kindHint === 'miniapp') {
          kind = 'miniapp'
          displayName = displayNameHint || value
        } else if (kindHint === 'desktop-app') {
          kind = 'desktop-app'
          mentionValue = value
          displayName = displayNameHint || value
        } else if (kindHint === 'session') {
          kind = 'session'
          mentionValue = value
          displayName = displayNameHint || value
        } else if (kindHint === 'collab' || kindHint === 'computer' || kindHint === 'browser') {
          kind = kindHint
          mentionValue = kindHint
          displayName = displayNameHint || kindHint
        } else {
          const isAgent = showAgentMentions && agents.some((a) => a.name === value)
          kind = isAgent ? 'agent' : value.endsWith('/') ? 'directory' : 'file'
          // Defensive: directory values must keep the trailing slash so message
          // re-parse (parseUserMentions) recovers kind:directory after send.
          if (kind === 'directory' && mentionValue && !mentionValue.endsWith('/')) mentionValue += '/'
          displayName = mentionValue.split('/').filter(Boolean).pop() || mentionValue
        }

        addMention({ kind, value: mentionValue, displayName })

        ed.chain()
          .focus()
          .deleteRange({ from: info.atPos, to: info.atPos + 1 + info.query.length })
          .insertContentAt(info.atPos, [
            { type: 'mention', attrs: { kind, value: mentionValue, displayName } },
          ])
          .run()

        setMentionActive(false)
        setMentionIndex(0)
        mentionInfoRef.current = null
        mentionEmptyByAtRef.current.clear()
        mentionDismissedAtRef.current.clear()
        syncSessionMentionDismissed(editorRef.current, mentionDismissedAtRef.current)
      },
      [agents, addMention, showAgentMentions]
    )

    const handleMentionResultState = useCallback((q: string, isEmpty: boolean) => {
      const info = mentionInfoRef.current
      if (!info || !q) return
      // Ignore stale reports from a previous keystroke (query already moved on).
      if (q !== info.query) return
      if (editorRef.current?.view.composing) return
      const map = mentionEmptyByAtRef.current
      const cur = map.get(info.atPos)
      if (isEmpty) {
        if (cur === undefined || q.length < cur.length) map.set(info.atPos, q)
      } else if (cur !== undefined) {
        map.delete(info.atPos)
      }
    }, [])

    const serializeAndClear = useCallback(() => {
      const ed = editorRef.current
      const segments: InputSegment[] = []
      const collectedMentions: MentionNodeAttrs[] = []
      let current = ''
      if (ed) {
        ed.state.doc.descendants((node) => {
          if (node.isText) {
            current += node.text ?? ''
          } else if (node.type.name === 'mention') {
            const attrs = node.attrs as MentionNodeAttrs
            collectedMentions.push(attrs)
            if (attrs.kind === 'miniapp') {
              current += ` <superone-miniapp><appname>${attrs.displayName}</appname><appid>${attrs.value}</appid></superone-miniapp> `
            } else if (attrs.kind === 'desktop-app') {
              current += ` <superone-desktop-app><name>${attrs.displayName}</name><bundleId>${attrs.value}</bundleId></superone-desktop-app> `
            } else if (attrs.kind === 'session') {
              current += ` <superone-session><title>${attrs.displayName}</title><sessionId>${attrs.value}</sessionId></superone-session> `
            } else if (attrs.kind === 'collab' || attrs.kind === 'computer' || attrs.kind === 'browser') {
              current += ` <superone-capability><name>${attrs.displayName}</name><id>${attrs.kind}</id></superone-capability> `
            } else {
              // Structured tag so only popup-selected path/agent mentions become
              // chips on render — bare `@foo` typed as text stays plain text.
              let value = attrs.value
              if (attrs.kind === 'directory' && value && !value.endsWith('/')) value += '/'
              const kind =
                attrs.kind === 'directory' || attrs.kind === 'agent' || attrs.kind === 'file'
                  ? attrs.kind
                  : 'file'
              current += ` ${wrapPathRefMention(kind, value, attrs.displayName || value)} `
            }
          } else if (node.type.name === 'attachment') {
            if (current.trim()) segments.push({ text: current.trim(), isPaste: false })
            current = ''
            segments.push({ attachmentId: (node.attrs as { id: string }).id })
          } else if (node.type.name === 'hardBreak') {
            current += '\n'
          } else if (node.type.name === 'pasteChip') {
            if (current.trim()) segments.push({ text: current.trim(), isPaste: false })
            current = ''
            segments.push({ text: (node.attrs as { text: string }).text, isPaste: true })
          } else if (node.isBlock && current.length > 0) {
            current += '\n'
          }
        })
        if (current.trim()) segments.push({ text: current.trim(), isPaste: false })
      } else if (text.trim()) {
        segments.push({ text: text.trim(), isPaste: false })
      }
      // Resolve the inline attachment refs to their stored bytes, in doc order.
      const orderedAttachments = segments
        .flatMap((s) => ('attachmentId' in s ? [s.attachmentId] : []))
        .map((id) => attachmentsRef.current.find((a) => a.id === id))
        .filter((a): a is ImageAttachment => !!a)
      setText('')
      ed?.commands.clearContent()
      setSlashIndex(-1)
      setMentionActive(false)
      setMentionIndex(0)
      mentionInfoRef.current = null
      mentionEmptyByAtRef.current.clear()
      return { segments, mentions: collectedMentions, attachments: orderedAttachments }
    }, [text])

    const handleSend = useCallback(() => {
      if (!canSend) return
      if (activeProviderForResources === 'codex') {
        const trimmed = text.trim()
        const goalMatch = /^\/goal(?:\s+([\s\S]*))?$/i.exec(trimmed)
        if (goalMatch) {
          const prefill = goalMatch[1]?.trim() ?? ''
          serializeAndClear()
          setGoalDialogState({ open: true, prefill })
          return
        }
      }
      const { segments, mentions: editorMentions, attachments: sentAttachments } = serializeAndClear()
      const fullText = segments.flatMap((s) => ('attachmentId' in s ? [] : [s.text])).join('\n')
      // Pass the mosaic tile (or mini-window) scope so the turn lands on this pane's
      // session even when project-active still points at a sibling tile mid-switch.
      // Catch so transport/IPC failures are not silent unhandled rejections.
      // Toast is raised inside sendMessageImpl; here we only prevent process noise.
      void sendMessage(
        fullText,
        segments,
        editorMentions,
        sentAttachments,
        sessionScope ?? undefined,
      ).catch((err) => {
        console.error('[ChatInput] sendMessage failed:', err)
      })
    }, [activeProviderForResources, canSend, sendMessage, serializeAndClear, sessionScope, text])

    const handleKeyDownCore = useCallback(
      (e: KeyboardEvent | React.KeyboardEvent): boolean => {
        const isComposing = 'nativeEvent' in e ? e.nativeEvent.isComposing : e.isComposing
        if (isComposing) return false

        if (e.key === 'Escape' && showReviewPanel) {
          setShowReviewPanel(false)
          return true
        }
        if (e.key === 'Escape' && addDirActive) {
          const ed = editorRef.current
          if (ed) ed.commands.clearContent()
          setText('')
          setAddDirIndex(0)
          return true
        }
        if (e.key === 'Escape' && workflowSlashActive) {
          const ed = editorRef.current
          if (ed) ed.commands.clearContent()
          setText('')
          setWorkflowSlashIndex(0)
          return true
        }
        if (e.key === 'Escape' && commandPopup) {
          dismissCommandPopup()
          return true
        }

        if (addDirActive) {
          const count = addDirRef.current?.getItemCount() ?? 0
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setAddDirIndex((i) => (count > 0 ? (i + 1) % count : 0))
            return true
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            setAddDirIndex((i) => (count > 0 ? (i <= 0 ? count - 1 : i - 1) : 0))
            return true
          }
          if (e.key === 'Tab') {
            e.preventDefault()
            addDirRef.current?.confirmTab()
            return true
          }
          if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
            e.preventDefault()
            addDirRef.current?.confirmEnter()
            return true
          }
        }

        if (workflowSlashActive) {
          const count = workflowSlashRef.current?.getItemCount() ?? 0
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setWorkflowSlashIndex((i) => (count > 0 ? (i + 1) % count : 0))
            return true
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            setWorkflowSlashIndex((i) => (count > 0 ? (i <= 0 ? count - 1 : i - 1) : 0))
            return true
          }
          // Always handle Tab in /workflow — args mode uses Tab for key=default / next key
          // even when the key list is empty (jump to next missing param).
          if (e.key === 'Tab') {
            e.preventDefault()
            workflowSlashRef.current?.confirmTab()
            return true
          }
          if (e.key === 'Enter' && !e.shiftKey && !e.altKey && count > 0) {
            e.preventDefault()
            workflowSlashRef.current?.confirmEnter()
            return true
          }
        }

        if (mentionInfoRef.current && mentionActive) {
          const count = mentionRef.current?.getItemCount() ?? 0
          if (count > 0) {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setMentionIndex((i) => (i + 1) % count)
              return true
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setMentionIndex((i) => (i <= 0 ? count - 1 : i - 1))
              return true
            }
            if (e.key === 'Tab') {
              e.preventDefault()
              mentionRef.current?.confirmTab()
              return true
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
              e.preventDefault()
              mentionRef.current?.confirmEnter()
              return true
            }
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            const dismissedAt = mentionInfoRef.current?.atPos
            if (dismissedAt !== undefined) {
              mentionDismissedAtRef.current.add(dismissedAt)
            }
            syncSessionMentionDismissed(editorRef.current, mentionDismissedAtRef.current)
            setMentionActive(false)
            setMentionIndex(0)
            mentionInfoRef.current = null
            // Keep empty-suppression map; only this @ is user-dismissed.
            return true
          }
        }

        if (matchingCommands.length > 0 && !slashDismissed) {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setSlashIndex((i) => (i + 1) % matchingCommands.length)
            return true
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            setSlashIndex((i) => (i <= 0 ? matchingCommands.length - 1 : i - 1))
            return true
          }
          if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !e.altKey)) {
            e.preventDefault()
            const idx = slashIndex >= 0 ? Math.min(slashIndex, matchingCommands.length - 1) : 0
            if (matchingCommands[idx]) {
              selectSlashCommand(matchingCommands[idx].name)
            }
            return true
          }
          if (e.key === 'Escape') {
            setSlashIndex(-1)
            setSlashDismissed(true)
            return true
          }
        }

        if (e.key === 'Tab' && !e.shiftKey) {
          const suggestion = promptSuggestionRef.current
          const ed = editorRef.current
          if (suggestion && ed && ed.isEmpty) {
            e.preventDefault()
            ed.commands.setContent(suggestion)
            ed.commands.focus('end')
            setTextRef.current(suggestion)
            return true
          }
        }

        if (e.key === 'Backspace') {
          const ed = editorRef.current
          if (ed && ed.isEmpty && attachments.length > 0) {
            e.preventDefault()
            removeAttachment(attachments.length - 1)
            return true
          }
        }

        if (e.key === 'ArrowUp' && editorRef.current?.isEmpty && queuedMessages.length > 0) {
          e.preventDefault()
          editQueuedMessage(queuedMessages[queuedMessages.length - 1].id)
          return true
        }

        if (e.key === 'Enter' && (e.shiftKey || e.altKey)) {
          e.preventDefault()
          editorRef.current?.chain().setHardBreak().scrollIntoView().run()
          return true
        }

        if (e.key === 'Enter') {
          e.preventDefault()
          handleSend()
          return true
        }

        return false
      },
      [handleSend, queuedMessages, editQueuedMessage, matchingCommands, slashIndex, selectSlashCommand, mentionActive, slashDismissed, attachments, removeAttachment, commandPopup, dismissCommandPopup, addDirActive, workflowSlashActive, setText, showReviewPanel, setShowReviewPanel]
    )

    handleKeyDownRef.current = handleKeyDownCore

    const insertMention = useCallback(
      (kind: MentionKind, value: string, displayName: string) => {
        addMention({ kind, value, displayName })
        const ed = editorRef.current
        if (ed) {
          const cursor = ed.state.selection.from
          ed.chain()
            .focus()
            .insertContentAt(cursor, [
              { type: 'mention', attrs: { kind, value, displayName } },
            ])
            .run()
          return
        }
        setText(`${text}@${value}`)
      },
      [addMention, setText, text],
    )
    chatInputAPI.insertMention = insertMention

    const insertFileMention = useCallback(
      async (rawPath: string) => {
        // Drop / file-picker paths always arrived as kind:file even for folders
        // (getPathForFile works for directories on macOS). Stat first so folder
        // mentions keep kind:directory + trailing slash for display round-trip.
        const stat = await window.app.pathStat(rawPath)
        const isDir = stat?.isDirectory ?? false
        const absForMention = isDir && !rawPath.endsWith('/') ? `${rawPath}/` : rawPath
        let mentionValue = toMentionPath(absForMention, fileRoot)
        if (isDir && mentionValue !== '.' && !mentionValue.endsWith('/')) mentionValue += '/'
        const displayName = mentionValue.split('/').filter(Boolean).pop() || mentionValue
        insertMention(isDir ? 'directory' : 'file', mentionValue, displayName)
      },
      [fileRoot, insertMention]
    )

    // Store the attachment and insert an inline chip node at the cursor, so an
    // upload reads as a file reference sitting in the message where the caret is.
    const attachFile = useCallback(
      (att: ImageAttachment) => {
        const id = crypto.randomUUID()
        addAttachment({ ...att, id })
        editorRef.current?.chain().focus().insertContent({ type: 'attachment', attrs: { id } }).run()
      },
      [addAttachment]
    )

    const processSelectedFiles = useCallback(
      (files: FileList | File[]) => {
        for (const file of Array.from(files)) {
          if (file.type.startsWith('image/')) {
            void buildImageAttachment(file).then((att) => {
              if (att) attachFile(att)
            })
            continue
          }
          if (file.type === 'application/pdf') {
            const reader = new FileReader()
            reader.onload = () => {
              const result = reader.result as string
              const base64 = result.split(',')[1]
              if (base64) {
                attachFile({ mimeType: file.type, base64, name: file.name })
              }
            }
            reader.readAsDataURL(file)
            continue
          }

          const filePath = window.app.getPathForFile(file)
          if (!filePath) continue
          void insertFileMention(filePath)
        }
      },
      [attachFile, insertFileMention]
    )
    processSelectedFilesRef.current = processSelectedFiles

    const addImageFromPath = useCallback(
      async (absPath: string) => {
        const res = await window.app.readFileAsDataUri(absPath)
        if (!res.ok) return
        const [meta, b64] = res.dataUri.split(',')
        if (!b64) return
        const mime = meta.match(/data:([^;]+)/)?.[1] ?? 'image/png'
        const bin = atob(b64)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        const name = absPath.split(/[\\/]/).pop() || 'image.png'
        const att = await buildImageAttachment(new File([bytes], name, { type: mime }))
        if (att) attachFile(att)
      },
      [attachFile],
    )
    chatInputAPI.addImageFromPath = addImageFromPath

    const handleFileSelect = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) processSelectedFiles(e.target.files)
        e.target.value = ''
      },
      [processSelectedFiles]
    )

    const handleDragEnter = useCallback((e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounterRef.current++
      if (e.dataTransfer.types.includes('Files')) {
        setIsDragging(true)
      }
    }, [])

    const handleDragLeave = useCallback((e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounterRef.current--
      if (dragCounterRef.current === 0) {
        setIsDragging(false)
      }
    }, [])

    const handleDragOver = useCallback((e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
    }, [])

    const handleDrop = useCallback(
      async (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        dragCounterRef.current = 0
        setIsDragging(false)
        const files = e.dataTransfer.files
        if (files.length === 0) {
          const imageUrl = extractDraggedImageUrl(e.dataTransfer)
          if (imageUrl) void addBrowserImageToChat(imageUrl, sessionScope ?? undefined)
          return
        }
        if (internalDragSource.active) {
          for (const file of Array.from(files)) {
            const absPath = window.app.getPathForFile(file)
            if (!absPath) continue
            const stat = await window.app.pathStat(absPath)
            const isDir = stat?.isDirectory ?? false
            const mentionValue = toMentionPath(isDir ? absPath + '/' : absPath, fileRoot)
            const displayName = mentionValue.split('/').filter(Boolean).pop() || mentionValue
            insertMention(isDir ? 'directory' : 'file', mentionValue, displayName)
          }
          return
        }
        processSelectedFiles(files)
      },
      [processSelectedFiles, insertMention, fileRoot, sessionScope]
    )

    const shouldShowCodexRejectHint = isCodexPlanMode && codexPlanRejectHintActive && text.trim().length === 0
    const providerPlaceholder = resolveChatInputPlaceholder(t, {
      provider: activeProviderForResources,
      permissionMode,
      codexPlanMode: isCodexPlanMode,
      acpAgentName: acpAgentName || t('chat.suggestions.acpLabel'),
    })
    const placeholderText = mentions.length > 0
      ? t('chat.placeholder.addInstructions')
      : shouldShowCodexRejectHint
        ? CODEX_REJECT_PLAN_PLACEHOLDER
        : providerPlaceholder
    placeholderTextRef.current = placeholderText

    const editor = useEditor({
      extensions: [
        StarterKit.configure({
          heading: false,
          blockquote: false,
          bulletList: false,
          orderedList: false,
          codeBlock: false,
          horizontalRule: false,
          listItem: false,
          code: false,
          bold: false,
          italic: false,
          strike: false,
          dropcursor: false,
        }),
        Placeholder.configure({ placeholder: () => placeholderTextRef.current }),
        MentionNode,
        AttachmentNode,
        PasteChipNode,
        SlashDecoration.configure({ slashCommands: activeSlashCommands }),
        SessionMentionDecoration.configure({ projects: sessionProjectOptions }),
        PromptSuggestion,
      ],
      content: '',
      editorProps: {
        attributes: {
          class: 'w-full min-h-9 max-h-30 overflow-y-auto text-sm leading-6 outline-none text-foreground',
          'data-chat-input-editor': 'true',
        },
        handleKeyDown: (_view, event) => {
          return handleKeyDownRef.current(event)
        },
        handlePaste: (_view, event) => {
          const plainText = event.clipboardData?.getData('text/plain')
          if (plainText) {
            const markers = findMiniAppMentionMarkers(plainText)
            if (markers.length > 0) {
              const installedAppIds = new Set(useMiniAppStore.getState().apps.map((a) => a.id))
              const content: { type: string; text?: string; attrs?: Record<string, unknown> }[] = []
              let cursor = 0
              const pushText = (slice: string) => {
                if (slice) content.push({ type: 'text', text: slice })
              }
              for (const m of markers) {
                if (m.start > cursor) pushText(plainText.slice(cursor, m.start))
                if (installedAppIds.has(m.appId)) {
                  content.push({ type: 'mention', attrs: { kind: 'miniapp', value: m.appId, displayName: m.appName } })
                  addMentionRef.current({ kind: 'miniapp', value: m.appId, displayName: m.appName })
                } else {
                  pushText(`@${m.appName}`)
                }
                cursor = m.end
              }
              if (cursor < plainText.length) pushText(plainText.slice(cursor))
              event.preventDefault()
              editorRef.current?.chain().focus().insertContent(content).run()
              return true
            }
          }
          if (plainText && plainText.trim()) {
            const lineCount = plainText.split('\n').length
            if (lineCount >= PASTE_CHIP_LINE_THRESHOLD || plainText.length >= PASTE_CHIP_CHAR_THRESHOLD) {
              event.preventDefault()
              const preview = plainText.slice(0, 60).replace(/\n/g, ' ')
              editorRef.current?.chain().focus().insertContent([
                { type: 'pasteChip', attrs: { text: plainText, lineCount, preview } },
                { type: 'paragraph' },
              ]).run()
              return true
            }
          }
          const items = event.clipboardData?.items
          if (!items) return false
          const attachableFiles: File[] = []
          for (const item of Array.from(items)) {
            if (item.type.startsWith('image/') || item.type === 'application/pdf') {
              const file = item.getAsFile()
              if (file) attachableFiles.push(file)
            }
          }
          if (attachableFiles.length > 0) {
            event.preventDefault()
            processSelectedFilesRef.current(attachableFiles)
            return true
          }
          return false
        },
        handleDrop: () => true,
      },
      onUpdate: ({ editor: ed }) => {
        isEditorUpdateRef.current = true
        // Captured before the flag is consumed below: a programmatic content set
        // (session restore) must NOT prune attachments — the nodes are being
        // rebuilt from persisted session.attachments, not deleted by the user.
        const wasProgrammaticSet = isProgrammaticSetRef.current
        const plainText = ed.getText()
        setTextRef.current(plainText)
        // Snapshot the full doc (text + chip nodes + positions) so a session
        // switch can restore it exactly, not just the plain text.
        setDraftJsonRef.current(ed.getJSON())
        setSlashIndex(-1)
        if (isProgrammaticSetRef.current) {
          isProgrammaticSetRef.current = false
          setSlashDismissed(true)
        } else {
          setSlashDismissed(false)
        }

        const editorMentions: MentionNodeAttrs[] = []
        const pasteChipNodes: unknown[] = []
        const editorAttachmentIds = new Set<string>()
        ed.state.doc.descendants((node) => {
          if (node.type.name === 'mention') {
            editorMentions.push(node.attrs as MentionNodeAttrs)
          } else if (node.type.name === 'pasteChip') {
            pasteChipNodes.push(node)
          } else if (node.type.name === 'attachment') {
            editorAttachmentIds.add((node.attrs as { id: string }).id)
          }
        })
        setHasPasteChips(pasteChipNodes.length > 0)
        // Drop attachments whose chip node was deleted inline (backspace / cut).
        // Skip during a programmatic restore, where nodes are (re)built from the
        // persisted store rather than reflecting a user deletion.
        if (!wasProgrammaticSet) {
          for (const att of attachmentsRef.current) {
            if (att.id && !editorAttachmentIds.has(att.id)) {
              removeAttachmentByIdRef.current(att.id)
            }
          }
        }
        const editorValues = new Set(editorMentions.map((m) => m.value))
        for (const m of mentionsRef.current) {
          if (!editorValues.has(m.value)) {
            removeMentionRef.current(m.value)
          }
        }

        const { from } = ed.state.selection
        const $pos = ed.state.doc.resolve(from)
        const textInParent = $pos.parent.textBetween(0, $pos.parentOffset, undefined, '\0')
        const lastAt = textInParent.lastIndexOf('@')
        if (lastAt !== -1) {
          const afterAt = textInParent.slice(lastAt + 1)
          // Default: single-token @mentions (file/agent) close on space.
          // Session grammar needs spaces: @session [project|all] [title…]
          const spaceOk = mentionQueryAllowsSpaces(afterAt)
          if ((!afterAt.includes(' ') || spaceOk) && !afterAt.includes('\0')) {
            const atPos = $pos.start() + lastAt
            // Drop dismiss markers for @ tokens that no longer exist (deleted or replaced).
            let dismissChanged = false
            for (const pos of [...mentionDismissedAtRef.current]) {
              if (pos !== atPos) {
                mentionDismissedAtRef.current.delete(pos)
                dismissChanged = true
              }
            }
            // Escape dismissed this @ — keep treating it as plain text (popup + ghost).
            if (mentionDismissedAtRef.current.has(atPos)) {
              if (dismissChanged) {
                syncSessionMentionDismissed(ed, mentionDismissedAtRef.current)
              }
              setMentionActive(false)
              mentionInfoRef.current = null
            } else {
              if (dismissChanged) {
                syncSessionMentionDismissed(ed, mentionDismissedAtRef.current)
              }
              const isComposing = ed.view.composing
              // During IME composition keep the popup open and skip empty-query lockout.
              if (isComposing) {
                if (!mentionActiveRef.current) setMentionIndex(0)
                setMentionActive(true)
                mentionInfoRef.current = { atPos, query: afterAt }
              } else {
                const firstEmptyQuery = mentionEmptyByAtRef.current.get(atPos)
                if (firstEmptyQuery !== undefined && !afterAt.startsWith(firstEmptyQuery)) {
                  mentionEmptyByAtRef.current.delete(atPos)
                }
                const stillEmpty = mentionEmptyByAtRef.current.get(atPos)
                if (stillEmpty !== undefined && afterAt.startsWith(stillEmpty)) {
                  setMentionActive(false)
                  mentionInfoRef.current = null
                } else {
                  if (!mentionActiveRef.current) {
                    setMentionIndex(0)
                  }
                  setMentionActive(true)
                  mentionInfoRef.current = { atPos, query: afterAt }
                }
              }
            }
          } else {
            setMentionActive(false)
            mentionInfoRef.current = null
            mentionEmptyByAtRef.current.clear()
            if (mentionDismissedAtRef.current.size > 0) {
              mentionDismissedAtRef.current.clear()
              syncSessionMentionDismissed(ed, mentionDismissedAtRef.current)
            }
          }
        } else {
          setMentionActive(false)
          mentionInfoRef.current = null
          mentionEmptyByAtRef.current.clear()
          if (mentionDismissedAtRef.current.size > 0) {
            mentionDismissedAtRef.current.clear()
            syncSessionMentionDismissed(ed, mentionDismissedAtRef.current)
          }
        }
      },
    })
    editorRef.current = editor && !editor.isDestroyed ? editor : null

    const isEditorUpdateRef = useRef(false)
    const isProgrammaticSetRef = useRef(false)
    const prevSessionIdRef = useRef(displayedSessionId)
    useEffect(() => {
      const sessionChanged = prevSessionIdRef.current !== displayedSessionId
      prevSessionIdRef.current = displayedSessionId
      if (!sessionChanged && isEditorUpdateRef.current) {
        isEditorUpdateRef.current = false
        return
      }
      isEditorUpdateRef.current = false
      if (!editor || editor.isDestroyed) return
      // Attachments live in per-session store state, not in the text draft, so
      // detect when the editor's chip nodes drift from session.attachments
      // (e.g. after a session switch rebuilt the doc from text only).
      const editorAttIds = new Set<string>()
      editor.state.doc.descendants((n) => {
        if (n.type.name === 'attachment') editorAttIds.add((n.attrs as { id: string }).id)
      })
      const storeAtts = attachmentsRef.current.filter((a) => a.id)
      const attMismatch = storeAtts.length !== editorAttIds.size || storeAtts.some((a) => !editorAttIds.has(a.id as string))
      if (text !== editor.getText() || attMismatch) {
        const json = draftJsonRef.current
        const textSnapshot = text
        // Defer setContent off the effect stack. TipTap ReactNodeViewRenderer
        // calls flushSync when mounting mention/attachment chips; React 19
        // rejects flushSync while a lifecycle is still running (console error
        // at this setContent site, and chip state can fail to settle).
        let cancelled = false
        queueMicrotask(() => {
          if (cancelled || !editor || editor.isDestroyed) return
          isProgrammaticSetRef.current = true
          if (json) {
            // Restore the exact doc — chip nodes keep their inline positions.
            editor.commands.setContent(json)
          } else {
            // Legacy fallback (draft has no JSON snapshot): rebuild from text and
            // append attachment chips from the persisted store.
            editor.commands.setContent(textSnapshot ? `<p>${textSnapshot}</p>` : '')
            if (storeAtts.length > 0) {
              editor.commands.insertContent(
                storeAtts.map((a) => ({ type: 'attachment' as const, attrs: { id: a.id } })),
              )
            }
          }
        })
        return () => {
          cancelled = true
        }
      }
    }, [text, editor, displayedSessionId])

    useEffect(() => {
      if (!sessionScope && editor && !editor.isDestroyed && !showReviewPanel) {
        editor.commands.focus('end')
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editor, showReviewPanel, displayedSessionId, sessionScope])

    useEffect(() => {
      if (!chatInputFocusNonce) return
      if (editor && !editor.isDestroyed && !showReviewPanel) {
        editor.commands.focus('end')
      }
    }, [chatInputFocusNonce, editor, showReviewPanel])

    useEffect(() => {
      if (!chatInputRestoreFocusNonce) return
      if (editor && !editor.isDestroyed && !showReviewPanel) {
        editor.commands.focus()
      }
    }, [chatInputRestoreFocusNonce, editor, showReviewPanel])

    useEffect(() => {
      if (showReviewPanel && editor && !editor.isDestroyed) {
        editor.commands.blur()
      }
    }, [showReviewPanel, editor])

    useEffect(() => {
      if (editor && !editor.isDestroyed) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(editor.storage as any).slashDecoration.slashCommands = activeSlashCommands
        editor.view.dispatch(editor.state.tr)
      }
    }, [activeSlashCommands, editor])

    useEffect(() => {
      if (editor && !editor.isDestroyed) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(editor.storage as any).sessionMentionDecoration.projects = sessionProjectOptions
        editor.view.dispatch(editor.state.tr)
      }
    }, [sessionProjectOptions, editor])

    useEffect(() => {
      if (editor && !editor.isDestroyed) {
        const active = status !== 'streaming' ? promptSuggestion : null
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(editor.storage as any).promptSuggestion.suggestion = active
        editor.view.dom.classList.toggle('has-prompt-suggestion', !!active)
        editor.view.dispatch(editor.state.tr)
      }
    }, [promptSuggestion, status, editor])

    useEffect(() => {
      if (editor && !editor.isDestroyed) {
        editor.view.dispatch(editor.state.tr)
      }
    }, [placeholderText, editor])


    useEffect(() => {
      if (!promptSuggestion || isStreaming || hasPendingInteraction) return
      function onKeyDown(e: KeyboardEvent) {
        if (e.key !== 'Tab' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return
        const ed = editorRef.current
        if (!ed || !ed.isEmpty) return
        if (ed.view.hasFocus()) return
        e.preventDefault()
        ed.commands.setContent(promptSuggestion!)
        ed.commands.focus('end')
        setTextRef.current(promptSuggestion!)
      }
      window.addEventListener('keydown', onKeyDown)
      return () => window.removeEventListener('keydown', onKeyDown)
    }, [promptSuggestion, isStreaming, hasPendingInteraction])

    return (
      <div className="relative">
        {activeProviderForResources === 'claude' && <ChatInputDirsHint />}
        <div
          className={cn(
            'relative mx-3 mb-1 rounded-xl border border-border px-3 py-2',
            isDragging && 'ring-2 ring-inset ring-primary/50'
          )}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
        {showSlashPopup && (
          <div className="absolute bottom-full left-0 right-0 z-10 mb-1 flex max-h-64 flex-col overflow-hidden rounded-xl border border-border bg-popover p-1.5">
            {acpSlashInitialLoading && (
              <div className="mb-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 shrink-0 animate-spin" />
                <span>{t('chat.acpCommands.loading')}</span>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {slashGroups.map((group) => (
                <div key={group.key}>
                  <PopupSectionHeader
                    label={t(group.key === 'skill' ? 'chat.slashCommand.groupSkills' : 'chat.slashCommand.groupCommands')}
                    count={group.items.length}
                  />
                  {group.items.map((cmd, j) => {
                    const i = group.startIndex + j
                    return (
                      <button
                        key={cmd.name}
                        ref={(el) => {
                          if (el) slashItemRefs.current.set(i, el)
                          else slashItemRefs.current.delete(i)
                        }}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          selectSlashCommand(cmd.name)
                        }}
                        className={`flex w-full flex-col gap-0.5 rounded px-2 py-1.5 text-left text-xs transition-colors ${
                          i === slashIndex
                            ? 'bg-primary/15 text-foreground'
                            : 'text-foreground hover:bg-muted/40'
                        }`}
                      >
                        <span className="flex min-w-0 items-center gap-1.5 font-medium">
                          {/* Keep the command name single-line; argument hints absorb overflow. */}
                          <HighlightedText
                            text={`/${cmd.name}`}
                            indices={[0, ...cmd.matchIndices.map((idx) => idx + 1)]}
                            highlightClassName="text-highlighted font-semibold"
                            className="shrink-0 whitespace-nowrap"
                          />
                          {cmd.argumentHint && (
                            <span className="min-w-0 flex-1 truncate text-muted-foreground font-normal">{cmd.argumentHint}</span>
                          )}
                        </span>
                        {cmd.description && (
                          <span className="line-clamp-2 text-muted-foreground leading-snug">
                            {cmd.description}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              ))}
              {acpSlashInitialLoading && matchingCommands.length === 0 && (
                <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                  {t('chat.acpCommands.loadingHint')}
                </div>
              )}
            </div>
          </div>
        )}

        {/* /provider popup layer retired — provider selection moved into the model selector (kept for reference)
        {commandPopup && commandPopup.command === 'provider' && (
          <div className="absolute bottom-full left-0 right-0 z-10 mb-1 overflow-hidden rounded-xl border border-border bg-popover">
            <ProviderSlashPopup onClose={dismissCommandPopup} />
          </div>
        )} */}

        {commandPopup && commandPopup.command === 'mcp' && (
          <div className="absolute bottom-full left-0 right-0 z-10 mb-1 overflow-hidden rounded-xl border border-border bg-popover">
            <McpSlashPopup onClose={dismissCommandPopup} />
          </div>
        )}

        {commandPopup && commandPopup.command === 'workflows' && (
          <div className="absolute bottom-full left-0 right-0 z-10 mb-1 overflow-hidden rounded-xl border border-border bg-popover">
            <WorkflowsSlashPopup onClose={dismissCommandPopup} />
          </div>
        )}

        {commandPopup && commandPopup.command !== 'provider' && commandPopup.command !== 'mcp' && commandPopup.command !== 'workflows' && (
          <div className="absolute bottom-full left-0 right-0 z-10 mb-1 flex max-h-96 flex-col overflow-hidden rounded-xl border border-border bg-popover">
            <div className="flex items-center justify-between px-3 py-1.5">
              <span className="text-xs font-medium text-muted-foreground">/{commandPopup.command}</span>
              <button
                onMouseDown={(e) => { e.preventDefault(); dismissCommandPopup() }}
                className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto border-t border-border px-3 py-2">
              <SlashCommandContent command={commandPopup.command} content={commandPopup.content} />
            </div>
          </div>
        )}

        {addDirActive && (
          <AddDirPopup
            ref={addDirRef}
            argsText={addDirArgsText}
            selectedIndex={addDirIndex}
            onSetSelectedIndex={setAddDirIndex}
            onScopeFill={handleAddDirScopeFill}
            onPathNavigate={handleAddDirPathNavigate}
            onPathCommit={handleAddDirCommit}
            onAddViaPicker={handleAddDirPicker}
            onRemoveDir={handleAddDirRemove}
          />
        )}
        {workflowSlashActive && (
          <WorkflowSlashPopup
            ref={workflowSlashRef}
            argsText={workflowSlashArgsText}
            selectedIndex={workflowSlashIndex}
            onSetSelectedIndex={setWorkflowSlashIndex}
            onApply={handleWorkflowSlashApply}
            slashCommands={activeSlashCommands}
          />
        )}
        {showReviewPanel && <ReviewPanel />}

        {mentionInfoRef.current && mentionActive && matchingCommands.length === 0 && !addDirActive && !workflowSlashActive && (
          <MentionPopup
            ref={mentionRef}
            query={mentionInfoRef.current.query}
            selectedIndex={mentionIndex}
            onSelect={handleMentionSelect}
            onSetSelectedIndex={setMentionIndex}
            onResultState={handleMentionResultState}
            onClose={() => {
              const dismissedAt = mentionInfoRef.current?.atPos
              if (dismissedAt !== undefined) mentionDismissedAtRef.current.add(dismissedAt)
              syncSessionMentionDismissed(editorRef.current, mentionDismissedAtRef.current)
              setMentionActive(false)
              setMentionIndex(0)
              mentionInfoRef.current = null
            }}
            showAgents={showAgentMentions}
          />
        )}

        <BrowserAnnotationChips annotations={browserAnnotations} onRemove={removeBrowserAnnotation} onClear={clearBrowserAnnotations} />

        <ContextBar
          contexts={miniAppContexts}
          onToggle={toggleMiniAppContext}
          onDismiss={clearMiniAppContext}
          userSelections={userSelections}
          onRemoveUserSelectionAt={removeUserSelectionAt}
          onClearUserSelections={clearUserSelections}
        />

        <EditorContent editor={editor} />

        <div className="mt-1.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />
            <IconButton size="sm" onClick={() => fileInputRef.current?.click()}>
              <Paperclip />
            </IconButton>

            <ModelSelector onCloseAutoFocus={(e) => { e.preventDefault(); if (editor && !editor.isDestroyed) editor.commands.focus() }} />
            {activeProviderForResources === 'codex' && displayedSessionId && codexThreadId && codexGoal && (
              <CodexGoalIndicator
                sessionId={displayedSessionId}
                threadId={codexThreadId}
                goal={codexGoal}
                onGoalChange={setCodexGoal}
                onEdit={() => setGoalDialogState({ open: true, prefill: codexGoal.objective })}
              />
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <ContextUsage />
            {isStreaming && (
              <StopButton
                onInterrupt={interrupt}
                softCancel={harnessUsesSoftCancel(activeProviderForResources)}
              />
            )}
            <IconButton
              variant="ghost"
              onClick={handleSend}
              disabled={!canSend}
              className="size-7 rounded-full border border-border disabled:opacity-30"
            >
              <ArrowUp />
            </IconButton>
          </div>
        </div>

        {isDragging && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[inherit] border-2 border-dashed border-primary bg-primary/10">
            <span className="text-xs font-medium text-primary">{t('chat.dropToAttach')}</span>
          </div>
        )}
        {activeProject && (
          <CodexGoalDialog
            open={goalDialogState.open}
            onOpenChange={(open) => setGoalDialogState((s) => ({ ...s, open }))}
            sessionId={displayedSessionId}
            threadId={codexThreadId ?? null}
            prefill={goalDialogState.prefill}
            onGoalChange={setCodexGoal}
          />
        )}
        </div>
      </div>
    )
  }
