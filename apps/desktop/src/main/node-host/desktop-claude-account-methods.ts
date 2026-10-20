import type { RpcExtensionDispatch, RpcResult } from '@superone/runtime/server'
import { asRecord, mapThrown, requireScopes } from '@superone/runtime/server/rpc-helpers'
import { OPERATION_SCOPES, type AuthScope } from '@superone/shared/environment'
import type { ClaudeAccount } from '@superone/shared/agent-types'

/** This desktop's Claude subscription accounts, as `listAccounts` returns them. */
export type ListClaudeAccounts = (force?: boolean) => Promise<ClaudeAccount[]>

type Handler = (p: Record<string, unknown>) => Promise<unknown>

/**
 * Claude accounts live on the desktop that signed in, not on the controller.
 * A controller listing providers for this node must read them here.
 */
export function createDesktopClaudeAccountMethods(listAccounts: ListClaudeAccounts): { dispatch: RpcExtensionDispatch; methods: ReadonlySet<string> } {
  const handlers: Record<string, { scopes: readonly AuthScope[]; run: Handler }> = {
    'claude.listAccounts': {
      scopes: OPERATION_SCOPES.readEnvironment,
      run: (p) => listAccounts(p.force === true),
    },
  }
  const dispatch: RpcExtensionDispatch = async (method, payload, ctx): Promise<RpcResult | null> => {
    const handler = Object.hasOwn(handlers, method) ? handlers[method] : undefined
    if (!handler) return null
    const denied = requireScopes(ctx.client, handler.scopes)
    if (denied) return denied
    try {
      return { result: await handler.run(asRecord(payload)) }
    } catch (err) {
      return mapThrown(err)
    }
  }
  return { dispatch, methods: new Set(Object.keys(handlers)) }
}
