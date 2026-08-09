import { describe, it, expect } from 'vitest'
import type { WorkflowArgSpec } from '@superone/shared/workflow-args'
import {
  parseCliArgsTail,
  formatCliDefault,
  applyKeyWithDefault,
  tabOutOfValue,
  cliArgsTailToJson,
  suggestCliKeys,
  rewriteWorkflowCommandForAgent,
  inferArgKind,
} from './workflow-cli-args'

const SPECS: WorkflowArgSpec[] = [
  { name: 'focus', description: 'free-text emphasis (default: thermal/idle heat)' },
  { name: 'domains', description: 'array of domain ids' },
  { name: 'max_verify', description: 'max findings (default: 10, max: 12)' },
  { name: 'auto_approve', description: 'if true, skip plan approval' },
]

describe('inferArgKind / formatCliDefault', () => {
  it('classifies common kinds', () => {
    expect(inferArgKind(SPECS[0]!)).toBe('string')
    expect(inferArgKind(SPECS[1]!)).toBe('string[]')
    expect(inferArgKind(SPECS[2]!)).toBe('number')
    expect(inferArgKind(SPECS[3]!)).toBe('boolean')
  })

  it('formats defaults for CLI', () => {
    expect(formatCliDefault(SPECS[1]!)).toBe('[]')
    expect(formatCliDefault(SPECS[2]!)).toBe('10')
    expect(formatCliDefault(SPECS[3]!)).toBe('false')
  })
})

describe('parseCliArgsTail', () => {
  it('parses complete pairs and expectKey after trailing space', () => {
    const p = parseCliArgsTail('focus=thermal max_verify=10 ')
    expect(p.pairs.map((x) => x.key)).toEqual(['focus', 'max_verify'])
    expect(p.trailing.kind).toBe('expectKey')
  })

  it('detects partial key', () => {
    const p = parseCliArgsTail('focus=thermal max')
    expect(p.trailing).toMatchObject({ kind: 'partialKey', text: 'max' })
  })

  it('detects inValue at end of pair', () => {
    const p = parseCliArgsTail('domains=[]')
    expect(p.trailing.kind).toBe('inValue')
    if (p.trailing.kind === 'inValue') {
      expect(p.trailing.value).toBe('[]')
      expect(p.trailing.key).toBe('domains')
    }
  })

  it('free text without =', () => {
    const p = parseCliArgsTail('compare postgres vs mysql')
    expect(p.freeText).toBe('compare postgres vs mysql')
  })
})

describe('applyKeyWithDefault + tabOutOfValue', () => {
  it('Tab completes key with selected default span', () => {
    const r = applyKeyWithDefault('scan', 'scan foc', SPECS[0]!)
    expect(r.line.startsWith('/workflow scan focus=')).toBe(true)
    expect(r.selectFrom).toBeDefined()
    expect(r.selectTo).toBeDefined()
    const val = r.line.slice(r.selectFrom!, r.selectTo!)
    expect(val.length).toBeGreaterThan(0)
    expect(r.line.slice(0, r.selectFrom!)).toMatch(/focus=$/)
  })

  it('Tab from value exits to trailing space without auto-filling next key', () => {
    const first = applyKeyWithDefault('scan', 'scan ', SPECS[0]!)
    const out = tabOutOfValue('scan', first.line.replace(/^\/workflow\s+/, ''))
    expect(out.line).toMatch(/^\/workflow scan focus=.+ $/)
    expect(out.line).not.toContain('domains=')
    expect(out.selectFrom).toBeUndefined()
    expect(out.selectTo).toBeUndefined()
  })
})

describe('suggestCliKeys', () => {
  it('filters remaining keys', () => {
    const s = suggestCliKeys('focus=x max', SPECS)
    expect(s.map((x) => x.name)).toEqual(['max_verify'])
  })
})

describe('cliArgsTailToJson', () => {
  it('converts key=value to object', () => {
    const r = cliArgsTailToJson('focus=thermal domains=session,harness max_verify=10 auto_approve=true', SPECS)
    expect(r).toEqual({
      mode: 'json',
      value: {
        focus: 'thermal',
        domains: ['session', 'harness'],
        max_verify: 10,
        auto_approve: true,
      },
    })
  })

  it('keeps free text for Grok native', () => {
    expect(cliArgsTailToJson('hello world', SPECS)).toEqual({
      mode: 'freeText',
      text: 'hello world',
    })
  })
})

describe('rewriteWorkflowCommandForAgent', () => {
  it('rewrites CLI style to JSON', () => {
    const out = rewriteWorkflowCommandForAgent(
      '/workflow scan focus=thermal max_verify=10',
      () => SPECS,
    )
    expect(out).toBe('/workflow scan {"focus":"thermal","max_verify":10}')
  })

  it('leaves free text and JSON alone', () => {
    expect(rewriteWorkflowCommandForAgent('/workflow scan hello', () => SPECS))
      .toBe('/workflow scan hello')
    expect(rewriteWorkflowCommandForAgent('/workflow scan {"a":1}', () => SPECS))
      .toBe('/workflow scan {"a":1}')
  })
})
