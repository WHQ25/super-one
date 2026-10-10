import { MOD_UI_MUTATING_OPS, type ModUiOp } from '../mod-ui'
import { MCP_APP_WRITE_OPERATIONS } from './mcp-apps-rpc'

/**
 * Node RPC methods that change state. The node requires an idempotency key for
 * each and dedupes retries by it; the desktop client sends one for exactly
 * these, so both sides read this one list.
 */
const NODE_MUTATING_METHODS: ReadonlySet<string> = new Set([
  'terminal.create',
  'terminal.write',
  'terminal.resize',
  'terminal.kill',
  'project.open',
  'project.update',
  'project.remove',
  'workspace.writeFile',
  'workspace.rename',
  'workspace.move',
  'workspace.delete',
  'workspace.mkdir',
  'workspace.watchStart',
  'workspace.watchStop',
  'workspace.tailWatchStart',
  'workspace.tailWatchStop',
  'git.clone',
  'git.fetch',
  'git.switchBranch',
  'git.createBranch',
  'git.worktreeActivate',
  'git.worktreeAssignBranch',
  'git.worktreeHandoff',
  'session.create',
  'session.setCwd',
  'session.patchSettings',
  'session.fork',
  'session.send',
  'session.interrupt',
  'session.respondPermission',
  'session.respondQuestion',
  'session.respondPlan',
  'session.recap',
  'session.setGoal',
  'session.dequeue',
  'session.steer',
  'session.answerAsyncQuestion',
  'composer.open',
  'composer.openInputRequest',
  'composer.cancel',
  'composer.outcome', // claims an uncollected result once
  'files.mkdir',
  'files.upload',
  'files.uploadComplete',
  'widget.saveTemplate',
  'git.setDefaultClonePath',
  'client.mintNodeCode',
  'client.pairNode',
  'client.markSeen',
  'client.appendLog',
  'draft.upsert',
  'draft.open',
  'draft.close',
  'draft.delete',
  'session.claimHostAction',
  'session.respondHostAction',
  'harness.probe',
  'session.acquireControl',
  'session.renewControl',
  'session.releaseControl',
  'session.close',
  'session.remove',
  'session.rename',
  'session.setTags',
  'session.setUiFlags', // pin/hide
  'session.setArchived',
  'terminal.acquireControl',
  'terminal.renewControl',
  'terminal.releaseControl',
  'collaboration.request',
  'collaboration.start',
  'collaboration.send',
  'provider.createCredential',
  'provider.updateCredential',
  'provider.deleteCredential',
  'provider.setBinding',
  'provider.clearBinding',
  'provider.upsertCustomPlatform',
  'provider.deleteCustomPlatform',
  'provider.importBundle',
  'settings.patch',
  // Skills, MCP, plugins, hooks
  'skills.delete',
  'skills.install',
  'mcp.save',
  'mcp.toggle',
  'mcp.delete',
  'plugins.delete',
  'plugins.setEnabled',
  'plugins.install',
  'plugins.update',
  'plugins.addMarketplace',
  'plugins.removeMarketplace',
  'plugins.updateMarketplace',
  'hooks.save',
  'hooks.delete',
  'automation.create',
  'automation.update',
  'automation.delete',
  'automation.runNow',
  'sessionProviders.create',
  'sessionProviders.update',
  'sessionProviders.delete',
  'codex.setDefaultAccount',
  'codex.setAuth',
  'codex.accountLoginStart',
  'codex.accountLoginCancel',
  'codex.accountLogout',
  'codex.consumeRateLimitReset',
  'codex.loginMcpOauth',
  'codex.importExternalAgent',
  'codex.plugins.install',
  'codex.plugins.uninstall',
  'codex.marketplace.add',
  'codex.marketplace.remove',
  'codex.marketplace.upgrade',
])

/**
 * Whether a call needs an idempotency key. `session.modUi` is mostly reads
 * (render, ask, attach); only its mutating ops (a press, a scroll) are keyed,
 * so a transport retry cannot run one twice.
 */
export function isNodeMutatingCall(method: string, payload: unknown): boolean {
  if (method === 'mcpApps.request') {
    const operation = (payload as { request?: { operation?: unknown } } | null)?.request?.operation
    return typeof operation === 'string' && MCP_APP_WRITE_OPERATIONS.has(operation)
  }
  if (method === 'session.modUi') {
    const op = (payload as { op?: unknown } | null)?.op
    return typeof op === 'string' && MOD_UI_MUTATING_OPS.has(op as ModUiOp)
  }
  return NODE_MUTATING_METHODS.has(method)
}
