import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { Placeholder } from '@tiptap/extension-placeholder'
import { common, createLowlight } from 'lowlight'
import { useEffectiveProjectRoot } from '@/stores/app'
import { LinkSafetyModal } from '@/components/chat/LinkSafetyModal'
import { requestOpenExternalLink } from '@/lib/external-link'
import { docToMarkdown, markdownToDoc } from './markdown-codec'
import { CodeBlock } from './extensions/code-block-view'
import { MermaidNode } from './extensions/mermaid-node'
import { createMathExtensions, type MathEditTarget } from './extensions/math'
import { MathEditDialog } from './extensions/MathEditDialog'
import './markdown-editor.css'

const lowlight = createLowlight(common)

const AUTOSAVE_DELAY = 1000

interface MarkdownEditorProps {
  content: string
  filePath: string
  onDirtyChange: (dirty: boolean) => void
  onContentChange: (text: string) => void
}

export function MarkdownEditor({ content, filePath, onDirtyChange, onContentChange }: MarkdownEditorProps) {
  const fileRoot = useEffectiveProjectRoot()
  const [isDirty, setIsDirty] = useState(false)
  const contentRef = useRef(content)
  const savingRef = useRef(false)
  const loadingRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const filePathRef = useRef(filePath)
  const [mathEdit, setMathEdit] = useState<MathEditTarget | null>(null)
  const [linkHref, setLinkHref] = useState<string | null>(null)

  useEffect(() => {
    filePathRef.current = filePath
  }, [filePath])

  const save = useCallback(async (text: string) => {
    if (!fileRoot) return
    const path = filePathRef.current
    if (text === contentRef.current) return
    savingRef.current = true
    const result = await window.app.saveFile(fileRoot, path, text)
    if (result.ok) {
      contentRef.current = text
      setIsDirty(false)
    }
    savingRef.current = false
  }, [fileRoot])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false, link: { openOnClick: false } }),
      CodeBlock.configure({ lowlight, defaultLanguage: 'plaintext' }),
      TableKit,
      MermaidNode,
      ...createMathExtensions({ onEdit: setMathEdit }),
      Placeholder.configure({ placeholder: 'Start writing…' }),
    ],
    editorProps: {
      handleDOMEvents: {
        click: (_view, event) => {
          const anchor = (event.target as HTMLElement | null)?.closest('a')
          const href = anchor?.getAttribute('href')
          if (href) {
            event.preventDefault()
            setLinkHref(href)
            return true
          }
          return false
        },
      },
    },
    content: '',
    onUpdate: ({ editor: ed }) => {
      if (loadingRef.current) return
      const text = docToMarkdown(ed as never)
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
    if (!editor || savingRef.current) return
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    contentRef.current = content
    let cancelled = false
    loadingRef.current = true
    markdownToDoc(content).then((doc) => {
      if (cancelled || !editor) return
      editor.commands.setContent(doc)
      setIsDirty(false)
      loadingRef.current = false
    }).catch(() => {
      loadingRef.current = false
    })
    return () => { cancelled = true }
  }, [content, editor])

  useEffect(() => {
    onDirtyChange(isDirty)
  }, [isDirty, onDirtyChange])

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [])

  return (
    <>
      <EditorContent
        editor={editor}
        className="markdown-editor size-full overflow-auto text-sm [&_.tiptap]:size-full [&_.tiptap]:p-6 [&_.tiptap]:outline-none"
      />
      <MathEditDialog editor={editor} target={mathEdit} onClose={() => setMathEdit(null)} />
      <LinkSafetyModal
        url={linkHref ?? ''}
        isOpen={linkHref !== null}
        onClose={() => setLinkHref(null)}
        onConfirm={() => { if (linkHref) requestOpenExternalLink(linkHref) }}
      />
    </>
  )
}
