import { Context } from '@deepseek-ai/cordis'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import * as LlmDeepseek from '@deepseek-ai/dsh-llm-deepseek'
import type { DeepSeekCatalogModel } from '@deepseek-ai/dsh-llm-deepseek'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as CheckpointPolicy from '@deepseek-ai/dsh-session-checkpoint-policy'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as SubagentSpawnInProcess from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as SubagentForkInProcess from '@deepseek-ai/dsh-subagent-fork-in-process'
import * as ToolSubagent from '@deepseek-ai/dsh-tool-subagent'
import DynamicCordisRunner from '@deepseek-ai/dsh-cordis-host-runner'
import * as ToolCordis from '@deepseek-ai/dsh-tool-cordis'
import PermissionPresets from '@deepseek-ai/dsh-permission-presets'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic'
import ToolResultPruner from '@deepseek-ai/dsh-compaction-tool-result-pruner'
import { createCredentialPlugin, type CredentialLookup } from './credentials'
import { DEFAULT_DSH_PERMISSION_PRESET, DSH_PERMISSION_PRESETS } from './permission-presets'
import { mountHostToolPlane } from './tool-plane'

export interface DeepseekTreeOptions {
  /**
   * Extra persona text appended to the dsh system prompt. The harness identity
   * opener stays on (decision: docs/draft/deepseek-harness-integration.md §12.1).
   */
  persona?: string
  /** JSONL session-log root; omit to run without durable persistence (tests). */
  persistenceRoot?: string
  /**
   * Serve dsh credential references from SuperOne's credential store instead of
   * `dsh-credentials-local` or the process environment (D7).
   */
  credentialLookup?: CredentialLookup
  /**
   * Mount the official DeepSeek adapter at boot. Omit and call
   * `DeepseekRuntime.configureProvider()` later to mount or re-mount it when
   * the user's credential or model selection changes.
   */
  deepseekAdapter?: DeepseekAdapterOptions
  /**
   * Let the model rewrite this process's own plugin tree (`dsh-tool-cordis`).
   * Off unless the user opted in; see `toolCordisPlugin`.
   */
  toolCordis?: boolean
}

/** A mounted plugin subtree that can be taken back out. */
export interface DisposableFiber {
  dispose(): Promise<void>
}

/**
 * Mount the self-referential toolset: five tools that let the model inspect,
 * define, run and stop plugins **inside the running dsh process**.
 *
 * Behind a user opt-in (`AppSettings.dshToolCordis`, default off) for two
 * reasons its own README states plainly. Its sandbox "is not a security
 * boundary" — "treat this toolset like bash access" — and a dynamic package
 * lives in shared process memory, so it "may affect other sessions in that
 * process". Neither fits SuperOne's per-tool permission model: the gate can
 * refuse `cordis_run`, but it cannot scope what a package does once running.
 *
 * Both rows travel together: the runner (`ctx.dynamicCordisRunner`) owns the vm
 * and the package registry, and the toolset alone never activates without it.
 * Mounted on the host plane like every other model-facing row, and reversible —
 * turning the setting off withdraws the tools from the next request's schema.
 */
export async function mountToolCordis(ctx: Context): Promise<DisposableFiber> {
  // Awaited, not fired: the toolset injects the runner's service, so an
  // unawaited pair leaves the tools dormant and the registry unchanged —
  // indistinguishable from the switch not working.
  const runner = await ctx.plugin(DynamicCordisRunner, {}) as DisposableFiber
  // The toolset takes no config at all — its vm and broadcast bounds live on
  // the runner, which is why only that row is configurable.
  const tools = await ctx.plugin(ToolCordis) as DisposableFiber
  return {
    async dispose() {
      // Tools first: the runner is what they inject, and unmounting a service
      // out from under a live consumer is the noisier of the two orders.
      await tools.dispose()
      await runner.dispose()
    },
  }
}

export interface DeepseekAdapterOptions {
  models: readonly DeepSeekCatalogModel[]
  thinking?: 'enabled' | 'disabled'
  /** Credential reference name resolved through the credential seam per request. */
  apiKeyEnv?: string
  baseURL?: string
}

/** Build the adapter plugin row so boot and later re-mounts stay identical. */
export function deepseekAdapterPlugin(options: DeepseekAdapterOptions): {
  plugin: typeof LlmDeepseek
  config: Record<string, unknown>
} {
  return {
    plugin: LlmDeepseek,
    config: {
      thinking: options.thinking ?? 'enabled',
      models: options.models,
      ...(options.apiKeyEnv !== undefined ? { apiKeyEnv: options.apiKeyEnv } : {}),
      ...(options.baseURL !== undefined ? { baseURL: options.baseURL } : {}),
    },
  }
}

