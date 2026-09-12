import type { Definition, Image, Root } from 'mdast'
import { visit } from 'unist-util-visit'
import { defaultRehypePlugins } from 'streamdown'
import { harden, BlockPolicy } from 'rehype-harden'
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from 'rehype-sanitize'
import type { PluggableList } from 'unified'

/**
 * The markdown media pipeline both chat surfaces share.
 *
 * A `![…](path)` in a transcript names a file on the desktop (or the remote
 * node behind it), which the `img` element cannot load by itself. Each surface
 * rewrites the destination onto its own transport — the desktop's
 * `local-file:` / `remote-media:`, the phone's `host-file:` — and that
 * transport has to survive the rehype pipeline: Streamdown's sanitize step
 * only lets `http`/`https` through on `img src`, and harden replaces a bare
 * relative path with an "[Image blocked]" stub. This module owns the
 * plumbing so the two surfaces cannot drift: the rewrite visitor and the
 * sanitize/harden configuration, parameterised only by the transport.
 *
 * `data:` is deliberately *not* let through on either surface. Nothing in the
 * product writes a data URI into markdown — the agent cites files by path and
 * generated images travel as structured items — so allowing it would only
 * widen the sanitize surface.
 */

/** A destination that already names its transport — never re-resolved or decoded. */
const QUALIFIED_SRC_RE = /^(?:[a-z][a-z\d+.-]*:\/\/|data:|blob:)/i

/**
 * Rewrite parsed image destinations — never markdown source, which may be a
 * code example. Reference-style images resolve through their definition.
 * Destinations are URLs, so `screen%20one.png` is decoded once before the
 * surface turns it into a transport URL; qualified ones pass verbatim.
 */
export function remarkImageDestinations(resolve: (path: string) => string) {
  return () => (tree: Root) => {
    const imageReferences = new Set<string>()
    visit(tree, 'imageReference', (node) => { imageReferences.add(node.identifier) })
    visit(tree, (node) => {
      if (node.type !== 'image' && !(node.type === 'definition' && imageReferences.has(node.identifier))) return
      const media = node as Image | Definition
      let src = media.url
      if (!src) return
      if (!QUALIFIED_SRC_RE.test(src)) {
        try { src = decodeURIComponent(src) } catch { /* literal percent in a file name */ }
      }
      media.url = resolve(src)
    })
  }
}

/**
 * Harden config shared by both surfaces. Any link prefix and protocol is
 * allowed because a link never navigates on its own here — the desktop
 * prompts through `LinkSafetyModal`, the phone routes through `openLink` —
 * and a project file citation (`src/a.ts:42`) would otherwise read as an
 * unknown scheme and be stubbed out before the file chip could render.
 * Without `defaultOrigin`, relative URLs stay as written.
 */
const HARDEN_OPTIONS = {
  allowedLinkPrefixes: ['*'],
  allowedImagePrefixes: ['*'],
  allowedProtocols: ['*'],
  linkBlockPolicy: BlockPolicy.textOnly,
}

export interface MarkdownMediaSchemaOptions {
  /** The surface's own media transport(s), added to the `src` protocol allowlist. */
  srcProtocols: string[]
  /** Extra elements the surface renders (e.g. `video`), on top of the default set. */
  tagNames?: string[]
  /** Attribute allowlists for those extra elements. */
  attributes?: NonNullable<SanitizeSchema['attributes']>
}

/**
 * Streamdown's default rehype list with sanitize and harden replaced by the
 * shared configuration, widened for the surface's media transport.
 */
export function createMarkdownRehypePlugins({ srcProtocols, tagNames = [], attributes = {} }: MarkdownMediaSchemaOptions): PluggableList {
  const schema: SanitizeSchema = {
    ...defaultSchema,
    tagNames: [...(defaultSchema.tagNames ?? []), ...tagNames],
    attributes: { ...defaultSchema.attributes, ...attributes },
    protocols: {
      ...defaultSchema.protocols,
      src: [...(defaultSchema.protocols?.src ?? []), ...srcProtocols],
    },
  }
  return Object.values({
    ...defaultRehypePlugins,
    sanitize: [rehypeSanitize, schema],
    harden: [harden, HARDEN_OPTIONS],
  }) as PluggableList
}
