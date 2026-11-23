import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { Placeholder } from '@tiptap/extension-placeholder'
import { splitFrontmatter } from '@superone/shared/markdown-frontmatter'
import { cn } from '@superone/ui/lib/utils'
import { useAppStore, useEffectiveProjectRoot } from '@/stores/app'
import { showNativeContextMenu } from '@/lib/native-context-menu'
import { LinkSafetyModal } from '@/components/chat/LinkSafetyModal'
import { requestOpenExternalLink } from '@/lib/external-link'
import { openBrowserTab } from '@/components/activity/activity-panel-api'
import { getMarkdownLowlight, htmlToProseMirrorDoc, markdownToDoc } from './markdown-codec'
import {
  LARGE_MARKDOWN_CHAR_THRESHOLD,
  frontmatterToHtml,
  splitMarkdownChunks,
} from './markdown-html'
import { parseMarkdownHtmlOffThread } from './markdown-worker-client'
import { htmlSchemas } from './markdown-schemas'
import { docToMarkdown } from './markdown-serialize'
import { CodeBlock } from './extensions/code-block-view'
import { MermaidNode } from './extensions/mermaid-node'
import { MediaBaseDirProvider, MediaImageNode, RawMediaNode } from './extensions/media-nodes'
import { SlashCommand } from './extensions/slash-command'
import { TableContextMenu, TABLE_MENU_ENTRIES, type TableMenuPos } from './extensions/TableContextMenu'
import { createMathExtensions, type MathEditTarget } from './extensions/math'
import { MathEditDialog } from './extensions/MathEditDialog'
import './markdown-editor.css'

const AUTOSAVE_DELAY = 1000
const LARGE_DOC_SERIALIZE_DEBOUNCE = 300
const INITIAL_BLOCK_BATCH = 80
const SUBSEQUENT_BLOCK_BATCH = 120

function yieldFrame(): Promise<void> {
  return new Promise((resolve) => {
    let rafId = 0
    const timeoutId = setTimeout(() => {
      if (rafId && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId)
      resolve()
    }, 32)
    if (typeof requestAnimationFrame === 'function') {
      rafId = requestAnimationFrame(() => {
        clearTimeout(timeoutId)
        resolve()
      })
    }
  })
}

function replaceDocWithoutHistory(editor: Editor, content: Fragment): void {
  const tr = editor.state.tr.replaceWith(0, editor.state.doc.content.size, content)
  tr.setMeta('addToHistory', false)
  editor.view.dispatch(tr)
}

function appendFragmentWithoutHistory(editor: Editor, content: Fragment): void {
  if (content.childCount === 0) return
  const tr = editor.state.tr.insert(editor.state.doc.content.size, content)
  tr.setMeta('addToHistory', false)
  editor.view.dispatch(tr)
}

interface MarkdownEditorProps {
  content: string
  filePath: string
  onDirtyChange: (dirty: boolean) => void
  onContentChange: (text: string) => void
  onSaved?: (text: string) => void
}

