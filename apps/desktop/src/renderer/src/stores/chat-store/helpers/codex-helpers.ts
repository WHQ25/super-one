import type {
  ChatMessage,
  CodexAccountLoginStartResult,
  CodexPlanApprovalState,
  CodexReasoningEffort,
  CodexReviewTarget,
  CodexThreadItem,
  CodexUsageInfo,
  ModelOption,
} from '@superone/shared/agent-types'
import type { ChatStore, PerSessionState, ProjectState } from '../types'
import { findLatestCodexUsage, hasValidCodexUsageSnapshot } from './codex-usage'
import { _getEffectiveSessionId } from './persistence'
import { defaultPrefsCache } from './prefs-cache'
import { resolveProvider } from './provider-routing'
import { getActivePerSession, getProject } from './store-helpers'

export type CodexCommand =
  | { kind: 'reset' }
  | { kind: 'login' }
  | { kind: 'logout' }
  | { kind: 'run'; prompt: string }
  | { kind: 'review'; target: CodexReviewTarget }
  | { kind: 'review-picker'; mode: 'branch' | 'commit' }
  | { kind: 'compact' }
  | { kind: 'plan' }

export function upsertCodexItem(items: CodexThreadItem[], next: CodexThreadItem): CodexThreadItem[] {
  const idx = items.findIndex((item) => item.id === next.id)
  if (idx === -1) return [...items, next]
  const cloned = [...items]
  cloned[idx] = next
  return cloned
}

export function removeCodexItem(items: CodexThreadItem[], itemId: string): CodexThreadItem[] {
  return items.filter((item) => item.id !== itemId)
}

export function getCodexUsageStepTokens(usage: CodexUsageInfo): { input: number; output: number } {
  return {
    input: Math.max(0, usage.lastInputTokens - usage.lastCachedInputTokens),
    output: usage.lastOutputTokens,
  }
}

function isSameCodexUsageSnapshot(a: CodexUsageInfo | null, b: CodexUsageInfo | null): boolean {
  return Boolean(
    hasValidCodexUsageSnapshot(a)
      && hasValidCodexUsageSnapshot(b)
      && a.totalInputTokens === b.totalInputTokens
      && a.totalCachedInputTokens === b.totalCachedInputTokens
      && a.totalOutputTokens === b.totalOutputTokens
      && a.lastInputTokens === b.lastInputTokens
      && a.lastCachedInputTokens === b.lastCachedInputTokens
      && a.lastOutputTokens === b.lastOutputTokens
  )
}

export function accumulateCodexFooterTokens(
  current: { input: number; output: number },
  usage: CodexUsageInfo,
  previous: CodexUsageInfo | null,
): { input: number; output: number } {
  if (!hasValidCodexUsageSnapshot(usage) || isSameCodexUsageSnapshot(usage, previous)) {
    return current
  }
  const step = getCodexUsageStepTokens(usage)
  return {
    input: current.input + step.input,
    output: current.output + step.output,
  }
}

export function parseCodexCommand(input: string): CodexCommand | null {
  if (!input.startsWith('/')) return null

  const body = input.slice(1).trim()
  if (!body) return null

  if (body === 'reset') return { kind: 'reset' }
  if (body === 'compact') return { kind: 'compact' }
  if (body === 'plan') return { kind: 'plan' }
  if (body === 'login') return { kind: 'login' }
  if (body === 'logout') return { kind: 'logout' }

  if (body === 'review' || body.startsWith('review ')) {
    const reviewBody = body.slice('review'.length).trim()
    if (reviewBody === 'branch' || reviewBody.startsWith('branch ')) {
      const branch = reviewBody.slice('branch'.length).trim()
      if (!branch) return { kind: 'review-picker', mode: 'branch' }
      return { kind: 'review', target: { type: 'baseBranch', branch } }
    }
    if (reviewBody === 'commit' || reviewBody.startsWith('commit ')) {
      const sha = reviewBody.slice('commit'.length).trim()
      if (!sha) return { kind: 'review-picker', mode: 'commit' }
      return { kind: 'review', target: { type: 'commit', sha } }
    }
    return { kind: 'review', target: { type: 'uncommittedChanges' } }
  }

  return null
}

export function formatCodexLoginStart(result: CodexAccountLoginStartResult): string {
  return [
    'Continue signing in to ChatGPT in your browser.',
    ...(result.userCode ? ['', `Device code: ${result.userCode}`] : []),
  ].join('\n')
}

