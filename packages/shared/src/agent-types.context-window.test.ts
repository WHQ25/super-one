import { describe, expect, it } from 'vitest'
import {
  CODEX_GPT_5_6_CONTEXT_WINDOW,
  DEFAULT_CONTEXT_WINDOW,
  EXTENDED_CONTEXT_WINDOW,
  resolveRingContextWindow,
} from './agent-types'

describe('resolveRingContextWindow', () => {
  it('uses the Codex managed window for GPT-5.6 models', () => {
    expect(resolveRingContextWindow({
      harnessId: 'codex',
      modelId: 'gpt-5.6-sol',
      catalogContextWindow: 1_050_000,
      sessionContextWindow: 258_400,
    })).toBe(CODEX_GPT_5_6_CONTEXT_WINDOW)

    expect(resolveRingContextWindow({
      harnessId: 'codex',
      modelId: 'custom-alias',
      resolvedModel: 'openai/gpt-5.6-terra',
      catalogContextWindow: 1_050_000,
    })).toBe(CODEX_GPT_5_6_CONTEXT_WINDOW)
  })

  it('keeps the catalog window for GPT-5.6 outside Codex', () => {
    expect(resolveRingContextWindow({
      harnessId: 'opencode',
      modelId: 'gpt-5.6-sol',
      catalogContextWindow: 1_050_000,
    })).toBe(1_050_000)
  })

  it('prefers models.dev catalog over session and detailed maxTokens', () => {
    expect(resolveRingContextWindow({
      modelId: 'claude-sonnet-4-6',
      catalogContextWindow: 1_000_000,
      sessionContextWindow: 258_400,
      detailedMaxTokens: 200_000,
      harnessContextWindow: 200_000,
    })).toBe(1_000_000)
  })

  it('raises catalog window to 1M when the model id carries [1m]', () => {
    expect(resolveRingContextWindow({
      modelId: 'claude-sonnet-4-5[1m]',
      catalogContextWindow: 200_000,
    })).toBe(EXTENDED_CONTEXT_WINDOW)
  })

  it('uses 1M when [1m] is set and catalog is missing', () => {
    expect(resolveRingContextWindow({
      modelId: 'opus[1m]',
      claudeFallback: true,
    })).toBe(EXTENDED_CONTEXT_WINDOW)
  })

  it('falls back to harness window when catalog is missing', () => {
    expect(resolveRingContextWindow({
      modelId: 'grok-4.5',
      harnessContextWindow: 500_000,
      sessionContextWindow: 128_000,
    })).toBe(500_000)
  })

  it('uses Claude hardcoded 200k when nothing else is available', () => {
    expect(resolveRingContextWindow({
      modelId: 'claude-opus-4-8',
      claudeFallback: true,
    })).toBe(DEFAULT_CONTEXT_WINDOW)
  })

  it('uses session then detailed maxTokens for non-Claude without catalog', () => {
    expect(resolveRingContextWindow({
      modelId: 'gpt-5',
      sessionContextWindow: 258_400,
      detailedMaxTokens: 400_000,
    })).toBe(258_400)
    expect(resolveRingContextWindow({
      modelId: 'gpt-5',
      detailedMaxTokens: 400_000,
    })).toBe(400_000)
  })

  it('returns null when no source has a positive window', () => {
    expect(resolveRingContextWindow({ modelId: 'unknown' })).toBeNull()
  })
})
