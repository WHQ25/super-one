import { createContext, useContext } from 'react'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { useEffectiveProjectRoot } from '@/stores/app'
import {
  MarkdownAudio,
  MarkdownMedia,
  MarkdownVideo,
  rebaseMarkdownSrc,
  resolveMarkdownMediaSrc,
} from '@/components/chat/chat-shared'
import { mediaStyleFor } from '@/components/chat/markdown-media-style'
import { ImageSchema, RawMediaSchema } from '../markdown-schemas'

/**
 * Project-relative directory of the markdown file being edited — the base every
 * relative media src resolves against.
 *
 * Context rather than an extension option because the editor instance outlives
 * the file: MarkdownEditor swaps `content` in place instead of remounting, so a
 * value baked in at `useEditor` time would go stale on the next file.
 * Tiptap renders React node views as portals inside `EditorContent`'s own tree,
 * so a provider wrapping it reaches them.
 */
const MediaBaseDirContext = createContext('')

export const MediaBaseDirProvider = MediaBaseDirContext.Provider

/** Project-relative src for display; the node keeps the author's original. */
function useDisplaySrc(src: string): string {
  const projectRoot = useEffectiveProjectRoot()
  const baseDir = useContext(MediaBaseDirContext)
  return resolveMarkdownMediaSrc(rebaseMarkdownSrc(src, baseDir), projectRoot)
}

function MediaImageView({ node }: NodeViewProps) {
  const alt = (node.attrs.alt as string | null) ?? ''
  const displaySrc = useDisplaySrc(String(node.attrs.src ?? ''))
  return (
    <NodeViewWrapper as="span" contentEditable={false} className="markdown-media">
      <MarkdownMedia
        src={displaySrc}
        alt={alt}
        title={(node.attrs.title as string | null) ?? undefined}
        width={(node.attrs.width as string | null) ?? undefined}
        height={(node.attrs.height as string | null) ?? undefined}
      />
    </NodeViewWrapper>
  )
}

/**
 * `<picture>` is left to the browser: its whole point is that the engine picks
 * the best `<source>`, which is how a README shows an animated GIF over a static
 * fallback. Wrapping the `<img>` in the usual lightbox button would break that —
 * `<picture>` requires the `<img>` to be its direct child.
 */
function PictureView({ node }: NodeViewProps) {
  const sources = (node.attrs.sources as Array<Record<string, string>>) ?? []
  const fallback = (node.attrs.fallback as Record<string, string> | null) ?? {}
  const projectRoot = useEffectiveProjectRoot()
  const baseDir = useContext(MediaBaseDirContext)
  const resolve = (src: string | undefined) =>
    src ? resolveMarkdownMediaSrc(rebaseMarkdownSrc(src, baseDir), projectRoot) : undefined
  return (
    <NodeViewWrapper as="span" contentEditable={false} className="markdown-media">
      <picture>
        {sources.map((source, i) => (
          <source key={i} srcSet={resolve(source.srcset)} type={source.type} media={source.media} />
        ))}
        <img
          src={resolve(fallback.src)}
          alt={fallback.alt ?? ''}
          width={fallback.width}
          height={fallback.height}
          style={mediaStyleFor(fallback.width, fallback.height)}
        />
      </picture>
    </NodeViewWrapper>
  )
}

function RawMediaView(props: NodeViewProps) {
  const { node } = props
  const tag = node.attrs.tag as string
  const attrs = (node.attrs.attrs as Record<string, string>) ?? {}
  const sources = (node.attrs.sources as Array<Record<string, string>>) ?? []
  // A `<source>` list is a codec-negotiation hint for a real browser; the
  // preview just plays the first one it was given.
  const rawSrc = attrs.src || sources[0]?.src || ''
  const displaySrc = useDisplaySrc(rawSrc)
  const Media = tag === 'audio' ? MarkdownAudio : MarkdownVideo
  if (tag === 'picture') return <PictureView {...props} />
  return (
    <NodeViewWrapper as="span" contentEditable={false} className="markdown-media">
      {rawSrc ? (
        <Media src={displaySrc} />
      ) : (
        <span className="text-xs text-muted-foreground">{`<${tag}> without a source`}</span>
      )}
    </NodeViewWrapper>
  )
}

/**
 * Editor-side media nodes: the codec's schemas plus live views, so
 * `![…](demo.png)`, `![…](clip.mp4)` and a raw `<video>` render instead of
 * vanishing. Extending the codec nodes keeps one schema — a second declaration
 * would let the round-trip and the preview drift apart.
 */
export const MediaImageNode = ImageSchema.extend({
  draggable: true,
  addNodeView() {
    return ReactNodeViewRenderer(MediaImageView)
  },
})

export const RawMediaNode = RawMediaSchema.extend({
  draggable: true,
  addNodeView() {
    return ReactNodeViewRenderer(RawMediaView)
  },
})
