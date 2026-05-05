import type { ResourceScope } from './agent-types'

export type McpbServerType = 'node' | 'python' | 'binary' | 'uv'
export type McpbPlatform = 'darwin' | 'win32' | 'linux'

export interface McpbAuthor {
  name: string
  email?: string
  url?: string
}

export interface McpbUserConfigField {
  type: 'string' | 'number' | 'boolean' | 'directory' | 'file'
  title: string
  description?: string
  required: boolean
  default?: string | number | boolean | string[]
  sensitive: boolean
  multiple: boolean
  min?: number
  max?: number
}

export interface McpbToolDecl {
  name: string
  description?: string
}

export interface McpbPromptDecl {
  name: string
  description?: string
  arguments: string[]
  text?: string
}

export interface McpbMcpConfig {
  command?: string
  args: string[]
  env: Record<string, string>
  platform_overrides?: Partial<Record<McpbPlatform, {
    command?: string
    args?: string[]
    env?: Record<string, string>
  }>>
}

export interface McpbCompatibility {
  claude_desktop?: string
  platforms?: McpbPlatform[]
  runtimes?: { node?: string; python?: string }
}

export interface McpbManifest {
  manifest_version: string
  name: string
  display_name?: string
  version: string
  description: string
  long_description?: string
  author: McpbAuthor
  homepage?: string
  documentation?: string
  support?: string
  repository?: { type: string; url: string }
  icon?: string
  license?: string
  keywords?: string[]
  privacy_policies?: string[]
  server: {
    type: McpbServerType
    entry_point: string
    mcp_config: McpbMcpConfig
  }
  user_config: Record<string, McpbUserConfigField>
  tools: McpbToolDecl[]
  tools_generated: boolean
  prompts: McpbPromptDecl[]
  prompts_generated: boolean
  compatibility?: McpbCompatibility
}

export type McpbUserConfigValues = Record<string, string | number | boolean | string[]>

export interface McpbRuntimeAvailability {
  ok: boolean
  type: McpbServerType
  missing?: 'python' | 'uv' | 'binary'
  hint?: string
  detectedPath?: string
}

export type McpbProvider = 'claude' | 'codex'

export interface McpbInstallMeta {
  name: string
  version: string
  installedAt: string
  provider: McpbProvider
  scope: ResourceScope
  cwd?: string
  manifestHash: string
  userConfigPlain: McpbUserConfigValues
  userConfigSensitiveKeys: string[]
}

export interface McpbPreview {
  manifest: McpbManifest
  manifestHash: string
  iconDataUrl?: string
  warnings: string[]
  runtime: McpbRuntimeAvailability
  conflictsWith?: { name: string; existingVersion: string; sameVersion: boolean }
  platformSupported: boolean
}

export interface McpbInstallRequest {
  filePath: string
  provider: McpbProvider
  scope: ResourceScope
  cwd?: string
  userConfig: McpbUserConfigValues
  expectedManifestHash: string
}

export interface McpbInstalledEntry {
  meta: McpbInstallMeta
  installDir: string
  iconDataUrl?: string
}
