/**
 * Payload bounding and content-block flattening shared by the projection.
 *
 * The ledger row wants one line; the inspector wants the exact bytes. Both come
 * from the same dsh `ContentBlock[]`, so the flattening lives here once.
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { TrajectoryBlock, TrajectoryPayload } from '@superone/shared/trajectory-types'

/**
 * Transport bound for one inspector payload.
 *
 * A single `Read` of a large file lands in the log verbatim, and shipping it
 * unbounded would stall the IPC channel the panel shares with the rest of the
 * app. The bound is generous enough that ordinary prompts, messages, and tool
 * results are never touched, and every truncation is declared rather than
 * silently applied.
 */
export const PAYLOAD_MAX_CHARS = 512_000

/** How much of a record's text reaches the one-line ledger summary. */
const SUMMARY_MAX_CHARS = 300

/**
 * Bound one text for transport, declaring what was dropped.
 * @param text - the complete text.
 * @returns the payload, carrying `truncatedChars` only when it was shortened.
 */
export function boundPayload(text: string): TrajectoryPayload {
  if (text.length <= PAYLOAD_MAX_CHARS) return { text }
  return { text: text.slice(0, PAYLOAD_MAX_CHARS), truncatedChars: text.length - PAYLOAD_MAX_CHARS }
}

/**
 * Flatten one content block's model-facing text.
 * @param block - the source block.
 * @returns its text, or a bracketed placeholder for blocks that carry none.
 */
function blockText(block: ContentBlock): string {
  switch (block.type) {
    case 'text':
    case 'reasoning':
      return block.text
    case 'image':
      return '[image]'
    case 'tool-call':
      return `${block.name}(${block.arguments})`
    case 'tool-result':
      return block.content.map(blockText).join('\n')
    default:
      // Merge-extensible union: a plugin block type is opaque but not lost.
      return JSON.stringify(block)
  }
}

/**
 * Concatenate the model-facing text of a block list.
 * @param blocks - the source blocks in model order.
 * @returns the joined text.
 */
export function blocksText(blocks: readonly ContentBlock[]): string {
  return blocks.map(blockText).join('\n')
}

/**
 * Concatenate only the blocks of one type — the split the inspector uses to
 * separate visible text from reasoning.
 * @param blocks - the source blocks in model order.
 * @param type - the block type to keep.
 * @returns the joined text of the matching blocks, empty when there are none.
 */
export function blocksTextOfType(blocks: readonly ContentBlock[], type: 'text' | 'reasoning'): string {
  return blocks.filter((block) => block.type === type).map(blockText).join('\n')
}

/**
 * Preserve the source blocks in model order for the inspector's hierarchy view.
 * @param blocks - the source blocks.
 * @returns the projected blocks, each bounded independently.
 */
export function projectBlocks(blocks: readonly ContentBlock[]): TrajectoryBlock[] {
  return blocks.map((block) => {
    const projected: TrajectoryBlock = { type: block.type, text: boundPayload(blockText(block)).text }
    if (block.type === 'tool-call') {
      projected.callId = block.id
      projected.toolName = block.name
    }
    if (block.type === 'tool-result') projected.callId = block.toolCallId
    return projected
  })
}

/**
 * Collapse text into the ledger's single-line summary.
 *
 * Markdown structure is flattened rather than rendered: the row is a scanning
 * aid, and the inspector is where the real content lives.
 * @param text - the record's full text.
 * @returns one line, ellipsized past the summary bound.
 */
export function summarize(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length <= SUMMARY_MAX_CHARS ? line : `${line.slice(0, SUMMARY_MAX_CHARS - 1)}…`
}
