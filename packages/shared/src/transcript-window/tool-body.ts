import type { ContentBlock } from '../agent-types'
import { contentDigest, utf8Length } from './content-digest'

export type ToolBodyBlock = Extract<ContentBlock, { toolUseId: string }>

export interface BodyVersion {
  length: number
  digest: string
}

export interface ToolBodyRef extends BodyVersion {
  head: ToolBodyBlock
  /** The metadata itself outgrew the fragment; the page stream contains the serialized block. */
  wholeBlock?: true
}

export interface ToolBodyAddress extends BodyVersion {
  messageId: string
  toolUseId: string
  type: 'tool_use' | 'tool_result' | 'block' | 'detail'
}

export interface ToolChunkRequest extends Omit<ToolBodyAddress, 'length'> {
  sessionId: string
  offset: number
  /** A fixed revision-zero body, held until the detail subscription closes. */
  subscriptionId?: string
}

export const MAX_FRAGMENT_BYTES = 32 * 1024
// UTF-16 units: even control characters escaped by JSON fit in a 32 KiB reply.
export const TOOL_CHUNK_CHARS = 5000

export function largeBody(text: string): boolean {
  return text.length > MAX_FRAGMENT_BYTES || (text.length * 6 + 2 > MAX_FRAGMENT_BYTES && utf8Length(JSON.stringify(text)) > MAX_FRAGMENT_BYTES)
}

export function bodyVersion(text: string): BodyVersion {
  return { length: text.length, digest: contentDigest(text) }
}

export function toolBodyType(block: ToolBodyBlock): 'tool_use' | 'tool_result' {
  return 'input' in block ? 'tool_use' : 'tool_result'
}

export function toolBodyText(block: ToolBodyBlock): string {
  return 'input' in block ? block.input : block.summary
}

export function withToolBody(head: ToolBodyBlock, text: string): ToolBodyBlock {
  return 'input' in head ? { ...head, input: text } : { ...head, summary: text }
}

export function inlineBodyAddress(messageId: string, ref: ToolBodyRef): ToolBodyAddress {
  return { messageId, toolUseId: ref.head.toolUseId, type: ref.wholeBlock ? 'block' : toolBodyType(ref.head), length: ref.length, digest: ref.digest }
}

/** Keep the JSON envelope when only the result is large. The cache can then reuse
 * a result that arrived earlier on the live feed, byte for byte. */
export function detailSnapshotBody(ref: string, text: string) {
  if (!largeBody(text)) return
  const [messageId, kind, key] = JSON.parse(ref)
  if (kind !== 'tool' && kind !== 'item' && kind !== 'nested-item') return
  const parsed = JSON.parse(text)
  if (kind === 'tool' && typeof parsed.result === 'string' && parsed.result.length > 0) {
    const result = parsed.result
    parsed.result = ''
    const envelope = JSON.stringify(parsed)
    if (!largeBody(envelope)) return { envelope, address: {
      messageId, toolUseId: key, type: 'tool_result' as const, ...bodyVersion(result),
    }, text: result }
  }
  return { envelope: '', address: { messageId, toolUseId: ref, type: 'detail' as const, ...bodyVersion(text) }, text }
}
