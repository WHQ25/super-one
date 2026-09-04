import { Extension, Mark, Node } from '@tiptap/core'

/**
 * Every node, mark and attribute the markdown editor understands beyond what
 * StarterKit and TableKit provide. They live together because they are one
 * contract: `markdown-codec.ts` parses into them, `markdown-serialize.ts` writes
 * them back, and `MarkdownEditor` has to register the same set or the preview
 * drops whatever it cannot hold.
 */
export const InlineMathSchema = Node.create({
  name: 'inlineMath',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-latex') ?? el.textContent ?? '',
        renderHTML: (attrs: { latex: string }) => ({ 'data-latex': attrs.latex }),
      },
    }
  },
  parseHTML() { return [{ tag: 'span[data-type="inline-math"]' }] },
  renderHTML({ HTMLAttributes }) { return ['span', { ...HTMLAttributes, 'data-type': 'inline-math' }] },
})

export const BlockMathSchema = Node.create({
  name: 'blockMath',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-latex') ?? el.textContent ?? '',
        renderHTML: (attrs: { latex: string }) => ({ 'data-latex': attrs.latex }),
      },
    }
  },
  parseHTML() { return [{ tag: 'div[data-type="block-math"]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', { ...HTMLAttributes, 'data-type': 'block-math' }] },
})

/** Ordered attribute map of an element, so serialization can replay it verbatim. */
function readAttributes(el: Element): Record<string, string> {
  const out: Record<string, string> = {}
  for (const attr of Array.from(el.attributes)) out[attr.name] = attr.value
  return out
}

/**
 * Markdown images (`![alt](src)`) — also how this app embeds video and audio,
 * which the editor's node view dispatches on by file extension. Without a node
 * in the schema `generateJSON` drops every `<img>`, so the preview rendered
 * nothing *and* the next autosave wrote the image out of the file.
 */
export const ImageSchema = Node.create({
  name: 'image',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return {
      src: { default: '' },
      alt: { default: null },
      title: { default: null },
      // READMEs size inline icons and badges with HTML attributes. Dropping them
      // both flattens the preview (a 16px icon renders at full size) and rewrites
      // the sizing out of the file on the next autosave.
      width: { default: null },
      height: { default: null },
    }
  },
  parseHTML() { return [{ tag: 'img[src]' }] },
  renderHTML({ HTMLAttributes }) { return ['img', HTMLAttributes] },
})

/**
 * Raw `<video>` / `<audio>` written directly in the markdown. Parsed from the
 * DOM rather than from the mdast `html` node because the common single-line
 * form (`<video src="a.mp4"></video>`) is not a CommonMark HTML block — remark
 * splits it into separate open/close inline html nodes, and only the browser's
 * parser puts the element back together.
 *
 * Inline (like `image`) so both spellings round-trip: a tag on its own line is
 * a paragraph holding just this node, and a tag mid-sentence stays mid-sentence.
 * Attributes and `<source>` children are carried verbatim so serialization
 * gives the author's markup back instead of a normalized rewrite.
 */
export const RawMediaSchema = Node.create({
  name: 'rawMedia',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return {
      tag: { default: 'video' },
      attrs: { default: {} },
      sources: { default: [] },
      fallback: { default: null },
    }
  },
  parseHTML() {
    // `<picture>` rides along because it has the same shape — a wrapper whose
    // `<source>` children are the point. Its fallback `<img>` is kept separately
    // so the preview has something concrete to draw.
    return (['video', 'audio', 'picture'] as const).map((tag) => ({
      tag,
      getAttrs: (el: HTMLElement) => {
        const fallback = tag === 'picture' ? el.querySelector('img') : null
        return {
          tag,
          attrs: readAttributes(el),
          sources: Array.from(el.querySelectorAll('source')).map(readAttributes),
          fallback: fallback ? readAttributes(fallback) : null,
        }
      },
    }))
  },
  renderHTML({ node }) {
    const sources = (node.attrs.sources as Array<Record<string, string>>) ?? []
    const fallback = node.attrs.fallback as Record<string, string> | null
    return [
      node.attrs.tag as string,
      { ...((node.attrs.attrs as Record<string, string>) ?? {}) },
      ...sources.map((source) => ['source', source] as const),
      ...(fallback ? [['img', fallback] as const] : []),
    ] as never
  },
})

