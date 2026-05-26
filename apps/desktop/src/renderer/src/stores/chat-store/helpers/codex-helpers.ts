import type {
  ChatMessage,
  CodexAuthMode,
  CodexAuthStatus,
  CodexReasoningEffort,
  CodexReviewTarget,
  CodexThreadItem,
  CodexUsageInfo,
  ModelOption,
} from '@superone/shared/agent-types'

export type CodexCommand =
  | { kind: 'help' }
  | { kind: 'reset' }
  | { kind: 'auth-status' }
  | { kind: 'auth-set'; mode: CodexAuthMode; apiKey?: string }
  | { kind: 'run'; prompt: string }
  | { kind: 'review'; target: CodexReviewTarget }
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

export function hasValidCodexUsageSnapshot(usage: CodexUsageInfo | null): usage is CodexUsageInfo {
  return Boolean(
    usage
      && Number.isFinite(usage.totalInputTokens)
      && Number.isFinite(usage.totalCachedInputTokens)
      && Number.isFinite(usage.totalOutputTokens)
      && Number.isFinite(usage.lastInputTokens)
      && Number.isFinite(usage.lastCachedInputTokens)
      && Number.isFinite(usage.lastOutputTokens)
  )
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

export function findLatestCodexUsage(messages: ChatMessage[]): CodexUsageInfo | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const usage = messages[i].metadata?.codex?.usage
    if (hasValidCodexUsageSnapshot(usage as CodexUsageInfo | null)) return usage as CodexUsageInfo
  }
  return null
}

export function parseCodexCommand(input: string): CodexCommand | null {
  if (!input.startsWith('/')) return null

  const body = input.slice(1).trim()
  if (!body) return null

  if (body === 'help') return { kind: 'help' }
  if (body === 'reset') return { kind: 'reset' }
  if (body === 'compact') return { kind: 'compact' }
  if (body === 'plan') return { kind: 'plan' }

  if (body === 'review' || body.startsWith('review ')) {
    const reviewBody = body.slice('review'.length).trim()
    if (reviewBody.startsWith('branch')) return { kind: 'review', target: { type: 'baseBranch' } }
    if (reviewBody.startsWith('commit')) {
      const sha = reviewBody.slice('commit'.length).trim()
      if (!sha) return { kind: 'help' }
      return { kind: 'review', target: { type: 'commit', sha } }
    }
    return { kind: 'review', target: { type: 'uncommittedChanges' } }
  }

  if (body === 'auth' || body.startsWith('auth ')) {
    const authBody = body.slice('auth'.length).trim()
    if (!authBody) return { kind: 'auth-status' }
    if (authBody === 'auto') return { kind: 'auth-set', mode: 'auto' }
    if (authBody === 'chatgpt') return { kind: 'auth-set', mode: 'chatgpt' }
    if (authBody.startsWith('apikey')) {
      const apiKey = authBody.slice('apikey'.length).trim()
      return { kind: 'auth-set', mode: 'apiKey', apiKey: apiKey || undefined }
    }
    return { kind: 'help' }
  }

  return null
}

export function formatCodexAuthStatus(status: CodexAuthStatus): string {
  return [
    'Codex authentication status:',
    `- configured mode: ${status.mode}`,
    `- resolved mode: ${status.resolvedMode}`,
    `- env CODEX_API_KEY: ${status.hasEnvApiKey ? 'set' : 'not set'}`,
    `- session API key: ${status.hasSessionApiKey ? 'set' : 'not set'}`,
    `- runtime state: ${status.isRunning ? 'running' : 'idle'}`,
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
