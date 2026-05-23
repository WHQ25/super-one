import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import { Document } from '@tiptap/extension-document'
import { Text } from '@tiptap/extension-text'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { encodeHtmlEntities } from '@tiptap/core'
import { common, createLowlight } from 'lowlight'
import type { Root } from 'hast'
import { useEffectiveProjectRoot } from '@/stores/app'
import './markdown-editor.css'

export const FRONTMATTER_RE = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*\n([\s\S]*)$/

const baseLowlight = createLowlight(common)

export function highlightMarkdownWithFrontmatter(
  base: typeof baseLowlight,
  value: string,
  options?: Record<string, unknown>,
): Root {
  const m = value.match(FRONTMATTER_RE)
  if (!m) return base.highlight('markdown', value, options) as Root
  const openFence = { type: 'element' as const, tagName: 'span', properties: { className: ['hljs-meta'] }, children: [{ type: 'text' as const, value: '---\n' }] }
  const yamlTree = base.highlight('yaml', m[1], options) as Root
  const closeFence = { type: 'element' as const, tagName: 'span', properties: { className: ['hljs-meta'] }, children: [{ type: 'text' as const, value: '\n---\n' }] }
  const mdTree = base.highlight('markdown', m[2], options) as Root
  return { type: 'root', children: [openFence, ...yamlTree.children, closeFence, ...mdTree.children], data: { language: 'markdown', relevance: 10 } } satisfies Root
}

const lowlight = new Proxy(baseLowlight, {
  get(target, prop, receiver) {
    if (prop === 'highlight') {
      return (lang: string, value: string, options?: Record<string, unknown>) => {
        if (lang === 'markdown') return highlightMarkdownWithFrontmatter(target, value, options)
        return target.highlight(lang, value, options)
      }
    }
    return Reflect.get(target, prop, receiver)
  },
})

const CustomDocument = Document.extend({ content: 'codeBlock' })

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
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const filePathRef = useRef(filePath)

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
