import { pasteSummary } from '@superone/shared/user-message-parts'
import type { MentionEditorCommand, MentionEditorSnapshot } from './mention-editor-state'

/** Replace just the tapped chip, only while its native identity still matches. */
export function pasteChipEditCommand(snapshot: MentionEditorSnapshot, chip: { offset: number; value: string }, text: string,
  id: number, expand = false): MentionEditorCommand | undefined {
  if (snapshot.composing || !snapshot.tokens.some(token =>
    token.kind === 'paste' && token.offset === chip.offset && token.value === chip.value)) return
  return { id, eventCount: snapshot.eventCount, start: chip.offset, end: chip.offset + 1,
    text: expand ? text.replaceAll('\uFFFC', '\uFFFD') : '\uFFFC',
    tokens: expand ? [] : [{ offset: 0, kind: 'paste', value: text, displayName: pasteSummary(text) }] }
}
