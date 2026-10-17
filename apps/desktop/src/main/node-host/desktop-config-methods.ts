import { isAgentProfilesEnabled } from '../session/agent-profile-feature'
import type { ProjectsPort, RpcExtensionDispatch } from '@superone/runtime/server'
import { AUTOMATION_RPC_METHODS, dispatchAutomationRpc, type AutomationRpcContext } from '@superone/runtime/server/rpc-automations'
import { dispatchSessionProviderRpc, SESSION_PROVIDER_RPC_METHODS } from '@superone/runtime/server/rpc-session-providers'
import type { SessionProviderStore } from '@superone/runtime/session'
import { redactedSessionProviderStore } from './desktop-session-providers'

/** This desktop's configuration stores, as its window keeps them. */
export interface DesktopConfig {
  /** The session provider profiles the window's settings edit. */
  sessionProviders: SessionProviderStore
  /** The automations the window's sidebar lists and the scheduler that runs them (`desktop-automations-port.ts`). */
  automations: Pick<AutomationRpcContext, 'automations' | 'automationService'>
}

/**
 * The CLI node's `sessionProviders.*` and `automation.*` families over this
 * desktop's own stores, so every client edits what the window edits. Profile
 * secrets stay on this desktop (`desktop-session-providers.ts`).
 */
export function createDesktopConfigMethods(config: DesktopConfig, projects: ProjectsPort): { dispatch: RpcExtensionDispatch; methods: ReadonlySet<string> } {
  const sessionProviders = redactedSessionProviderStore(config.sessionProviders)
  return {
    dispatch: async (method, payload, ctx) =>
      dispatchSessionProviderRpc(method, payload, { client: ctx.client, sessionProviders, agentProfilesEnabled: isAgentProfilesEnabled })
      ?? await dispatchAutomationRpc(method, payload, { client: ctx.client, projects, ...config.automations }),
    methods: new Set([...SESSION_PROVIDER_RPC_METHODS, ...AUTOMATION_RPC_METHODS]),
  }
}
