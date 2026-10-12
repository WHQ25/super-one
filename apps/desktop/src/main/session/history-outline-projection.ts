import type { ChatMessage, ContentBlock, CodexThreadItem } from '@superone/shared/agent-types'
import { contentKeys, type TranscriptBoundary } from '@superone/shared/transcript-boundary'
import { HISTORY_PREVIEW_LENGTH } from '@superone/shared/session-history-index'
import { getDb } from '../database'

type Preview = { length: number; text: string }
type Leaf = { index: number; type: string; id?: string; preview: Preview; toolUseId?: string; toolName?: string; parentToolUseId?: string; delivery?: string; command?: string; tool?: string }
const registered = new WeakSet<ReturnType<typeof getDb>>()

/** Match JavaScript's UTF-16 cursors, including emoji, inside the bounded SQL projection. */
function registerPreviewFunction(db: ReturnType<typeof getDb>): void {
  if (registered.has(db)) return
  db.function('superone_history_text', { deterministic: true }, (value: unknown, cuts: unknown) => {
    const text = typeof value === 'string' ? value : ''
    if (typeof cuts !== 'string') return JSON.stringify({ length: text.length, text: text.slice(0, HISTORY_PREVIEW_LENGTH) })
    const offsets = JSON.parse(cuts) as number[]
    return JSON.stringify(offsets.slice(0, -1).map((from, index) => ({ from, to: offsets[index + 1],
      text: text.slice(from, Math.min(offsets[index + 1], from + HISTORY_PREVIEW_LENGTH)) })))
  })
  registered.add(db)
}

