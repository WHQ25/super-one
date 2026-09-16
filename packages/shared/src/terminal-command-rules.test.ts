import { describe, expect, it } from 'vitest'
import {
  isTerminalCommandAllowed,
  matchesTerminalCommandRule,
  resolveTerminalCommandRule,
  suggestedTerminalCommandRule,
  terminalCommandRuleFor,
} from './terminal-command-rules'

describe('terminal command rules', () => {
  it('turns an approved command into a prefix rule', () => {
    expect(terminalCommandRuleFor('  bun   run storybook ')).toBe('bun run storybook:*')
    expect(terminalCommandRuleFor('python3:*')).toBe('python3:*')
  })

  it('suggests the command + subcommand as the always-allow rule', () => {
    expect(suggestedTerminalCommandRule('bun run dev')).toBe('bun run:*')
    expect(suggestedTerminalCommandRule('bun run dev --port 3000')).toBe('bun run:*')
    expect(suggestedTerminalCommandRule('git commit -m fix')).toBe('git commit:*')
    expect(suggestedTerminalCommandRule('ls -la /tmp')).toBe('ls:*')
    expect(suggestedTerminalCommandRule('npx vitest run src/a.test.ts')).toBe('npx vitest:*')
  })

  it('keeps the full command when nothing can be dropped safely', () => {
    expect(suggestedTerminalCommandRule('python3')).toBe('python3:*')
    expect(suggestedTerminalCommandRule('npm test')).toBe('npm test:*')
    expect(suggestedTerminalCommandRule('python3 script.py')).toBe('python3 script.py:*')
    expect(suggestedTerminalCommandRule('cd x && bun dev')).toBe('cd x && bun dev:*')
    expect(suggestedTerminalCommandRule('echo "a b" c')).toBe('echo "a b" c:*')
    expect(suggestedTerminalCommandRule('sudo rm -rf build')).toBe('sudo rm -rf build:*')
    expect(suggestedTerminalCommandRule('ssh staging -p 22')).toBe('ssh staging -p 22:*')
    expect(suggestedTerminalCommandRule('docker exec -it app sh')).toBe('docker exec -it app sh:*')
  })

  it('prefers the agent-proposed rule when it matches the command', () => {
    expect(resolveTerminalCommandRule('bun run dev:*', 'bun run dev --port 3000')).toBe('bun run dev:*')
    expect(resolveTerminalCommandRule(' bun  run:* ', 'bun run dev')).toBe('bun run:*')
    expect(resolveTerminalCommandRule('python3', 'python3')).toBe('python3')
  })

  it('falls back to the derived suggestion when the proposal is missing or does not match', () => {
    expect(resolveTerminalCommandRule(undefined, 'bun run dev')).toBe('bun run:*')
    expect(resolveTerminalCommandRule('git commit:*', 'bun run dev')).toBe('bun run:*')
    expect(resolveTerminalCommandRule('bun run dev-old:*', 'bun run dev')).toBe('bun run:*')
    expect(resolveTerminalCommandRule('', 'bun run dev')).toBe('bun run:*')
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
