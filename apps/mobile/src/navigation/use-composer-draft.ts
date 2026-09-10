import { useRef, useState } from 'react'
import { ComposerDraftState } from '../composer-draft-state'
import type { MentionEditorSnapshot } from '../mention-editor-state'
import type { NativeComposerController } from '../ui/native-composer-input'

export function useComposerDraft() {
  const state = useRef(new ComposerDraftState()).current
  const [draft, setDraft] = useState('')
  const [generation, setGeneration] = useState(0)
  const editorRef = useRef<NativeComposerController | null>(null)
  const changeText = (text: string) => { state.changeText(text); setDraft(text) }
  const accept = (snapshot: MentionEditorSnapshot) => { if (state.accept(snapshot)) setDraft(snapshot.text) }
  const clearSent = (sentRevision: number) => {
    if (!state.holdsCaptured(sentRevision)) return false
    if (editorRef.current?.replaceText('')) return true
    // Voice IMEs leave composing spans, so the native editor refuses a
    // replacement. Remount restores the empty document at command id 0.
    changeText('')
    if (editorRef.current) setGeneration((value) => value + 1)
    return true
  }
  return { draft, draftRef: state.text, document: state.document, editorRef, generation, lastDraftChangeAtRef: state.lastChangeAt,
    changeText, accept, recordMention: state.recordMention.bind(state), capture: () => state.capture(), clearSent }
}
