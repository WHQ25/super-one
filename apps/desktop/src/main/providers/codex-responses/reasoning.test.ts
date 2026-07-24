import { describe, expect, it } from 'vitest'
import { applyCodexChatReasoning, codexReasoningOptions, resolveCodexChatReasoning } from './reasoning'

function apply(platformId: string, effort: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  applyCodexChatReasoning(result, { reasoning: { effort } }, resolveCodexChatReasoning(platformId))
  return result
}

describe('Codex Chat reasoning mappings', () => {
  it('uses the Codex effort values for custom OpenAI-compatible providers', () => {
    for (const effort of ['minimal', 'low', 'medium', 'high', 'xhigh']) {
      expect(apply('custom:gateway', effort)).toEqual({ reasoning_effort: effort })
    }
  })

  it('uses OpenRouter native reasoning and preserves all Codex effort values', () => {
    expect(apply('openrouter', 'minimal')).toEqual({ reasoning: { effort: 'minimal' } })
    expect(apply('openrouter', 'xhigh')).toEqual({ reasoning: { effort: 'xhigh' } })
  })

  it('exposes standard effort metadata that matches each provider mapping', () => {
    expect(codexReasoningOptions(resolveCodexChatReasoning('custom:newapi')).map((option) => option.value))
      .toEqual(['minimal', 'low', 'medium', 'high', 'xhigh'])
    expect(codexReasoningOptions(resolveCodexChatReasoning('deepseek')).map((option) => option.value))
      .toEqual(['high', 'xhigh'])
    expect(codexReasoningOptions(resolveCodexChatReasoning('moonshot')).map((option) => option.value))
      .toEqual(['high'])
  })

  it('lets the provider rule override a reasoning-model name', () => {
    const result: Record<string, unknown> = {}
    applyCodexChatReasoning(
      result,
      { model: 'deepseek/deepseek-chat-v3.1', reasoning: { effort: 'high' } },
      resolveCodexChatReasoning('openrouter'),
    )

    expect(result).toEqual({ reasoning: { effort: 'high' } })
  })

  it('maps DeepSeek and toggle-only providers without model-name inference', () => {
    expect(apply('deepseek', 'high')).toEqual({
      thinking: { type: 'enabled' },
      reasoning_effort: 'high',
    })
    expect(apply('deepseek', 'xhigh')).toEqual({
      thinking: { type: 'enabled' },
      reasoning_effort: 'max',
    })
    expect(apply('moonshot', 'high')).toEqual({ thinking: { type: 'enabled' } })
    expect(apply('siliconflow', 'high')).toEqual({ enable_thinking: true })
  })

  it('does not send reasoning fields for an unmapped provider', () => {
    expect(resolveCodexChatReasoning('unknown')).toBeUndefined()
  })
})
