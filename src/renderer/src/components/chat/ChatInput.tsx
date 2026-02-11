import { useRef, useState, useCallback, useImperativeHandle, forwardRef, useMemo, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/stores/chat'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ArrowUp, Square, ChevronDown, Paperclip, X, Folder } from 'lucide-react'
import { FileIcon } from '@/components/ui/FileIcon'
import type { MentionKind } from '@/stores/chat'
import { PermissionModeSelector } from './PermissionModeSelector'
import { ContextUsage } from './ContextUsage'
import { MentionPopup, type MentionPopupHandle } from './MentionPopup'

export interface ChatInputHandle {
  send: () => void
}

interface ChatInputProps {
  compact?: boolean
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(
  function ChatInput({ compact }, ref) {
    const text = useChatStore((s) => s.draftText)
    const setText = useChatStore((s) => s.setDraftText)
    const [modelOpen, setModelOpen] = useState(false)
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const sendMessage = useChatStore((s) => s.sendMessage)
    const interrupt = useChatStore((s) => s.interrupt)
    const isOpen = useChatStore((s) => s.isOpen)
    const toggleOpen = useChatStore((s) => s.toggleOpen)
    const status = useChatStore((s) => s.status)
    const selectedModel = useChatStore((s) => s.selectedModel)
    const availableModels = useChatStore((s) => s.availableModels)
    const setSelectedModel = useChatStore((s) => s.setSelectedModel)
    const attachments = useChatStore((s) => s.attachments)
    const addAttachment = useChatStore((s) => s.addAttachment)
    const removeAttachment = useChatStore((s) => s.removeAttachment)
    const slashCommands = useChatStore((s) => s.slashCommands)
    const mentions = useChatStore((s) => s.mentions)
    const addMention = useChatStore((s) => s.addMention)
    const removeMention = useChatStore((s) => s.removeMention)
    const agents = useChatStore((s) => s.agents)
    const permissionMode = useChatStore((s) => s.permissionMode)

    const [slashIndex, setSlashIndex] = useState(-1)
    const slashItemRefs = useRef<Map<number, HTMLButtonElement>>(new Map())

    // @ mention state
    const [mentionActive, setMentionActive] = useState(false)
    const [mentionIndex, setMentionIndex] = useState(0)
    const mentionRef = useRef<MentionPopupHandle>(null)

    // Auto-focus expanded textarea when panel opens
    useEffect(() => {
      if (!compact && isOpen && textareaRef.current) {
        const el = textareaRef.current
        // Focus and move cursor to end
        el.focus()
        el.selectionStart = el.value.length
        el.selectionEnd = el.value.length
        // Detect active @ mention from shared draftText (e.g. typed in compact mode)
        const lastAt = text.lastIndexOf('@')
        if (lastAt !== -1 && !text.slice(lastAt + 1).includes(' ')) {
          setMentionActive(true)
          setMentionIndex(0)
        }
      }
    }, [compact, isOpen])

    // Detect @ trigger position based on cursor in text
    const mentionInfo = useMemo(() => {
      if (!mentionActive) return null
      // Find the last unescaped @ before the text end
      const atIdx = text.lastIndexOf('@')
      if (atIdx === -1) return null
      const query = text.slice(atIdx + 1)
      // Close if there's a space in the query (unless it's a path separator)
      if (query.includes(' ')) return null
      return { atIndex: atIdx, query }
    }, [text, mentionActive])

    // Scroll selected slash command into view
    useEffect(() => {
      if (slashIndex >= 0) {
        slashItemRefs.current.get(slashIndex)?.scrollIntoView({ block: 'nearest' })
      }
    }, [slashIndex])

    // Highlighted slash command overlay content
    const slashHighlight = useMemo(() => {
      if (!text.startsWith('/')) return null
      const match = text.match(/^(\/\S*)(.*)$/s)
      if (!match) return null
      const cmdPart = match[1]
      const rest = match[2]
      const cmdName = cmdPart.slice(1)
      const exact = slashCommands.find((c) => c.name === cmdName)
      const hasMatch = slashCommands.some((c) => c.name.toLowerCase().startsWith(cmdName.toLowerCase()))
      if (!hasMatch && !exact) return null

      // Parse hint tokens (e.g. "<file> <message>" → ["<file>", "<message>"])
      const hintTokens = exact?.argumentHint?.match(/<[^>]+>|\[[^\]]+\]/g) ?? []
      // Count user-provided args to determine remaining hints
      const trimmedRest = rest.trimStart()
      const filledCount = trimmedRest ? trimmedRest.split(/\s+/).length : 0
      const remainingHints = hintTokens.slice(filledCount)
      const hintPrefix = rest.endsWith(' ') ? '' : ' '

      return (
        <>
          <span className="text-blue-400">{cmdPart}</span>
          {rest && <span className="text-foreground">{rest}</span>}
          {remainingHints.length > 0 && (
            <span className="text-muted-foreground">{hintPrefix}{remainingHints.join(' ')}</span>
          )}
        </>
      )
    }, [text, slashCommands])

    const isStreaming = status === 'streaming'
    const canSend = (text.trim().length > 0 || attachments.length > 0 || mentions.length > 0) && !isStreaming

    // Filter slash commands based on current input
    const HIDDEN_COMMANDS = new Set(['keybindings-help', 'debug'])
    const matchingCommands = useMemo(() => {
      if (!text.startsWith('/') || text.includes(' ')) return []
      const query = text.slice(1).toLowerCase()
      return slashCommands.filter(
        (cmd) => cmd.name.toLowerCase().startsWith(query) && !HIDDEN_COMMANDS.has(cmd.name)
      )
    }, [text, slashCommands])

    const selectSlashCommand = useCallback(
      (name: string) => {
        setText(`/${name} `)
        setSlashIndex(-1)
        textareaRef.current?.focus()
      },
      []
    )

    const handleMentionSelect = useCallback(
      (value: string, action: 'navigate' | 'select') => {
        if (!mentionInfo) return

        if (action === 'navigate') {
          // Directory navigation — update the @query in text, keep popup open
          setText(text.slice(0, mentionInfo.atIndex + 1) + value)
          setMentionIndex(0)
          textareaRef.current?.focus()
          return
        }

        // Determine mention kind
        const isAgent = agents.some((a) => a.name === value)
        const kind: MentionKind = isAgent ? 'agent' : value.endsWith('/') ? 'directory' : 'file'
        const displayName = value.split('/').filter(Boolean).pop() || value

        addMention({ kind, value, displayName })

        // Remove @query portion from text
        const before = text.slice(0, mentionInfo.atIndex)
        const after = text.slice(mentionInfo.atIndex + 1 + mentionInfo.query.length)
        setText(before + after)

        setMentionActive(false)
        setMentionIndex(0)
        textareaRef.current?.focus()
      },
      [mentionInfo, agents, addMention]
    )

    const handleSend = useCallback(() => {
      if (!canSend) return
      sendMessage(text.trim())
      setText('')
      setSlashIndex(-1)
      setMentionActive(false)
      setMentionIndex(0)
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }
    }, [canSend, text, sendMessage])

    useImperativeHandle(ref, () => ({ send: handleSend }), [handleSend])

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        // Ignore key events during IME composition (e.g. Chinese input)
        if (e.nativeEvent.isComposing) return

        // Shift+Enter in collapsed mode → expand the panel with newline
        if (e.key === 'Enter' && e.shiftKey && !isOpen) {
          e.preventDefault()
          toggleOpen()
          return
        }

        // @ mention navigation (takes priority when active)
        if (mentionInfo && mentionActive) {
          const count = mentionRef.current?.getItemCount() ?? 0
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setMentionIndex((i) => (count > 0 ? (i + 1) % count : 0))
            return
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            setMentionIndex((i) => (count > 0 ? (i <= 0 ? count - 1 : i - 1) : 0))
            return
          }
          if (e.key === 'Tab') {
            e.preventDefault()
            mentionRef.current?.confirmTab()
            return
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            setMentionActive(false)
            setMentionIndex(0)
            return
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            mentionRef.current?.confirmEnter()
            return
          }
        }

        // Slash command navigation
        if (matchingCommands.length > 0) {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setSlashIndex((i) => (i + 1) % matchingCommands.length)
            return
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            setSlashIndex((i) => (i <= 0 ? matchingCommands.length - 1 : i - 1))
            return
          }
          if (e.key === 'Tab' || (e.key === 'Enter' && slashIndex >= 0)) {
            e.preventDefault()
            const idx = slashIndex >= 0 ? Math.min(slashIndex, matchingCommands.length - 1) : 0
            if (matchingCommands[idx]) {
              selectSlashCommand(matchingCommands[idx].name)
            }
            return
          }
          if (e.key === 'Escape') {
            setSlashIndex(-1)
            return
          }
        }
        // Backspace on empty text → remove last mention chip
        if (e.key === 'Backspace' && text === '' && mentions.length > 0) {
          e.preventDefault()
          removeMention(mentions[mentions.length - 1].value)
          return
        }

        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          handleSend()
        }
      },
      [handleSend, matchingCommands, slashIndex, selectSlashCommand, mentionInfo, mentionActive, isOpen, toggleOpen, text, mentions, removeMention]
    )

    const handleInput = useCallback(() => {
      const el = textareaRef.current
      if (!el) return
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`
    }, [])

    const handleFileSelect = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files
        if (!files) return
        for (const file of Array.from(files)) {
          if (!file.type.startsWith('image/')) continue
          const reader = new FileReader()
          reader.onload = () => {
            const result = reader.result as string
            // Strip the data:...;base64, prefix
            const base64 = result.split(',')[1]
            if (base64) {
              addAttachment({ mimeType: file.type, base64, name: file.name })
            }
          }
          reader.readAsDataURL(file)
        }
        // Reset so the same file can be selected again
        e.target.value = ''
      },
      [addAttachment]
    )

    const currentModelName =
      (availableModels.find((m) => m.id === selectedModel)?.name ?? selectedModel) || 'Loading...'

    if (compact) {
      return (
        <input
          type="text"
          value={text}
          onChange={(e) => {
            const val = e.target.value
            setText(val)
            // Typing @ in compact mode → expand panel and activate mention
            if (val.endsWith('@') && !isOpen) {
              setMentionActive(true)
              setMentionIndex(0)
              toggleOpen()
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder={permissionMode === 'plan' ? 'Plan mode — describe your intent...' : 'Ask anything...'}
          className="flex-1 bg-transparent text-sm text-foreground placeholder-muted-foreground outline-none"
        />
      )
    }

    return (
      <div className="relative border-t border-border px-3 py-2">
        {/* Slash command autocomplete */}
        {matchingCommands.length > 0 && (
          <div className="absolute bottom-full left-0 right-0 z-10 mb-0.5 max-h-64 overflow-y-auto rounded-t-lg border border-border bg-card p-1">
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
        )}

        {/* @ mention autocomplete */}
        {mentionInfo && mentionActive && matchingCommands.length === 0 && (
          <MentionPopup
            ref={mentionRef}
            query={mentionInfo.query}
            selectedIndex={mentionIndex}
            onSelect={handleMentionSelect}
            onSetSelectedIndex={setMentionIndex}
            onClose={() => { setMentionActive(false); setMentionIndex(0) }}
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

        {/* Mention chips */}
        {mentions.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {mentions.map((m) => (
              <span
                key={m.value}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs',
                  m.kind === 'agent'
                    ? 'border-purple-500/40 bg-purple-500/10 text-purple-400'
                    : 'border-border bg-muted/50 text-foreground'
                )}
              >
                {m.kind === 'agent' ? (
                  <span className="font-medium">@{m.displayName}</span>
                ) : m.kind === 'directory' ? (
                  <>
                    <Folder className="size-3.5 shrink-0 text-blue-500" />
                    <span>{m.displayName}</span>
                  </>
                ) : (
                  <>
                    <FileIcon name={m.displayName} size={12} />
                    <span>{m.displayName}</span>
                  </>
                )}
                <button
                  onClick={() => removeMention(m.value)}
                  className="ml-0.5 rounded-sm hover:bg-muted"
                >
                  <X className="size-2.5" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="relative w-full">
          {slashHighlight && (
            <div
              className="pointer-events-none absolute inset-0 whitespace-pre-wrap break-words text-sm leading-5"
              aria-hidden
            >
              {slashHighlight}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => {
              const val = e.target.value
              setText(val)
              setSlashIndex(-1)

              // Detect @ mention trigger
              const cursorPos = e.target.selectionStart ?? val.length
              const textBeforeCursor = val.slice(0, cursorPos)
              const lastAt = textBeforeCursor.lastIndexOf('@')
              if (lastAt !== -1) {
                const afterAt = textBeforeCursor.slice(lastAt + 1)
                // Activate if no space in the query
                if (!afterAt.includes(' ')) {
                  if (!mentionActive) {
                    setMentionIndex(0)
                  }
                  setMentionActive(true)
                } else {
                  setMentionActive(false)
                }
              } else {
                setMentionActive(false)
              }

              handleInput()
            }}
            onKeyDown={handleKeyDown}
            placeholder={permissionMode === 'plan' ? 'Plan mode — describe your intent...' : 'Ask anything...'}
            rows={1}
            className={cn(
              'w-full resize-none bg-transparent text-sm leading-5 placeholder-muted-foreground outline-none',
              slashHighlight ? 'text-transparent caret-foreground' : 'text-foreground'
            )}
          />
        </div>

        <div className="mt-1 flex items-center justify-between">
          <div className="flex items-center gap-1">
            {/* Model selector */}
            <Popover open={modelOpen} onOpenChange={setModelOpen}>
              <PopoverTrigger asChild>
                <button className="flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
                  <span className="max-w-[140px] truncate">{currentModelName}</span>
                  <ChevronDown className="size-3" />
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

            {/* Permission mode */}
            <PermissionModeSelector />

            <div className="mx-0.5 h-3 w-px bg-border" />

            {/* Image upload */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
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
              <Paperclip className="size-3" />
            </Button>
          </div>

          <div className="flex items-center gap-1.5">
            <ContextUsage />
            {isStreaming ? (
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={() => interrupt()}
                className="text-muted-foreground hover:text-foreground"
              >
                <Square className="size-3" />
              </Button>
            ) : (
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={handleSend}
                disabled={!canSend}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                <ArrowUp className="size-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>
    )
  }
)
