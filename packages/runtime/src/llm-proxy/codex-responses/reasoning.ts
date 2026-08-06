import { asObject, asString } from './helpers'
import type { ReasoningEffortOption } from '@superone/shared/agent-types'

export type CodexReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

type ThinkingParam = 'none' | 'thinking' | 'enable_thinking' | 'reasoning_split'
type EffortParam = 'none' | 'reasoning_effort' | 'reasoning.effort'
type EffortValueMode = 'passthrough' | 'deepseek' | 'low_high' | 'openrouter'

export interface CodexChatReasoningConfig {
  supportsThinking: boolean
  supportsEffort: boolean
  thinkingParam: ThinkingParam
  effortParam: EffortParam
  effortValueMode?: EffortValueMode
  supportedEfforts: CodexReasoningEffort[]
  defaultEffort: CodexReasoningEffort
}

const ALL_EFFORTS: CodexReasoningEffort[] = ['minimal', 'low', 'medium', 'high', 'xhigh']
const TOGGLE_EFFORTS: CodexReasoningEffort[] = ['high']
const DEEPSEEK_EFFORTS: CodexReasoningEffort[] = ['high', 'xhigh']

const EFFORT_DESCRIPTIONS: Record<CodexReasoningEffort, string> = {
  minimal: 'Minimal reasoning effort',
  low: 'Low reasoning effort',
  medium: 'Medium reasoning effort',
  high: 'High reasoning effort',
  xhigh: 'Extra-high reasoning effort',
}

const OPENAI_COMPATIBLE: CodexChatReasoningConfig = {
  supportsThinking: false,
  supportsEffort: true,
  thinkingParam: 'none',
  effortParam: 'reasoning_effort',
  effortValueMode: 'passthrough',
  supportedEfforts: ALL_EFFORTS,
  defaultEffort: 'high',
}

const THINKING: CodexChatReasoningConfig = {
  supportsThinking: true,
  supportsEffort: false,
  thinkingParam: 'thinking',
  effortParam: 'none',
  supportedEfforts: TOGGLE_EFFORTS,
  defaultEffort: 'high',
}

const ENABLE_THINKING: CodexChatReasoningConfig = {
  supportsThinking: true,
  supportsEffort: false,
  thinkingParam: 'enable_thinking',
  effortParam: 'none',
  supportedEfforts: TOGGLE_EFFORTS,
  defaultEffort: 'high',
}

const PLATFORM_REASONING: Record<string, CodexChatReasoningConfig> = {
  deepseek: {
    supportsThinking: true,
    supportsEffort: true,
    thinkingParam: 'thinking',
    effortParam: 'reasoning_effort',
    effortValueMode: 'deepseek',
    supportedEfforts: DEEPSEEK_EFFORTS,
    defaultEffort: 'high',
  },
  kimi: THINKING,
  moonshot: THINKING,
  minimax: {
    supportsThinking: true,
    supportsEffort: false,
    thinkingParam: 'reasoning_split',
    effortParam: 'none',
    supportedEfforts: TOGGLE_EFFORTS,
    defaultEffort: 'high',
  },
  xiaomi: THINKING,
  bailian: ENABLE_THINKING,
  modelscope: THINKING,
  siliconflow: ENABLE_THINKING,
  nvidia: THINKING,
  openrouter: {
    supportsThinking: false,
    supportsEffort: true,
    thinkingParam: 'none',
    effortParam: 'reasoning.effort',
    effortValueMode: 'openrouter',
    supportedEfforts: ALL_EFFORTS,
    defaultEffort: 'high',
  },
}

export function resolveCodexChatReasoning(platformId?: string | null): CodexChatReasoningConfig | undefined {
  if (!platformId) return undefined
  return PLATFORM_REASONING[platformId] ?? (platformId.startsWith('custom:') ? OPENAI_COMPATIBLE : undefined)
}

export function supportsCodexChatReasoning(config?: CodexChatReasoningConfig): boolean {
  return config?.supportsThinking === true || config?.supportsEffort === true
}

export function codexReasoningOptions(config?: CodexChatReasoningConfig): ReasoningEffortOption[] {
  if (!config) return []
  return config.supportedEfforts.map((value) => ({ value, description: EFFORT_DESCRIPTIONS[value] }))
}

export function applyCodexChatReasoning(
  result: Record<string, unknown>,
  body: unknown,
  config?: CodexChatReasoningConfig,
): void {
  if (!config) return
  const reasoning = asObject(asObject(body)?.reasoning)
  if (!reasoning) return

  const rawEffort = asString(reasoning.effort)
  const reasoningEnabled = rawEffort ? !isDisabled(rawEffort) : true

  if (config.supportsThinking) {
    if (config.thinkingParam === 'thinking') {
      result.thinking = { type: reasoningEnabled ? 'enabled' : 'disabled' }
    } else if (config.thinkingParam === 'enable_thinking') {
      result.enable_thinking = reasoningEnabled
    } else if (config.thinkingParam === 'reasoning_split') {
      result.reasoning_split = reasoningEnabled
    }
  }

  if (!reasoningEnabled) {
    if (config.effortParam === 'reasoning.effort') result.reasoning = { effort: 'none' }
    return
  }
  if (!config.supportsEffort || !rawEffort) return

  const effort = mapReasoningEffort(rawEffort, config.effortValueMode)
  if (!effort) return
  if (config.effortParam === 'reasoning_effort') result.reasoning_effort = effort
  if (config.effortParam === 'reasoning.effort') result.reasoning = { effort }
}

function isDisabled(effort: string): boolean {
  return ['none', 'off', 'disabled'].includes(effort.trim().toLowerCase())
}

function mapReasoningEffort(effort: string, mode: EffortValueMode | undefined): string | undefined {
  const value = effort.trim().toLowerCase()
  if (isDisabled(value)) return undefined

  if (mode === 'deepseek') return value === 'xhigh' || value === 'max' ? 'max' : 'high'
  if (mode === 'low_high') return value === 'minimal' || value === 'low' ? 'low' : 'high'
  if (mode === 'openrouter') {
    if (value === 'xhigh' || value === 'max') return 'xhigh'
    return ['minimal', 'low', 'medium', 'high'].includes(value) ? value : undefined
  }
  return ['minimal', 'low', 'medium', 'high', 'xhigh'].includes(value) ? value : undefined
}
