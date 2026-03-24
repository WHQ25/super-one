import { createElement, type ComponentProps } from 'react'
import type { LinkSafetyConfig } from 'streamdown'
import { defaultRehypePlugins } from 'streamdown'
import { defaultSchema } from 'hast-util-sanitize'
import rehypeSanitize from 'rehype-sanitize'
import { createCodePlugin } from '@streamdown/code'
import { createMathPlugin } from '@streamdown/math'
import 'katex/dist/katex.min.css'
import { createStreamdownCodeComponent } from './CodeBlock'
import { toMediaUrl } from '@/lib/path-utils'
import { LinkSafetyModal } from './LinkSafetyModal'

/** Shared code highlighter plugin instance — reused across all chat components. */
export const codePlugin = createCodePlugin({ themes: ['github-dark', 'github-dark'] })
export const codePluginLight = createCodePlugin({ themes: ['github-light', 'github-light'] })

export const mathPlugin = createMathPlugin({ singleDollarTextMath: false })
;(mathPlugin.rehypePlugin as [unknown, Record<string, unknown>])[1].strict = false

/** Shared Streamdown plugins config. */
export const streamdownPlugins = { code: codePlugin, math: mathPlugin }

/** Shared Streamdown controls config. */
export const streamdownControls = { table: false }

/** Custom link safety modal scoped properly for Electron. */
export const streamdownLinkSafety: LinkSafetyConfig = {
  enabled: true,
  renderModal: (props) => createElement(LinkSafetyModal, props),
}

function localFileToMediaUrl(src: string | undefined): string | undefined {
  if (!src) return src
  if (src.startsWith('local-file:///')) {
    const filePath = decodeURIComponent(new URL(src).pathname)
    return toMediaUrl(filePath)
  }
  return src
}

function MediaVideo(props: ComponentProps<'video'>) {
  return createElement('video', { ...props, src: localFileToMediaUrl(props.src), style: { width: '100%', borderRadius: '8px' } })
}

function MediaAudio(props: ComponentProps<'audio'>) {
  return createElement('audio', { ...props, src: localFileToMediaUrl(props.src) })
}

/** Shared Streamdown code component. */
export const streamdownComponents: Record<string, unknown> = {
  code: createStreamdownCodeComponent(codePlugin),
  video: MediaVideo,
  audio: MediaAudio,
}

const localFileSanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'video', 'audio', 'source'],
  attributes: {
    ...defaultSchema.attributes,
    video: ['src', 'controls', 'autoPlay', 'loop', 'muted', 'poster', 'width', 'height', 'preload'],
    audio: ['src', 'controls', 'autoPlay', 'loop', 'muted', 'preload'],
    source: ['src', 'type'],
  },
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src ?? []), 'local-file'],
  },
}

export const streamdownRehypePlugins = Object.values({
  ...defaultRehypePlugins,
  sanitize: [rehypeSanitize, localFileSanitizeSchema],
}) as unknown[]

/** Format token count: plain number if < 1k, otherwise k with 1 decimal. */
export function formatTokens(n: number): string {
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

