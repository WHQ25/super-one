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

it('restores text, rich document structure, and attachments after the editor remounts', async () => {
  const attachmentNode = TiptapNode.create({
    name: 'attachment', group: 'inline', inline: true, atom: true,
    addAttributes: () => ({ id: { default: '' } }),
    renderHTML: ({ HTMLAttributes }) => ['span', HTMLAttributes],
    renderText: () => '',
  })
  const editorExtensions = [StarterKit, attachmentNode]
  const attachment = { id: 'image-1', mimeType: 'image/png', base64: 'aW1hZ2U=', name: 'photo.png' }
  const draftJson = { type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'Keep this draft ' },
    { type: 'attachment', attrs: { id: 'image-1' } },
  ] }] }
  const props = {
    text: 'Keep this draft ',
    draftJson,
    attachments: [attachment],
    sessionId: 'draft-remount',
    readOnly: false,
  }

  const firstEditor = new Editor({ extensions: editorExtensions })
  const firstView = renderHook(useComposerDraftSync, { initialProps: { ...props, editor: firstEditor } })
  try {
    await waitFor(() => expect(firstEditor.getJSON()).toEqual(draftJson))
  } finally {
    firstView.unmount()
    firstEditor.destroy()
  }

  const nextEditor = new Editor({ extensions: [StarterKit, attachmentNode] })
  const nextView = renderHook(useComposerDraftSync, { initialProps: { ...props, editor: nextEditor } })
  try {
    await waitFor(() => expect(nextEditor.getJSON()).toEqual(draftJson))
    expect(nextEditor.getText()).toBe('Keep this draft ')
  } finally {
    nextView.unmount()
    nextEditor.destroy()
  }
})
