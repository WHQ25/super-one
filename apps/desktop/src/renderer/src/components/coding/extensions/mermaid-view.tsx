import { NodeViewWrapper } from '@tiptap/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { NodeViewProps } from '@tiptap/core'
import { useTranslation } from 'react-i18next'
import { Check, Code, Copy, Expand, Eye, Loader2 } from 'lucide-react'
import { createLowlight } from 'lowlight'
import { mermaidGrammar } from 'lowlight-mermaid'
import { toHtml } from 'hast-util-to-html'
import { tryCopy } from '@/lib/clipboard'
import { useIsDark } from '@/hooks/use-is-dark'
import { MermaidPreview } from '@/components/chat/MermaidBlock'
import { MermaidFullscreen } from '@/components/chat/MermaidFullscreen'
import type { MermaidOptions } from './mermaid-node'

const lowlight = createLowlight()
lowlight.register('mermaid', mermaidGrammar)

function highlightMermaid(code: string): string {
  try {
    return toHtml(lowlight.highlight('mermaid', code))
  } catch {
    return code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
}

export const MermaidView = ({ node, updateAttributes, selected, deleteNode, extension }: NodeViewProps) => {
  const { t } = useTranslation()
  const dictionary = (extension.options as MermaidOptions).dictionary
  const isDark = useIsDark()

  const syntax = node.attrs.syntax as string
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isThemeSwitching, setIsThemeSwitching] = useState(false)
  const [isEditing, setIsEditing] = useState(node.attrs.isEditing as boolean)
  const [copied, setCopied] = useState(false)
  const [fullscreenOpen, setFullscreenOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const prevDarkRef = useRef(isDark)

  useEffect(() => {
    if (node.attrs.isEditing !== isEditing) setIsEditing(node.attrs.isEditing as boolean)
  }, [node.attrs.isEditing, isEditing])

  const adjustHeight = () => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${ta.scrollHeight}px`
  }

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      setTimeout(() => { textareaRef.current?.focus(); adjustHeight() }, 0)
    }
  }, [isEditing])

  useEffect(() => {
    if (isEditing) adjustHeight()
  }, [syntax, isEditing])

  useEffect(() => {
    if (isEditing || !syntax.trim()) return
    const isThemeChange = prevDarkRef.current !== isDark
    if (isThemeChange && svg) {
      setIsThemeSwitching(true)
    } else {
      setIsLoading(true)
      setSvg('')
    }
    setError('')
    let cancelled = false
    const render = async () => {
      try {
        const mermaid = (await import('mermaid')).default
        mermaid.initialize({
          startOnLoad: false,
          theme: isDark ? 'dark' : 'default',
          securityLevel: 'loose',
          suppressErrorRendering: true,
        })
        const id = `mermaid-edit-${Math.random().toString(36).slice(2, 11)}`
        const { svg: rendered } = await mermaid.render(id, syntax)
        if (!cancelled) {
          setSvg(rendered)
          setError('')
          prevDarkRef.current = isDark
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to render diagram')
      } finally {
        if (!cancelled) { setIsLoading(false); setIsThemeSwitching(false) }
      }
    }
    render()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syntax, isEditing, isDark])

  const enterEdit = () => { setIsEditing(true); updateAttributes({ isEditing: true }) }
  const exitEdit = () => {
    if (!syntax.trim()) { deleteNode(); return }
    setIsEditing(false)
    updateAttributes({ isEditing: false })
  }

  const handleCopy = useCallback(async () => {
    if (!(await tryCopy(syntax))) return
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [syntax])

  const onTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); exitEdit() }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.stopPropagation()
  }

  useEffect(() => {
    if (!selected || isEditing || !svg || error) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault()
        e.stopPropagation()
        setFullscreenOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, isEditing, svg, error])

  const toolbar = (
    <div className="code-block-header" contentEditable={false}>
      <span className="code-block-lang">mermaid</span>
      <div className="flex items-center gap-1">
        {isEditing ? (
          <button onClick={exitEdit} className="code-block-copy" title={t('tooltips.mermaidPreview')}>
            <Eye className="size-3.5" />
          </button>
        ) : (
          <>
            {svg && !error && (
              <button onClick={() => setFullscreenOpen(true)} className="code-block-copy" title={t('tooltips.expand')}>
                <Expand className="size-3.5" />
              </button>
            )}
            <button onClick={enterEdit} className="code-block-copy" title={t('tooltips.mermaidSource')}>
              <Code className="size-3.5" />
            </button>
          </>
        )}
        <button onClick={handleCopy} className="code-block-copy" title={t('tooltips.copy')}>
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      </div>
    </div>
  )

  return (
    <>
      <NodeViewWrapper className={`mermaid-node ${selected ? 'selected' : ''}`}>
        <div className="mermaid-container">
          {toolbar}
          {isEditing ? (
            <div className="mermaid-editor">
              <div className="mermaid-editor-wrapper">
                <pre className="mermaid-highlight" aria-hidden="true" dangerouslySetInnerHTML={{ __html: highlightMermaid(syntax) + '\n' }} />
                <textarea
                  ref={textareaRef}
                  className="mermaid-textarea"
                  value={syntax}
                  onChange={(e) => updateAttributes({ syntax: e.target.value })}
                  onKeyDown={onTextareaKeyDown}
                  placeholder={dictionary.placeholder}
                  spellCheck={false}
                />
              </div>
              <div className="mermaid-hint">{dictionary.hint}</div>
            </div>
          ) : error ? (
            <div className="mermaid-error" onDoubleClick={enterEdit}>
              <strong>{dictionary.error}</strong>
              <pre>{error}</pre>
            </div>
          ) : !svg || isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div onDoubleClick={enterEdit} className="cursor-pointer">
              <MermaidPreview svg={svg} isThemeSwitching={isThemeSwitching} />
            </div>
          )}
        </div>
      </NodeViewWrapper>
      <MermaidFullscreen svg={svg} open={fullscreenOpen} onOpenChange={setFullscreenOpen} />
    </>
  )
}