export function MarkdownEditor({ content, filePath, onDirtyChange, onContentChange, onSaved }: MarkdownEditorProps) {
  const fileRoot = useEffectiveProjectRoot()
  const isLargeDoc = content.length >= LARGE_MARKDOWN_CHAR_THRESHOLD
  const [isDirty, setIsDirty] = useState(false)
  const contentRef = useRef(content)
  const loadedRef = useRef<string | null>(null)
  const savingRef = useRef(false)
  const loadingRef = useRef(false)
  const hydratedRef = useRef(true)
  const dirtyDuringHydrationRef = useRef(false)
  const pendingTailChunksRef = useRef<string[]>([])
  const pendingTailNodesRef = useRef<ProseMirrorNode[]>([])
  const loadTokenRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const serializeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const filePathRef = useRef(filePath)
  const emittedRef = useRef<string | null>(null)
  const onContentChangeRef = useRef(onContentChange)
  onContentChangeRef.current = onContentChange
  const [mathEdit, setMathEdit] = useState<MathEditTarget | null>(null)
  const [linkHref, setLinkHref] = useState<string | null>(null)
  const [tableMenu, setTableMenu] = useState<TableMenuPos | null>(null)
  const editorRef = useRef<ReturnType<typeof useEditor>>(null)

  useEffect(() => {
    filePathRef.current = filePath
    emittedRef.current = null
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

  const serializeEditorDoc = useCallback((ed: Editor): string => {
    if (pendingTailNodesRef.current.length > 0 && !ed.isDestroyed) {
      const rest = pendingTailNodesRef.current
      pendingTailNodesRef.current = []
      loadingRef.current = true
      appendFragmentWithoutHistory(ed, Fragment.fromArray(rest))
      loadingRef.current = false
      hydratedRef.current = true
    }
    const serialized = docToMarkdown(ed as never)
    if (pendingTailChunksRef.current.length === 0) return serialized
    const tail = pendingTailChunksRef.current.join('\n\n')
    const base = serialized.replace(/\n+$/, '')
    return base ? `${base}\n\n${tail}\n` : `${tail}\n`
  }, [])

  const commitSerialized = useCallback((ed: Editor, allowAutosave: boolean) => {
    if (ed.isDestroyed) return
    const text = serializeEditorDoc(ed)
    emittedRef.current = text
    const dirty = text !== contentRef.current
    setIsDirty(dirty)
    onContentChangeRef.current(text)
    if (dirty && allowAutosave) {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => { void save(text) }, AUTOSAVE_DELAY)
    }
  }, [save, serializeEditorDoc])

  const flushSerialization = useCallback((allowAutosave: boolean) => {
    if (serializeTimerRef.current) {
      clearTimeout(serializeTimerRef.current)
      serializeTimerRef.current = null
      const ed = editorRef.current
      if (ed && !ed.isDestroyed) commitSerialized(ed, allowAutosave)
    }
  }, [commitSerialized])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false, link: { openOnClick: false } }),
      CodeBlock.configure({ lowlight: getMarkdownLowlight(), defaultLanguage: 'plaintext' }),
      TableKit,
      MermaidNode,
      MediaImageNode,
      RawMediaNode,
      ...htmlSchemas,
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
        blur: () => {
          flushSerialization(hydratedRef.current)
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
      if (contentRef.current.length < LARGE_MARKDOWN_CHAR_THRESHOLD && hydratedRef.current) {
        commitSerialized(ed, true)
        return
      }
      setIsDirty(true)
      if (!hydratedRef.current) {
        dirtyDuringHydrationRef.current = true
      }
      if (serializeTimerRef.current) clearTimeout(serializeTimerRef.current)
      serializeTimerRef.current = setTimeout(() => {
        serializeTimerRef.current = null
        commitSerialized(ed, hydratedRef.current)
      }, LARGE_DOC_SERIALIZE_DEBOUNCE)
    },
  })

  editorRef.current = editor

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    editor.view.dom.setAttribute('spellcheck', isLargeDoc ? 'false' : 'true')
  }, [editor, isLargeDoc])

  useEffect(() => {
    if (!editor || savingRef.current) return
    if (content === loadedRef.current || content === emittedRef.current) return
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    if (serializeTimerRef.current) { clearTimeout(serializeTimerRef.current); serializeTimerRef.current = null }
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const token = ++loadTokenRef.current
    contentRef.current = content
    dirtyDuringHydrationRef.current = false
    pendingTailChunksRef.current = []
    pendingTailNodesRef.current = []

    const isStale = () => controller.signal.aborted || token !== loadTokenRef.current || editor.isDestroyed

    if (content.length < LARGE_MARKDOWN_CHAR_THRESHOLD) {
      hydratedRef.current = true
      loadingRef.current = true
      markdownToDoc(content).then((doc) => {
        if (isStale()) return
        editor.commands.setContent(doc)
        loadedRef.current = content
        emittedRef.current = null
        setIsDirty(false)
        loadingRef.current = false
      }).catch(() => {
        if (token === loadTokenRef.current) loadingRef.current = false
      })
      return () => { controller.abort() }
    }

    const loadLarge = async () => {
      const { frontmatter, body } = splitFrontmatter(content)
      const fmHtml = frontmatter !== null ? frontmatterToHtml(frontmatter) : ''
      const chunks = splitMarkdownChunks(body)

      if (chunks && chunks.length > 1) {
        hydratedRef.current = false
        pendingTailChunksRef.current = chunks.slice(1)

        const headHtml = await parseMarkdownHtmlOffThread(chunks[0], controller.signal)
        if (isStale()) return
        const headDoc = htmlToProseMirrorDoc(fmHtml + headHtml, editor.schema)
        loadingRef.current = true
        replaceDocWithoutHistory(editor, headDoc.content)
        loadedRef.current = content
        emittedRef.current = null
        setIsDirty(false)
        loadingRef.current = false

        let nextHtmlPromise: Promise<string> | null = parseMarkdownHtmlOffThread(chunks[1], controller.signal)
        for (let i = 1; i < chunks.length; i++) {
          const chunkHtml = await nextHtmlPromise!
          if (isStale()) return
          nextHtmlPromise = i + 1 < chunks.length
            ? parseMarkdownHtmlOffThread(chunks[i + 1], controller.signal)
            : null
          const chunkDoc = htmlToProseMirrorDoc(chunkHtml, editor.schema)
          await yieldFrame()
          if (isStale()) return
          loadingRef.current = true
          appendFragmentWithoutHistory(editor, chunkDoc.content)
          loadingRef.current = false
          pendingTailChunksRef.current = chunks.slice(i + 1)
        }

        if (isStale()) return
        hydratedRef.current = true
        if (dirtyDuringHydrationRef.current) {
          dirtyDuringHydrationRef.current = false
          commitSerialized(editor, true)
        }
        return
      }

      hydratedRef.current = false
      const bodyHtml = body.trim() ? await parseMarkdownHtmlOffThread(body, controller.signal) : ''
      if (isStale()) return
      const fullDoc = htmlToProseMirrorDoc(fmHtml + bodyHtml, editor.schema)
      const children: ProseMirrorNode[] = []
      fullDoc.forEach((child) => { children.push(child) })

      const initialBatch = children.slice(0, INITIAL_BLOCK_BATCH)
      pendingTailNodesRef.current = children.slice(INITIAL_BLOCK_BATCH)
      loadingRef.current = true
      replaceDocWithoutHistory(editor, Fragment.fromArray(initialBatch))
      loadedRef.current = content
      emittedRef.current = null
      setIsDirty(false)
      loadingRef.current = false

      while (pendingTailNodesRef.current.length > 0) {
        await yieldFrame()
        if (isStale()) return
        if (pendingTailNodesRef.current.length === 0) break
        const batch = pendingTailNodesRef.current.slice(0, SUBSEQUENT_BLOCK_BATCH)
        pendingTailNodesRef.current = pendingTailNodesRef.current.slice(SUBSEQUENT_BLOCK_BATCH)
        loadingRef.current = true
        appendFragmentWithoutHistory(editor, Fragment.fromArray(batch))
        loadingRef.current = false
      }

      if (isStale()) return
      hydratedRef.current = true
      if (dirtyDuringHydrationRef.current) {
        dirtyDuringHydrationRef.current = false
        commitSerialized(editor, true)
      }
    }

    void loadLarge().catch(() => {
      if (token === loadTokenRef.current) {
        loadingRef.current = false
        hydratedRef.current = true
      }
    })

    return () => { controller.abort() }
  }, [content, editor, commitSerialized])

  useEffect(() => {
    onDirtyChange(isDirty)
  }, [isDirty, onDirtyChange])

  useEffect(() => {
    return () => {
      flushSerialization(false)
      abortRef.current?.abort()
      if (timerRef.current) clearTimeout(timerRef.current)
      if (serializeTimerRef.current) clearTimeout(serializeTimerRef.current)
    }
  }, [flushSerialization])

  const mediaBaseDir = filePath.replace(/\\/g, '/').replace(/\/?[^/]*$/, '')

  return (
    <>
      <MediaBaseDirProvider value={mediaBaseDir}>
        <EditorContent
          editor={editor}
          className={cn(
            'markdown-editor size-full overflow-auto [&_.tiptap]:size-full [&_.tiptap]:p-6 [&_.tiptap]:outline-none',
            isLargeDoc && 'is-large-doc',
          )}
        />
      </MediaBaseDirProvider>
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
