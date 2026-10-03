import { useEffect, useMemo, useState } from 'react'
import { frontmatterAsCodeBlock } from '@superone/shared/markdown-frontmatter'
import { installHostBridge, postHost } from './bridge'
import { applyDocumentTheme, initialDocumentScheme, type DocumentTheme } from './document-theme'
import { applyDocumentViewport } from './document-viewport'
import { PortableMarkdown } from './PortableMarkdown'
import { PortableTurnContext, type PortableTurnContextValue } from './portable-turn-context'

export interface MarkdownDocument {
  text: string
  /** The file's folder on the host; relative links and images resolve against it. */
  directory: string
}

/**
 * A Markdown file rendered by the transcript's own pipeline — GFM, math,
 * mermaid, highlighted code, host images, file chips — so a `.md` preview on
 * the phone reads like the desktop's editor and the chat. Frontmatter shows as
 * a YAML block, as it does on the desktop.
 */
export function MarkdownDocumentContent({ document: doc, scheme }: { document: MarkdownDocument; scheme: DocumentTheme['scheme'] }) {
  const text = useMemo(() => frontmatterAsCodeBlock(doc.text), [doc.text])
  const context = useMemo<PortableTurnContextValue>(
    () => ({ scheme, pendingPermission: null, projectPath: doc.directory, mcpIcons: {} }),
    [scheme, doc.directory],
  )
  return (
    <PortableTurnContext.Provider value={context}>
      <main className="markdown-document">
        <PortableMarkdown text={text} isStreaming={false} scheme={scheme} />
      </main>
    </PortableTurnContext.Provider>
  )
}

/** The `markdown-document` root (`view-mode.ts`): theme and content come from the host. */
export function MarkdownDocumentView() {
  const [theme, setTheme] = useState<DocumentTheme>(() => ({ hue: 250, scheme: initialDocumentScheme(document.documentElement) }))
  const [doc, setDoc] = useState<MarkdownDocument | null>(null)

  useEffect(() => {
    const removeBridge = installHostBridge((message) => {
      if (message.type === 'setTheme') {
        setTheme((previous) => ({
          hue: typeof message.hue === 'number' ? message.hue : previous.hue,
          scheme: message.scheme ?? previous.scheme,
        }))
      } else if (message.type === 'setViewport') {
        applyDocumentViewport(message)
      } else if (message.type === 'showMarkdownDocument') {
        setDoc({ text: message.text, directory: message.directory })
      }
    })
    postHost({ type: 'ready' })
    return removeBridge
  }, [])

  useEffect(() => {
    applyDocumentTheme(document.documentElement, document.body, theme)
  }, [theme])

  // The host keeps its loading indicator up until the first frame with the document in it.
  useEffect(() => {
    if (!doc) return
    const frame = requestAnimationFrame(() => postHost({ type: 'documentRendered' }))
    return () => cancelAnimationFrame(frame)
  }, [doc])

  return doc ? <MarkdownDocumentContent document={doc} scheme={theme.scheme} /> : null
}
