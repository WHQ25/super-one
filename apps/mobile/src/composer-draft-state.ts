import { plainMentionText, serializeMentionDocument, type MentionDocument } from './mention-document'
import type { MentionEditorSnapshot } from './mention-editor-state'

/** Structured draft survives native editor remounts. Revisions also distinguish
 * two different identities whose native placeholder strings happen to match. */
export class ComposerDraftState {
  readonly document = { current: [] as MentionDocument }
  readonly text = { current: '' }
  readonly lastChangeAt = { current: 0 }
  private revision = 0
  private snapshot: MentionEditorSnapshot | null = null

  changeText(text: string, now = Date.now()) {
    this.document.current = text ? [{ text }] : []
    this.text.current = text
    this.lastChangeAt.current = now
    this.revision++
    this.snapshot = null
  }
  accept(next: MentionEditorSnapshot, now = Date.now()): boolean {
    const previous = this.snapshot
    this.snapshot = next
    this.document.current = next.document
    if (previous && previous.eventCount === next.eventCount && previous.text === next.text) return false
    this.text.current = next.text
    this.lastChangeAt.current = now
    this.revision++
    return true
  }
  capture() {
    return { text: serializeMentionDocument(this.document.current), title: plainMentionText(this.document.current).trim(), revision: this.revision }
  }
  isCurrent(revision: number) { return this.revision === revision }
}
