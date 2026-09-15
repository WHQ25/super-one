import { describe, expect, it } from 'vitest'
import {
  isTerminalCommandAllowed,
  matchesTerminalCommandRule,
  terminalCommandRuleFor,
} from './terminal-command-rules'

describe('terminal command rules', () => {
  it('turns an approved command into a prefix rule', () => {
    expect(terminalCommandRuleFor('  bun   run storybook ')).toBe('bun run storybook:*')
    expect(terminalCommandRuleFor('python3:*')).toBe('python3:*')
  })

  it('matches prefix rules only at a word boundary', () => {
    expect(matchesTerminalCommandRule('bun run storybook:*', 'bun run storybook')).toBe(true)
    expect(matchesTerminalCommandRule('bun run storybook:*', 'bun run storybook --ci -p 6006')).toBe(true)
    expect(matchesTerminalCommandRule('bun run storybook:*', 'bun run storybook-old')).toBe(false)
    expect(matchesTerminalCommandRule('bun run storybook:*', 'bun run')).toBe(false)
  })

  it('matches exact rules exactly', () => {
    expect(matchesTerminalCommandRule('python3', 'python3')).toBe(true)
    expect(matchesTerminalCommandRule('python3', 'python3 -i')).toBe(false)
  })

  it('normalizes whitespace on both sides and rejects empty input', () => {
    expect(matchesTerminalCommandRule('bun  run dev:*', ' bun run   dev ')).toBe(true)
    expect(matchesTerminalCommandRule(':*', 'anything')).toBe(false)
    expect(matchesTerminalCommandRule('bun:*', '')).toBe(false)
  })

  it('checks a command against a rule list', () => {
    const rules = ['bun run storybook:*', 'python3']
    expect(isTerminalCommandAllowed(rules, 'bun run storybook --ci')).toBe(true)
    expect(isTerminalCommandAllowed(rules, 'rm -rf /')).toBe(false)
  })
})
