import { useEffect, useImperativeHandle, useRef, useState, type RefObject } from 'react'
import { NativeMentionEditor } from './native-mention-editor'
import { nativeMentionSpans, nativeMentionText, type MentionDocument } from '../mention-document'
import type { MentionEditorCommand, MentionEditorSnapshot } from '../mention-editor-state'
import { selectNativeMention } from '../mention-selection'
import type { MentionItem } from '../mentions'
import { rememberMentionArtwork } from './mention-dynamic-artwork'
import { firstLineRange } from '../composer-first-line'

export interface NativeComposerController {
  insertMention(item: MentionItem): boolean
  replaceText(text: string): boolean
  /** Rewrite the command line only, keeping later lines and their chips. */
  replaceFirstLine(text: string): boolean
  canSubmit(): boolean
  /** Commit IME composition and synchronize the authoritative native draft. */
  prepareSubmit(): Promise<void>
}
export interface NativeComposerBinding {
  controller: RefObject<NativeComposerController | null>
  document: MentionDocument
  onChange(snapshot: MentionEditorSnapshot): void
  onError(message: string): void
  /** Bumped to remount after a clear the native editor refused (IME composing). */
  generation?: number
}

/** Commands are explicit transactions; native typing never receives a mirrored
 * controlled value. Remounting restores the structured document at version zero. */
/**
 * The native editor and the plain-`TextInput` fallback have to open at exactly
 * the same size — a session that switches between them must not resize the
 * composer — so both read these rather than repeating the pair.
 *
 * One line plus its padding is 42. The tablet card opens taller because it is a
 * boxed surface with room to spare, but not by a whole second line: at 64 the
 * empty box read as a text area waiting to be filled rather than a prompt.
 */
export function composerInputMinHeight(tablet: boolean): number {
  return tablet ? 52 : 42
}

export const COMPOSER_INPUT_MAX_HEIGHT = 144

export function NativeComposerInput({ binding, tablet, editable, placeholder, onSubmit }: {
  binding: NativeComposerBinding; tablet: boolean; editable: boolean; placeholder: string; onSubmit(): void
}) {
  const [command, setCommand] = useState<MentionEditorCommand>(() => ({ id: 0, eventCount: 0, start: 0, end: 0,
    text: nativeMentionText(binding.document), tokens: nativeMentionSpans(binding.document) }))
  const snapshot = useRef<MentionEditorSnapshot | null>(null)
  const commandId = useRef(0)
  const pending = useRef<number | null>(0)
  const submission = useRef<{
    id: number | null; promise: Promise<void>; resolve(): void; reject(error: Error): void
    timer: ReturnType<typeof setTimeout>
  } | null>(null)
  const finishSubmission = (error?: Error) => {
    const task = submission.current
    if (!task) return
    submission.current = null
    clearTimeout(task.timer)
    if (error) task.reject(error)
    else task.resolve()
  }
  useEffect(() => () => finishSubmission(new Error('The editor closed before sending. Your draft was not sent.')), [])
  const startSubmission = () => {
    const task = submission.current
    if (!task || task.id !== null || pending.current !== null) return
    // OTA JavaScript may run on an older dev client. Never send an unknown
    // editing command to it; retain its safe, settled-draft path.
    if (!snapshot.current?.supportsPrepareSubmit) {
      // Older native clients cannot commit IME composition. An explicit Send
      // tap still owns the visible draft — voice IMEs often leave composing
      // spans after the dictated text is already final.
      const ready = snapshot.current && !snapshot.current.rejection
      finishSubmission(ready ? undefined : new Error('Could not read the editor. Your draft was not sent; please try again.'))
      return
    }
    task.id = ++commandId.current
    setCommand({ id: task.id, action: 'prepareSubmit', eventCount: snapshot.current?.eventCount ?? 0,
      start: 0, end: 0, text: '', tokens: [] })
  }
  const prepareSubmit = () => {
    if (submission.current) return submission.current.promise
    let resolve!: () => void
    let reject!: (error: Error) => void
    const promise = new Promise<void>((ok, fail) => { resolve = ok; reject = fail })
    submission.current = { id: null, promise, resolve, reject,
      timer: setTimeout(() => finishSubmission(new Error('Could not synchronize the editor. Your draft was not sent; please try again.')), 3000) }
    startSubmission()
    return promise
  }
  const issue = (next: MentionEditorCommand | undefined) => {
    if (!next || pending.current !== null || submission.current) return false
    pending.current = next.eventCount
    commandId.current = next.id
    setCommand(next)
    return true
  }
  const replaceRange = (text: string, endOf: (current: MentionEditorSnapshot) => number) => {
    const current = snapshot.current
    if (!current || current.composing) return false
    return issue({ id: commandId.current + 1, eventCount: current.eventCount, start: 0, end: endOf(current),
      text: text.replaceAll('\uFFFC', '\uFFFD'), tokens: [] })
  }
  useImperativeHandle(binding.controller, () => ({
    insertMention: (item) => {
      if (!snapshot.current) return false
      const next = selectNativeMention(snapshot.current, item, commandId.current + 1)
      if (!next || !issue(next)) return false
      rememberMentionArtwork(item)
      return true
    },
    replaceText: (text) => replaceRange(text, (current) => current.text.length),
    // Selecting a slash command rewrites the command line, not the draft. A
    // whole-document replacement would delete every later line — and every
    // mention chip on them — the moment the overlay learned to stay open past
    // the first space.
    replaceFirstLine: (text) => replaceRange(text, (current) => firstLineRange(current.text).end),
    prepareSubmit,
    canSubmit: () => !!snapshot.current && !snapshot.current.composing && !snapshot.current.rejection && pending.current === null,
  }))
  return <NativeMentionEditor command={command} editable={editable} placeholder={placeholder} accessibilityLabel="Message"
    autoSize={{ minHeight: composerInputMinHeight(tablet), maxHeight: COMPOSER_INPUT_MAX_HEIGHT }} submitBehavior={tablet ? 'submit' : 'newline'}
    onSubmit={() => { if (pending.current === null) onSubmit() }}
    onError={(message) => { finishSubmission(new Error(message)); snapshot.current = null; pending.current = null; binding.onError(message) }}
    onChange={(next) => {
      snapshot.current = next
      if (next.rejection || (pending.current !== null && next.eventCount > pending.current)) pending.current = null
      binding.onChange(next)
      if (next.submissionId === submission.current?.id) {
        // Native already unmark'd / cleared composing spans. Voice IMEs may
        // immediately re-mark the same text after restartInput — the draft is
        // still the one the user asked to send.
        finishSubmission(next.rejection ? new Error('Could not finish editing. Your draft was not sent; please try again.') : undefined)
      } else if (next.rejection && submission.current) {
        finishSubmission(new Error('The draft changed before the edit could be applied. Please review it and send again.'))
      } else startSubmission()
      if (next.rejection) binding.onError('The draft changed before the edit could be applied. Please select the item again.')
    }} />
}
