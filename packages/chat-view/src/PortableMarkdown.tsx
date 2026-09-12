import { createElement, useContext, useEffect, useMemo, type ComponentProps, type ReactNode } from 'react'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import { createMathPlugin } from '@streamdown/math'
import { defaultRehypePlugins, type Components } from 'streamdown'
import { harden, BlockPolicy } from 'rehype-harden'
import type { PluggableList } from 'unified'
import {
  CopyableMarkdownPresenter,
  InsightBlockPresenter,
  type CopyableMarkdownRuntime,
} from './presenters/CopyableMarkdown'
import {
  createStreamdownCodeComponentPresenter,
  HighlightedCodeBlockPresenter,
  type HighlightResult,
  type HighlightedCodeBlockPresenterPorts,
  type StreamdownCodePresenterPorts,
} from './presenters/CodeBlock'
import { MermaidBlockPresenter } from './presenters/MermaidBlock'
import { fileChipLabel } from './presenters/file-chip-label'
import { formatLineRange, resolveProjectFileHref } from './presenters/file-link'
import { PortableTurnContext } from './portable-turn-context'
import { createPortableCodePlugin } from './portable-code-plugin'
import { requestNative } from './bridge'
import { isPreviewableImageSource, previewImage } from './image-preview'
import { hasNativeHost, previewMermaid } from './mermaid-preview'

const darkCodePlugin = createPortableCodePlugin('github-dark')
const lightCodePlugin = createPortableCodePlugin('github-light')
const mathPlugin = createMathPlugin({ singleDollarTextMath: false })
/**
 * Streamdown's default harden config allows any link PREFIX but not any
 * PROTOCOL, so a project file citation like `src/ToolRow.tsx:42` reads as an
 * unknown scheme and is replaced with a "Blocked URL" stub — the chip never
 * gets to render. Desktop already widens exactly this (see `chat-shared.ts`);
 * matching it is what makes file citations work on both surfaces.
 *
 * Widening is safe here because a link in this WebView never navigates: every
 * anchor goes through `NativeLink`, and the native side validates the scheme
 * before acting on `openLink`.
 */
const rehypePlugins = Object.values({
  ...defaultRehypePlugins,
  harden: [harden, {
    allowedLinkPrefixes: ['*'],
    allowedImagePrefixes: ['*'],
    allowedProtocols: ['*'],
    allowDataImages: true,
    linkBlockPolicy: BlockPolicy.textOnly,
  }],
}) as PluggableList

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    requestNative('copyText', { text })
    return true
  }
}

/**
 * Project file citation. The phone cannot open an editor tab, so the chip hands
 * the resolved host path (and cited line) to the native `previewFile` action —
 * the same affordance the tool rows use for a touched file.
 *
 * The icon is resolved from the PATH's basename, not the link label: markdown
 * may caption a file with prose, and the desktop `InlineFileChip` makes the same
 * choice so a citation reads identically on both surfaces.
 */
function NativeFileChip({
  name,
  filePath,
  lineNumber,
  endLine,
}: {
  name: string
  filePath: string
  lineNumber?: number
  endLine?: number
}) {
  return (
    <span
      role="button"
      title={filePath}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        requestNative('previewFile', { path: filePath, ...(lineNumber != null ? { line: lineNumber } : {}) })
      }}
      className="inline-flex max-w-full items-center gap-0.5 rounded bg-muted px-1 align-baseline text-[0.9em] text-foreground whitespace-nowrap"
    >
      <FileIcon name={filePath.split(/[/\\]/).pop() || name} size={12} />
      <span className="min-w-0 truncate">{name}</span>
      {lineNumber != null && (
        <span className="shrink-0 text-[0.85em] text-muted-foreground">{formatLineRange(lineNumber, endLine)}</span>
      )}
    </span>
  )
}

function NativeLink({ href, onClick, ...props }: ComponentProps<'a'>) {
  const { projectPath } = useContext(PortableTurnContext)
  const resolved = href ? resolveProjectFileHref(href, projectPath ?? '') : null
  if (resolved) {
    return (
      <NativeFileChip
        name={fileChipLabel(props.children, href, resolved.filePath)}
        filePath={resolved.filePath}
        lineNumber={resolved.lineNumber}
        endLine={resolved.endLine}
      />
    )
  }
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented || !href) return
        event.preventDefault()
        requestNative('openLink', { url: href })
      }}
    />
  )
}

/**
 * A markdown image. One the WebView can actually display — inline bytes or a
 * public URL — opens fullscreen on tap; a relative host path has nothing to
 * show and stays a plain (broken) picture, as before.
 */
