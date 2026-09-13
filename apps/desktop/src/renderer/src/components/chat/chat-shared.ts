import { createElement, type ComponentProps } from 'react'
import type { Components, LinkSafetyConfig, MathPlugin } from 'streamdown'
import type { PluggableList } from 'unified'
import { createStreamdownCodeComponent } from './CodeBlock'
import { codePlugin, codePluginLight } from './code-plugins'
import { toMediaUrl } from '@/lib/path-utils'
import {
  resolveMediaSrcForProject,
  isRemoteMediaUrl,
  decodeRemoteMediaUrl,
} from '@/lib/remote-media-url'
import { LinkSafetyModal } from './LinkSafetyModal'
import { MarkdownImage } from './markdown-image'
import { mediaStyleFor } from './markdown-media-style'
import { MarkdownTable } from './MarkdownTable'
import { MarkdownRemoteMedia } from './markdown-remote-media'
import { openBrowserTab } from '@/components/activity/activity-panel-api'
import { resolveMarkdownFileLinks } from '@superone/chat-view/presenters/markdown-file-links'
import { createMarkdownRehypePlugins } from '@superone/chat-view/presenters/markdown-media'
import { isVideoFileName } from '@superone/shared/file-preview'

export { resolveMarkdownFileLinks }

export { codePlugin, codePluginLight }

let mathMiniAppHostInstance: MathPlugin | null = null
let mathPluginPromise: Promise<MathPlugin> | null = null

/** Lazy-load @streamdown/math + katex CSS only when math content is detected. */
export function loadMathPlugin(): Promise<MathPlugin> {
  if (mathMiniAppHostInstance) return Promise.resolve(mathMiniAppHostInstance)
  if (!mathPluginPromise) {
    mathPluginPromise = Promise.all([
      import('@streamdown/math'),
      import('katex/dist/katex.min.css'),
    ]).then(([mod]) => {
      const plugin = mod.createMathPlugin({ singleDollarTextMath: false })
      ;(plugin.rehypePlugin as [unknown, Record<string, unknown>])[1].strict = false
      mathMiniAppHostInstance = plugin
      return plugin
    })
  }
  return mathPluginPromise
}

/** Synchronous accessor — returns null until loadMathPlugin() resolves. */
export function getMathPluginSync(): MathPlugin | null {
  return mathMiniAppHostInstance
}

/** Shared Streamdown plugins config (math omitted; injected per-render when needed). */
export const streamdownPlugins = { code: codePlugin }

/** Shared Streamdown controls config. */
export const streamdownControls = { table: false }

/** Custom link safety modal scoped properly for Electron. */
export const streamdownLinkSafety: LinkSafetyConfig = {
  enabled: true,
  renderModal: (props) => createElement(LinkSafetyModal, { ...props, onOpenInApp: () => openBrowserTab(props.url) }),
}

function localFileToMediaUrl(src: string | undefined): string | undefined {
  if (!src) return src
  if (src.startsWith('local-file:///')) {
    const filePath = decodeURIComponent(new URL(src).pathname)
    return toMediaUrl(filePath)
  }
  return src
}

const AUDIO_EXTS = new Set(['.mp3', '.wav', '.flac', '.aac', '.m4a', '.opus', '.weba'])

function MediaVideo(props: ComponentProps<'video'>) {
  const style = mediaStyleFor(props.width, props.height)
  if (isRemoteMediaUrl(props.src)) {
    return createElement(MarkdownRemoteMedia, { kind: 'video', src: props.src, style })
  }
  return createElement('video', {
    ...props,
    src: localFileToMediaUrl(props.src),
    controls: true,
    preload: 'metadata',
    style,
  })
}

function MediaAudio(props: ComponentProps<'audio'>) {
  if (isRemoteMediaUrl(props.src)) {
    return createElement(MarkdownRemoteMedia, { kind: 'audio', src: props.src })
  }
  return createElement('audio', { ...props, src: localFileToMediaUrl(props.src), controls: true })
}

