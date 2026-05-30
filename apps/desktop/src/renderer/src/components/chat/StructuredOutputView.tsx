import { useMemo } from 'react'
import { HighlightedCodeBlock } from './CodeBlock'
import { codePlugin } from './chat-shared'
import { ToolIcon } from './ToolIcon'
import { getToolDisplay } from './tool-display'
import { STRUCTURED_OUTPUT_TOOL } from './subagent-utils'

export function StructuredOutputBlock({ data }: { data: unknown }) {
  const icon = getToolDisplay(STRUCTURED_OUTPUT_TOOL, {}).icon
  return (
    <div className="tool-node my-0.5 overflow-hidden rounded bg-muted/50">
      <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs">
        <ToolIcon icon={icon} className="size-3 shrink-0 text-muted-foreground" />
        <span className="font-medium text-foreground">{STRUCTURED_OUTPUT_TOOL}</span>
      </div>
      <div className="px-2 pb-1.5">
        <StructuredOutputView data={data} fill />
      </div>
    </div>
  )
}

export function StructuredOutputView({ data, fill }: { data: unknown; fill?: boolean }) {
  const code = useMemo(() => {
    if (typeof data === 'string') return data
    try {
      return JSON.stringify(data, null, 2)
    } catch {
      return String(data)
    }
  }, [data])

  const block = <HighlightedCodeBlock code={code} language="json" codePlugin={codePlugin} />
  if (fill) return block
  return <div className="max-h-80 overflow-y-auto">{block}</div>
}
