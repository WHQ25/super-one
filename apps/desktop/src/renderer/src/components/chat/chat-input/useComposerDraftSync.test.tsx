/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react'
import { Editor, Node as TiptapNode } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { expect, it } from 'vitest'
import { useComposerDraftSync } from './useComposerDraftSync'

it('observes chip changes with unchanged text and restores editing after disconnect', async () => {
  const attachment = TiptapNode.create({
    name: 'attachment', group: 'inline', inline: true, atom: true,
    addAttributes: () => ({ id: { default: '' } }),
    renderHTML: ({ HTMLAttributes }) => ['span', HTMLAttributes],
    renderText: () => '',
  })
  const editor = new Editor({ extensions: [StarterKit, attachment] })
  const doc = (id: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'Review ' }, { type: 'attachment', attrs: { id } },
  ] }] })
  const initialProps = { editor, text: 'Review ', draftJson: doc('one'), attachments: [], sessionId: 'draft', readOnly: true }
  const view = renderHook(useComposerDraftSync, { initialProps })
  try {
    await waitFor(() => expect(editor.state.doc.firstChild?.lastChild?.attrs.id).toBe('one'))
    expect(editor.isEditable).toBe(false)
    expect(editor.view.dom.getAttribute('contenteditable')).toBe('false')
    view.rerender({ ...initialProps, draftJson: doc('two') })
    await waitFor(() => expect(editor.state.doc.firstChild?.lastChild?.attrs.id).toBe('two'))
    view.rerender({ ...initialProps, draftJson: doc('two'), readOnly: false })
    expect(editor.isEditable).toBe(true)
    act(() => { editor.commands.insertContent('Continue') })
    expect(editor.getText()).toContain('Continue')
  } finally {
    view.unmount()
    editor.destroy()
  }
})
