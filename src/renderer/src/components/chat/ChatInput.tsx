import { useRef, useState, useCallback, useImperativeHandle, forwardRef, useMemo, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { useChatStore, useActiveSession } from '@/stores/chat'
import { Button } from '@/components/ui/button'
import { ArrowUp, Square, Paperclip, X } from 'lucide-react'
import type { MentionKind } from '@/stores/chat'
import { ContextUsage } from './ContextUsage'
import { MentionPopup, type MentionPopupHandle } from './MentionPopup'
import { useAppStore } from '@/stores/app'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { MentionNode } from './mention-node'
import { SlashDecoration } from './slash-decoration'
import { PromptSuggestion } from './prompt-suggestion'
import type { MentionNodeAttrs } from './mention-node'
import type { SlashCommandInfo } from '../../../../shared/agent-types'
import type { ImageAttachment } from '../../../../shared/agent-types'
import { toMentionPath } from './chat-input-utils'
import { AttachmentBar } from './AttachmentBar'
import { ModelSelector } from './ModelSelector'
import { DirManagerPanel } from './DirManagerPanel'

export interface ChatInputHandle {
  send: () => void
}

interface ChatInputProps {
  compact?: boolean
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(
  function ChatInput({ compact }, ref) {
    const text = useActiveSession((s) => s.draftText)
    const setText = useChatStore((s) => s.setDraftText)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const sendMessage = useChatStore((s) => s.sendMessage)
    const activeProject = useChatStore((s) => s.activeProject)
    const interrupt = useChatStore((s) => s.interrupt)
    const isOpen = useChatStore((s) => s.isOpen)
    const toggleOpen = useChatStore((s) => s.toggleOpen)
    const status = useActiveSession((s) => s.status)
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
    const promptSuggestion = useActiveSession((s) => s.promptSuggestion)
    const hasPendingInteraction = useActiveSession((s) => s.hasPendingInteraction)

    const [slashIndex, setSlashIndex] = useState(-1)
    const [slashDismissed, setSlashDismissed] = useState(false)
    const slashItemRefs = useRef<Map<number, HTMLButtonElement>>(new Map())

    const [isDragging, setIsDragging] = useState(false)
    const dragCounterRef = useRef(0)

    const [mentionActive, setMentionActive] = useState(false)
    const [mentionIndex, setMentionIndex] = useState(0)
    const mentionRef = useRef<MentionPopupHandle>(null)

    const mentionInfoRef = useRef<{ atPos: number; query: string } | null>(null)
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
    const promptSuggestionRef = useRef(promptSuggestion)
    promptSuggestionRef.current = promptSuggestion

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
          ed.chain()
            .focus()
            .deleteRange({ from: info.atPos, to: info.atPos + 1 + info.query.length })
            .insertContentAt(info.atPos, '@' + value)
            .run()
          setMentionIndex(0)
          return
        }

        const isAgent = showAgentMentions && agents.some((a) => a.name === value)
        const kind: MentionKind = isAgent ? 'agent' : value.endsWith('/') ? 'directory' : 'file'
        const displayName = value.split('/').filter(Boolean).pop() || value

        addMention({ kind, value, displayName })

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

    const handleKeyDownCore = useCallback(
      (e: KeyboardEvent | React.KeyboardEvent): boolean => {
        const isComposing = 'nativeEvent' in e ? e.nativeEvent.isComposing : e.isComposing
        if (isComposing) return false

        if (e.key === 'Escape' && showDirManager) {
          setShowDirManager(false)
          return true
        }
        if (e.key === 'Escape' && commandPopup) {
          dismissCommandPopup()
          return true
        }

        if (e.key === 'Enter' && e.shiftKey && !isOpen) {
          e.preventDefault()
          toggleOpen()
          return true
        }

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
          if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
            e.preventDefault()
            mentionRef.current?.confirmEnter()
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
      [handleSend, matchingCommands, slashIndex, selectSlashCommand, mentionActive, slashDismissed, isOpen, toggleOpen, attachments, removeAttachment, commandPopup, dismissCommandPopup, showDirManager, setShowDirManager]
    )

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
          if (file.type.startsWith('image/') || file.type === 'application/pdf') {
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
        PromptSuggestion,
      ],
      content: '',
      editorProps: {
        attributes: {
          class: 'w-full min-h-[36px] max-h-[120px] overflow-y-auto text-[15px] leading-6 outline-none text-foreground',
        },
        handleKeyDown: (_view, event) => {
          return handleKeyDownRef.current(event)
        },
        handlePaste: (_view, event) => {
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
        const plainText = ed.getText()
        setTextRef.current(plainText)
        setSlashIndex(-1)
        setSlashDismissed(false)

        const editorMentions: MentionNodeAttrs[] = []
        ed.state.doc.descendants((node) => {
          if (node.type.name === 'mention') {
            editorMentions.push(node.attrs as MentionNodeAttrs)
          }
        })
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
          if (!afterAt.includes(' ') && !afterAt.includes('\0')) {
            if (!mentionActiveRef.current) {
              setMentionIndex(0)
            }
            setMentionActive(true)
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

    useEffect(() => {
      if (!compact && isOpen && editor) {
        editor.commands.focus('end')
      }
    }, [compact, isOpen, editor])

    useEffect(() => {
      if (editor) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(editor.storage as any).slashDecoration.slashCommands = activeSlashCommands
        editor.view.dispatch(editor.state.tr)
      }
    }, [activeSlashCommands, editor])

    useEffect(() => {
      if (editor) {
        const active = status !== 'streaming' ? promptSuggestion : null
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(editor.storage as any).promptSuggestion.suggestion = active
        editor.view.dom.classList.toggle('has-prompt-suggestion', !!active)
        editor.view.dispatch(editor.state.tr)
      }
    }, [promptSuggestion, status, editor])

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

        {showDirManager && <DirManagerPanel isCoding={isCoding} />}

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

        <AttachmentBar attachments={attachments} onRemove={removeAttachment} />

        <div className="relative w-full">
          <EditorContent editor={editor} />
        </div>

        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf"
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

            <ModelSelector />
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

        {isDragging && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[inherit] border-2 border-dashed border-blue-500 bg-blue-500/10">
            <span className="text-xs font-medium text-blue-400">Drop images or PDFs to attach</span>
          </div>
        )}
      </div>
    )
  }
)
