import { createElement, type ComponentProps } from 'react'
import type { Components, LinkSafetyConfig } from 'streamdown'
import { defaultRehypePlugins } from 'streamdown'
import type { PluggableList } from 'unified'
import { defaultSchema } from 'hast-util-sanitize'
import rehypeSanitize from 'rehype-sanitize'
import { harden, BlockPolicy } from 'rehype-harden'
import { createCodePlugin } from '@streamdown/code'
import { createStreamdownCodeComponent } from './CodeBlock'
import { toMediaUrl, toLocalFileUrl } from '@/lib/path-utils'
import { LinkSafetyModal } from './LinkSafetyModal'
import { MarkdownImage } from './markdown-image'
import { MarkdownTable } from './MarkdownTable'

/** Shared code highlighter plugin instance — reused across all chat components. */
export const codePlugin = createCodePlugin({ themes: ['github-dark', 'github-dark'] })
export const codePluginLight = createCodePlugin({ themes: ['github-light', 'github-light'] })

type MathPlugin = { remarkPlugin?: unknown; rehypePlugin: [unknown, Record<string, unknown>] }
let mathPluginInstance: MathPlugin | null = null
let mathPluginPromise: Promise<MathPlugin> | null = null

/** Lazy-load @streamdown/math + katex CSS only when math content is detected. */
export function loadMathPlugin(): Promise<MathPlugin> {
  if (mathPluginInstance) return Promise.resolve(mathPluginInstance)
  if (!mathPluginPromise) {
    mathPluginPromise = Promise.all([
      import('@streamdown/math'),
      import('katex/dist/katex.min.css'),
    ]).then(([mod]) => {
      const plugin = mod.createMathPlugin({ singleDollarTextMath: false }) as MathPlugin
      plugin.rehypePlugin[1].strict = false
      mathPluginInstance = plugin
      return plugin
    })
  }
  return mathPluginPromise
}

/** Synchronous accessor — returns null until loadMathPlugin() resolves. */
export function getMathPluginSync(): MathPlugin | null {
  return mathPluginInstance
}

/** Shared Streamdown plugins config (math omitted; injected per-render when needed). */
export const streamdownPlugins = { code: codePlugin }

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

const VIDEO_EXTS = new Set(['.mp4', '.m4v', '.webm', '.ogg', '.mov'])
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.flac', '.aac', '.m4a', '.opus', '.weba'])

const MEDIA_STYLE = { maxHeight: '20rem', maxWidth: '100%', width: 'auto', height: 'auto', borderRadius: '8px', display: 'block' } as const

function MediaVideo(props: ComponentProps<'video'>) {
  return createElement('video', { ...props, src: localFileToMediaUrl(props.src), controls: true, preload: 'metadata', style: MEDIA_STYLE })
}

function MediaAudio(props: ComponentProps<'audio'>) {
  return createElement('audio', { ...props, src: localFileToMediaUrl(props.src), controls: true })
}

function getMediaExt(src: string | undefined): string | null {
  if (!src) return null
  try {
    const pathname = src.startsWith('local-file:///') ? new URL(src).pathname : src
    return pathname.slice(pathname.lastIndexOf('.')).toLowerCase()
  } catch { return null }
}

function MediaImage(props: ComponentProps<'img'>) {
  const ext = getMediaExt(props.src)
  if (ext && VIDEO_EXTS.has(ext)) {
    const { alt: _, ...rest } = props
    return MediaVideo(rest as ComponentProps<'video'>)
  }
  if (ext && AUDIO_EXTS.has(ext)) {
    const { alt: _, ...rest } = props
    return MediaAudio(rest as ComponentProps<'audio'>)
  }
  return createElement(MarkdownImage, props)
}

/** Shared Streamdown code component. */
export const streamdownComponents = {
  code: createStreamdownCodeComponent(codePlugin),
  img: MediaImage,
  video: MediaVideo,
  audio: MediaAudio,
  table: MarkdownTable,
} as unknown as Components

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

export const streamdownRehypePlugins: PluggableList = Object.values({
  ...defaultRehypePlugins,
  sanitize: [rehypeSanitize, localFileSanitizeSchema],
  harden: [harden, {
    allowedLinkPrefixes: ['*'],
    allowedImagePrefixes: ['*'],
    allowedProtocols: ['*'],
    allowDataImages: true,
    defaultOrigin: 'https://localhost',
    linkBlockPolicy: BlockPolicy.textOnly,
  }],
}) as PluggableList

const MD_IMAGE_RE = /!\[([^\]]*)\]\((?!https?:\/\/|data:|local-file:\/\/)([^)\s]+)([^)]*)\)/g

function resolveLocalSrc(src: string, projectPath: string): string {
  const cleanSrc = src.replace(/^\.\//, '')
  return src.startsWith('/')
    ? toLocalFileUrl(src)
    : toLocalFileUrl(`${projectPath}/${cleanSrc}`)
}

export function resolveMarkdownMedia(text: string, projectPath: string): string {
  return text.replace(MD_IMAGE_RE, (_, alt, src, rest) => {
    return `![${alt}](${resolveLocalSrc(src, projectPath)}${rest})`
  })
}

/** Format token count: plain number if < 1k, otherwise k with 1 decimal. */
export function formatTokens(n: number): string {
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

