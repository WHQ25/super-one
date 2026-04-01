import { useEffect, useCallback, useRef, useMemo } from 'react'
import { useChatStore, useActiveSession } from '@/stores/chat'
import { Streamdown } from 'streamdown'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { ContextCommandView } from './ContextCommandView'
import { ReleaseNotesView } from './ReleaseNotesView'
import {
  codePlugin,
  streamdownPlugins,
  streamdownControls,
  streamdownComponents,
  streamdownLinkSafety,
  streamdownRehypePlugins,
} from './chat-shared'
import { createStreamdownCodeComponent } from './CodeBlock'

/** Commands that should auto-scroll to the bottom on open. */
const SCROLL_TO_BOTTOM = new Set(['release-notes'])

const MARKDOWN_COMMANDS = new Set(['usage', 'cost'])

function MarkdownCommandView({ content }: { content: string }) {
  const codeComponent = useMemo(() => createStreamdownCodeComponent(codePlugin), [])
  const components = useMemo(
    () => ({ ...streamdownComponents, code: codeComponent }),
    [codeComponent],
  )
  return (
    <Streamdown
      className="chat-md text-xs"
      plugins={streamdownPlugins}
      rehypePlugins={streamdownRehypePlugins}
      components={components}
      controls={streamdownControls}
      linkSafety={streamdownLinkSafety}
    >
      {content}
    </Streamdown>
  )
}

/** Route to specialized views based on command name, fallback to raw text. */
function CommandContent({ command, content }: { command: string; content: string }) {
  if (MARKDOWN_COMMANDS.has(command)) {
    return <MarkdownCommandView content={content} />
  }
  switch (command) {
    case 'context':
      return <ContextCommandView content={content} />
    case 'release-notes':
      return <ReleaseNotesView content={content} />
    default:
      return (
        <pre className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">
          {content}
        </pre>
      )
  }
}

export function SlashCommandOverlay() {
  const output = useActiveSession((s) => s.slashCommandOutput)
  const dismiss = useChatStore((s) => s.dismissSlashCommandOutput)
  const scrollRef = useRef<HTMLDivElement>(null)

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss()
    },
    [dismiss]
  )

  useEffect(() => {
    if (!output) return
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [output, handleKeyDown])

  // Auto-scroll to bottom for certain commands
  useEffect(() => {
    if (!output || !SCROLL_TO_BOTTOM.has(output.command)) return
    requestAnimationFrame(() => {
      const el = scrollRef.current
      if (el) el.scrollTop = el.scrollHeight
    })
  }, [output])

  if (!output || output.mode === 'popup') return null

  const title = output.command ? `/${output.command}` : 'Command Output'

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-card">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={dismiss}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
        </Button>
      </div>

      {/* Content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3">
        <CommandContent command={output.command} content={output.content} />
      </div>

      {/* Footer hint */}
      <div className="border-t border-border px-3 py-1.5 text-center text-[10px] text-muted-foreground">
        Press <Kbd>esc</Kbd> to close
      </div>
    </div>
  )
}
