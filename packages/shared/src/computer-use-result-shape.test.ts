import { describe, expect, it } from 'vitest'
import {
  isComputerUseToolName,
  looksLikeComputerUseOutline,
  looksLikeComputerUseResult,
} from './computer-use-result-shape'

describe('computer-use result shape', () => {
  it('matches computer_* tools under any MCP prefix', () => {
    expect(isComputerUseToolName('computer_snapshot')).toBe(true)
    expect(isComputerUseToolName('superone__computer_snapshot')).toBe(true)
    expect(isComputerUseToolName('mcp__superone__computer_query')).toBe(true)
    expect(isComputerUseToolName('mcp__superone__computer_act')).toBe(true)
  })

  it('does not match unrelated tools that merely contain the word', () => {
    // device_* drives phones and has its own (smaller) result shape.
    expect(isComputerUseToolName('device_snapshot')).toBe(false)
    expect(isComputerUseToolName('browser_snapshot')).toBe(false)
    expect(isComputerUseToolName('computer_use_grant')).toBe(false)
    expect(isComputerUseToolName(undefined)).toBe(false)
  })

  it('recognises the envelope by shape when the tool name is missing', () => {
    expect(looksLikeComputerUseResult({ stateId: 'S1', outline: 'outline[3]{ref…' })).toBe(true)
    expect(looksLikeComputerUseResult({ stateId: 'S1', root: { app: 'Kimi', bundleId: 'com.moonshot.kimichat' } })).toBe(true)
    expect(looksLikeComputerUseResult({ stateId: 'S2', subtree: 'outline[1]{ref…' })).toBe(true)
  })

  it('rejects envelopes that only look similar', () => {
    expect(looksLikeComputerUseResult({ stateId: 'S1' })).toBe(false)
    expect(looksLikeComputerUseResult({ outline: 'x' })).toBe(false)
    expect(looksLikeComputerUseResult({ status: 'ok', messages: [] })).toBe(false)
  })

  it('recognises the outline table header before the envelope is parsed', () => {
    const summary = '{"stateId":"S1","outline":"outline[180]{ref,depth,role,name…'
    expect(looksLikeComputerUseOutline(summary)).toBe(true)
    expect(looksLikeComputerUseOutline('{"stateId":"S1","outcome":"worked"}')).toBe(false)
  })
})

describe('envelope recognition is narrow enough to be safe', () => {
  const root = { app: 'Kimi', bundleId: 'com.moonshot.kimichat' }

  it('recognises a sparse computer_act completion by its successor fields', () => {
    // This is the payload that still got sliced to 4000 chars: an act result
    // carries successorStateId / successorRoot, never stateId / root.
    expect(looksLikeComputerUseResult({ successorStateId: 'S4', successorRoot: root })).toBe(true)
  })

  it('recognises a query result by its matches array', () => {
    expect(looksLikeComputerUseResult({ stateId: 'S1', root, matches: [] })).toBe(true)
  })

  it('rejects a generic state machine that merely has a root object', () => {
    // The loose branch this replaced matched any {stateId, root:{…}} payload and
    // would have exempted it from the size cap.
    expect(looksLikeComputerUseResult({ stateId: 'S1', root: { rootId: '@r1' } })).toBe(false)
    expect(looksLikeComputerUseResult({ stateId: 'S1', root: { app: 'Kimi' } })).toBe(false)
    expect(looksLikeComputerUseResult({ stateId: 'S1', root: { bundleId: 'x.y' } })).toBe(false)
  })

  it('still exempts a third-party computer-use server by tool name', () => {
    // The user's machine runs an open-computer-use MCP server whose results are
    // the same size and break the same way when cut.
    expect(isComputerUseToolName('open_computer_use__computer_snapshot')).toBe(true)
  })
})
