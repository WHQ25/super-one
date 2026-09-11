import { useEffect, useLayoutEffect, useRef } from 'react'
import type { Editor, JSONContent } from '@tiptap/react'
import type { ImageAttachment } from '@superone/shared/agent-types'
import { plainTextToTiptapDoc } from './plainTextToTiptapDoc'

export function useComposerDraftSync({ editor, text, draftJson, attachments, sessionId, readOnly }: {
  editor: Editor | null
  text: string
  draftJson: object | null
  attachments: ImageAttachment[]
  sessionId: string | null
  readOnly: boolean
}) {
  const editorEchoTextRef = useRef<string | null>(null)
  const isProgrammaticSetRef = useRef(false)
  const prevSessionIdRef = useRef(sessionId)

  useLayoutEffect(() => {
    if (!editor || editor.isDestroyed) return
    editor.setEditable(!readOnly, false)
    if (readOnly) editor.commands.blur()
  }, [editor, readOnly])

  useEffect(() => {
    const sessionChanged = prevSessionIdRef.current !== sessionId
    prevSessionIdRef.current = sessionId
    const isEditorEcho = editorEchoTextRef.current === text
    editorEchoTextRef.current = null
    if (!sessionChanged && isEditorEcho && !readOnly) return
    if (!editor || editor.isDestroyed) return

    const editorAttIds = new Set<string>()
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'attachment') editorAttIds.add(node.attrs.id as string)
    })
    const storeAtts = attachments.filter((attachment) => attachment.id)
    const attMismatch = storeAtts.length !== editorAttIds.size || storeAtts.some((attachment) => !editorAttIds.has(attachment.id!))
    const docMismatch = (readOnly || sessionChanged) && draftJson && JSON.stringify(draftJson) !== JSON.stringify(editor.getJSON())
    if (text === editor.getText() && !attMismatch && !docMismatch) return

    let cancelled = false
    queueMicrotask(() => {
      if (cancelled || editor.isDestroyed) return
      isProgrammaticSetRef.current = true
      if (draftJson) {
        editor.commands.setContent(draftJson)
      } else {
        const doc: JSONContent = plainTextToTiptapDoc(text)
        if (storeAtts.length) {
          doc.content!.push({ type: 'paragraph', content: storeAtts.map((attachment) => ({ type: 'attachment', attrs: { id: attachment.id } })) })
        }
        editor.commands.setContent(doc)
      }
    })
    return () => { cancelled = true }
  }, [text, draftJson, attachments, editor, sessionId, readOnly])

  return { editorEchoTextRef, isProgrammaticSetRef }
}
