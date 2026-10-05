import { useTranslation } from 'react-i18next'
import { ToolIcon } from './ToolIcon'
import { CompactLabeledToolRow, withStreamingEllipsis } from './ToolRow'
import { unwrapMcpResultText } from './tool-block-utils'

/** Status only: the active form belongs in the composer, never in the transcript row. */
export function InputRequestToolRow({ title, result, streaming, isError, isDenied }: {
  title?: string
  result?: string
  streaming: boolean
  isError?: boolean
  isDenied?: boolean
}) {
  const { t } = useTranslation()
  const text = result ? unwrapMcpResultText(result) : ''
  // Remote results can truncate large answers. The host puts status first, so
  // this prefix remains trustworthy without parsing or showing private values.
  const status = /^\s*\{\s*"status"\s*:\s*"(submitted|cancelled)"/.exec(text)?.[1]
  const failed = isError || isDenied
  const key = streaming ? 'waiting' : failed ? 'failed' : status === 'submitted' ? 'submitted' : status === 'cancelled' ? 'cancelled' : 'closed'
  return <div>
    <CompactLabeledToolRow icon={<ToolIcon icon="clipboard-list" className="size-3 shrink-0 text-muted-foreground" />}
      label={withStreamingEllipsis(t(`chat.inputRequest.tool.${key}`), streaming)} streaming={streaming}
      tone={failed ? 'error' : 'default'} summary={title || undefined} />
    {failed && text ? <div className="whitespace-pre-wrap break-words px-2 pb-1 text-xs text-warning">{text}</div> : null}
  </div>
}
