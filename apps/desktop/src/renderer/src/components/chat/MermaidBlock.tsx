import { useMemo } from 'react'
import type { CodeHighlighterPlugin } from '@streamdown/code'
import { tryCopy } from '@/lib/clipboard'
import { useIsDark } from '@/hooks/use-is-dark'
import { useAppStore } from '@/stores/app'
import { HighlightedCodeBlock } from './CodeBlock'
import { MermaidFullscreen } from './MermaidFullscreen'
import { resolveMermaidThemeId } from './mermaid-themes'
import {
  MermaidBlockPresenter,
  type MermaidBlockPresenterPorts,
} from './presenters/MermaidBlock'

export {
  computeLayout,
  MAX_H,
  OVERFLOW_RENDER_RATIO,
  OVERFLOW_THRESHOLD,
  parseSize,
  MermaidPreview,
} from './presenters/MermaidBlock'

export interface MermaidBlockProps {
  code: string
  isComplete: boolean
  codePlugin: CodeHighlighterPlugin
}

export function MermaidBlock({ code, isComplete, codePlugin }: MermaidBlockProps) {
  const isDark = useIsDark()
  const mermaidLightTheme = useAppStore((state) => state.mermaidLightTheme)
  const mermaidDarkTheme = useAppStore((state) => state.mermaidDarkTheme)
  const scheme = isDark ? 'dark' : 'light'
  const theme = resolveMermaidThemeId(
    scheme,
    isDark ? mermaidDarkTheme : mermaidLightTheme,
  )
  const ports = useMemo<MermaidBlockPresenterPorts>(() => ({
    copyText: tryCopy,
    renderHighlightedCode: (props) => (
      <HighlightedCodeBlock {...props} codePlugin={codePlugin} />
    ),
    renderFullscreen: (props) => <MermaidFullscreen {...props} />,
  }), [codePlugin])

  return (
    <MermaidBlockPresenter
      code={code}
      isComplete={isComplete}
      scheme={scheme}
      theme={theme}
      ports={ports}
    />
  )
}
