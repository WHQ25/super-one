import { describe, expect, it, vi } from 'vitest'
import {
  buildGrokSuggestPromptParams,
  fetchGrokSuggestPrompt,
  parseGrokSuggestPromptResult,
  sanitizeGrokPromptSuggestion,
  shouldFetchGrokSuggestPrompt,
  XAI_SUGGEST_PROMPT_WIRE,
} from './grok-suggest-prompt'

describe('sanitizeGrokPromptSuggestion', () => {
  it('keeps the first line and strips wrapping quotes', () => {
    expect(sanitizeGrokPromptSuggestion('run the tests')).toBe('run the tests')
    expect(sanitizeGrokPromptSuggestion('"commit this"')).toBe('commit this')
    expect(sanitizeGrokPromptSuggestion('`push it`')).toBe('push it')
    expect(sanitizeGrokPromptSuggestion('run the tests\nthen commit')).toBe('run the tests')
    expect(sanitizeGrokPromptSuggestion('"run the tests"<|eos|>')).toBe('run the tests')
  })

  it('drops silence and empty text', () => {
    for (const raw of ['', '   ', 'none', 'N/A', 'no suggestion', 'nothing', 'silence', '(silence)', 'null']) {
      expect(sanitizeGrokPromptSuggestion(raw), raw).toBeNull()
    }
  })
})

describe('parseGrokSuggestPromptResult', () => {
  it('reads a direct result and a JSON-RPC envelope', () => {
    expect(parseGrokSuggestPromptResult({ suggestion: 'Run tests', generation: 3 }, 3)).toBe('Run tests')
    expect(parseGrokSuggestPromptResult({ result: { suggestion: 'Open PR', generation: 1 } }, 1)).toBe('Open PR')
  })

  it('returns null on mismatch, missing, or silence', () => {
    expect(parseGrokSuggestPromptResult({ suggestion: 'stale', generation: 2 }, 3)).toBeNull()
    expect(parseGrokSuggestPromptResult({ suggestion: null, generation: 1 }, 1)).toBeNull()
    expect(parseGrokSuggestPromptResult({ suggestion: 'none', generation: 1 }, 1)).toBeNull()
    expect(parseGrokSuggestPromptResult(undefined, 1)).toBeNull()
  })
})

describe('shouldFetchGrokSuggestPrompt', () => {
  it('is only for a successful grok turn that is not a slash command', () => {
    expect(shouldFetchGrokSuggestPrompt({ grok: true, complete: true, interrupted: false, text: 'go' })).toBe(true)
    expect(shouldFetchGrokSuggestPrompt({ grok: false, complete: true, interrupted: false, text: 'go' })).toBe(false)
    expect(shouldFetchGrokSuggestPrompt({ grok: true, complete: true, interrupted: true, text: 'go' })).toBe(false)
    expect(shouldFetchGrokSuggestPrompt({ grok: true, complete: false, interrupted: false, text: 'go' })).toBe(false)
    expect(shouldFetchGrokSuggestPrompt({ grok: true, complete: true, interrupted: false, text: '/recap' })).toBe(false)
    expect(shouldFetchGrokSuggestPrompt({ grok: true, complete: true, interrupted: false, text: '  /goal x' })).toBe(false)
  })
})

describe('buildGrokSuggestPromptParams', () => {
  it('omits model unless pinned', () => {
    expect(buildGrokSuggestPromptParams(4, 'sess-1')).toEqual({ generation: 4, sessionId: 'sess-1' })
    expect(buildGrokSuggestPromptParams(4, 'sess-1', 'grok-4')).toEqual({
      generation: 4,
      sessionId: 'sess-1',
      model: 'grok-4',
    })
  })
})

describe('fetchGrokSuggestPrompt', () => {
  it('sends the _x.ai wire method and returns a sanitized suggestion', async () => {
    const request = vi.fn(async () => ({ suggestion: '  Run tests  ', generation: 7 }))
    await expect(fetchGrokSuggestPrompt(request, { generation: 7, sessionId: 's1' })).resolves.toBe('Run tests')
    expect(request).toHaveBeenCalledWith(XAI_SUGGEST_PROMPT_WIRE, { generation: 7, sessionId: 's1' })
  })

  it('returns null on timeout or request failure', async () => {
    await expect(fetchGrokSuggestPrompt(() => new Promise(() => {}), {
      generation: 1,
      sessionId: 's1',
      timeoutMs: 20,
    })).resolves.toBeNull()
    await expect(fetchGrokSuggestPrompt(async () => {
      throw new Error('Method not found')
    }, { generation: 1, sessionId: 's1' })).resolves.toBeNull()
  })
})
