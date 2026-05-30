import { useMemo } from 'react'
import { HighlightedCodeBlock } from './CodeBlock'
import { codePlugin } from './chat-shared'

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
