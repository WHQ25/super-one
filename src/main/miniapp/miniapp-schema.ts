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

const toolDefinitionSchema = z.object({
  name: z.string().min(1).regex(/^[a-z0-9_]+$/, { message: 'Tool name must be lowercase alphanumeric with underscores' }),
  description: z.string().min(1),
  inputSchema: toolInputSchemaSchema,
})

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
  tools: z.array(toolDefinitionSchema).optional(),
})

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
