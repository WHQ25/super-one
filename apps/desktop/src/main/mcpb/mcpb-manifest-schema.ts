import { z } from 'zod'
import type { McpbManifest } from '@superone/shared/mcpb-types'

const USER_CONFIG_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

const ServerType = z.enum(['node', 'python', 'binary', 'uv'])
const Platform = z.enum(['darwin', 'win32', 'linux'])

const platformOverridesShape = z.object({
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
})

const McpConfig = z.object({
  command: z.string().optional(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  platform_overrides: z.record(Platform, platformOverridesShape).optional(),
})

const UserConfigField = z.object({
  type: z.enum(['string', 'number', 'boolean', 'directory', 'file']),
  title: z.string(),
  description: z.string().optional(),
  required: z.boolean().default(false),
  default: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.string()),
  ]).optional(),
  sensitive: z.boolean().default(false),
  multiple: z.boolean().default(false),
  min: z.number().optional(),
  max: z.number().optional(),
})

const ToolDecl = z.object({
  name: z.string(),
  description: z.string().optional(),
})

const PromptDecl = z.object({
  name: z.string(),
  description: z.string().optional(),
  arguments: z.array(z.string()).default([]),
  text: z.string().optional(),
})

const Author = z.object({
  name: z.string().min(1),
  email: z.string().optional(),
  url: z.string().optional(),
})

const Compatibility = z.object({
  claude_desktop: z.string().optional(),
  platforms: z.array(Platform).optional(),
  runtimes: z.object({
    node: z.string().optional(),
    python: z.string().optional(),
  }).optional(),
})

export const McpbManifestSchema = z.object({
  manifest_version: z.string(),
  name: z.string(),
  display_name: z.string().optional(),
  version: z.string(),
  description: z.string(),
  long_description: z.string().optional(),
  author: Author,
  homepage: z.string().optional(),
  documentation: z.string().optional(),
  support: z.string().optional(),
  repository: z.object({ type: z.string(), url: z.string() }).optional(),
  icon: z.string().optional(),
  license: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  privacy_policies: z.array(z.string()).optional(),

  server: z.object({
    type: ServerType,
    entry_point: z.string(),
    mcp_config: McpConfig,
  }),

  user_config: z.record(z.string().regex(USER_CONFIG_KEY_RE), UserConfigField).default({}),

  tools: z.array(ToolDecl).default([]),
  tools_generated: z.boolean().default(false),
  prompts: z.array(PromptDecl).default([]),
  prompts_generated: z.boolean().default(false),

  compatibility: Compatibility.optional(),
})

export type { McpbManifest } from '@superone/shared/mcpb-types'

export interface McpbManifestParseResult {
  ok: boolean
  manifest?: McpbManifest
  errors: string[]
}

export function parseMcpbManifest(raw: unknown): McpbManifestParseResult {
  const result = McpbManifestSchema.safeParse(raw)
  if (result.success) return { ok: true, manifest: result.data as McpbManifest, errors: [] }
  return {
    ok: false,
    errors: result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
  }
}