/** Return only bounded visible text and identity fields, never tool inputs/results or reasoning bodies. */
export function loadHistoryOutlineMessages(sessionId: string): ChatMessage[] {
  const db = getDb()
  registerPreviewFunction(db)
  const rows = db.prepare(`
    SELECT id, role, provider_id, created_at,
      json_extract(metadata_json, '$.transcriptBoundary') AS boundary,
      json_type(metadata_json, '$.codex') = 'object' AS codex,
      (SELECT json_group_array(json_object(
        'index', CAST(block.key AS INTEGER), 'type', json_extract(block.value, '$.type'),
        'preview', json(superone_history_text(CASE WHEN json_extract(block.value, '$.type') = 'text'
          THEN json_extract(block.value, '$.text') END, NULL)),
        'toolUseId', json_extract(block.value, '$.toolUseId'), 'toolName', json_extract(block.value, '$.toolName'),
        'parentToolUseId', json_extract(block.value, '$.parentToolUseId')))
       FROM json_each(CASE WHEN json_type(content_json) = 'array'
         THEN content_json ELSE json_extract(content_json, '$.content') END) AS block) AS blocks,
      (SELECT json_group_array(json_object(
        'index', CAST(item.key AS INTEGER), 'id', json_extract(item.value, '$.id'), 'type', json_extract(item.value, '$.type'),
        'delivery', json_extract(item.value, '$.delivery'),
        'preview', json(superone_history_text(CASE WHEN json_extract(item.value, '$.type') IN ('agent_message', 'plan', 'review')
          THEN json_extract(item.value, '$.text') END, NULL)),
        'command', substr(json_extract(item.value, '$.command'), 1, ${HISTORY_PREVIEW_LENGTH}), 'tool', json_extract(item.value, '$.tool')))
       FROM json_each(json_extract(metadata_json, '$.codex.items')) AS item) AS items
    FROM chat_messages WHERE session_id = ? ORDER BY sort_order ASC
  `).all(sessionId) as { id: string; role: ChatMessage['role']; provider_id: string; created_at: string; boundary: string | null; codex: number; blocks: string; items: string }[]
  const leaves = new Map<string, { blocks: Leaf[]; items: Leaf[] }>()
  const messages: ChatMessage[] = rows.map(row => {
    const blocks = JSON.parse(row.blocks) as Leaf[]
    const items = JSON.parse(row.items) as Leaf[]
    leaves.set(row.id, { blocks, items })
    return {
      id: row.id, role: row.role, providerId: row.provider_id, createdAt: row.created_at, status: 'complete',
      content: blocks.map(block => ({ type: block.type,
        ...(block.type === 'text' ? { text: block.preview.text } : block.type === 'thinking' ? { thinking: '' } : {}),
        ...(block.toolName ? { toolName: block.toolName, input: '', status: 'complete' } : {}),
        ...(block.toolUseId ? { toolUseId: block.toolUseId } : {}),
        ...(block.parentToolUseId ? { parentToolUseId: block.parentToolUseId } : {}),
      }) as ContentBlock),
      metadata: {
        ...(row.boundary ? { transcriptBoundary: JSON.parse(row.boundary) as TranscriptBoundary } : {}),
        ...(row.codex ? { codex: { threadId: null, usage: null, items: items.map(item => ({ id: item.id, type: item.type,
          ...(['agent_message', 'reasoning', 'plan', 'review'].includes(item.type) ? { text: item.preview.text } : {}),
          ...(item.delivery ? { delivery: item.delivery } : {}), ...(item.command ? { command: item.command } : {}),
          ...(item.tool ? { tool: item.tool } : {}),
        }) as CodexThreadItem) } } : {}),
      },
    }
  })
  const byId = new Map(messages.map(message => [message.id, message]))
  const boundaries = new Map<string, TranscriptBoundary[]>()
  for (const message of messages) {
    const cursor = message.metadata?.transcriptBoundary
    if (cursor) boundaries.set(cursor.messageId, [...boundaries.get(cursor.messageId) ?? [], cursor])
  }
  const contentSlice = db.prepare(`SELECT superone_history_text(json_extract(CASE WHEN json_type(content_json) = 'array'
    THEN content_json ELSE json_extract(content_json, '$.content') END, ?), ?) AS slices
    FROM chat_messages WHERE session_id = ? AND id = ?`)
  const itemSlice = db.prepare(`SELECT superone_history_text(json_extract(metadata_json, ?), ?) AS slices
    FROM chat_messages WHERE session_id = ? AND id = ?`)
  for (const [id, cursors] of boundaries) {
    const source = byId.get(id)
    if (!source) continue
    const sourceLeaves = leaves.get(id)!
    const keys = contentKeys(source.content)
    const project = (leaf: Leaf, key: string, kind: 'content' | 'items'): string => {
      const limit = leaf.preview.length
      const offsets = [...new Set([0, limit, ...cursors.flatMap(cursor => cursor[kind][key] >= 0
        ? [Math.min(limit, cursor[kind][key])] : [])])].sort((a, b) => a - b)
      const pieces: { from: number; to: number; text: string }[] = offsets.length > 2
        ? JSON.parse(((kind === 'content' ? contentSlice : itemSlice).get(kind === 'content'
          ? `$[${leaf.index}].text` : `$.codex.items[${leaf.index}].text`, JSON.stringify(offsets), sessionId, id) as { slices: string }).slices)
        : [{ from: 0, to: limit, text: leaf.preview.text }]
      for (const cursor of cursors) if (cursor[kind][key] >= 0) {
        const original = Math.min(limit, cursor[kind][key])
        cursor[kind][key] = pieces.reduce((size, piece) => size + (piece.to <= original ? piece.text.length : 0), 0)
      }
      return pieces.map(piece => piece.text).join('')
    }
    source.content.forEach((block, index) => {
      const text = project(sourceLeaves.blocks[index], keys[index], 'content')
      if (block.type === 'text') block.text = text
    })
    source.metadata?.codex?.items.forEach((item, index) => {
      const text = project(sourceLeaves.items[index], item.id, 'items')
      if ('text' in item) item.text = text
    })
  }
  return messages
}
