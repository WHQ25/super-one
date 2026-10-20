import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import { isSubagentToolName } from '@superone/shared/tool-ui'
import { isClaudePinnedSegment } from './compact-mode'
import type { GroupContentPorts, RenderSegment } from './group-content'
import { isHiddenToolBlock } from './media-tools'

/**
 * How the phone's chat view groups and pins a turn. A host that folds a
 * window for that view reads turns through the same rules, so what it folds
 * is exactly what the view collapses.
 */

function isOffTranscript(block: ContentBlock, failed: boolean): boolean {
  // The decision queue asks an async question; the answer bubble keeps it.
  if (block.type === 'text') return Boolean(block.codexAsyncQuestions?.length)
  // A failed turn's footer reports its error once.
  return failed && block.type === 'notice' && block.level === 'error'
}

/** Whether an assistant turn leaves `block` out of its body. */
export function isOffTranscriptBlock(block: ContentBlock, message: Pick<ChatMessage, 'status'>): boolean {
  return isOffTranscript(block, message.status === 'error')
}

/**
 * The blocks an assistant turn draws. The same array when nothing is left out,
 * so memoized grouping keeps its identity.
 */
export function turnDisplayContent(message: Pick<ChatMessage, 'content' | 'status'>): ContentBlock[] {
  const failed = message.status === 'error'
  return message.content.some(block => isOffTranscript(block, failed))
    ? message.content.filter(block => !isOffTranscript(block, failed))
    : message.content
}

/** A remote harness-specific tool block (`bash`, `todo`) as the shared grouping reads it. */
export function portableToolBlock(block: ContentBlock): ContentBlock {
  return 'toolName' in block && block.type !== 'tool_use' ? { ...block, type: 'tool_use' } : block
}

/**
 * Remote turns carry harness-specific block types (`bash`, `todo`) that the
 * shared grouping and gallery collectors only recognise as `tool_use`. The turn
 * body and the turn-end galleries normalise identically — collecting from raw
 * content would silently find no generated images.
 */
export function portableToolBlocks(content: ContentBlock[]): ContentBlock[] {
  return content.map(portableToolBlock)
}

function parseRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function isWorkflowSmokeCheck(input: string): boolean {
  const parsed = parseRecord(input)
  return parsed.validate_only === true
    || parsed.validateOnly === true
    || /"(?:validate_only|validateOnly)"\s*:\s*true/.test(input)
}

export function isPortableWidgetShowTool(toolName: string): boolean {
  return toolName === 'widget_show' || toolName.endsWith('__widget_show')
}

export const PORTABLE_GROUP_PORTS: GroupContentPorts = {
  isSubagentToolName,
  isWorkflowSmokeCheck,
  isHiddenToolBlock,
  resolveAppTool: () => null,
}

export function isPortablePinnedSegment(segment: RenderSegment): boolean {
  return isClaudePinnedSegment(segment, { isWidgetShowTool: isPortableWidgetShowTool })
}
