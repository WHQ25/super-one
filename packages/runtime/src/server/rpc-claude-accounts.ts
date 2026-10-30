import type { ClaudeAccount } from '@superone/shared/agent-types'
import { OPERATION_SCOPES, type AuthScope } from '@superone/shared/environment'
import type { RpcContext, RpcResult } from './rpc-context'
import { asRecord, mapThrown, requireScopes } from './rpc-helpers'

/** Accounts on the host that signed in, as `listAccounts` returns them. */
export type ListClaudeAccounts = (force?: boolean) => Promise<ClaudeAccount[]>

type Handler = (p: Record<string, unknown>) => Promise<unknown>

/** The lister only checks the caller's scopes. Hosts pass their own RPC context. */
type AccountRpcContext = Pick<RpcContext, 'client'>

/**
 * Claude accounts live on the host that signed in, not on the controller.
 * Desktop and the CLI node serve the same method with their own lister.
 */
export function createClaudeAccountMethods(listAccounts: ListClaudeAccounts): {
  dispatch: (method: string, payload: unknown, ctx: AccountRpcContext) => Promise<RpcResult | null>
  methods: ReadonlySet<string>
} {
  const handlers: Record<string, { scopes: readonly AuthScope[]; run: Handler }> = {
    'claude.listAccounts': {
      scopes: OPERATION_SCOPES.readEnvironment,
      run: (p) => listAccounts(p.force === true),
    },
  }
  const dispatch = async (method: string, payload: unknown, ctx: AccountRpcContext): Promise<RpcResult | null> => {
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