/**
 * Compose the embedded dsh spine with plain `ctx.plugin(...)` calls — no YAML
 * profiles, no bundles, no $DSH_HOME (design D3). The Loader *service* is
 * mounted anyway, for the one thing D3 did not anticipate: rows that have to
 * change while the tree runs (third-party MCP). Its file-backed half
 * (`cordis-plugin-include`) and its hot-reload half (`cordis-plugin-hmr`) stay
 * out. The returned context is the root the bridge plugin mounts on; callers
 * dispose it via `root.stop()` semantics owned by DeepseekRuntime.
 */
export async function createDeepseekTree(options: DeepseekTreeOptions): Promise<Context> {
  const ctx = new Context()
  ctx.plugin(Timer)
  // The runtime entry tree. dsh's own CLI drives composition through this
  // service; we mount it without `cordis-plugin-include` (no YAML) and without
  // `cordis-plugin-hmr` (that one needs Node ESM internals through a native
  // addon). What is left is exactly the part we want: create/update/remove a
  // plugin row while the tree is running. Its `write()` is a no-op — nothing
  // this loader holds is ever persisted to disk.
  ctx.plugin(Loader, { baseUrl: import.meta.url })
  ctx.plugin(LlmRuntime)
  ctx.plugin(SessionStore)
  ctx.plugin(SystemPrompt, {
    includeHarnessIdentity: true,
    includeRuntimeContext: true,
    persona: options.persona ?? '',
  })
  ctx.plugin(ToolRuntime, {})
  ctx.plugin(AgentRegistry)
  ctx.plugin(ApprovalService, { policy: 'ask' })
  ctx.plugin(AgentLoop, { agents: [] })

  // dsh's executors and its model-facing file/search/shell/todo rows, on the
  // host plane so delegated children inherit them (see `mountHostToolPlane`).
  await mountHostToolPlane(ctx)

  // Delegation. `subagents` is the provider registry; `spawn` creates a fresh
  // child Agent in this process and `fork` seeds one with the parent's
  // completed turns. Each provider needs its own `tool-subagent` instance —
  // one instance binds one provider to one tool name, and the tool's own
  // description is derived from `provider.inheritsParentContext`, so the model
  // is told which of the two it is choosing.
  //
  // Foreground only: the background route registers a parent-owned Task whose
  // status/collection/kill tools are a separate surface SuperOne does not
  // render, so exposing `run_in_background` would let the model start work the
  // user can neither see nor stop.
  ctx.plugin(SubagentRuntime)
  ctx.plugin(SubagentSpawnInProcess, { providerName: 'spawn' })
  ctx.plugin(SubagentForkInProcess, { providerName: 'fork' })
  ctx.plugin(ToolSubagent, {
    provider: 'spawn',
    toolName: 'subagent',
    enableRunInBackground: false,
    maxDepth: 3,
  })
  ctx.plugin(ToolSubagent, {
    provider: 'fork',
    toolName: 'subagent_fork',
    enableRunInBackground: false,
    maxDepth: 3,
  })

  // The user-facing permission vocabulary. Each preset bundles the two knobs
  // dsh actually enforces — the sandbox mode and whether approvals are asked —
  // and the service pins them into each session at creation, so a later default
  // change never rewrites a running conversation. It hard-requires a CONFINING
  // `ctx.shell`, which is why it lands with the sandbox tier and not before.
  //
  // Its two optional children stay out: the `/permissionPresets` command
  // (SuperOne owns slash) and the `permissions` projection unit (nothing reads
  // it yet). Both activate only when their registry is composed, so not
  // mounting `commands` / `sessionProjections` is the whole exclusion.
  ctx.plugin(PermissionPresets, {
    presets: DSH_PERMISSION_PRESETS,
    defaultPreset: DEFAULT_DSH_PERMISSION_PRESET,
  })

  // Compaction. `token-meter` prices the live request envelope; the basic
  // engine reads that pressure, prunes oversized tool results first, then
  // summarizes the oldest balanced span through a direct `llm.stream()` call.
  //
  // `auto` stays on (its default): the step-boundary pressure listener and the
  // provider-overflow recovery path are the whole reason a long dsh session
  // survives, and a harness that only compacts when asked is one that dies at
  // the context wall. `dsh-command-compact` is NOT mounted — SuperOne owns the
  // slash surface, so `/compact` reaches `ctx.compaction.compactNow()` through
  // the backend instead.
  ctx.plugin(TokenMeter)
  ctx.plugin(ToolResultPruner, {})
  ctx.plugin(BasicCompactionEngine, {})

  if (options.credentialLookup) {
    ctx.plugin(createCredentialPlugin(options.credentialLookup))
  }

  if (options.deepseekAdapter) {
    const { plugin, config } = deepseekAdapterPlugin(options.deepseekAdapter)
    ctx.plugin(plugin, config)
  }

  if (options.persistenceRoot) {
    ctx.plugin(JsonlSessionPersistence, { root: options.persistenceRoot })
    ctx.plugin(CheckpointPolicy)
  }

  return ctx
}