export function getLatestCodexThreadId(messages: ChatMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.providerId !== 'codex' || msg.role !== 'assistant') continue
    const tid = msg.metadata?.codex?.threadId
    if (tid) return tid
  }
  return undefined
}

export function resolveCodexReasoningEffort(
  model: ModelOption | undefined,
  preferred?: CodexReasoningEffort,
): CodexReasoningEffort | undefined {
  const options = model?.supportedReasoningEfforts ?? []
  if (options.length === 0) return undefined
  const supported = new Set(options.map((entry) => entry.value))
  if (preferred && supported.has(preferred)) return preferred
  if (model?.defaultReasoningEffort && supported.has(model.defaultReasoningEffort)) {
    return model.defaultReasoningEffort
  }
  return options[options.length - 1]?.value
}

export function resolveCodexModelSelection(
  models: ModelOption[],
  selectedCodexModel: string,
  selectedCodexReasoningEffort?: CodexReasoningEffort,
): { modelId: string; reasoningEffort?: CodexReasoningEffort } {
  const current = selectedCodexModel.length > 0 ? models.find((m) => m.id === selectedCodexModel) : undefined
  if (current) {
    return {
      modelId: current.id,
      reasoningEffort: resolveCodexReasoningEffort(current, selectedCodexReasoningEffort),
    }
  }

  const preferred = models.find((m) => m.isDefault)
    ?? models[0]

  if (!preferred) {
    return { modelId: '', reasoningEffort: undefined }
  }

  return {
    modelId: preferred.id,
    reasoningEffort: resolveCodexReasoningEffort(preferred, selectedCodexReasoningEffort),
  }
}

// --- Codex thread-item trace helpers ---

export function pruneTransientCodexItems(items: CodexThreadItem[]): CodexThreadItem[] {
  return items
}

function getCodexTraceTextLength(item: CodexThreadItem): number | undefined {
  switch (item.type) {
    case 'agent_message':
    case 'reasoning':
    case 'plan':
    case 'review':
      return item.text.length
    default:
      return undefined
  }
}

export function summarizeCodexTraceItem(item: CodexThreadItem): { id: string; type: CodexThreadItem['type']; textLen?: number } {
  const textLen = getCodexTraceTextLength(item)
  return textLen === undefined
    ? { id: item.id, type: item.type }
    : { id: item.id, type: item.type, textLen }
}

export function getCodexTraceItems(message: ChatMessage | undefined | null): {
  length: number
  tail: Array<{ id: string; type: CodexThreadItem['type']; textLen?: number }>
} {
  const items = message?.metadata?.codex?.items ?? []
  return {
    length: items.length,
    tail: items.slice(-3).map(summarizeCodexTraceItem),
  }
}

export function getCodexContextTokens(usage: CodexUsageInfo): number {
  return usage.lastInputTokens
}

export function getCodexCompletionEventMeta(metadata: ChatMessage['metadata'] | undefined): {
  finalResponse?: string
  durationMs?: number
  threadId: string | null
  usage: CodexUsageInfo | null
  items: CodexThreadItem[]
} | null {
  const rawCodex = metadata?.codex
  if (!rawCodex || typeof rawCodex !== 'object') return null
  const codex = rawCodex as unknown as Record<string, unknown>
  return {
    finalResponse: typeof codex.finalResponse === 'string' ? codex.finalResponse : undefined,
    durationMs: typeof codex.durationMs === 'number' && Number.isFinite(codex.durationMs) ? codex.durationMs : undefined,
    threadId: typeof codex.threadId === 'string' || codex.threadId === null ? codex.threadId : null,
    usage: hasValidCodexUsageSnapshot(codex.usage as CodexUsageInfo | null) ? codex.usage as CodexUsageInfo : null,
    items: Array.isArray(codex.items) ? codex.items as CodexThreadItem[] : [],
  }
}

// --- Codex command helpers ---

export type CodexRunnableCommand = Extract<CodexCommand, { kind: 'run' | 'review' | 'compact' }>

export function isRunnableCodexCommand(command: CodexCommand): command is CodexRunnableCommand {
  return command.kind === 'run' || command.kind === 'review' || command.kind === 'compact'
}

// --- Codex default / persisted selection ---

const CODEX_LAST_SELECTION_STORAGE_KEY = 'super-one.codex.last-selection.v1'

