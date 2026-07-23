import { describe, it, expect } from 'vitest'
import {
  formatCodexModelLabel,
  formatCodexModelName,
  formatReasoningEffortLabel,
  normalizeFilePath,
  toMentionPath,
} from './chat-input-utils'

describe('formatCodexModelLabel', () => {
  it('should extract last segment from path', () => {
    expect(formatCodexModelLabel('openai/gpt-4o')).toBe('GPT-4o')
  })

  it('should capitalize each token', () => {
    expect(formatCodexModelLabel('codex-mini')).toBe('Codex-Mini')
  })

  it('should uppercase gpt token', () => {
    expect(formatCodexModelLabel('gpt')).toBe('GPT')
  })

  it('should preserve version numbers', () => {
    expect(formatCodexModelLabel('model-4.1')).toBe('Model-4.1')
  })

  it('should join GPT and decimal version while separating the variant', () => {
    expect(formatCodexModelLabel('gpt-5.6-sol')).toBe('GPT5.6 Sol')
  })

  it('should format versioned GPT display names without changing other names', () => {
    expect(formatCodexModelName('GPT-5.6-Sol', 'gpt-5.6-sol')).toBe('GPT5.6 Sol')
    expect(formatCodexModelName('GPT5.6 Sol', 'gpt-5.6-sol')).toBe('GPT5.6 Sol')
    expect(formatCodexModelName('My Custom Model', 'custom-model')).toBe('My Custom Model')
  })

  it('should convert underscores to hyphens', () => {
    expect(formatCodexModelLabel('gpt_4o')).toBe('GPT-4o')
  })

  it('should return raw input for empty string', () => {
    expect(formatCodexModelLabel('')).toBe('')
  })

  it('should return raw input for whitespace-only string', () => {
    expect(formatCodexModelLabel('   ')).toBe('   ')
  })

  it('should handle single token', () => {
    expect(formatCodexModelLabel('claude')).toBe('Claude')
  })
})

describe('formatReasoningEffortLabel', () => {
  it('should map minimal to Minimal', () => {
    expect(formatReasoningEffortLabel('minimal')).toBe('Minimal')
  })

  it('should map xhigh to Extra High', () => {
    expect(formatReasoningEffortLabel('xhigh')).toBe('Extra High')
  })

  it('should return unknown values as-is', () => {
    expect(formatReasoningEffortLabel('custom')).toBe('custom')
  })
})

describe('normalizeFilePath', () => {
  it('should convert backslashes to forward slashes', () => {
    expect(normalizeFilePath('C:\\Users\\file.txt')).toBe('C:/Users/file.txt')
  })

  it('should leave forward slashes unchanged', () => {
    expect(normalizeFilePath('/usr/local/bin')).toBe('/usr/local/bin')
  })
})

describe('toMentionPath', () => {
  it('should return relative path when file is under project', () => {
    expect(toMentionPath('/project/src/file.ts', '/project')).toBe('src/file.ts')
  })

  it('should return dot when file equals project path', () => {
    expect(toMentionPath('/project', '/project')).toBe('.')
  })

  it('should return full path when no project path', () => {
    expect(toMentionPath('/project/src/file.ts')).toBe('/project/src/file.ts')
  })

  it('should return full path when file is outside project', () => {
    expect(toMentionPath('/other/file.ts', '/project')).toBe('/other/file.ts')
  })

  it('should handle trailing slashes on project path', () => {
    expect(toMentionPath('/project/src/file.ts', '/project/')).toBe('src/file.ts')
  })
})
