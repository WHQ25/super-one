import { dispatchResourceRpc, RESOURCE_RPC_METHODS, type ResourceHost } from '@superone/runtime/server/rpc-resources'
import type { DesktopExtension } from './desktop-domain'

/**
 * The resource families a CLI node serves (`skills.*`, `mcp.*`, `plugins.*`,
 * `agents.*`, `hooks.*`) over the files this desktop's window manages, with
 * the follow-ups its window applies after the same change. Recency stays
 * with the window's own project opens.
 */
export function createDesktopResourceMethods(host: ResourceHost): DesktopExtension {
  return {
    dispatch: (method, payload, ctx) => dispatchResourceRpc(method, payload, {
      ...host,
      client: ctx.client,
      projects: { get: (projectId) => ctx.projects?.get(projectId) ?? null },
    }),
    methods: RESOURCE_RPC_METHODS,
  }
}
