import type { PermissionRuleset } from '@opencode-ai/sdk/v2'
import type { OpenCodeV2Client, OpenCodeV2ClientOptions } from './opencode-v2-client'
import type { OpenCodeV2McpConfig } from './opencode-v2-types'
import type { OpenCodeMcpRegistrar } from './runtime-types'
import type { openCodeAttachmentTurn } from './runtime-helpers'
import type { OAuthBrowserContext } from './opencode-oauth'

/** Host-owned config, authorization and browser actions stay outside the native runtime. */
export interface NativeRuntimePorts {
  assertOAuthControl?: () => void
  attachmentTurn?: typeof openCodeAttachmentTurn
  createClient?: (options: OpenCodeV2ClientOptions) => OpenCodeV2Client
  buildOpenCodeHostPermissionRules(): PermissionRuleset
  reconcileOpenCodePermissions(existing?: PermissionRuleset): PermissionRuleset
  syncMcpServers(
    registrar: OpenCodeMcpRegistrar<OpenCodeV2McpConfig>,
    cwd: string,
    sessionId: string,
    previous: Set<string>,
  ): Promise<Set<string>>
  openUrl(url: string, context: OAuthBrowserContext): Promise<void>
}
