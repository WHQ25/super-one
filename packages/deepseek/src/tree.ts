import { Context } from '@deepseek-ai/cordis'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import * as LlmDeepseek from '@deepseek-ai/dsh-llm-deepseek'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as CheckpointPolicy from '@deepseek-ai/dsh-session-checkpoint-policy'

export interface DeepseekTreeOptions {
  /**
   * Extra persona text appended to the dsh system prompt. The harness identity
   * opener stays on (decision: docs/draft/deepseek-harness-integration.md §12.1).
   */
  persona?: string
  /** JSONL session-log root; omit to run without durable persistence (tests). */
  persistenceRoot?: string
  /**
   * Mount the official DeepSeek adapter. The adapter resolves its credential
   * reference (DEEPSEEK_API_KEY) itself; SuperOne's credential store material
   * must be exported into the process environment before the first request
   * (D7 — we deliberately do not mount dsh's settings/credentials file plugins).
   */
  deepseekAdapter?: {
    models: Array<{ id: string; contextWindow?: number }>
    thinking?: 'enabled' | 'disabled'
  }
}

/**
 * Compose the embedded dsh spine with plain `ctx.plugin(...)` calls — no
 * Loader, no YAML profiles, no $DSH_HOME (design D3). The returned context is
 * the root the bridge plugin mounts on; callers dispose it via `root.stop()`
 * semantics owned by DeepseekRuntime.
 */
export async function createDeepseekTree(options: DeepseekTreeOptions): Promise<Context> {
  const ctx = new Context()
  ctx.plugin(Timer)
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

  if (options.deepseekAdapter) {
    ctx.plugin(LlmDeepseek, {
      thinking: options.deepseekAdapter.thinking ?? 'enabled',
      models: options.deepseekAdapter.models,
    })
  }

  if (options.persistenceRoot) {
    ctx.plugin(JsonlSessionPersistence, { root: options.persistenceRoot })
    ctx.plugin(CheckpointPolicy)
  }

  return ctx
}
