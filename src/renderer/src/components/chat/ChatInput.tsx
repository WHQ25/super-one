import { useRef, useState, useCallback, useImperativeHandle, forwardRef, useMemo, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/stores/chat'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ArrowUp, Square, ChevronDown, Paperclip, X } from 'lucide-react'
import { PermissionModeSelector } from './PermissionModeSelector'
import { ContextUsage } from './ContextUsage'

export interface ChatInputHandle {
  send: () => void
}

interface ChatInputProps {
  compact?: boolean
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(
  function ChatInput({ compact }, ref) {
    const [text, setText] = useState('')
    const [modelOpen, setModelOpen] = useState(false)
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const sendMessage = useChatStore((s) => s.sendMessage)
    const interrupt = useChatStore((s) => s.interrupt)
    const status = useChatStore((s) => s.status)
    const selectedModel = useChatStore((s) => s.selectedModel)
    const availableModels = useChatStore((s) => s.availableModels)
    const setSelectedModel = useChatStore((s) => s.setSelectedModel)
    const attachments = useChatStore((s) => s.attachments)
    const addAttachment = useChatStore((s) => s.addAttachment)
    const removeAttachment = useChatStore((s) => s.removeAttachment)
    const slashCommands = useChatStore((s) => s.slashCommands)

    const [slashIndex, setSlashIndex] = useState(-1)
    const slashItemRefs = useRef<Map<number, HTMLButtonElement>>(new Map())

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
          {rest && <span className="text-white">{rest}</span>}
          {remainingHints.length > 0 && (
            <span className="text-neutral-500">{hintPrefix}{remainingHints.join(' ')}</span>
          )}
        </>
      )
    }, [text, slashCommands])

    const isStreaming = status === 'streaming'
    const canSend = (text.trim().length > 0 || attachments.length > 0) && !isStreaming

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

    const handleSend = useCallback(() => {
      if (!canSend) return
      sendMessage(text.trim())
      setText('')
      setSlashIndex(-1)
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }
    }, [canSend, text, sendMessage])

    useImperativeHandle(ref, () => ({ send: handleSend }), [handleSend])

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
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
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          handleSend()
        }
      },
      [handleSend, matchingCommands, slashIndex, selectSlashCommand]
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
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Design with Claude Code..."
          className="flex-1 bg-transparent text-sm text-white placeholder-neutral-500 outline-none"
        />
      )
    }

    return (
      <div className="relative border-t border-neutral-700 px-3 py-2">
        {/* Slash command autocomplete */}
        {matchingCommands.length > 0 && (
          <div className="absolute bottom-full left-0 right-0 z-10 mb-0.5 max-h-64 overflow-y-auto rounded-t-lg border border-neutral-700 bg-neutral-800 p-1">
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
                    ? 'bg-neutral-700 text-white'
                    : 'text-neutral-300 hover:bg-neutral-700/50'
                }`}
              >
                <span className="flex min-w-0 items-center gap-1.5 font-medium">
                  <span className="text-blue-400">/{cmd.name}</span>
                  {cmd.argumentHint && (
                    <span className="truncate text-neutral-500 font-normal">{cmd.argumentHint}</span>
                  )}
                  {cmd.isSkill && (
                    <span className="rounded bg-emerald-900/50 px-1 py-px text-[10px] font-normal text-emerald-400">
                      skill
                    </span>
                  )}
                </span>
                {cmd.description && (
                  <span className={cn('text-neutral-500 leading-snug', cmd.isSkill && 'line-clamp-2')}>
                    {cmd.description}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Attachment thumbnails */}
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachments.map((att, i) => (
              <div
                key={i}
                className="group relative size-12 overflow-hidden rounded border border-neutral-600"
              >
                <img
                  src={`data:${att.mimeType};base64,${att.base64}`}
                  alt={att.name}
                  className="size-full object-cover"
                />
                <button
                  onClick={() => removeAttachment(i)}
                  className="absolute -right-0.5 -top-0.5 hidden rounded-full bg-neutral-800 p-0.5 group-hover:block"
                >
                  <X className="size-2.5 text-neutral-300" />
                </button>
              </div>
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
              setText(e.target.value)
              setSlashIndex(-1)
              handleInput()
            }}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything..."
            rows={1}
            className={cn(
              'w-full resize-none bg-transparent text-sm leading-5 placeholder-neutral-500 outline-none',
              slashHighlight ? 'text-transparent caret-white' : 'text-white'
            )}
          />
        </div>

        <div className="mt-1 flex items-center justify-between">
          <div className="flex items-center gap-1">
            {/* Model selector */}
            <Popover open={modelOpen} onOpenChange={setModelOpen}>
              <PopoverTrigger asChild>
                <button className="flex items-center gap-0.5 text-[11px] text-neutral-500 hover:text-neutral-300 transition-colors">
                  <span className="max-w-[140px] truncate">{currentModelName}</span>
                  <ChevronDown className="size-3" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                side="top"
                className="w-64 max-h-60 overflow-y-auto border-neutral-700 bg-neutral-800 p-1"
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
                        ? 'bg-neutral-700 text-white'
                        : 'text-neutral-300 hover:bg-neutral-700/50'
                    }`}
                  >
                    <div className="font-medium">{model.name}</div>
                    {model.description && (
                      <div className="mt-0.5 text-[10px] text-neutral-500 line-clamp-1">
                        {model.description}
                      </div>
                    )}
                  </button>
                ))}
                {availableModels.length === 0 && (
                  <div className="px-2 py-1.5 text-xs text-neutral-500">Loading models...</div>
                )}
              </PopoverContent>
            </Popover>

            {/* Permission mode */}
            <PermissionModeSelector />

            <div className="mx-0.5 h-3 w-px bg-neutral-700" />

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
              className="text-neutral-500 hover:text-neutral-300"
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
                className="text-neutral-400 hover:text-white"
              >
                <Square className="size-3" />
              </Button>
            ) : (
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={handleSend}
                disabled={!canSend}
                className="text-neutral-400 hover:text-white disabled:opacity-30"
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
