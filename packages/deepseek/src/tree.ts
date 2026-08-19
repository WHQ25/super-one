import { Context } from '@deepseek-ai/cordis'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Group from '@deepseek-ai/cordis-plugin-group'
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
import DynamicCordisRunner from '@deepseek-ai/dsh-cordis-host-runner'
import PermissionPresets from '@deepseek-ai/dsh-permission-presets'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import GoalService from '@deepseek-ai/dsh-goal'
import * as GoalRoundDriver from '@deepseek-ai/dsh-goal-round-driver'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as DeepSeekWebSearch from '@deepseek-ai/dsh-web-search-deepseek'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import * as ToolSubagentReport from '@deepseek-ai/dsh-tool-subagent-report'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
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
   * Read-only preset roots, in precedence order — the compositions shipped with
   * the app. `dsh-agent-presets` appends `<dshHome>/.agent-presets` as the
   * writable one on top, so a person's own presets are found without the
   * deployment naming that path.
   *
   * Omit to run without a roster: every agent then reaches the model with the
   * host plane's tools alone, which is the shape every test that does not care
   * about compositions wants.
   */
  presetRoots?: readonly string[]
  /** Preset mounted when a session names none. */
  defaultPreset?: string
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
  await ctx.plugin(Loader, { baseUrl: import.meta.url })
  // `cordis:group` is a HOST-registered builtin, not something the loader
  // carries: a group row is how a composition hands one `isolate` realm to a
  // provider and its consumers together, and a preset living outside this
  // workspace could never resolve `@deepseek-ai/cordis-plugin-group` by name.
  // Without this registration every grouped row in a preset resolves to
  // `undefined` and the whole composition fails to apply.
  ctx.loader.builtins.group = Group
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
  // `report` is host-plane for a mechanical reason, not a product one: it
  // registers a continuable SETUP on the subagent registry rather than a tool
  // this agent calls, and that setup list is not scope-aware — one copy per
  // mounted preset would register `report` once per live session and throw on
  // the second.
  ctx.plugin(ToolSubagentReport)

  // The registries the preset rows resolve. Each is a process singleton with
  // cross-session queries, which is dsh's own criterion for host-plane
  // ownership: a service a row outside the realm reads belongs to the plane
  // both can see. Their model-facing tools live in the preset.
  ctx.plugin(SkillRegistry)
  ctx.plugin(GoalService)
  ctx.plugin(GoalRoundDriver)
  ctx.plugin(LocalJobRegistry)
  ctx.plugin(WebRuntime)
  ctx.plugin(DeepSeekWebSearch)
  ctx.plugin(UserQuestionService)
  // The command REGISTRY, mounted even though SuperOne owns the slash surface
  // and renders none of its entries. `standard` names `command-compact`, and a
  // row still waiting on a service the deployment never supplies is exactly
  // what `mount()` refuses — it would take the whole preset down. Registering
  // the registry keeps the shipped composition a verbatim copy; the alternative
  // was editing a vendored file, which forks it forever.
  ctx.plugin(CommandRuntime)
  // The dynamic-Cordis RUNNER and its inspect registry, mounted for the whole
  // tree because they are services, not tools: nothing here reaches the model.
  // The row that does — `tool-cordis` — belongs to the `cordis` preset, and two
  // instances cannot coexist (the second collides on the inspect provider), so
  // the preset is the one and only way an agent gets those tools.
  ctx.plugin(DynamicCordisRunner, {})

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

  // `token-meter` prices the live request envelope and stays host-plane: it
  // takes no configuration, keys every fold by Session, and owns the projection
  // units a context ring reads for every session. Behind a preset realm those
  // units would come and go with whichever presets happen to be mounted. The
  // compaction ENGINE and its tool-result pruner are the preset's choice and
  // live in its own realm — which is why `compactSession` resolves them through
  // the agent's context rather than the bridge's.
  ctx.plugin(TokenMeter)

  // The preset roster. A preset is an agent-plane composition mounted ONCE per
  // process under a standing scope; each session joins by having its agent
  // scope parented to that mount, so one instance of every tool and prompt
  // section covers every session that named it. This is why the model-facing
  // rows left the host plane above: they are a preset's choice, not the
  // deployment's.
  if (options.presetRoots?.length) {
    ctx.plugin(AgentPresets, {
      default: options.defaultPreset ?? 'standard',
      roots: options.presetRoots.map((path) => ({ path, trust: 'system' as const })),
      // `<dshHome>/.agent-presets` is where a person's own presets live, the
      // way `<dshHome>/skills` holds their own skills. It is appended AFTER the
      // shipped roots, so a shipped id still shadows a home directory that
      // claimed the same name.
      includeUserRoot: true,
    })
  }

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