function getMediaExt(src: string | undefined): string | null {
  if (!src) return null
  try {
    if (isRemoteMediaUrl(src)) {
      const ref = decodeRemoteMediaUrl(src)
      if (ref) {
        const f = ref.relativePath
        return f.slice(f.lastIndexOf('.')).toLowerCase()
      }
    }
    const pathname = src.startsWith('local-file:///') ? new URL(src).pathname : src
    return pathname.slice(pathname.lastIndexOf('.')).toLowerCase()
  } catch {
    return null
  }
}

function MediaImage(props: ComponentProps<'img'>) {
  const ext = getMediaExt(props.src)
  if (ext && isVideoFileName(ext)) {
    const { alt: _, ...rest } = props
    return MediaVideo(rest as ComponentProps<'video'>)
  }
  if (ext && AUDIO_EXTS.has(ext)) {
    const { alt: _, ...rest } = props
    return MediaAudio(rest as ComponentProps<'audio'>)
  }
  return createElement(MarkdownImage, props)
}

/**
 * Markdown `src` that already names its own transport — leave it alone.
 */
const ABSOLUTE_MEDIA_SRC_RE = /^(?:https?:\/\/|data:|blob:|file:\/\/|local-file:\/\/|remote-media:\/\/)/

/**
 * Fold a src written relative to its containing markdown file into a path
 * relative to the project root, collapsing `.` / `..`.
 *
 * Markdown resolves relative paths against the FILE, not the project root — a
 * `docs/report/x.md` writing `assets/a.png` means `docs/report/assets/a.png`.
 * The chat renderer never needs this (the agent writes cwd-relative paths), but
 * the .md editor does, and skipping it 404s on every image in a subdirectory.
 */
export function rebaseMarkdownSrc(src: string, baseDir: string): string {
  if (!src || !baseDir || ABSOLUTE_MEDIA_SRC_RE.test(src)) return src
  if (src.startsWith('/') || /^[A-Za-z]:[\\/]/.test(src)) return src
  const parts: string[] = []
  for (const segment of `${baseDir}/${src}`.replace(/\\/g, '/').split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..' && parts.length > 0 && parts[parts.length - 1] !== '..') {
      parts.pop()
      continue
    }
    parts.push(segment)
  }
  return parts.join('/')
}

/**
 * Resolve parsed chat media and live document previews without rewriting source.
 */
export function resolveMarkdownMediaSrc(src: string, projectPath: string | null | undefined): string {
  if (!src || !projectPath || ABSOLUTE_MEDIA_SRC_RE.test(src)) return src
  return resolveMediaSrcForProject(src, projectPath)
}

/**
 * Media renderers shared with the .md editor. `MarkdownMedia` dispatches on the
 * file extension (what `![…](…)` needs); the tag-specific two are for raw
 * `<video>` / `<audio>`, where the author's tag beats extension guessing.
 */
export { MediaImage as MarkdownMedia, MediaVideo as MarkdownVideo, MediaAudio as MarkdownAudio }

/** Shared Streamdown code component. */
export const streamdownComponents = {
  code: createStreamdownCodeComponent(codePlugin),
  img: MediaImage,
  video: MediaVideo,
  audio: MediaAudio,
  table: MarkdownTable,
} as unknown as Components

/**
 * The shared media pipeline with the desktop's transports plugged in. Project
 * file links are pre-resolved to absolute filesystem paths by
 * `resolveMarkdownFileLinks` — never via a fake `https://localhost` origin.
 */
export const streamdownRehypePlugins: PluggableList = createMarkdownRehypePlugins({
  srcProtocols: ['local-file', 'remote-media'],
  tagNames: ['video', 'audio', 'source'],
  attributes: {
    video: ['src', 'controls', 'autoPlay', 'loop', 'muted', 'poster', 'width', 'height', 'preload'],
    audio: ['src', 'controls', 'autoPlay', 'loop', 'muted', 'preload'],
    source: ['src', 'type'],
  },
})

/** Shared with Remote Control so both context rings read the same number. */
export { formatTokens } from '@superone/shared/format-tokens'

