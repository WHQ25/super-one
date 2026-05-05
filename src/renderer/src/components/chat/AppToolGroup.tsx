import { useState, useMemo, useEffect, useRef } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ToolBlock } from './ToolBlock'
import { MiniAppIcon } from '@/components/miniapp/MiniAppIcon'
import { useMiniAppStore } from '@/stores/miniapp'
import type { ContentBlock } from '../../../../shared/agent-types'

interface AppToolGroupProps {
  appId: string
  blocks: ContentBlock[]
  sealed?: boolean
}

export function AppToolGroup({ appId, blocks, sealed = false }: AppToolGroupProps) {
  const app = useMiniAppStore((s) => s.apps.find((a) => a.id === appId))
  const appName = app?.manifest.name ?? appId
  const toolUses = useMemo(() => blocks.filter((b): b is ContentBlock & { type: 'tool_use' } => b.type === 'tool_use'), [blocks])
  const streamingTool = useMemo(() => toolUses.find((b) => b.status === 'streaming') ?? null, [toolUses])
  const [expanded, setExpanded] = useState(!!streamingTool && !sealed)

  const scrollRef = useRef<HTMLDivElement>(null)
  const isNearBottomRef = useRef(true)

  useEffect(() => {
    if (sealed) setExpanded(false)
  }, [sealed])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    isNearBottomRef.current = true
    const handleScroll = (): void => {
      isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30
    }
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [expanded])

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !isNearBottomRef.current) return
    el.scrollTop = el.scrollHeight
  })

  return (
    <div className="tool-group my-0.5">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-1.5 rounded bg-muted/50 px-2 py-1.5 text-xs transition-colors hover:bg-muted/70"
      >
        <MiniAppIcon appId={appId} className="size-3.5 shrink-0" />
        <span className="shrink-0 font-medium text-foreground">{appName}</span>
        <span className="shrink-0 text-muted-foreground">·</span>
        <span className="text-muted-foreground">{toolUses.length} tool call{toolUses.length !== 1 ? 's' : ''}</span>
        <ChevronRight
          className={cn('ml-auto size-3 shrink-0 text-muted-foreground transition-transform duration-200', expanded && 'rotate-90')}
        />
      </button>

      {expanded && (
        <div ref={scrollRef} className="mt-0.5 max-h-[120px] space-y-0.5 overflow-y-auto pl-2">
          {toolUses.map((block, i) => (
            <ToolBlock key={i} toolName={block.toolName} toolUseId={block.toolUseId} input={block.input} status={block.status} elapsedSeconds={block.elapsedSeconds} grouped />
          ))}
        </div>
      )}

      {!expanded && streamingTool && (
        <div className="mt-0.5">
          <ToolBlock toolName={streamingTool.toolName} toolUseId={streamingTool.toolUseId} input={streamingTool.input} status={streamingTool.status} elapsedSeconds={streamingTool.elapsedSeconds} grouped />
        </div>
      )}
    </div>
  )
}
