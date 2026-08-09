import { describe, it, expect } from 'vitest'
import {
  extractJsonArgsTail,
  extractPresentJsonKeys,
  mergeArgIntoWorkflowLine,
  suggestJsonKeys,
  currentPartialKey,
  buildArgsExampleObject,
} from './workflow-json-args'

const SPECS = [
  { name: 'focus', description: 'free-text emphasis' },
  { name: 'domains', description: 'array of domain ids' },
  { name: 'max_verify', description: 'max features (default: 16)' },
]

describe('extractJsonArgsTail', () => {
  it('strips the workflow name', () => {
    expect(extractJsonArgsTail('client-cli-coverage-scan {"a":1}', 'client-cli-coverage-scan'))
      .toBe('{"a":1}')
    expect(extractJsonArgsTail('client-cli-coverage-scan ', 'client-cli-coverage-scan')).toBe('')
  })
})

describe('extractPresentJsonKeys', () => {
  it('finds keys in partial or complete JSON', () => {
    expect([...extractPresentJsonKeys('{"focus":"","domains":[]}')].sort()).toEqual(['domains', 'focus'])
    expect([...extractPresentJsonKeys('{"fo')]).toEqual([])
  })
})

describe('mergeArgIntoWorkflowLine', () => {
  it('starts a JSON object with the first key', () => {
    expect(mergeArgIntoWorkflowLine('scan', 'scan ', SPECS[0]!, SPECS))
      .toBe('/workflow scan {"focus":""} ')
  })

  it('merges into existing valid JSON', () => {
    expect(mergeArgIntoWorkflowLine('scan', 'scan {"focus":"x"}', SPECS[1]!, SPECS))
      .toBe('/workflow scan {"focus":"x","domains":[]} ')
  })
})

describe('currentPartialKey / suggestJsonKeys', () => {
  it('detects partial key after brace', () => {
    expect(currentPartialKey('{"fo')).toBe('fo')
    expect(currentPartialKey('{"focus":"","do')).toBe('do')
  })

  it('suggests missing keys filtered by partial', () => {
    const s = suggestJsonKeys('{"fo', SPECS)
    expect(s.map((x) => x.name)).toEqual(['focus'])
  })

  it('lists all missing keys when JSON is empty object mid-type', () => {
    const s = suggestJsonKeys('{', SPECS)
    expect(s.map((x) => x.name).sort()).toEqual(['domains', 'focus', 'max_verify'])
  })
})

describe('buildArgsExampleObject', () => {
  it('fills defaults from descriptions', () => {
    const o = buildArgsExampleObject(SPECS)
    expect(o.focus).toBe('')
    expect(o.domains).toEqual([])
    expect(o.max_verify).toBe(16)
  })
})
