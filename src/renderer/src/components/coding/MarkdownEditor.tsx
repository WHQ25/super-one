import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import { Document } from '@tiptap/extension-document'
import { Text } from '@tiptap/extension-text'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { encodeHtmlEntities } from '@tiptap/core'
import { common, createLowlight } from 'lowlight'
import { useAppStore } from '@/stores/app'
import './markdown-editor.css'

const lowlight = createLowlight(common)

const CustomDocument = Document.extend({ content: 'codeBlock' })

const AUTOSAVE_DELAY = 1000

interface MarkdownEditorProps {
  content: string
  filePath: string
  onDirtyChange: (dirty: boolean) => void
  onContentChange: (text: string) => void
}

export function MarkdownEditor({ content, filePath, onDirtyChange, onContentChange }: MarkdownEditorProps) {
  const currentFolder = useAppStore((s) => s.currentFolder)
  const [isDirty, setIsDirty] = useState(false)
  const contentRef = useRef(content)
  const savingRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const filePathRef = useRef(filePath)

  useEffect(() => {
    filePathRef.current = filePath
  }, [filePath])

  const save = useCallback(async (text: string) => {
    if (!currentFolder) return
    const path = filePathRef.current
    if (text === contentRef.current) return
    savingRef.current = true
    const result = await window.app.saveFile(currentFolder, path, text)
    if (result.ok) {
      contentRef.current = text
      setIsDirty(false)
    }
    savingRef.current = false
  }, [currentFolder])

  const editor = useEditor({
    extensions: [
      CustomDocument,
      Text,
      CodeBlockLowlight.configure({ lowlight, defaultLanguage: 'markdown' }),
    ],
    content: toCodeBlockHtml(content),
    onUpdate: ({ editor: ed }) => {
      const text = ed.getText()
      const dirty = text !== contentRef.current
      setIsDirty(dirty)
      onContentChange(text)
      if (dirty) {
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => save(text), AUTOSAVE_DELAY)
      }
    },
  })

  useEffect(() => {
    onDirtyChange(isDirty)
  }, [isDirty, onDirtyChange])

  useEffect(() => {
    if (!editor || savingRef.current) return
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    contentRef.current = content
    if (editor.getText() !== content) {
      editor.commands.setContent(toCodeBlockHtml(content))
      setIsDirty(false)
    }
  }, [content, editor])

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [])

  return (
    <EditorContent
      editor={editor}
      className="markdown-editor size-full overflow-auto font-mono text-sm [&_.tiptap]:size-full [&_.tiptap]:p-4 [&_.tiptap]:outline-none [&_.tiptap_pre]:size-full [&_.tiptap_pre]:bg-transparent [&_.tiptap_code]:bg-transparent"
    />
  )
}

function toCodeBlockHtml(text: string): string {
  return `<pre><code class="language-markdown">${encodeHtmlEntities(text)}</code></pre>`
}