/**
 * `<kbd>` has no markdown spelling, yet READMEs lean on it for key caps and for
 * the pill rows of a badge wall. Without a mark for it Tiptap keeps the text and
 * throws the element away, so the pills flatten into bare words on the next save.
 */
export const KbdSchema = Mark.create({
  name: 'kbd',
  parseHTML() { return [{ tag: 'kbd' }] },
  renderHTML() { return ['kbd', 0] },
})

const ALIGNMENTS = new Set(['left', 'center', 'right', 'justify'])

/**
 * The `align` attribute is how a README centres its header block — markdown has
 * no syntax for it, so it is always written as HTML. Chromium maps the attribute
 * to `text-align` for exactly these elements, which is why it can be carried
 * verbatim instead of being translated into a style.
 *
 * Read through `closest` so a `<div align="center">` (or a `<center>`) wrapping
 * several paragraphs lands on each of them: the wrapper itself is not in the
 * schema, and losing it would silently un-centre everything inside.
 */
export const BlockAlignSchema = Extension.create({
  name: 'blockAlign',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          align: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const raw = element.closest('[align]')?.getAttribute('align')?.toLowerCase()
              return raw && ALIGNMENTS.has(raw) ? raw : null
            },
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs.align ? { align: attrs.align as string } : {},
          },
        },
      },
    ]
  },
})

/**
 * Inline HTML with no markdown spelling. `<u>` is absent because StarterKit's
 * Underline already claims that tag; the serializer just has to write it back.
 */
const HTML_INLINE_TAGS = ['sub', 'sup', 'ins', 'mark', 'small'] as const

export const HtmlInlineSchemas = HTML_INLINE_TAGS.map((tag) =>
  Mark.create({
    name: tag,
    parseHTML() { return [{ tag }] },
    renderHTML() { return [tag, 0] },
  }),
)

/** `<abbr>` is the one inline tag whose attribute carries the meaning. */
export const AbbrSchema = Mark.create({
  name: 'abbr',
  addAttributes() { return { title: { default: null } } },
  parseHTML() { return [{ tag: 'abbr' }] },
  renderHTML({ HTMLAttributes }) { return ['abbr', HTMLAttributes, 0] },
})

/**
 * GFM task state, carried on the ordinary list item rather than as the separate
 * taskList/taskItem node pair Tiptap ships: remark writes a plain `<ul>` with an
 * `<input type="checkbox">` inside the item, which those nodes do not match, and
 * a list that mixes task and plain items has to stay one list either way.
 *
 * The `<input>` itself is left unmatched on purpose — ProseMirror keeps only its
 * (empty) children, so it disappears from the document and the checkbox state
 * lives in the attribute instead of in editable content.
 */
export const TaskItemSchema = Extension.create({
  name: 'taskItemState',
  addGlobalAttributes() {
    return [
      {
        types: ['listItem'],
        attributes: {
          checked: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const box = element.querySelector(':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]')
              return box ? box.hasAttribute('checked') : null
            },
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs.checked == null ? {} : { 'data-checked': String(attrs.checked) },
          },
        },
      },
    ]
  },
})

/**
 * `<details>`/`<summary>`. The summary is its own node rather than a string
 * attribute so a link or an icon inside it survives — which is most of them.
 */
export const DetailsSummarySchema = Node.create({
  name: 'detailsSummary',
  content: 'inline*',
  defining: true,
  parseHTML() { return [{ tag: 'summary' }] },
  renderHTML() { return ['summary', 0] },
})

