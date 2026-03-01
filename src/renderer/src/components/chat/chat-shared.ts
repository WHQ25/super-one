import { createCodePlugin } from '@streamdown/code'
import { createStreamdownCodeComponent } from './CodeBlock'

/** Shared code highlighter plugin instance — reused across all chat components. */
export const codePlugin = createCodePlugin({ themes: ['github-dark', 'github-dark'] })
export const codePluginLight = createCodePlugin({ themes: ['github-light', 'github-light'] })

/** Shared Streamdown plugins config. */
export const streamdownPlugins = { code: codePlugin }

/** Shared Streamdown controls config. */
export const streamdownControls = { table: false }

/** Shared Streamdown code component. */
export const streamdownComponents: Record<string, ReturnType<typeof createStreamdownCodeComponent>> = {
  code: createStreamdownCodeComponent(codePlugin),
}

/** Format token count: plain number if < 1k, otherwise k with 1 decimal. */
export function formatTokens(n: number): string {
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

