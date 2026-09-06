import { useRef, useState } from 'react'
import { ComposerDraftState } from '../composer-draft-state'
import type { MentionEditorSnapshot } from '../mention-editor-state'
import type { NativeComposerController } from '../ui/native-composer-input'

export function useComposerDraft() {
  const state = useRef(new ComposerDraftState()).current
  const [draft, setDraft] = useState('')
  const editorRef = useRef<NativeComposerController | null>(null)
  const changeText = (text: string) => { state.changeText(text); setDraft(text) }
  const accept = (snapshot: MentionEditorSnapshot) => { if (state.accept(snapshot)) setDraft(snapshot.text) }
  const clearSent = (sentRevision: number) => {
    if (!state.isCurrent(sentRevision)) return false
    if (editorRef.current) return editorRef.current.replaceText('')
    changeText('')
    return true
  }
  return { draft, draftRef: state.text, document: state.document, editorRef, lastDraftChangeAtRef: state.lastChangeAt,
    changeText, accept, capture: () => state.capture(), clearSent }
}