export const DetailsSchema = Node.create({
  name: 'details',
  group: 'block',
  content: 'detailsSummary block+',
  defining: true,
  addAttributes() {
    return {
      open: {
        default: false,
        parseHTML: (element: HTMLElement) => element.hasAttribute('open'),
        renderHTML: (attrs: Record<string, unknown>) => (attrs.open ? { open: '' } : {}),
      },
    }
  },
  parseHTML() { return [{ tag: 'details' }] },
  renderHTML({ HTMLAttributes }) { return ['details', HTMLAttributes, 0] },
})

/**
 * Footnotes. remark-gfm hands `mdast-util-to-hast` a footnote reference, which
 * expands it into a superscript anchor and appends a generated "Footnotes"
 * section to the document — text that was never in the file and that the
 * serializer would then write back into it. The handlers in `markdownToHtml`
 * short-circuit that into these two markers instead.
 */
export const FootnoteRefSchema = Node.create({
  name: 'footnoteRef',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return {
      label: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-label') ?? '',
        renderHTML: (attrs: { label: string }) => ({ 'data-label': attrs.label }),
      },
    }
  },
  parseHTML() { return [{ tag: 'span[data-type="footnote-ref"]' }] },
  renderHTML({ HTMLAttributes }) { return ['span', { ...HTMLAttributes, 'data-type': 'footnote-ref' }] },
})

export const FootnoteDefSchema = Node.create({
  name: 'footnoteDef',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      label: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-label') ?? '',
        renderHTML: (attrs: { label: string }) => ({ 'data-label': attrs.label }),
      },
    }
  },
  parseHTML() { return [{ tag: 'div[data-type="footnote-def"]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', { ...HTMLAttributes, 'data-type': 'footnote-def' }] },
})

/**
 * An HTML comment. The DOM parser never offers comment nodes to ProseMirror, so
 * `markdownToHtml` rewrites them into this placeholder first. Worth keeping:
 * comments are where `prettier-ignore`, table-of-contents markers and generated
 * badge regions live, and dropping one silently changes how other tools behave.
 */
export const HtmlCommentSchema = Node.create({
  name: 'htmlComment',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      value: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-value') ?? '',
        renderHTML: (attrs: { value: string }) => ({ 'data-value': attrs.value }),
      },
    }
  },
  parseHTML() { return [{ tag: 'div[data-type="html-comment"]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', { ...HTMLAttributes, 'data-type': 'html-comment' }] },
})

/** A bare `<a name="…">` target — a link mark needs an href, so this is a node. */
export const AnchorSchema = Node.create({
  name: 'anchorTarget',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() { return { name: { default: '' } } },
  parseHTML() { return [{ tag: 'a[name]:not([href])' }] },
  renderHTML({ HTMLAttributes }) { return ['a', HTMLAttributes] },
})

/**
 * Presentation attributes on table cells. A README's feature wall is an HTML
 * table whose whole layout is `width="50%"` — losing it collapses two columns
 * into whatever the content happens to measure.
 */
export const CellAttrsSchema = Extension.create({
  name: 'cellPresentation',
  addGlobalAttributes() {
    return [
      {
        types: ['tableCell', 'tableHeader'],
        attributes: Object.fromEntries(
          ['width', 'valign', 'align'].map((name) => [
            name,
            {
              default: null,
              parseHTML: (element: HTMLElement) => element.getAttribute(name),
              renderHTML: (attrs: Record<string, unknown>) =>
                attrs[name] ? { [name]: attrs[name] as string } : {},
            },
          ]),
        ),
      },
    ]
  },
})

/**
 * Everything the codec understands on top of StarterKit/TableKit. Exported as
 * one list because it has to be registered in three places — here, the editor,
 * and the round-trip test — and a schema the editor does not share is a schema
 * whose content the preview silently drops.
 */
export const htmlSchemas = [
  KbdSchema,
  BlockAlignSchema,
  AbbrSchema,
  ...HtmlInlineSchemas,
  TaskItemSchema,
  DetailsSummarySchema,
  DetailsSchema,
  FootnoteRefSchema,
  FootnoteDefSchema,
  HtmlCommentSchema,
  AnchorSchema,
  CellAttrsSchema,
]
