import { describe, expect, it } from 'vitest'
import {
  MIN_CLI_NODE_VERSION,
  cliNodeEngineRange,
  cliNodeEsbuildTarget,
  nodeVersionSatisfies,
} from './node-runtime'

describe('CLI node floor', () => {
  it('is the Cursor SDK engine floor', () => {
    expect(MIN_CLI_NODE_VERSION).toBe('22.13.0')
    expect(cliNodeEngineRange()).toBe('>=22.13.0')
    expect(cliNodeEsbuildTarget()).toBe('node22')
  })

  it.each(['20.19.2', '22.0.0', '22.12.9', '22'])('rejects %s', (version) => {
    expect(nodeVersionSatisfies(version)).toBe(false)
  })

  it.each(['22.13.0', '22.13', '22.23.4', '24.0.0', 'v24.14.0'])('accepts %s', (version) => {
    expect(nodeVersionSatisfies(version)).toBe(true)
  })
})