function NativeImage(props: ComponentProps<'img'>) {
  const picture = <img {...props} className="max-h-80 max-w-full rounded-lg object-contain" />
  if (!isPreviewableImageSource(props.src)) return picture
  const src = props.src
  const label = typeof props.alt === 'string' && props.alt ? props.alt : 'image'
  return (
    <button
      type="button"
      className="inline-block max-w-full overflow-hidden rounded-lg align-top"
      onClick={() => previewImage(src, { label })}
      aria-label={`Preview ${label}`}
    >
      {picture}
    </button>
  )
}

function FullscreenMermaid({
  svg,
  open,
  onOpenChange,
}: {
  svg: string
  open: boolean
  onOpenChange(open: boolean): void
}) {
  const native = hasNativeHost()
  // On the phone the overlay would be the same document as the transcript, so a
  // pinch would scale the chat and stay that way after close. Hand the SVG to
  // the native preview page instead; that page owns zoom, and back restores 1×.
  useEffect(() => {
    if (!open || !native) return
    previewMermaid(svg)
    onOpenChange(false)
  }, [open, svg, native, onOpenChange])
  if (!open || native) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 p-4 touch-none"
      role="dialog"
      aria-modal="true"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="max-h-full max-w-full overflow-auto [&_svg]:h-auto [&_svg]:max-w-none"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  )
}

function noRhaiHighlight(
  _code: string,
  _themes: readonly unknown[],
  _callback: (result: HighlightResult) => void,
): HighlightResult | null {
  return null
}

function createMarkdownRuntime(scheme: 'light' | 'dark'): CopyableMarkdownRuntime {
  const activeCodePlugin = scheme === 'dark' ? darkCodePlugin : lightCodePlugin
  const highlightedPorts: HighlightedCodeBlockPresenterPorts = {
    isDark: scheme === 'dark',
    lightCodePlugin,
    copyText,
    isRhaiLanguage: () => false,
    highlightRhai: noRhaiHighlight,
  }
  const codePorts: StreamdownCodePresenterPorts = {
    renderHighlightedCode: (props) => (
      <HighlightedCodeBlockPresenter {...props} ports={highlightedPorts} />
    ),
    renderMermaid: ({ code, isComplete, codePlugin }) => (
      <MermaidBlockPresenter
        code={code}
        isComplete={isComplete}
        scheme={scheme}
        theme={scheme === 'dark' ? 'dark' : 'default'}
        ports={{
          copyText,
          renderHighlightedCode: (props) => (
            <HighlightedCodeBlockPresenter
              {...props}
              codePlugin={codePlugin}
              ports={highlightedPorts}
            />
          ),
          renderFullscreen: (props) => <FullscreenMermaid {...props} />,
        }}
      />
    ),
  }
  const components = {
    code: createStreamdownCodeComponentPresenter(activeCodePlugin, codePorts),
    a: NativeLink,
    img: NativeImage,
  } as unknown as Components

  return {
    components,
    controls: { table: false },
    getMathPluginSync: () => mathPlugin,
    loadMathPlugin: async () => mathPlugin,
    plugins: {},
    rehypePlugins,
    copyText,
    linkSafety: { enabled: false },
  }
}

export function PortableMarkdown({
  text,
  isStreaming,
  scheme,
}: {
  text: string
  isStreaming: boolean
  scheme: 'light' | 'dark'
}) {
  const runtime = useMemo(() => createMarkdownRuntime(scheme), [scheme])
  return (
    <CopyableMarkdownPresenter
      text={text}
      isStreaming={isStreaming}
      runtime={runtime}
    />
  )
}

/**
 * Insight callout for a block the desktop already split out of the turn's text.
 * The text path reaches the same card through `splitByInsightBlocks`; this entry
 * point exists because the remote projection splits in the main process instead,
 * so the markers never reach the markdown renderer that would have found them.
 */
export function PortableInsight({
  title,
  content,
  isStreaming,
  scheme,
}: {
  title: string
  content: string
  isStreaming: boolean
  scheme: 'light' | 'dark'
}) {
  const runtime = useMemo(() => createMarkdownRuntime(scheme), [scheme])
  return (
    <InsightBlockPresenter
      title={title}
      content={content}
      isStreaming={isStreaming}
      runtime={runtime}
    />
  )
}

export function PlainCode({ children }: { children: ReactNode }) {
  return createElement('pre', {
    className: 'my-1.5 overflow-x-auto whitespace-pre-wrap rounded-md bg-muted/40 px-3 py-2 font-mono text-xs',
  }, children)
}
