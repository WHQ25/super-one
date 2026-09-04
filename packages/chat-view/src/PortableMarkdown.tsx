import { createElement, useMemo, type ComponentProps, type ReactNode } from 'react'
import type { CodeHighlighterPlugin } from '@streamdown/code'
import { createMathPlugin } from '@streamdown/math'
import { defaultRehypePlugins, type Components } from 'streamdown'
import type { PluggableList } from 'unified'
import {
  CopyableMarkdownPresenter,
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
import { requestNative } from './bridge'

function plainCodePlugin(theme: 'github-dark' | 'github-light'): CodeHighlighterPlugin {
  return {
    name: 'shiki',
    type: 'code-highlighter',
    getSupportedLanguages: () => [],
    getThemes: () => [theme, theme],
    supportsLanguage: () => false,
    highlight: () => null,
  }
}

// The mobile bundle deliberately keeps code monochrome: bundling every Shiki
// grammar adds ~12 MB before the WebView has rendered its first turn.
const darkCodePlugin = plainCodePlugin('github-dark')
const lightCodePlugin = plainCodePlugin('github-light')
const mathPlugin = createMathPlugin({ singleDollarTextMath: false })
const rehypePlugins = Object.values(defaultRehypePlugins) as PluggableList

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    requestNative('copyText', { text })
    return true
  }
}

function NativeLink({ href, onClick, ...props }: ComponentProps<'a'>) {
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

function NativeImage(props: ComponentProps<'img'>) {
  return <img {...props} className="max-h-80 max-w-full rounded-lg object-contain" />
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
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 p-4"
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

export function PlainCode({ children }: { children: ReactNode }) {
  return createElement('pre', {
    className: 'my-1.5 overflow-x-auto whitespace-pre-wrap rounded-md bg-muted/40 px-3 py-2 font-mono text-xs',
  }, children)
}
