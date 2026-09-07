import { documentFromText, plainMentionText, serializeMentionDocument, type MentionDocument, type MentionInsertion, type MentionToken } from './mention-document'
import type { MentionEditorSnapshot } from './mention-editor-state'

/** Structured draft survives native editor remounts. Revisions also distinguish
 * two different identities whose native placeholder strings happen to match. */
export class ComposerDraftState {
  readonly document = { current: [] as MentionDocument }
  readonly text = { current: '' }
  readonly lastChangeAt = { current: 0 }
  private revision = 0
  private snapshot: MentionEditorSnapshot | null = null
  /**
   * Mentions the plain-text editor wrote. The native editor keeps identities in
   * its own spans; the fallback has nowhere to put them, so they live here and
   * are matched back onto the draft at send time.
   */
  private insertions: MentionInsertion[] = []

  /**
   * Record what a fallback insertion wrote, before the text itself lands.
   *
   * The trailing space an insertion adds is not part of the identity: deleting
   * it is an ordinary edit, and matching on it would silently turn the mention
   * back into plain text.
   */
  recordMention(text: string, mention: MentionToken) {
    const key = text.trimEnd()
    if (!key) return
    this.insertions = [...this.insertions.filter((insertion) => insertion.text !== key), { text: key, mention }]
  }

  changeText(text: string, now = Date.now()) {
    // An insertion the user has edited away is no longer a mention.
    this.insertions = this.insertions.filter((insertion) => text.includes(insertion.text))
    this.document.current = documentFromText(text, this.insertions)
    this.text.current = text
    this.lastChangeAt.current = now
    this.revision++
    this.snapshot = null
  }
  accept(next: MentionEditorSnapshot, now = Date.now()): boolean {
    // The native editor owns identities in its spans; a recorded insertion
    // would then be applied twice.
    this.insertions = []
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