export function readLastCodexSelection(): { modelId: string; reasoningEffort?: CodexReasoningEffort } {
  try {
    const raw = globalThis.localStorage?.getItem(CODEX_LAST_SELECTION_STORAGE_KEY)
    if (!raw) return { modelId: '', reasoningEffort: undefined }
    const parsed = JSON.parse(raw) as { modelId?: unknown; reasoningEffort?: unknown }
    if (typeof parsed.modelId !== 'string') return { modelId: '', reasoningEffort: undefined }
    const effort = typeof parsed.reasoningEffort === 'string'
      ? parsed.reasoningEffort as CodexReasoningEffort
      : undefined
    return { modelId: parsed.modelId, reasoningEffort: effort }
  } catch {
    return { modelId: '', reasoningEffort: undefined }
  }
}

export function saveLastCodexSelection(modelId: string, reasoningEffort?: CodexReasoningEffort): void {
  try {
    globalThis.localStorage?.setItem(
      CODEX_LAST_SELECTION_STORAGE_KEY,
      JSON.stringify({ modelId, reasoningEffort }),
    )
  } catch {}
}

export function resolveDefaultCodexSelection(models: ModelOption[]): { modelId: string; reasoningEffort?: CodexReasoningEffort } {
  const remembered = readLastCodexSelection()
  const defaults = defaultPrefsCache.codexSelection ?? { modelId: '', reasoningEffort: undefined }
  return resolveCodexModelSelection(
    models,
    defaults.modelId || remembered.modelId,
    defaults.reasoningEffort ?? remembered.reasoningEffort,
  )
}

export function resolveSessionCodexSelection(
  models: ModelOption[],
  selectedCodexModel: string,
  selectedCodexReasoningEffort?: CodexReasoningEffort,
): { modelId: string; reasoningEffort?: CodexReasoningEffort } {
  if (selectedCodexModel || selectedCodexReasoningEffort) {
    return resolveCodexModelSelection(models, selectedCodexModel, selectedCodexReasoningEffort)
  }
  return resolveDefaultCodexSelection(models)
}

// --- Codex plan-mode action helpers ---

export function createLocalTextUserMessage(id: string, text: string): ChatMessage {
  return {
    id,
    role: 'user',
    status: 'complete',
    content: [{ type: 'text', text }],
    createdAt: new Date().toISOString(),
    providerId: 'local',
  }
}

export function getCodexPlanActionContext(
  get: () => ChatStore,
  activeProject: string,
): {
  project: ProjectState
  session: PerSessionState
  assistantMessageId: string
  codexSessionId: string
  resolvedCodexModel?: string
  resolvedCodexReasoningEffort?: CodexReasoningEffort
} | null {
  const project = getProject(get(), activeProject)
  const codexSessionId = _getEffectiveSessionId(project)
  if (!codexSessionId) return null

  const session = getActivePerSession(get(), activeProject)
  const provider = resolveProvider(session)
  if (provider !== 'codex' || session.selectedCodexCollaborationMode !== 'plan' || session.status !== 'idle' || project.hasPendingInteraction) {
    return null
  }

  const lastAssistantId = session.lastAssistantMessageId
  if (!lastAssistantId) return null
  const lastAssistantMessage = lastAssistantId
    ? session.messages.find((message) => message.id === lastAssistantId)
    : null
  const hasPlan = !!lastAssistantMessage?.metadata?.codex?.items.some((item) => item.type === 'plan')
  if (!hasPlan) return null

  const resolvedCodexSelection = resolveSessionCodexSelection(
    project.codexModels,
    session.selectedCodexModel,
    session.selectedCodexReasoningEffort,
  )

  return {
    project,
    session,
    assistantMessageId: lastAssistantId,
    codexSessionId,
    resolvedCodexModel: resolvedCodexSelection.modelId || undefined,
    resolvedCodexReasoningEffort: resolvedCodexSelection.reasoningEffort,
  }
}

export function updateCodexPlanApproval(
  session: PerSessionState,
  assistantMessageId: string,
  planApproval: CodexPlanApprovalState,
): Partial<PerSessionState> {
  return {
    messages: session.messages.map((message) => {
      if (message.id !== assistantMessageId || message.role !== 'assistant' || !message.metadata?.codex) {
        return message
      }
      return {
        ...message,
        metadata: {
          ...message.metadata,
          codex: {
            ...message.metadata.codex,
            planApproval,
          },
        },
      }
    }),
  }
}

// Re-exported from the leaf module; importers below still take them from here.
export { findLatestCodexUsage, hasValidCodexUsageSnapshot }
