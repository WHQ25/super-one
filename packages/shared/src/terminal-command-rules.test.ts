import { describe, expect, it } from 'vitest'
import {
  isTerminalCommandAllowed,
  legacyTerminalCommandRuleToRegex,
  matchesTerminalCommandRule,
  resolveTerminalCommandRule,
  suggestedTerminalCommandRule,
  terminalCommandRuleFor,
  validateTerminalCommandRule,
} from './terminal-command-rules'

describe('terminal command rules', () => {
  it('bounds backtracking in proposed and remembered rules and fails closed', () => {
    const command = `${'a'.repeat(100)}!`
    const start = performance.now()
    expect(resolveTerminalCommandRule('(a+)+', command)).toBe(suggestedTerminalCommandRule(command))
    expect(isTerminalCommandAllowed(['(a|aa)+'], command)).toBe(false)
    expect(performance.now() - start).toBeLessThan(2000)
    // A timed-out cached rule cannot later authorize even a matching command.
    expect(matchesTerminalCommandRule('(a+)+', 'aaa')).toBe(false)
  })

  it('turns an approved command into an escaped prefix rule', () => {
    expect(terminalCommandRuleFor('  bun   run storybook ')).toBe('bun run storybook( .*)?')
    expect(terminalCommandRuleFor('vitest run src/a.test.ts')).toBe('vitest run src/a\\.test\\.ts( .*)?')
  })

  it('suggests the command + subcommand as the always-allow rule', () => {
    expect(suggestedTerminalCommandRule('bun run dev')).toBe('bun run( .*)?')
    expect(suggestedTerminalCommandRule('bun run dev --port 3000')).toBe('bun run( .*)?')
    expect(suggestedTerminalCommandRule('git commit -m fix')).toBe('git commit( .*)?')
    expect(suggestedTerminalCommandRule('ls -la /tmp')).toBe('ls( .*)?')
    expect(suggestedTerminalCommandRule('npx vitest run src/a.test.ts')).toBe('npx vitest( .*)?')
  })

  it('generalizes leading env assignments instead of pinning their values', () => {
    const rule = suggestedTerminalCommandRule('REMOTE_DEBUGGING_PORT=9361 bun run dev')
    expect(rule).toBe('(\\w+=\\S+ )*bun run( .*)?')
    expect(matchesTerminalCommandRule(rule, 'REMOTE_DEBUGGING_PORT=9362 bun run dev')).toBe(true)
    expect(matchesTerminalCommandRule(rule, 'A=1 B=2 bun run dev')).toBe(true)
    expect(matchesTerminalCommandRule(rule, 'bun run dev')).toBe(true)
    expect(matchesTerminalCommandRule(rule, 'A=1 sudo bun run dev')).toBe(false)
    expect(suggestedTerminalCommandRule('FOO=1 sudo rm -rf build')).toBe('FOO=1 sudo rm -rf build( .*)?')
  })

  it('keeps the full command when nothing can be dropped safely', () => {
    expect(suggestedTerminalCommandRule('python3')).toBe('python3( .*)?')
    expect(suggestedTerminalCommandRule('npm test')).toBe('npm test( .*)?')
    expect(suggestedTerminalCommandRule('python3 script.py')).toBe('python3 script\\.py( .*)?')
    expect(suggestedTerminalCommandRule('cd x && bun dev')).toBe('cd x && bun dev( .*)?')
    expect(suggestedTerminalCommandRule('echo "a b" c')).toBe('echo "a b" c( .*)?')
    expect(suggestedTerminalCommandRule('sudo rm -rf build')).toBe('sudo rm -rf build( .*)?')
    expect(suggestedTerminalCommandRule('ssh staging -p 22')).toBe('ssh staging -p 22( .*)?')
    expect(suggestedTerminalCommandRule('docker exec -it app sh')).toBe('docker exec -it app sh( .*)?')
  })

  it('prefers the agent-proposed rule when it is valid and matches the command', () => {
    expect(resolveTerminalCommandRule('bun run dev( .*)?', 'bun run dev --port 3000')).toBe('bun run dev( .*)?')
    expect(resolveTerminalCommandRule(' bun  run.* ', 'bun run dev')).toBe('bun run.*')
    expect(resolveTerminalCommandRule('python3', 'python3')).toBe('python3')
    expect(resolveTerminalCommandRule('(\\w+=\\S+ )*bun run dev\\b.*', 'PORT=1 bun run dev')).toBe('(\\w+=\\S+ )*bun run dev\\b.*')
  })

  it('falls back to the derived suggestion when the proposal is missing, invalid or does not match', () => {
    expect(resolveTerminalCommandRule(undefined, 'bun run dev')).toBe('bun run( .*)?')
    expect(resolveTerminalCommandRule('git commit.*', 'bun run dev')).toBe('bun run( .*)?')
    expect(resolveTerminalCommandRule('bun run dev-old.*', 'bun run dev')).toBe('bun run( .*)?')
    expect(resolveTerminalCommandRule('bun run (', 'bun run dev')).toBe('bun run( .*)?')
    expect(resolveTerminalCommandRule('', 'bun run dev')).toBe('bun run( .*)?')
  })

  it('matches the whole command, never a substring', () => {
    expect(matchesTerminalCommandRule('bun run storybook( .*)?', 'bun run storybook')).toBe(true)
    expect(matchesTerminalCommandRule('bun run storybook( .*)?', 'bun run storybook --ci -p 6006')).toBe(true)
    expect(matchesTerminalCommandRule('bun run storybook( .*)?', 'bun run storybook-old')).toBe(false)
    expect(matchesTerminalCommandRule('bun run storybook( .*)?', 'bun run')).toBe(false)
    expect(matchesTerminalCommandRule('bun run', 'sudo bun run')).toBe(false)
    expect(matchesTerminalCommandRule('bun run', 'bun run dev')).toBe(false)
  })

  it('normalizes whitespace on both sides and rejects empty or invalid input', () => {
    expect(matchesTerminalCommandRule('bun  run dev( .*)?', ' bun run   dev ')).toBe(true)
    expect(matchesTerminalCommandRule('', 'anything')).toBe(false)
    expect(matchesTerminalCommandRule('bun.*', '')).toBe(false)
    expect(matchesTerminalCommandRule('bun (', 'bun (')).toBe(false)
  })

  it('validates rule syntax and length', () => {
    expect(validateTerminalCommandRule('bun run( .*)?')).toEqual({ ok: true })
    expect(validateTerminalCommandRule('   ').ok).toBe(false)
    expect(validateTerminalCommandRule('bun (').ok).toBe(false)
    expect(validateTerminalCommandRule('a'.repeat(513)).ok).toBe(false)
  })

  it('checks a command against a rule list', () => {
    const rules = ['bun run storybook( .*)?', 'python3']
    expect(isTerminalCommandAllowed(rules, 'bun run storybook --ci')).toBe(true)
    expect(isTerminalCommandAllowed(rules, 'rm -rf /')).toBe(false)
  })

  it('converts pre-regex rules for the migration', () => {
    expect(legacyTerminalCommandRuleToRegex('bun run storybook:*')).toBe('bun run storybook( .*)?')
    expect(legacyTerminalCommandRuleToRegex('python3')).toBe('python3')
    expect(legacyTerminalCommandRuleToRegex('npx vitest run src/a.test.ts:*')).toBe('npx vitest run src/a\\.test\\.ts( .*)?')
    expect(matchesTerminalCommandRule(legacyTerminalCommandRuleToRegex('bun run storybook:*'), 'bun run storybook --ci')).toBe(true)
    expect(matchesTerminalCommandRule(legacyTerminalCommandRuleToRegex('python3'), 'python3 -i')).toBe(false)
  })
})
