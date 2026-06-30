import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { Placeholder } from '@tiptap/extension-placeholder'
import { common, createLowlight } from 'lowlight'
import { useAppStore, useEffectiveProjectRoot } from '@/stores/app'
import { showNativeContextMenu } from '@/lib/native-context-menu'
import { LinkSafetyModal } from '@/components/chat/LinkSafetyModal'
import { requestOpenExternalLink } from '@/lib/external-link'
import { openBrowserTab } from '@/components/activity/activity-panel-api'
import { docToMarkdown, markdownToDoc } from './markdown-codec'
import { CodeBlock } from './extensions/code-block-view'
import { MermaidNode } from './extensions/mermaid-node'
import { SlashCommand } from './extensions/slash-command'
import { TableContextMenu, TABLE_MENU_ENTRIES, type TableMenuPos } from './extensions/TableContextMenu'
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
  onSaved?: (text: string) => void
}

export function MarkdownEditor({ content, filePath, onDirtyChange, onContentChange, onSaved }: MarkdownEditorProps) {
  const fileRoot = useEffectiveProjectRoot()
  const [isDirty, setIsDirty] = useState(false)
  const contentRef = useRef(content)
  const loadedRef = useRef<string | null>(null)
  const savingRef = useRef(false)
  const loadingRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const filePathRef = useRef(filePath)
  const [mathEdit, setMathEdit] = useState<MathEditTarget | null>(null)
  const [linkHref, setLinkHref] = useState<string | null>(null)
  const [tableMenu, setTableMenu] = useState<TableMenuPos | null>(null)
  const editorRef = useRef<ReturnType<typeof useEditor>>(null)

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
      loadedRef.current = text
      setIsDirty(false)
      onSaved?.(text)
    }
    savingRef.current = false
  }, [fileRoot, onSaved])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false, link: { openOnClick: false } }),
      CodeBlock.configure({ lowlight, defaultLanguage: 'plaintext' }),
      TableKit,
      MermaidNode,
      ...createMathExtensions({ onEdit: setMathEdit }),
      SlashCommand,
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
        contextmenu: (view, event) => {
          const posInfo = view.posAtCoords({ left: event.clientX, top: event.clientY })
          if (!posInfo) return false
          const $pos = view.state.doc.resolve(posInfo.pos)
          let inTable = false
          for (let d = $pos.depth; d > 0; d--) {
            if ($pos.node(d).type.name === 'table') { inTable = true; break }
          }
          if (!inTable) return false
          event.preventDefault()
          event.stopPropagation()
          view.dispatch(view.state.tr.setSelection(TextSelection.near($pos)))
          if (useAppStore.getState().liquidGlass) {
            const ed = editorRef.current
            if (ed) {
              void showNativeContextMenu(
                TABLE_MENU_ENTRIES.map((entry) =>
                  entry.type === 'separator'
                    ? { type: 'separator' }
                    : { id: entry.label, label: entry.label, icon: entry.icon, onSelect: () => entry.run(ed) },
                ),
              )
            }
            return true
          }
          setTableMenu({ x: event.clientX, y: event.clientY })
          return true
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

  editorRef.current = editor

  useEffect(() => {
    if (!editor || savingRef.current) return
    if (content === loadedRef.current) return
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    contentRef.current = content
    let cancelled = false
    loadingRef.current = true
    markdownToDoc(content).then((doc) => {
      if (cancelled || !editor) return
      editor.commands.setContent(doc)
      loadedRef.current = content
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
      {editor && tableMenu && (
        <TableContextMenu editor={editor} pos={tableMenu} onClose={() => setTableMenu(null)} />
      )}
      <MathEditDialog editor={editor} target={mathEdit} onClose={() => setMathEdit(null)} />
      <LinkSafetyModal
        url={linkHref ?? ''}
        isOpen={linkHref !== null}
        onClose={() => setLinkHref(null)}
        onConfirm={() => { if (linkHref) requestOpenExternalLink(linkHref) }}
        onOpenInApp={() => { if (linkHref) openBrowserTab(linkHref) }}
      />
    </>
  )
}
