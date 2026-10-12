import type { ChatMessage, ContentBlock, ImageAttachment, MessageMetadata } from '../agent-types'
import { readableContent } from '../codex-content'
import type {
  TextFragmentContext,
  TextFragmentHead,
  TextLikeBlock,
  TranscriptFragmentBody,
  TranscriptWindowMeta,
} from '../environment/transcript-window'
import { contentDigest, utf8Length } from './content-digest'
import { textCuts, textSlices, type TextCuts } from './text-cuts'

/** Serialized ceiling of one fragment body; an atomic block above it is sent as `omitted`. */
export const MAX_FRAGMENT_BYTES = 32 * 1024
/** Serialized ceiling of a message's meta; heavier metadata is dropped field by field. */
export const MAX_META_BYTES = 16 * 1024
/** Visible characters credited to a non-text fragment when filling a viewport. */
const BLOCK_CHARS = 120

export interface FragmentEntry {
  key: string
  digest: string
  body: TranscriptFragmentBody
  bytes: number
  /** Visible characters, to fill a viewport estimate. */
  chars: number
}

export interface MessageFragments {
  id: string
  meta: TranscriptWindowMeta
  metaDigest: string
  metaBytes: number
  fragments: FragmentEntry[]
}

/** Per-block work a fragmenter keeps between calls for one message. */
interface BlockMemo {
  source: ContentBlock
  text?: string
  cuts?: TextCuts
  entries: FragmentEntry[]
}

/**
 * Cuts projected messages into fragments, reusing the previous result of a
 * block whose object is unchanged and resuming the cuts of a text block that
 * only grew, so a streaming reply costs its new tail per call.
 */
export class MessageFragmenter {
  private readonly memo = new Map<string, Map<string, BlockMemo>>()

  fragment(message: ChatMessage): MessageFragments {
    const content = readableContent(message)
    const previous = this.memo.get(message.id)
    const next = new Map<string, BlockMemo>()
    const fragments: FragmentEntry[] = (message.attachments ?? []).map((attachment, index) => attachmentEntry(index, attachment))
    const keys = blockKeys(content)
    content.forEach((block, index) => {
      const key = keys[index]
      const memo = blockFragments(block, key, previous?.get(key))
      next.set(key, memo)
      fragments.push(...memo.entries)
    })
    this.memo.set(message.id, next)
    const meta = windowMeta(message)
    const metaJson = JSON.stringify(meta)
    return { id: message.id, meta, metaDigest: contentDigest(metaJson), metaBytes: utf8Length(metaJson), fragments }
  }

  forget(messageId: string): void {
    this.memo.delete(messageId)
  }

  retain(messageIds: Iterable<string>): void {
    const keep = new Set(messageIds)
    for (const id of this.memo.keys()) if (!keep.has(id)) this.memo.delete(id)
  }
}

/** One-shot {@link MessageFragmenter.fragment}. */
export function fragmentMessage(message: ChatMessage): MessageFragments {
  return new MessageFragmenter().fragment(message)
}

function blockFragments(block: ContentBlock, key: string, previous: BlockMemo | undefined): BlockMemo {
  if (previous?.source === block) return previous
  if (!isTextLike(block)) return { source: block, entries: [atomicEntry(key, block)] }
  const text = block.text
  const head = textHead(block)
  const grew = previous?.text !== undefined && previous.cuts && text.length >= previous.text.length && text.startsWith(previous.text)
    && sameHead(previous.source, block)
  const cuts = textCuts(text, grew ? previous.cuts : undefined)
  const entries = textSlices(text, cuts).map((slice, part): FragmentEntry => {
    const reused = grew && part < cuts.starts.length - 1 ? previous.entries[part] : undefined
    if (reused && reused.body.kind === 'text' && reused.body.offset === slice.offset && reused.body.text.length === slice.text.length) return reused
    return entry(`${key}~${part}`, textBody(head, slice.offset, slice.text, slice.context), slice.text.length)
  })
  return { source: block, text, cuts, entries }
}

/** Body of a text slice; key order matters, clients re-hash appended bodies. */
export function textBody(head: TextFragmentHead, offset: number, text: string, context?: TextFragmentContext): TranscriptFragmentBody {
  return context ? { kind: 'text', head, offset, text, context } : { kind: 'text', head, offset, text }
}

export function fragmentDigest(body: TranscriptFragmentBody): string {
  return contentDigest(JSON.stringify(body))
}

