import { isBuiltinCapabilityId } from '@superone/shared/capability-prompt-tags'
import { nativeMentionSpans, nativeMentionText, type MentionDocument, type MentionToken } from './mention-document'
import type { MentionEditorCommand, MentionEditorSnapshot } from './mention-editor-state'
import { extractMentionQuery, type MentionItem } from './mentions'

/** Only a selected, typed identity becomes a chip. Provider refs must come from
 * discovery; a project agent named "codex" must never turn into codex-base. */
export function mentionTokenFromItem(item: MentionItem): MentionToken | undefined {
  const kind = item.kind === 'builtin' ? item.path
    : item.kind === 'dir-entry' ? (item.isDirectory ? 'directory' : 'file') : item.kind
  if (!isBuiltinCapabilityId(kind) && !['file', 'directory', 'agent', 'agent-profile', 'session', 'miniapp', 'desktop-app'].includes(kind)) return
  const pathLike = kind === 'file' || kind === 'directory' || kind === 'agent'
  const displayName = item.label?.replace(/^@/, '') || (pathLike
    ? item.path.replace(/[/\\]+$/, '').split(/[/\\]/).at(-1) : item.path) || item.path
  return { kind: kind as MentionToken['kind'], value: item.path, displayName }
}

/** Produce a native transaction. Do not optimistically update the sendable
 * document: only an accepted native snapshot acknowledges this selection. */
export function selectNativeMention(snapshot: MentionEditorSnapshot, item: MentionItem, id: number): MentionEditorCommand | undefined {
  if (snapshot.composing || snapshot.start !== snapshot.end) return
  const query = extractMentionQuery(snapshot.text, snapshot.end)
  if (!query) return
  // A waypoint is still editable @text until a resource is selected. Which
  // items are waypoints is decided once, in `mentions.ts`, so this path and the
  // plain-text one cannot drift apart.
  const replacement: MentionDocument = item.navigateTo !== undefined
    ? [{ text: `@${item.navigateTo}` }]
    : (() => {
      const token = mentionTokenFromItem(item)
      return token ? [{ mention: token }, { text: ' ' }] : []
    })()
  if (!replacement.length) return
  return { id, eventCount: snapshot.eventCount, start: query.atPosition, end: snapshot.end,
    text: nativeMentionText(replacement), tokens: nativeMentionSpans(replacement) }
}
