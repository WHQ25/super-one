import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { BundledLanguage } from 'shiki'
import { useIsDark } from '@/hooks/use-is-dark'
import { getFileHighlighter, getFileHighlighterSync, getShikiTarget } from '@/lib/shiki-highlighter'
import { Z } from '@/lib/z-layers'
import type { ReviewLspHoverState } from './useReviewLsp'

interface ParsedSegment {
  kind: 'code' | 'text'
  lang?: string
  content: string
}

function splitMarkdownCodeBlocks(markdown: string): ParsedSegment[] {
  const segments: ParsedSegment[] = []
  const regex = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g
  let lastIdx = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(markdown)) !== null) {
    if (match.index > lastIdx) {
      const text = markdown.slice(lastIdx, match.index).trim()
      if (text) segments.push({ kind: 'text', content: text })
    }
    segments.push({ kind: 'code', lang: match[1] || undefined, content: match[2].replace(/\n$/, '') })
    lastIdx = regex.lastIndex
  }
  if (lastIdx < markdown.length) {
    const rest = markdown.slice(lastIdx).trim()
    if (rest) segments.push({ kind: 'text', content: rest })
  }
  return segments
}

function HighlightedHoverCode({ code, lang, isDark }: { code: string; lang: string; isDark: boolean }) {
  const [tokens, setTokens] = useState<Array<Array<{ content: string; color?: string }>> | null>(null)

  useEffect(() => {
    let active = true
    const target = getShikiTarget(isDark, lang)
    const syncHl = getFileHighlighterSync(target.theme, target.lang)
    if (syncHl) {
      const res = syncHl.codeToTokens(code, { lang: target.lang as BundledLanguage, theme: target.theme })
      setTokens(res.tokens)
      return
    }
    void getFileHighlighter(target.theme, target.lang).then((hl) => {
      if (!active) return
      const res = hl.codeToTokens(code, { lang: target.lang as BundledLanguage, theme: target.theme })
      setTokens(res.tokens)
    })
    return () => { active = false }
  }, [code, lang, isDark])

  return (
    <pre className="overflow-x-auto rounded bg-muted/60 px-2 py-1.5 font-mono text-[11px] leading-relaxed">
      <code>
        {tokens
          ? tokens.map((line, i) => (
              <div key={i}>
                {line.length === 0
                  ? '\u00a0'
                  : line.map((tok, j) => (
                      <span key={j} style={tok.color ? { color: tok.color } : undefined}>
                        {tok.content}
                      </span>
                    ))}
              </div>
            ))
          : code}
      </code>
    </pre>
  )
}

interface ReviewLspHoverCardProps {
  hover: ReviewLspHoverState
  onDismiss: () => void
}

export function ReviewLspHoverCard({ hover, onDismiss }: ReviewLspHoverCardProps) {
  const isDark = useIsDark()
  const cardRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState(() => ({
    left: Math.max(8, hover.rect.left),
    top: Math.max(8, hover.rect.bottom + 6),
  }))

  useLayoutEffect(() => {
    const el = cardRef.current
    if (!el) return
    const vw = window.innerWidth || 1024
    const vh = window.innerHeight || 768
    const box = el.getBoundingClientRect()
    const w = box.width || 360
    const h = box.height || 140
    const left = Math.max(8, Math.min(hover.rect.left, vw - w - 12))
    const fitsBelow = hover.rect.bottom + 6 + h <= vh - 8
    const top = fitsBelow
      ? hover.rect.bottom + 6
      : Math.max(8, hover.rect.top - h - 6)
    setPos((prev) => (prev.left === left && prev.top === top ? prev : { left, top }))
  }, [hover])

  const segments = splitMarkdownCodeBlocks(hover.markdown)

  return createPortal(
    <div
      ref={cardRef}
      role="tooltip"
      data-testid="review-lsp-hover-card"
      style={{ left: pos.left, top: pos.top, zIndex: Z.MODAL }}
      onMouseLeave={onDismiss}
      className="fixed max-h-72 w-max max-w-[min(520px,calc(100vw-24px))] overflow-auto rounded-lg border border-border bg-popover p-2.5 text-xs text-popover-foreground shadow-lg"
    >
      <div className="flex flex-col gap-2">
        {segments.map((seg, idx) =>
          seg.kind === 'code' ? (
            <HighlightedHoverCode
              key={idx}
              code={seg.content}
              lang={seg.lang ?? hover.language}
              isDark={isDark}
            />
          ) : (
            <div key={idx} className="whitespace-pre-wrap break-words leading-relaxed text-muted-foreground">
              {seg.content}
            </div>
          ),
        )}
      </div>
    </div>,
    document.body,
  )
}
