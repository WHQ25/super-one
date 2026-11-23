import { getSchema, type JSONContent } from '@tiptap/core'
import { generateJSON } from '@tiptap/html'
import { DOMParser as PMDOMParser, type Node as ProseMirrorNode, type Schema } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { TableKit } from '@tiptap/extension-table'
import { common, createLowlight } from 'lowlight'
import { splitFrontmatter } from '@superone/shared/markdown-frontmatter'
import { frontmatterToHtml, markdownToHtml } from './markdown-html'
import { BlockMathSchema, htmlSchemas, ImageSchema, InlineMathSchema, RawMediaSchema } from './markdown-schemas'

let sharedLowlight: ReturnType<typeof createLowlight> | null = null
let cachedCodecExtensions: ReturnType<typeof buildCodecExtensions> | null = null
let cachedCodecSchema: Schema | null = null
const parserBySchema = new WeakMap<Schema, PMDOMParser>()

export function getMarkdownLowlight() {
  if (!sharedLowlight) {
    sharedLowlight = createLowlight(common)
  }
  return sharedLowlight
}

function buildCodecExtensions() {
  return [
    StarterKit.configure({ codeBlock: false }),
    CodeBlockLowlight.configure({ lowlight: getMarkdownLowlight(), defaultLanguage: 'plaintext' }),
    TableKit,
    InlineMathSchema,
    BlockMathSchema,
    ImageSchema,
    RawMediaSchema,
    ...htmlSchemas,
  ]
}

function getCodecExtensions() {
  if (!cachedCodecExtensions) {
    cachedCodecExtensions = buildCodecExtensions()
  }
  return cachedCodecExtensions
}

function getCodecSchema(): Schema {
  if (!cachedCodecSchema) {
    cachedCodecSchema = getSchema(getCodecExtensions())
  }
  return cachedCodecSchema
}

function getParser(schema: Schema): PMDOMParser {
  let parser = parserBySchema.get(schema)
  if (!parser) {
    parser = PMDOMParser.fromSchema(schema)
    parserBySchema.set(schema, parser)
  }
  return parser
}

export function htmlToProseMirrorDoc(html: string, schema: Schema): ProseMirrorNode {
  const safeHtml = html || '<p></p>'
  const parsed = new DOMParser().parseFromString(`<body>${safeHtml}</body>`, 'text/html')
  return getParser(schema).parse(parsed.body)
}

export async function markdownToDoc(source: string): Promise<JSONContent> {
  const { frontmatter, body } = splitFrontmatter(source)
  const bodyHtml = body.trim() ? await markdownToHtml(body) : ''
  const fmHtml = frontmatter !== null ? frontmatterToHtml(frontmatter) : ''
  const html = fmHtml + bodyHtml || '<p></p>'
  if (typeof DOMParser === 'undefined') {
    return generateJSON(html, getCodecExtensions())
  }
  return htmlToProseMirrorDoc(html, getCodecSchema()).toJSON() as JSONContent
}
