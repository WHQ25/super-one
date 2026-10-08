/**
 * Deterministic stand-in for every harness, for end-to-end tests that must
 * not call a model (`apps/desktop/e2e/`). A turn follows the steps embedded in
 * its user message instead of asking an LLM:
 *
 *   <scripted>[{"tool":"session_collab_send","args":{"content":"done"}},{"sleep":500},{"say":"ok"}]</scripted>
 *
 * - `tool` calls a SuperOne tool through the same executor the MCP surface uses.
 * - `sleep` waits (Stop interrupts it).
 * - `say` streams assistant text.
 *
 * A message without a block (a mailbox wake, for instance) is echoed back as
 * `Received: <message>`, so a test can see what woke the session. A nested
 * block meant for another session escapes its `<` as `\u003c`, so it is
 * not read as this turn's script.
 *
 * Gate: `scriptedHarnessEnabled()` in `../scripted-harness-gate.ts`.
 */
import { randomUUID } from 'node:crypto'
import type { AgentEvent, ContentBlock, PermissionMode, SendMessageRequest } from '@superone/shared/agent-types'
import type { BackendStartOptions, HarnessId, SessionBackend } from '../types'

type ScriptStep =
  | { tool: string; args?: Record<string, unknown> }
  | { sleep: number }
  | { say: string }

const SCRIPT_BLOCK = /<scripted>([\s\S]*?)<\/scripted>/

export function parseScript(content: string): ScriptStep[] | null {
  const match = SCRIPT_BLOCK.exec(content)
  if (!match) return null
  const steps = JSON.parse(match[1]) as unknown
  if (!Array.isArray(steps)) throw new Error('<scripted> must hold a JSON array of steps')
  return steps as ScriptStep[]
}

function resultText(result: unknown): string {
  const content = (result as { content?: Array<{ type?: string; text?: string }> } | null | undefined)?.content
  const text = content?.filter((block) => block.type === 'text').map((block) => block.text ?? '').join('\n')
  return text || '(no output)'
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export class ScriptedBackend implements SessionBackend {
  private listeners = new Set<(event: AgentEvent) => void>()
  private providerSessionListeners = new Set<(id: string) => void>()
  private sessionId = ''
  private providerSessionId: string | null = null
  private turn: AbortController | null = null
  private turns: Promise<void> = Promise.resolve()

  constructor(readonly kind: HarnessId) {}

  hasActiveRuntime(): boolean { return this.sessionId !== '' }
  async releaseRuntime(): Promise<void> {}

  async start(opts: BackendStartOptions): Promise<void> {
    this.sessionId = opts.sessionId
    this.providerSessionId = opts.providerSessionId ?? `scripted-${opts.sessionId}`
    for (const listener of this.providerSessionListeners) listener(this.providerSessionId)
  }
  async rebuild(opts: BackendStartOptions): Promise<void> { await this.start(opts) }
  prewarm(opts: BackendStartOptions): void { void this.start(opts) }

  async send(request: SendMessageRequest): Promise<void> {
    // Resolve once the turn is accepted, as real harnesses do. A message that
    // arrives mid-turn (a mailbox wake) runs after it, like a queued prompt.
    this.turns = this.turns.then(async () => {
      const turn = new AbortController()
      this.turn = turn
      try {
        await this.runTurn(request.content, turn)
      } finally {
        if (this.turn === turn) this.turn = null
      }
    })
  }

  private async runTurn(content: string, turn: AbortController): Promise<void> {
    const messageId = randomUUID()
    this.emit({ type: 'status_change', status: 'streaming' })
    this.emit({
      type: 'message_start',
      message: { id: messageId, role: 'assistant', status: 'streaming', content: [], createdAt: new Date().toISOString(), providerId: this.kind },
    })
    const delta = (block: ContentBlock) => this.emit({ type: 'content_delta', messageId, delta: block })
    try {
      const steps = parseScript(content)
      if (!steps) delta({ type: 'text', text: `Received: ${content}` })
      for (const step of steps ?? []) {
        if (turn.signal.aborted) break
        if ('say' in step) {
          delta({ type: 'text', text: step.say })
        } else if ('sleep' in step) {
          await abortableDelay(step.sleep, turn.signal)
        } else {
          const toolUseId = `scripted-${randomUUID()}`
          const args = step.args ?? {}
          delta({ type: 'tool_use', toolName: `mcp__superone__${step.tool}`, toolUseId, input: JSON.stringify(args), status: 'complete', startedAt: Date.now() })
          let result: unknown
          try {
            // Loaded on use: production builds carry this class but never run a turn.
            const [{ executeSuperoneMcpTool }, { runInLocalCallScope }] = await Promise.all([
              import('../../mcp/superone-mcp-tool-surface'),
              import('../../mcp/artifact-registry'),
            ])
            result = await runInLocalCallScope(this.sessionId, () =>
              executeSuperoneMcpTool(this.sessionId, step.tool, args, turn.signal))
          } catch (error) {
            // A thrown tool error is what a model would read as an error result; the script stops there.
            delta({ type: 'tool_result', toolUseId, summary: error instanceof Error ? error.message : String(error), isError: true })
            throw error
          }
          delta({ type: 'tool_result', toolUseId, summary: resultText(result), isError: (result as { isError?: boolean } | null)?.isError === true })
        }
      }
      this.emit({ type: 'message_complete', messageId })
    } catch (error) {
      if (turn.signal.aborted) {
        this.emit({ type: 'message_interrupted', messageId })
      } else {
        delta({ type: 'text', text: `Script failed: ${error instanceof Error ? error.message : String(error)}` })
        this.emit({ type: 'message_complete', messageId })
      }
    } finally {
      this.emit({ type: 'status_change', status: 'idle' })
    }
  }

  async interrupt(): Promise<void> { this.turn?.abort(new Error('interrupted')) }
  async close(): Promise<void> {
    this.turn?.abort(new Error('closed'))
    this.sessionId = ''
  }

  async setModel(): Promise<void> {}
  async setSessionMode(): Promise<void> {}
  async setPermissionMode(_mode: PermissionMode): Promise<void> {}
  async setSandbox(): Promise<void> {}
  respondToPermission(): boolean { return false }
  respondToQuestion(): void {}
  dismissQuestion(): void {}
  respondToPlanApproval(): void {}
  async getContextUsage() { return null }
  async getMcpServerStatus() { return [] }
  async rewindFiles() { return { canRewind: false } }
  async reconnectMcp(): Promise<void> {}
  async toggleMcpServer(): Promise<void> {}
  async reloadMcpServers(): Promise<void> {}
  async reloadPlugins() { return false }
  dequeueMessage(): boolean { return false }
  getPendingInteractions(): AgentEvent[] { return [] }

  onEvent(handler: (event: AgentEvent) => void): () => void {
    this.listeners.add(handler)
    return () => { this.listeners.delete(handler) }
  }
  onProviderSessionId(handler: (id: string) => void): () => void {
    this.providerSessionListeners.add(handler)
    return () => { this.providerSessionListeners.delete(handler) }
  }
  onPermissionModeApplied(): () => void { return () => {} }

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}
