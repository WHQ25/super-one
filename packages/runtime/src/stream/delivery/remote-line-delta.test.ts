import { describe, expect, it } from 'vitest'
import type { AgentEvent, CodexThreadItem } from '@superone/shared/agent-types'
import { computeLineDelta, countPrefixedDiffDelta } from '@superone/chat-core/turn-process/line-delta'
import { computeToolLineDelta, computeToolMeta, stripEventForRemote } from './remote-content'
import { projectCodexTool, projectTool } from './progressive-tools'

function permissionDelta(toolName: string, input: Record<string, unknown>) {
  const event: AgentEvent = { type: 'permission_request', request: {
    requestId: 'p', toolName, input, allowAlwaysAllow: false,
  } }
  const projected = stripEventForRemote(event)
  if (projected.type !== 'permission_request') throw new Error('Expected a permission request')
  return projected.request
}

describe('file line counts across local, remote and permission views', () => {
  it.each([
    ['', 0], ['hello', 1], ['hello\n', 1], ['hello\r\n', 1],
    ['\n', 1], ['hello\n\n', 2], ['hello\r\n\r\n', 2],
  ] as const)('counts Write %j as %i source lines everywhere', (content, added) => {
    const input = { file_path: '/p/a.ts', content }
    const block = { type: 'tool_use' as const, toolName: 'Write', toolUseId: 'w', input: JSON.stringify(input), status: 'complete' as const }
    const expected = added ? { added, removed: 0 } : undefined
    expect(computeLineDelta('Write', input) ?? undefined).toEqual(expected)
    expect(computeToolLineDelta('Write', block.input)).toEqual(expected)
    const projected = projectTool(block, 'ref')
    expect('toolLineDelta' in projected ? projected.toolLineDelta : undefined).toEqual(expected)
    const meta = computeToolMeta(block)
    const permission = permissionDelta('Write', input)
    expect(meta.toolLineDelta).toEqual(expected)
    expect(permission.toolLineDelta).toEqual(expected)
    expect(countPrefixedDiffDelta(meta.toolDiff ?? '') ?? undefined).toEqual(expected)
    expect(countPrefixedDiffDelta(permission.toolDiff ?? '') ?? undefined).toEqual(expected)
  })

  it.each(['add', 'delete'] as const)('preserves Codex %s counts in both projection paths and the expanded diff', (kind) => {
    const input = { file_path: '/p/a.ts', kind, diff: 'one\r\ntwo\r\n\r\n' }
    const expected = kind === 'add' ? { added: 3, removed: 0 } : { added: 0, removed: 3 }
    const block = { type: 'tool_use' as const, toolName: 'FileChange', toolUseId: 'f', input: JSON.stringify(input) }
    expect(computeLineDelta('FileChange', input)).toEqual(expected)
    expect(projectTool(block, 'ref')).toHaveProperty('toolLineDelta', expected)
    const meta = computeToolMeta(block)
    expect(meta.toolLineDelta).toEqual(expected)
    expect(countPrefixedDiffDelta(meta.toolDiff ?? '')).toEqual(expected)
    const item: CodexThreadItem = { id: 'f', type: 'file_change', status: 'completed', changes: [
      { path: input.file_path, kind, diff: input.diff },
    ] }
    expect(projectCodexTool(item, 'ref')).toMatchObject({ toolLineDelta: expected, changes: [{ toolLineDelta: expected }] })
  })

  it.each([
    ['before', 'after\n', { added: 1, removed: 1 }],
    ['same', 'same\n', undefined],
    ['one\ntwo\n', 'one\ntwo', undefined],
    ['one\ntwo', 'one\ntwo\nthree', { added: 1, removed: 0 }],
    ['before\r\n', 'after\r\n', { added: 1, removed: 1 }],
  ] as const)('uses the local Edit rule for %j → %j', (old_string, new_string, expected) => {
    const input = { file_path: '/p/a.ts', old_string, new_string }
    const block = { type: 'tool_use' as const, toolName: 'Edit', toolUseId: 'e', input: JSON.stringify(input) }
    expect(computeLineDelta('Edit', input) ?? undefined).toEqual(expected)
    expect(computeToolLineDelta('Edit', block.input)).toEqual(expected)
    const meta = computeToolMeta(block)
    const permission = permissionDelta('Edit', input)
    expect(meta.toolLineDelta).toEqual(expected)
    expect(permission.toolLineDelta).toEqual(expected)
    expect(countPrefixedDiffDelta(meta.toolDiff ?? '') ?? undefined).toEqual(expected)
    expect(countPrefixedDiffDelta(permission.toolDiff ?? '') ?? undefined).toEqual(expected)
  })
})