function entry(key: string, body: TranscriptFragmentBody, chars: number): FragmentEntry {
  const json = JSON.stringify(body)
  return { key, digest: contentDigest(json), body, bytes: utf8Length(json), chars }
}

function atomicEntry(key: string, block: ContentBlock): FragmentEntry {
  return boundedEntry(key, { kind: 'block', block }, block.type)
}

function attachmentEntry(index: number, attachment: ImageAttachment): FragmentEntry {
  return boundedEntry(`attachment:${index}`, { kind: 'attachment', attachment }, 'attachment')
}

function boundedEntry(key: string, body: TranscriptFragmentBody, blockType: string): FragmentEntry {
  const json = JSON.stringify(body)
  const bytes = utf8Length(json)
  if (bytes > MAX_FRAGMENT_BYTES) return entry(key, { kind: 'omitted', blockType, bytes }, BLOCK_CHARS)
  return { key, digest: contentDigest(json), body, bytes, chars: BLOCK_CHARS }
}

function isTextLike(block: ContentBlock): block is TextLikeBlock {
  return block.type === 'text' || block.type === 'plan'
}

function textHead(block: TextLikeBlock): TextFragmentHead {
  // Highlight tokens describe the whole text; slices render without them, as live text does.
  const { text: _text, codeBlockTokens: _tokens, ...head } = block as TextLikeBlock & { codeBlockTokens?: unknown }
  return head as TextFragmentHead
}

function sameHead(previous: ContentBlock, next: TextLikeBlock): boolean {
  return JSON.stringify(textHead(previous as TextLikeBlock)) === JSON.stringify(textHead(next))
}

/**
 * Stable block keys: provider ids where a block has one, tool ids for tools
 * and results, else type, parent and ordinal. Unique within the message.
 */
export function blockKeys(content: readonly ContentBlock[]): string[] {
  const counts = new Map<string, number>()
  const seen = new Set<string>()
  return content.map((block) => {
    const parent = 'parentToolUseId' in block && block.parentToolUseId ? block.parentToolUseId : ''
    let key: string
    if ('toolName' in block && 'toolUseId' in block) key = `tool:${block.toolUseId}`
    else if ('toolUseId' in block) key = `${block.type}:${block.toolUseId}`
    else if ('id' in block && block.id) key = `${block.type}#${block.id}`
    else {
      const kind = `${block.type}:${parent}`
      const count = counts.get(kind) ?? 0
      counts.set(kind, count + 1)
      key = `${kind}:${count}`
    }
    let unique = key
    for (let n = 1; seen.has(unique); n++) unique = `${key}@${n}`
    seen.add(unique)
    return unique
  })
}

/**
 * A message's meta as a window carries it. Item rows of a legacy Codex turn
 * become its content, a completion's reply copies (`resultText`,
 * `finalResponse`) are dropped, and heavy optional metadata goes field by
 * field until the meta fits its ceiling.
 */
export function windowMeta(message: ChatMessage): TranscriptWindowMeta {
  const { content: _content, attachments: _attachments, ...rest } = message
  const metadata = message.metadata && lightMetadata(message.metadata)
  const meta: TranscriptWindowMeta = metadata ? { ...rest, metadata } : rest
  if (!metadata) delete meta.metadata
  return fitMeta(meta)
}

function lightMetadata(metadata: MessageMetadata): MessageMetadata | undefined {
  const { resultText: _resultText, ...light } = metadata
  if (light.codex) {
    const { finalResponse: _finalResponse, ...codex } = light.codex
    light.codex = { ...codex, items: [] }
  }
  return Object.keys(light).length ? light : undefined
}

const DROPPABLE_METADATA: Array<keyof MessageMetadata> = ['permissionDenials', 'modelUsage', 'codex', 'transcriptBoundary']

function fitMeta(meta: TranscriptWindowMeta): TranscriptWindowMeta {
  if (utf8Length(JSON.stringify(meta)) <= MAX_META_BYTES || !meta.metadata) return meta
  const metadata: MessageMetadata = { ...meta.metadata }
  for (const field of DROPPABLE_METADATA) {
    delete metadata[field]
    if (utf8Length(JSON.stringify({ ...meta, metadata })) <= MAX_META_BYTES) return { ...meta, metadata }
  }
  const { metadata: _dropped, ...bare } = meta
  return bare
}
