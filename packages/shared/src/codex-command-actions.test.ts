import { describe, expect, it } from 'vitest'
import type { CodexCommandExecutionItem } from './agent-types'
import { codexCommandPresentation, resolveCodexCommandActions, summarizeCodexCommandActions } from './codex-command-actions'

function item(command: string, commandActions?: CodexCommandExecutionItem['commandActions']): CodexCommandExecutionItem {
  return { id: 'command', type: 'command_execution', command, commandActions, cwd: '/repo', aggregatedOutput: '', status: 'completed' }
}

describe('Codex command actions', () => {
  it.each(['cat a.ts b.ts', "head -n 20 a.ts b.ts", "tail -n +5 a.ts b.ts", "sed -n '1,20p' a.ts b.ts"])(
    'recognizes every literal file operand in %s', (command) => {
      const result = codexCommandPresentation(item(command, [{ type: 'unknown', command }]))
      expect(result.kind).toBe('read')
      expect(result.files).toEqual(['/repo/a.ts', '/repo/b.ts'])
      expect(result.actions.map(action => action.path)).toEqual(result.files)
    },
  )

  it('corrects an upstream single-file summary without losing quoted filenames or -- operands', () => {
    const result = resolveCodexCommandActions(item("/bin/zsh -lc 'cat -- \"a file.ts\" -b.ts'", [{ type: 'read', path: '/repo/a file.ts' }]))
    expect(result.map(action => action.path)).toEqual(['/repo/a file.ts', '/repo/-b.ts'])
  })

  it('tracks literal cd and preserves distinct commands reading the same file', () => {
    const result = codexCommandPresentation(item("cd src && sed -n '1,20p' a.ts; head -n 40 a.ts"))
    expect(result.files).toEqual(['/repo/src/a.ts'])
    expect(result.actions).toHaveLength(2)
  })

  it('preserves every upstream action and classifies mixed exploration', () => {
    const actions = [{ type: 'read', path: '/repo/a.ts' }, { type: 'search', query: 'TODO', path: '/repo/src' }, { type: 'listFiles', path: '/repo/tests' }]
    const result = codexCommandPresentation(item('compound shell command', actions))
    expect(result).toMatchObject({ kind: 'explore', actions, files: ['/repo/a.ts'] })
    expect(summarizeCodexCommandActions([item('compound shell command', actions)])).toEqual({ files: 1, searches: 1, lists: 1 })
  })

  it('counts unique full paths across calls, rather than calls or basenames', () => {
    expect(summarizeCodexCommandActions([
      item('opaque', [{ type: 'read', path: '/repo/a/index.ts' }, { type: 'read', path: '/repo/b/index.ts' }]),
      item('opaque', [{ type: 'read', path: '/repo/a/index.ts' }]),
    ])).toEqual({ files: 2, searches: 0, lists: 0 })
  })

  it('supplements a multi-file read action inside mixed exploration without changing its search', () => {
    const search = { type: 'search', query: 'TODO', path: '/repo/src' }
    const result = codexCommandPresentation(item('head -n 10 a.ts b.ts && rg TODO src', [
      { type: 'read', command: 'head -n 10 a.ts b.ts', path: '/repo/a.ts' }, search,
    ]))
    expect(result.kind).toBe('explore')
    expect(result.files).toEqual(['/repo/a.ts', '/repo/b.ts'])
    expect(result.actions.at(-1)).toBe(search)
    expect(resolveCodexCommandActions({ ...item('opaque'), commandActions: result.actions })).toEqual(result.actions)
  })

  it('preserves upstream paths after an unparsed directory change and on legacy items without cwd', () => {
    const action = { type: 'read', path: '/repo/sub/a.ts', command: 'head -n 10 a.ts b.ts' }
    expect(resolveCodexCommandActions(item('cd sub && head -n 10 a.ts b.ts && rg TODO .', [action, { type: 'search' }]))[0]).toBe(action)
    expect(resolveCodexCommandActions({ ...item('cat a.ts', [action]), cwd: undefined })).toEqual([action])
    const repeated = [{ type: 'read', path: '/repo/a.ts', command: 'head -n 10 a.ts' }, { type: 'read', path: '/repo/a.ts', command: 'tail -n 10 a.ts' }]
    expect(resolveCodexCommandActions(item('cat a.ts', repeated))).toEqual(repeated)
  })

  it('keeps bounded parser work and unsupported platform paths as Bash', () => {
    for (const command of [`cat ${'a'.repeat(16_384)}`, `cat ${Array.from({ length: 129 }, (_, i) => `${i}.ts`).join(' ')}`,
      'cd missing; cat a.ts', './cat a.ts', '/tmp/cat a.ts', 'cat "C:\\repo\\a.ts"']) {
      expect(codexCommandPresentation(item(command)).kind).toBe('bash')
    }
  })

  it.each([
    'cat a.ts && rm b.ts', 'cat a.ts > b.ts', 'cat $(find src -type f)', 'cat "$FILE"',
    'cat src/*.ts', 'cat a.ts | node script.js', "sed -ni '1p' a.ts", "sed -n '1p;w output.ts' a.ts",
    'head --help a.ts', 'cat a.ts & cat b.ts', 'cat a.ts\nrm b.ts', 'cat a.ts # b.ts',
  ])('keeps complex or mutating commands as Bash: %s', (command) => {
    expect(codexCommandPresentation(item(command, [{ type: 'unknown', command }])).kind).toBe('bash')
  })

  it('does not classify a mixed known/unknown action array as read-only', () => {
    expect(codexCommandPresentation(item('opaque', [{ type: 'read', path: '/repo/a.ts' }, { type: 'unknown', command: 'rm b.ts' }])).kind).toBe('bash')
  })
})
