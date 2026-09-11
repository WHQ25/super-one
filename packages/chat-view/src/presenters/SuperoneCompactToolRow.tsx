import { useTranslation } from 'react-i18next'
import { ToolIcon } from './ToolIcon'
import {
  CompactLabeledToolRow,
  toolOutcomeLabel,
  toolRowTone,
  withStreamingEllipsis,
} from './ToolRow'
import { superoneToolDescriptor } from './superone-tool-display'

export interface SuperoneCompactToolRowPresenterProps {
  /** Bare tool name — `config_read`, not `mcp__superone__config_read`. */
  mcpToolName: string
  params: Record<string, unknown>
  result?: string | null
  isStreaming: boolean
  isError?: boolean
  isDenied?: boolean
  /** MCP server brand image when the host has one; otherwise the descriptor icon. */
  brandIconSrc?: string
}

/**
 * The one row every "verb plus subject" SuperOne tool renders on both surfaces.
 *
 * Returns `null` for a tool with no descriptor so the caller can fall through to its
 * own dispatch — that is the contract that lets the desktop keep its richer blocks
 * (`ConfigApplyBlock`, `ImageGenToolBlock`, …) ahead of this one while the phone
 * reaches the same rows through a different dispatcher.
 */
export function SuperoneCompactToolRowPresenter({
  mcpToolName,
  params,
  result,
  isStreaming,
  isError,
  isDenied,
  brandIconSrc,
}: SuperoneCompactToolRowPresenterProps) {
  const { t } = useTranslation()
  const descriptor = superoneToolDescriptor(mcpToolName)
  if (!descriptor) return null

  // A streaming call has no result yet, and a denied one carries a refusal rather
  // than the payload the summary would read.
  const settled = !isStreaming && !isDenied ? result ?? null : null
  const derived = descriptor.summary?.(params, settled) ?? ''
  const summary = derived || (!isStreaming && descriptor.emptySummaryKey ? t(descriptor.emptySummaryKey) : '')

  return (
    <CompactLabeledToolRow
      icon={brandIconSrc
        ? <img src={brandIconSrc} alt="" className="size-3.5 shrink-0 rounded-sm object-cover" />
        : <ToolIcon icon={descriptor.icon} className="size-3 shrink-0 text-muted-foreground" />}
      label={withStreamingEllipsis(
        toolOutcomeLabel({
          streaming: isStreaming,
          interrupted: !!isDenied || !!isError,
          streamingLabel: t(descriptor.streamingKey),
          actionLabel: t(descriptor.actionKey),
          doneLabel: t(descriptor.doneKey),
        }),
        isStreaming,
      )}
      streaming={isStreaming}
      tone={toolRowTone(isDenied, isError)}
      summary={summary || undefined}
    />
  )
}
