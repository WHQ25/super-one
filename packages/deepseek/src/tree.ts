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
import * as ToolSubagent from '@deepseek-ai/dsh-tool-subagent'
import { createCredentialPlugin, type CredentialLookup } from './credentials'
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

  // Delegation. `subagents` is the provider registry, `spawn` creates a fresh
  // child Agent in this process, and `tool-subagent` is the one model-facing
  // row over it. Foreground only for now: the background route registers a
  // parent-owned Task whose status/collection/kill tools are a separate surface
  // SuperOne does not render yet, so exposing `run_in_background` would let the
  // model start work the user cannot see or stop.
  ctx.plugin(SubagentRuntime)
  ctx.plugin(SubagentSpawnInProcess, { providerName: 'spawn' })
  ctx.plugin(ToolSubagent, {
    provider: 'spawn',
    toolName: 'subagent',
    enableRunInBackground: false,
    maxDepth: 3,
  })

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
