import { createElement } from 'react'
import type { LinkSafetyConfig } from 'streamdown'
import { createCodePlugin } from '@streamdown/code'
import { createMathPlugin } from '@streamdown/math'
import 'katex/dist/katex.min.css'
import { createStreamdownCodeComponent } from './CodeBlock'
import { LinkSafetyModal } from './LinkSafetyModal'

/** Shared code highlighter plugin instance — reused across all chat components. */
export const codePlugin = createCodePlugin({ themes: ['github-dark', 'github-dark'] })
export const codePluginLight = createCodePlugin({ themes: ['github-light', 'github-light'] })

export const mathPlugin = createMathPlugin({ singleDollarTextMath: true })

/** Shared Streamdown plugins config. */
export const streamdownPlugins = { code: codePlugin, math: mathPlugin }

/** Shared Streamdown controls config. */
export const streamdownControls = { table: false }

/** Custom link safety modal scoped properly for Electron. */
export const streamdownLinkSafety: LinkSafetyConfig = {
  enabled: true,
  renderModal: (props) => createElement(LinkSafetyModal, props),
}

/** Shared Streamdown code component. */
export const streamdownComponents: Record<string, ReturnType<typeof createStreamdownCodeComponent>> = {
  code: createStreamdownCodeComponent(codePlugin),
}

/** Format token count: plain number if < 1k, otherwise k with 1 decimal. */
export function formatTokens(n: number): string {
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

