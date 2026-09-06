import { useImperativeHandle, useRef, useState, type RefObject } from 'react'
import { NativeMentionEditor } from './native-mention-editor'
import { nativeMentionSpans, nativeMentionText, type MentionDocument } from '../mention-document'
import type { MentionEditorCommand, MentionEditorSnapshot } from '../mention-editor-state'
import { selectNativeMention } from '../mention-selection'
import type { MentionItem } from '../mentions'
import { rememberMentionArtwork } from './mention-dynamic-artwork'

export interface NativeComposerController {
  insertMention(item: MentionItem): boolean
  replaceText(text: string): boolean
  canSubmit(): boolean
}
export interface NativeComposerBinding {
  controller: RefObject<NativeComposerController | null>
  document: MentionDocument
  onChange(snapshot: MentionEditorSnapshot): void
  onError(message: string): void
}

/** Commands are explicit transactions; native typing never receives a mirrored
 * controlled value. Remounting restores the structured document at version zero. */
export function NativeComposerInput({ binding, tablet, editable, placeholder, onSubmit }: {
  binding: NativeComposerBinding; tablet: boolean; editable: boolean; placeholder: string; onSubmit(): void
}) {
  const [command, setCommand] = useState<MentionEditorCommand>(() => ({ id: 0, eventCount: 0, start: 0, end: 0,
    text: nativeMentionText(binding.document), tokens: nativeMentionSpans(binding.document) }))
  const snapshot = useRef<MentionEditorSnapshot | null>(null)
  const commandId = useRef(0)
  const pending = useRef<number | null>(0)
  const issue = (next: MentionEditorCommand | undefined) => {
    if (!next || pending.current !== null) return false
    pending.current = next.eventCount
    commandId.current = next.id
    setCommand(next)
    return true
  }
  useImperativeHandle(binding.controller, () => ({
    insertMention: (item) => {
      if (!snapshot.current) return false
      const next = selectNativeMention(snapshot.current, item, commandId.current + 1)
      if (!next || !issue(next)) return false
      rememberMentionArtwork(item)
      return true
    },
    replaceText: (text) => {
      const current = snapshot.current
      if (!current || current.composing) return false
      return issue({ id: commandId.current + 1, eventCount: current.eventCount, start: 0, end: current.text.length,
        text: text.replaceAll('\uFFFC', '\uFFFD'), tokens: [] })
    },
    canSubmit: () => !!snapshot.current && !snapshot.current.composing && !snapshot.current.rejection && pending.current === null,
  }))
  return <NativeMentionEditor command={command} editable={editable} placeholder={placeholder} accessibilityLabel="Message"
    autoSize={{ minHeight: tablet ? 64 : 42, maxHeight: 144 }} submitBehavior={tablet ? 'submit' : 'newline'}
    onSubmit={() => { if (pending.current === null) onSubmit() }}
    onError={(message) => { snapshot.current = null; pending.current = null; binding.onError(message) }}
    onChange={(next) => {
      snapshot.current = next
      if (next.rejection || (pending.current !== null && next.eventCount > pending.current)) pending.current = null
      binding.onChange(next)
      if (next.rejection) binding.onError('The draft changed before the edit could be applied. Please select the item again.')
    }} />
}
