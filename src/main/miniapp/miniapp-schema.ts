import { z } from 'zod'

const APP_ID_RE = /^[a-z0-9][a-z0-9_-]*$/

const authorSchema = z.object({
  name: z.string().min(1),
  email: z.email().optional(),
  url: z.url().optional(),
})

const fsEntrySchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('project'), path: z.string().min(1), access: z.enum(['read', 'readwrite']), reason: z.string().min(1) }),
  z.object({ scope: z.literal('user'), path: z.string().min(1), access: z.enum(['read', 'readwrite']), reason: z.string().min(1) }),
  z.object({ scope: z.literal('app'), reason: z.string().min(1) }),
])

const networkEntrySchema = z.object({
  domain: z.string().min(1),
  reason: z.string().min(1),
})

const permissionsSchema = z.object({
  network: z.array(networkEntrySchema).optional(),
  fs: z.array(fsEntrySchema).optional(),
})

const toolInputSchemaSchema = z.looseObject({
  type: z.literal('object'),
  properties: z.record(z.string(), z.unknown()).optional(),
  required: z.array(z.string()).optional(),
})

const interceptRendererSchema = z.object({
  template: z.string().min(1),
  inputMerge: z.enum(['shallow-merge', 'replace']).default('shallow-merge'),
  onCancel: z.enum(['reject', 'resolve-empty']).default('reject'),
  timeoutMs: z.number().int().nonnegative().optional(),
})

const resultRendererSchema = z.object({
  template: z.string().min(1),
  autoExpand: z.boolean().default(false),
})

const toolRendererSchema = z.object({
  intercept: interceptRendererSchema.optional(),
  result: resultRendererSchema.optional(),
})

const toolDefinitionSchema = z.object({
  name: z.string().min(1).regex(/^[a-z0-9_]+$/, { message: 'Tool name must be lowercase alphanumeric with underscores' }),
  description: z.string().min(1),
  displayName: z.string().optional(),
  runningText: z.string().optional(),
  inputSummaryField: z.string().optional(),
  resultSummaryField: z.string().optional(),
  showResult: z.boolean().optional(),
  groupable: z.boolean().optional(),
  inputSchema: toolInputSchemaSchema,
  renderer: toolRendererSchema.optional(),
})

const TOOL_NAME_RE = /^[a-z0-9_]+$/

export const manifestSchema = z.object({
  appId: z.string().min(1).regex(APP_ID_RE, { message: 'appId must be lowercase alphanumeric, hyphens, or underscores' }),
  name: z.string().min(1),
  version: z.string().optional(),
  author: authorSchema.optional(),
  description: z.string().optional(),
  logo: z.string().optional(),
  isDev: z.boolean().optional(),
  type: z.enum(['sidebar', 'panel', 'in-chat', 'fullscreen']).optional(),
  permissions: permissionsSchema.optional(),
  toolSlug: z.string().min(1).regex(TOOL_NAME_RE, { message: 'toolSlug must be lowercase alphanumeric with underscores' }).optional(),
  tools: z.array(toolDefinitionSchema).optional(),
  inChatToolName: z.string().min(1).regex(TOOL_NAME_RE, { message: 'toolName must be lowercase alphanumeric with underscores' }).optional(),
  inChatToolDescription: z.string().optional(),
  runningText: z.string().optional(),
  inputSchema: toolInputSchemaSchema.optional(),
  templates: z.record(
    z.string().min(1).regex(/^[a-z0-9_-]+$/, { message: 'Template name must be lowercase alphanumeric with hyphens or underscores' }),
    z.string().min(1),
  ).optional(),
}).refine(
  (m) => {
    if (m.type !== 'in-chat') return true
    return !!m.inChatToolName && !!m.inputSchema
  },
  { message: 'in-chat apps require toolName and inputSchema' },
).refine(
  (m) => {
    if (m.type !== 'in-chat') return true
    return !m.tools || m.tools.length === 0
  },
  { message: 'in-chat apps must not declare tools[]' },
).refine(
  (m) => {
    if (m.type === 'in-chat' || !m.tools || m.tools.length === 0) return true
    return !!m.toolSlug
  },
  { message: 'apps with tools require toolSlug' },
).refine(
  (m) => {
    if (!m.tools) return true
    for (const t of m.tools) {
      const tpl = t.renderer?.intercept?.template
      if (tpl && !(m.templates && tpl in m.templates)) return false
    }
    return true
  },
  { message: 'renderer.intercept.template must reference a key in manifest.templates' },
).refine(
  (m) => {
    if (!m.tools) return true
    for (const t of m.tools) {
      const tpl = t.renderer?.result?.template
      if (tpl && !(m.templates && tpl in m.templates)) return false
    }
    return true
  },
  { message: 'renderer.result.template must reference a key in manifest.templates' },
)

export type ManifestParseResult =
  | { ok: true; manifest: z.infer<typeof manifestSchema> }
  | { ok: false; errors: string[] }

export function parseManifest(raw: unknown): ManifestParseResult {
  const result = manifestSchema.safeParse(raw)
  if (result.success) {
    return { ok: true, manifest: result.data }
  }
  const errors = result.error.issues.map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  )
  return { ok: false, errors }
}
