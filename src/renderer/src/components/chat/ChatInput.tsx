import { useRef, useState, useCallback, useImperativeHandle, forwardRef, useMemo, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { useChatStore, useActiveSession } from '@/stores/chat'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ArrowUp, Square, ChevronDown, Paperclip, X, Loader2, Check, FolderPlus, Folder } from 'lucide-react'
import type { MentionKind } from '@/stores/chat'
import { ContextUsage } from './ContextUsage'
import { MentionPopup, type MentionPopupHandle } from './MentionPopup'
import { useAppStore } from '@/stores/app'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { MentionNode } from './mention-node'
import { SlashDecoration } from './slash-decoration'
import type { MentionNodeAttrs } from './mention-node'
import type { SlashCommandInfo } from '../../../../shared/agent-types'

export interface ChatInputHandle {
  send: () => void
}

interface ChatInputProps {
  compact?: boolean
}

function formatCodexModelLabel(raw: string): string {
  const normalized = raw.trim().split('/').pop()?.trim() ?? raw.trim()
  if (!normalized) return raw
  const tokens = normalized
    .replace(/_/g, '-')
    .split(/[-\s]+/)
    .filter(Boolean)
  if (tokens.length === 0) return normalized
  return tokens.map((token) => {
    const lower = token.toLowerCase()
    if (lower === 'gpt') return 'GPT'
    if (/^\d+(\.\d+)*$/.test(token)) return token
    return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`
  }).join('-')
}

function formatReasoningEffortLabel(value: string): string {
  switch (value) {
    case 'minimal':
      return 'Minimal'
    case 'low':
      return 'Low'
    case 'medium':
      return 'Medium'
    case 'high':
      return 'High'
    case 'xhigh':
      return 'Extra High'
    default:
      return value
  }
}

function normalizeFilePath(path: string): string {
  return path.replace(/\\/g, '/')
}

function toMentionPath(filePath: string, projectPath?: string | null): string {
  const normalizedFilePath = normalizeFilePath(filePath)
  const normalizedProjectPath = projectPath ? normalizeFilePath(projectPath).replace(/\/+$/, '') : ''
  if (!normalizedProjectPath) return normalizedFilePath
  if (normalizedFilePath === normalizedProjectPath) return '.'
  if (normalizedFilePath.startsWith(`${normalizedProjectPath}/`)) {
    return normalizedFilePath.slice(normalizedProjectPath.length + 1)
  }
  return normalizedFilePath
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(
  function ChatInput({ compact }, ref) {
    const text = useActiveSession((s) => s.draftText)
    const setText = useChatStore((s) => s.setDraftText)
    const [modelOpen, setModelOpen] = useState(false)
    const [effortOpen, setEffortOpen] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const sendMessage = useChatStore((s) => s.sendMessage)
    const activeProject = useChatStore((s) => s.activeProject)
    const interrupt = useChatStore((s) => s.interrupt)
    const isOpen = useChatStore((s) => s.isOpen)
    const toggleOpen = useChatStore((s) => s.toggleOpen)
    const status = useActiveSession((s) => s.status)
    const selectedModel = useActiveSession((s) => s.selectedModel)
    const selectedCodexModel = useActiveSession((s) => s.selectedCodexModel)
    const selectedCodexReasoningEffort = useActiveSession((s) => s.selectedCodexReasoningEffort)
    const availableModels = useChatStore((s) => s.availableModels)
    const codexModels = useActiveSession((s) => s.codexModels)
    const codexModelsLoading = useActiveSession((s) => s.codexModelsLoading)
    const setSelectedModel = useChatStore((s) => s.setSelectedModel)
    const setSelectedCodexModel = useChatStore((s) => s.setSelectedCodexModel)
    const setSelectedCodexReasoningEffort = useChatStore((s) => s.setSelectedCodexReasoningEffort)
    const refreshCodexModels = useChatStore((s) => s.refreshCodexModels)
    const attachments = useActiveSession((s) => s.attachments)
    const addAttachment = useChatStore((s) => s.addAttachment)
    const removeAttachment = useChatStore((s) => s.removeAttachment)
    const slashCommands = useActiveSession((s) => s.slashCommands)
    const preferredProvider = useActiveSession((s) => s.preferredProvider)
    const sessionProvider = useActiveSession((s) => s.sessionProvider)
    const mentions = useActiveSession((s) => s.mentions)
    const addMention = useChatStore((s) => s.addMention)
    const removeMention = useChatStore((s) => s.removeMention)
    const agents = useActiveSession((s) => s.agents)
    const permissionMode = useActiveSession((s) => s.permissionMode)
    const commandPopup = useActiveSession((s) =>
      s.slashCommandOutput?.mode === 'popup' ? s.slashCommandOutput : null
    )
    const dismissCommandPopup = useChatStore((s) => s.dismissSlashCommandOutput)
    const showDirManager = useActiveSession((s) => s.showDirManager)
    const setShowDirManager = useChatStore((s) => s.setShowDirManager)
    const additionalDirs = useActiveSession((s) => s.additionalDirs)
    const projectAdditionalDirs = useActiveSession((s) => s.projectAdditionalDirs)
    const addDir = useChatStore((s) => s.addDir)
    const removeDir = useChatStore((s) => s.removeDir)

    const [slashIndex, setSlashIndex] = useState(-1)
    const [slashDismissed, setSlashDismissed] = useState(false)
    const slashItemRefs = useRef<Map<number, HTMLButtonElement>>(new Map())

    // Drag-and-drop state
    const [isDragging, setIsDragging] = useState(false)
    const dragCounterRef = useRef(0)

    // @ mention state
    const [mentionActive, setMentionActive] = useState(false)
    const [mentionIndex, setMentionIndex] = useState(0)
    const mentionRef = useRef<MentionPopupHandle>(null)

    // Track mention trigger info (computed in onUpdate, not from store text)
    const mentionInfoRef = useRef<{ atPos: number; query: string } | null>(null)
    // Stable refs for callbacks used inside TipTap (to avoid stale closures)
    const mentionActiveRef = useRef(mentionActive)
    mentionActiveRef.current = mentionActive
    const slashCommandsRef = useRef(slashCommands)
    slashCommandsRef.current = slashCommands
    const mentionsRef = useRef(mentions)
    mentionsRef.current = mentions
    const removeMentionRef = useRef(removeMention)
    removeMentionRef.current = removeMention
    const processSelectedFilesRef = useRef<(files: FileList | File[]) => void>(() => {})
    const setTextRef = useRef(setText)
    setTextRef.current = setText
    const matchingCommandsRef = useRef<typeof matchingCommands>([])
    const slashDismissedRef = useRef(false)
    const handleKeyDownRef = useRef<(e: KeyboardEvent) => boolean>(() => false)

    // Scroll selected slash command into view
    useEffect(() => {
      if (slashIndex >= 0) {
        slashItemRefs.current.get(slashIndex)?.scrollIntoView({ block: 'nearest' })
      }
    }, [slashIndex])

    const isStreaming = status === 'streaming'
    const activeProviderForResources = sessionProvider ?? preferredProvider
    const canSend = (text.trim().length > 0 || attachments.length > 0 || mentions.length > 0) && (!isStreaming || activeProviderForResources === 'codex')
    const showAgentMentions = activeProviderForResources === 'claude'

    const codexSlashCommands = useMemo<SlashCommandInfo[]>(() => ([
      { name: 'help', description: 'Show available commands', argumentHint: '', isSkill: false },
      { name: 'reset', description: 'Reset Codex thread', argumentHint: '', isSkill: false },
      { name: 'auth', description: 'Show auth status', argumentHint: '', isSkill: false },
      { name: 'auth auto', description: 'Auto auth mode (prefer API key)', argumentHint: '', isSkill: false },
      { name: 'auth chatgpt', description: 'Use ChatGPT sign-in mode', argumentHint: '', isSkill: false },
      { name: 'auth apikey', description: 'Use API key mode', argumentHint: '<CODEX_API_KEY>', isSkill: false },
      { name: 'review', description: 'Review uncommitted changes', argumentHint: '', isSkill: false },
      { name: 'review branch', description: 'Review diff against base branch', argumentHint: '', isSkill: false },
      { name: 'review commit', description: 'Review a specific commit', argumentHint: '<sha>', isSkill: false },
      { name: 'compact', description: 'Compact thread context', argumentHint: '', isSkill: false },
    ]), [])

    const activeSlashCommands = activeProviderForResources === 'codex' ? codexSlashCommands : slashCommands

    // Filter slash commands based on current input
    const HIDDEN_COMMANDS = new Set(['keybindings-help', 'debug'])
    const matchingCommands = useMemo(() => {
      if (activeProviderForResources === 'codex') {
        if (!text.startsWith('/')) return []
        const query = text.slice(1).toLowerCase()
        return activeSlashCommands.filter((cmd) => cmd.name.toLowerCase().startsWith(query))
      }
      if (!text.startsWith('/') || text.includes(' ')) return []
      const query = text.slice(1).toLowerCase()
      return activeSlashCommands.filter(
        (cmd) => cmd.name.toLowerCase().startsWith(query) && !HIDDEN_COMMANDS.has(cmd.name)
      )
    }, [activeProviderForResources, text, activeSlashCommands])
    matchingCommandsRef.current = matchingCommands
    slashDismissedRef.current = slashDismissed

    const editorRef = useRef<ReturnType<typeof useEditor>>(null)

    const selectSlashCommand = useCallback(
      (name: string) => {
        // Special handling for add-dir: show directory manager instead of inserting text
        if (name === 'add-dir') {
          const ed = editorRef.current
          if (ed) {
            ed.chain().focus().setContent('').run()
          }
          setText('')
          setSlashIndex(-1)
          setShowDirManager(true)
          return
        }
        const ed = editorRef.current
        if (ed) {
          ed.chain().focus().setContent(`/${name} `).run()
          // Move cursor to end
          ed.commands.focus('end')
        }
        setText(`/${name} `)
        setSlashIndex(-1)
      },
      [setShowDirManager]
    )

    const handleMentionSelect = useCallback(
      (value: string, action: 'navigate' | 'select') => {
        const info = mentionInfoRef.current
        const ed = editorRef.current
        if (!info || !ed) return

        if (action === 'navigate') {
          // Replace @query text with new path for directory navigation
          ed.chain()
            .focus()
            .deleteRange({ from: info.atPos, to: info.atPos + 1 + info.query.length })
            .insertContentAt(info.atPos, '@' + value)
            .run()
          setMentionIndex(0)
          return
        }

        // Determine mention kind
        const isAgent = showAgentMentions && agents.some((a) => a.name === value)
        const kind: MentionKind = isAgent ? 'agent' : value.endsWith('/') ? 'directory' : 'file'
        const displayName = value.split('/').filter(Boolean).pop() || value

        addMention({ kind, value, displayName })

        // Delete @query text and insert mention node inline
        ed.chain()
          .focus()
          .deleteRange({ from: info.atPos, to: info.atPos + 1 + info.query.length })
          .insertContentAt(info.atPos, [
            { type: 'mention', attrs: { kind, value, displayName } },
            { type: 'text', text: ' ' },
          ])
          .run()

        setMentionActive(false)
        setMentionIndex(0)
        mentionInfoRef.current = null
      },
      [agents, addMention, showAgentMentions]
    )

    const handleSend = useCallback(() => {
      if (!canSend) return
      const ed = editorRef.current
      // Serialize editor content with inline @mentions preserved at their positions
      let serialized = ''
      if (ed) {
        ed.state.doc.descendants((node) => {
          if (node.isText) {
            serialized += node.text ?? ''
          } else if (node.type.name === 'mention') {
            serialized += `@${(node.attrs as MentionNodeAttrs).value}`
          } else if (node.isBlock && serialized.length > 0) {
            serialized += '\n'
          }
        })
      } else {
        serialized = text
      }
      sendMessage(serialized.trim())
      setText('')
      ed?.commands.clearContent()
      setSlashIndex(-1)
      setMentionActive(false)
      setMentionIndex(0)
      mentionInfoRef.current = null
    }, [canSend, text, sendMessage])

    useImperativeHandle(ref, () => ({ send: handleSend }), [handleSend])

    // Core keyboard handler — works with both native and React events
    // Returns true if the key was handled (used by ProseMirror's handleKeyDown)
    const handleKeyDownCore = useCallback(
      (e: KeyboardEvent | React.KeyboardEvent): boolean => {
        const isComposing = 'nativeEvent' in e ? e.nativeEvent.isComposing : e.isComposing
        if (isComposing) return false

        // Escape → dismiss dir manager or command output popup
        if (e.key === 'Escape' && showDirManager) {
          setShowDirManager(false)
          return true
        }
        if (e.key === 'Escape' && commandPopup) {
          dismissCommandPopup()
          return true
        }

        // Shift+Enter in collapsed mode → expand the panel
        if (e.key === 'Enter' && e.shiftKey && !isOpen) {
          e.preventDefault()
          toggleOpen()
          return true
        }

        // @ mention navigation
        if (mentionInfoRef.current && mentionActive) {
          const count = mentionRef.current?.getItemCount() ?? 0
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setMentionIndex((i) => (count > 0 ? (i + 1) % count : 0))
            return true
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            setMentionIndex((i) => (count > 0 ? (i <= 0 ? count - 1 : i - 1) : 0))
            return true
          }
          if (e.key === 'Tab') {
            e.preventDefault()
            mentionRef.current?.confirmTab()
            return true
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            setMentionActive(false)
            setMentionIndex(0)
            mentionInfoRef.current = null
            return true
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            mentionRef.current?.confirmEnter()
            return true
          }
        }

        // Slash command navigation
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
          if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
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

        // Backspace on empty editor → remove last attachment
        if (e.key === 'Backspace') {
          const ed = editorRef.current
          if (ed && ed.isEmpty && attachments.length > 0) {
            e.preventDefault()
            removeAttachment(attachments.length - 1)
            return true
          }
        }

        // Enter → send message (Shift+Enter falls through to ProseMirror for newline)
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          handleSend()
          return true
        }

        return false
      },
      [handleSend, matchingCommands, slashIndex, selectSlashCommand, mentionActive, slashDismissed, isOpen, toggleOpen, attachments, removeAttachment, commandPopup, dismissCommandPopup, showDirManager, setShowDirManager]
    )

    // Keep ref in sync for ProseMirror's handleKeyDown (avoids stale closure)
    handleKeyDownRef.current = handleKeyDownCore

    const insertFileMention = useCallback(
      (rawPath: string) => {
        const mentionValue = toMentionPath(rawPath, activeProject)
        const displayName = mentionValue.split('/').filter(Boolean).pop() || mentionValue
        addMention({ kind: 'file', value: mentionValue, displayName })

        const ed = editorRef.current
        if (ed) {
          const cursor = ed.state.selection.from
          ed.chain()
            .focus()
            .insertContentAt(cursor, [
              { type: 'mention', attrs: { kind: 'file', value: mentionValue, displayName } },
              { type: 'text', text: ' ' },
            ])
            .run()
          return
        }

        const suffix = text.length > 0 && !text.endsWith(' ') ? ' ' : ''
        setText(`${text}${suffix}@${mentionValue} `)
      },
      [activeProject, addMention, setText, text]
    )

    const processSelectedFiles = useCallback(
      (files: FileList | File[]) => {
        for (const file of Array.from(files)) {
          if (file.type.startsWith('image/')) {
            const reader = new FileReader()
            reader.onload = () => {
              const result = reader.result as string
              const base64 = result.split(',')[1]
              if (base64) {
                addAttachment({ mimeType: file.type, base64, name: file.name })
              }
            }
            reader.readAsDataURL(file)
            continue
          }

          const filePath = (file as File & { path?: string }).path
          if (!filePath) continue
          insertFileMention(filePath)
        }
      },
      [addAttachment, insertFileMention]
    )
    processSelectedFilesRef.current = processSelectedFiles

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
      (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        dragCounterRef.current = 0
        setIsDragging(false)
        if (e.dataTransfer.files.length > 0) {
          processSelectedFiles(e.dataTransfer.files)
        }
      },
      [processSelectedFiles]
    )

    // --- TipTap editor ---
    const placeholderText = mentions.length > 0
      ? 'Add instructions...'
      : activeProviderForResources === 'codex'
        ? 'Ask Codex...'
        : permissionMode === 'plan'
        ? 'Plan mode — describe your intent...'
        : 'Ask anything, @ to add files, / for commands'

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
        Placeholder.configure({ placeholder: placeholderText }),
        MentionNode,
        SlashDecoration.configure({ slashCommands: activeSlashCommands }),
      ],
      content: '',
      editorProps: {
        attributes: {
          class: 'w-full min-h-[36px] max-h-[120px] overflow-y-auto text-[15px] leading-6 outline-none text-foreground',
        },
        // Intercept keys BEFORE ProseMirror handles them
        handleKeyDown: (_view, event) => {
          return handleKeyDownRef.current(event)
        },
        handlePaste: (_view, event) => {
          const items = event.clipboardData?.items
          if (!items) return false
          const imageFiles: File[] = []
          for (const item of Array.from(items)) {
            if (item.type.startsWith('image/')) {
              const file = item.getAsFile()
              if (file) imageFiles.push(file)
            }
          }
          if (imageFiles.length > 0) {
            event.preventDefault()
            processSelectedFilesRef.current(imageFiles)
            return true
          }
          return false
        },
        // Drop handled by outer container's onDrop to avoid duplicate processing
        handleDrop: () => true,
      },
      onUpdate: ({ editor: ed }) => {
        isEditorUpdateRef.current = true
        const plainText = ed.getText()
        setTextRef.current(plainText)
        setSlashIndex(-1)
        setSlashDismissed(false)

        // Sync mention nodes with store
        const editorMentions: MentionNodeAttrs[] = []
        ed.state.doc.descendants((node) => {
          if (node.type.name === 'mention') {
            editorMentions.push(node.attrs as MentionNodeAttrs)
          }
        })
        // Remove mentions from store that are no longer in editor
        const editorValues = new Set(editorMentions.map((m) => m.value))
        for (const m of mentionsRef.current) {
          if (!editorValues.has(m.value)) {
            removeMentionRef.current(m.value)
          }
        }

        // Detect @ mention trigger within the current paragraph
        const { from } = ed.state.selection
        const $pos = ed.state.doc.resolve(from)
        const textInParent = $pos.parent.textBetween(0, $pos.parentOffset, undefined, '\0')
        const lastAt = textInParent.lastIndexOf('@')
        if (lastAt !== -1) {
          const afterAt = textInParent.slice(lastAt + 1)
          if (!afterAt.includes(' ') && !afterAt.includes('\0')) {
            if (!mentionActiveRef.current) {
              setMentionIndex(0)
            }
            setMentionActive(true)
            // $pos.start() = start of paragraph content; offset 1:1 within inline content
            mentionInfoRef.current = { atPos: $pos.start() + lastAt, query: afterAt }
          } else {
            setMentionActive(false)
            mentionInfoRef.current = null
          }
        } else {
          setMentionActive(false)
          mentionInfoRef.current = null
        }
      },
    })
    editorRef.current = editor

    // Sync external draftText changes (e.g. from "Commit First" button) into the editor
    const isEditorUpdateRef = useRef(false)
    useEffect(() => {
      if (isEditorUpdateRef.current) {
        isEditorUpdateRef.current = false
        return
      }
      if (editor && text !== editor.getText()) {
        editor.commands.setContent(text ? `<p>${text}</p>` : '')
        editor.commands.focus('end')
      }
    }, [text, editor])

    // Auto-focus when panel opens
    useEffect(() => {
      if (!compact && isOpen && editor) {
        editor.commands.focus('end')
      }
    }, [compact, isOpen, editor])

    // Update SlashDecoration storage when slashCommands change
    useEffect(() => {
      if (editor) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(editor.storage as any).slashDecoration.slashCommands = activeSlashCommands
        // Force decoration recalculation by dispatching an empty transaction
        editor.view.dispatch(editor.state.tr)
      }
    }, [activeSlashCommands, editor])

    const currentModelName =
      (availableModels.find((m) => m.id === selectedModel)?.name ?? selectedModel) || null
    const selectedCodexModelOption = codexModels.find((m) => m.id === selectedCodexModel)
    const currentCodexModelName =
      (selectedCodexModelOption
        ? formatCodexModelLabel(selectedCodexModelOption.id || selectedCodexModelOption.name)
        : selectedCodexModel
        ? formatCodexModelLabel(selectedCodexModel)
        : null)
    const codexReasoningEfforts = selectedCodexModelOption?.supportedReasoningEfforts ?? []
    const currentCodexReasoningEffort =
      selectedCodexReasoningEffort
      ?? selectedCodexModelOption?.defaultReasoningEffort
      ?? codexReasoningEfforts[0]?.value
      ?? null
    const currentCodexReasoningEffortLabel = currentCodexReasoningEffort
      ? formatReasoningEffortLabel(currentCodexReasoningEffort)
      : null

    useEffect(() => {
      if (activeProviderForResources !== 'codex') return
      if (codexModelsLoading || codexModels.length > 0) return
      void refreshCodexModels()
    }, [activeProviderForResources, codexModelsLoading, codexModels.length, refreshCodexModels])

    if (compact) {
      return (
        <input
          type="text"
          value={text}
          onChange={(e) => {
            const val = e.target.value
            setText(val)
            if (val.endsWith('@') && !isOpen) {
              setMentionActive(true)
              setMentionIndex(0)
              toggleOpen()
            }
          }}
          onKeyDown={handleKeyDownCore}
          placeholder={activeProviderForResources === 'codex'
            ? 'Ask Codex...'
            : permissionMode === 'plan'
              ? 'Plan mode — describe your intent...'
              : 'Ask anything...'}
          className="flex-1 bg-transparent text-sm text-foreground placeholder-muted-foreground outline-none"
        />
      )
    }

    const isCoding = useAppStore.getState().layoutMode === 'coding'

    return (
      <div
        className={cn(
          'relative',
          isCoding
            ? 'mx-3 mb-1 rounded-xl border border-border px-4 py-3'
            : 'border-t border-border px-3 py-2',
          isDragging && 'ring-2 ring-blue-500/50'
        )}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* Slash command autocomplete */}
        {matchingCommands.length > 0 && !slashDismissed && (
          <div className={cn(
            'absolute bottom-full left-0 right-0 z-10 flex max-h-64 flex-col overflow-hidden border border-border bg-card p-1.5',
            isCoding ? 'mb-1 rounded-xl' : 'mb-0.5 rounded-t-lg'
          )}>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {matchingCommands.map((cmd, i) => (
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
                      ? 'bg-muted text-foreground'
                      : 'text-foreground hover:bg-muted/50'
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-1.5 font-medium">
                    <span className="text-blue-400">/{cmd.name}</span>
                    {cmd.argumentHint && (
                      <span className="truncate text-muted-foreground font-normal">{cmd.argumentHint}</span>
                    )}
                    {cmd.isSkill && (
                      <span className="rounded bg-emerald-900/50 px-1 py-px text-[10px] font-normal text-emerald-400">
                        skill
                      </span>
                    )}
                  </span>
                  {cmd.description && (
                    <span className={cn('text-muted-foreground leading-snug', cmd.isSkill && 'line-clamp-2')}>
                      {cmd.description}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Command output popup */}
        {commandPopup && (
          <div className={cn(
            'absolute bottom-full left-0 right-0 z-10 flex max-h-64 flex-col overflow-hidden border border-border bg-card',
            isCoding ? 'mb-1 rounded-xl' : 'mb-0.5 rounded-t-lg'
          )}>
            <div className="flex items-center justify-between px-3 py-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">/{commandPopup.command}</span>
              <button
                onMouseDown={(e) => { e.preventDefault(); dismissCommandPopup() }}
                className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto border-t border-border px-3 py-2">
              <pre className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">{commandPopup.content}</pre>
            </div>
          </div>
        )}

        {/* Directory manager panel */}
        {showDirManager && (
          <div className={cn(
            'absolute bottom-full left-0 right-0 z-10 flex max-h-80 flex-col overflow-hidden border border-border bg-card',
            isCoding ? 'mb-1 rounded-xl' : 'mb-0.5 rounded-t-lg'
          )}>
            <div className="flex items-center justify-between px-3 py-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">/add-dir</span>
              <button
                onMouseDown={(e) => { e.preventDefault(); setShowDirManager(false) }}
                className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto border-t border-border px-3 py-2 space-y-3">
              {/* Project-level directories */}
              <div>
                <div className="mb-1 flex items-center gap-1.5">
                  <span className="text-sm font-medium text-muted-foreground">Project</span>
                  <button
                    onMouseDown={async (e) => {
                      e.preventDefault()
                      const folder = await window.app.selectFolder()
                      if (folder) addDir(folder, 'project')
                    }}
                    className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <FolderPlus className="size-3.5" />
                  </button>
                </div>
                {projectAdditionalDirs.length === 0 ? (
                  <div className="text-xs text-muted-foreground/60 italic">No additional directories</div>
                ) : (
                  <div className="space-y-0.5">
                    {projectAdditionalDirs.map((dir) => (
                      <div key={dir} className="flex items-center justify-between gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted/50">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <Folder className="size-3.5 shrink-0 text-blue-500" />
                          <span className="truncate text-foreground">{dir}</span>
                        </span>
                        <button
                          onMouseDown={(e) => { e.preventDefault(); removeDir(dir, 'project') }}
                          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <X className="size-2.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {/* Session-level directories */}
              <div>
                <div className="mb-1 flex items-center gap-1.5">
                  <span className="text-sm font-medium text-muted-foreground">Session</span>
                  <button
                    onMouseDown={async (e) => {
                      e.preventDefault()
                      const folder = await window.app.selectFolder()
                      if (folder) addDir(folder, 'session')
                    }}
                    className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <FolderPlus className="size-3.5" />
                  </button>
                </div>
                {additionalDirs.length === 0 ? (
                  <div className="text-xs text-muted-foreground/60 italic">No additional directories</div>
                ) : (
                  <div className="space-y-0.5">
                    {additionalDirs.map((dir) => (
                      <div key={dir} className="flex items-center justify-between gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted/50">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <Folder className="size-3.5 shrink-0 text-blue-500" />
                          <span className="truncate text-foreground">{dir}</span>
                        </span>
                        <button
                          onMouseDown={(e) => { e.preventDefault(); removeDir(dir, 'session') }}
                          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <X className="size-2.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* @ mention autocomplete */}
        {mentionInfoRef.current && mentionActive && matchingCommands.length === 0 && (
          <MentionPopup
            ref={mentionRef}
            query={mentionInfoRef.current.query}
            selectedIndex={mentionIndex}
            onSelect={handleMentionSelect}
            onSetSelectedIndex={setMentionIndex}
            onClose={() => { setMentionActive(false); setMentionIndex(0); mentionInfoRef.current = null }}
            showAgents={showAgentMentions}
            rounded={isCoding}
          />
        )}

        {/* Attachment thumbnails */}
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachments.map((att, i) => (
              <div
                key={i}
                className="group relative size-12 overflow-hidden rounded border border-border"
              >
                <img
                  src={`data:${att.mimeType};base64,${att.base64}`}
                  alt={att.name}
                  className="size-full object-cover"
                />
                <button
                  onClick={() => removeAttachment(i)}
                  className="absolute -right-0.5 -top-0.5 hidden rounded-full bg-card p-0.5 group-hover:block"
                >
                  <X className="size-2.5 text-foreground" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* TipTap editor */}
        <div className="relative w-full">
          <EditorContent editor={editor} />
        </div>

        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Attachment upload */}
            <input
              ref={fileInputRef}
              type="file"
              accept="*/*"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() => fileInputRef.current?.click()}
              className="text-muted-foreground hover:text-foreground"
            >
              <Paperclip className="size-3.5" />
            </Button>

            {/* Provider / model selector */}
            {activeProviderForResources === 'claude' ? (
              <Popover open={modelOpen} onOpenChange={setModelOpen}>
                <PopoverTrigger asChild>
                  <button className="flex items-center gap-0.5 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                    {currentModelName ? (
                      <span className="max-w-[140px] truncate">{currentModelName}</span>
                    ) : (
                      <Loader2 className="size-3 animate-spin" />
                    )}
                    <ChevronDown className={`size-3 transition-transform duration-200 ${modelOpen ? 'rotate-180' : ''}`} />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  side="top"
                  className="w-64 max-h-60 overflow-y-auto border-border bg-card p-1"
                >
                  {availableModels.map((model) => (
                    <button
                      key={model.id}
                      onClick={() => {
                        setSelectedModel(model.id)
                        setModelOpen(false)
                      }}
                      className={`w-full rounded px-2 py-1.5 text-left text-xs transition-colors ${
                        model.id === selectedModel
                          ? 'bg-muted text-foreground'
                          : 'text-foreground hover:bg-muted/50'
                      }`}
                    >
                      <div className="font-medium">{model.name}</div>
                      {model.description && (
                        <div className="mt-0.5 text-[10px] text-muted-foreground line-clamp-1">
                          {model.description}
                        </div>
                      )}
                    </button>
                  ))}
                  {availableModels.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">Loading models...</div>
                  )}
                </PopoverContent>
              </Popover>
            ) : (
              <div className="flex items-center gap-1">
                <Popover
                  open={modelOpen}
                  onOpenChange={(open) => {
                    setModelOpen(open)
                    if (open) void refreshCodexModels()
                  }}
                >
                  <PopoverTrigger asChild>
                    <button className="flex items-center gap-0.5 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                      {currentCodexModelName ? (
                        <span className="max-w-[140px] truncate">{currentCodexModelName}</span>
                      ) : codexModelsLoading ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <span>Codex model</span>
                      )}
                      <ChevronDown className={`size-3 transition-transform duration-200 ${modelOpen ? 'rotate-180' : ''}`} />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    side="top"
                    className="w-72 max-h-60 overflow-y-auto border-border bg-card p-1"
                  >
                    {codexModels.map((model) => (
                      <button
                        key={model.id}
                        onClick={() => {
                          setSelectedCodexModel(model.id)
                          setModelOpen(false)
                        }}
                        className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs transition-colors ${
                          model.id === selectedCodexModel
                            ? 'bg-muted text-foreground'
                            : 'text-foreground hover:bg-muted/50'
                        }`}
                      >
                        <div className="font-medium">
                          {formatCodexModelLabel(model.id || model.name)}
                        </div>
                        {model.id === selectedCodexModel && (
                          <Check className="size-3.5 shrink-0" />
                        )}
                      </button>
                    ))}
                    {codexModelsLoading && (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">Loading Codex models...</div>
                    )}
                    {!codexModelsLoading && codexModels.length === 0 && (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">Use default model (auto)</div>
                    )}
                  </PopoverContent>
                </Popover>

                {codexReasoningEfforts.length > 0 && (
                  <Popover open={effortOpen} onOpenChange={setEffortOpen}>
                    <PopoverTrigger asChild>
                      <button className="flex items-center gap-0.5 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                        <span className="max-w-[120px] truncate">
                          {currentCodexReasoningEffortLabel ?? formatReasoningEffortLabel(codexReasoningEfforts[0].value)}
                        </span>
                        <ChevronDown className={`size-3 transition-transform duration-200 ${effortOpen ? 'rotate-180' : ''}`} />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      side="top"
                      className="w-72 max-h-60 overflow-y-auto border-border bg-card p-1"
                    >
                      {codexReasoningEfforts.map((option) => (
                        <button
                          key={option.value}
                          onClick={() => {
                            setSelectedCodexReasoningEffort(option.value)
                            setEffortOpen(false)
                          }}
                          className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs transition-colors ${
                            option.value === currentCodexReasoningEffort
                              ? 'bg-muted text-foreground'
                              : 'text-foreground hover:bg-muted/50'
                          }`}
                        >
                          <div className="font-medium">{formatReasoningEffortLabel(option.value)}</div>
                          {option.value === currentCodexReasoningEffort && (
                            <Check className="size-3.5 shrink-0" />
                          )}
                        </button>
                      ))}
                    </PopoverContent>
                  </Popover>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <ContextUsage />
            {isStreaming ? (
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={() => interrupt()}
                className={cn(
                  'text-muted-foreground hover:text-foreground',
                  isCoding && 'size-7 rounded-full border border-border'
                )}
              >
                <Square className="size-3" />
              </Button>
            ) : (
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={handleSend}
                disabled={!canSend}
                className={cn(
                  'text-muted-foreground hover:text-foreground disabled:opacity-30',
                  isCoding && 'size-7 rounded-full border border-border'
                )}
              >
                <ArrowUp className="size-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* Drag overlay */}
        {isDragging && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[inherit] border-2 border-dashed border-blue-500 bg-blue-500/10">
            <span className="text-xs font-medium text-blue-400">Drop to attach files</span>
          </div>
        )}
      </div>
    )
  }
)
