import { describe, expect, it } from 'vitest'
import { mapCodexCommandItem } from './command-item'
import { mapCodexThreadItem } from './agent-event-mapper'

describe('Codex command mapping', () => {
  it('preserves cwd and resolves all operands before a partial update omits metadata', () => {
    const started = mapCodexThreadItem({ id: 'read', type: 'commandExecution', cwd: '/repo',
      command: "sed -n '1,20p' src/a.ts src/b.ts", status: 'inProgress',
      commandActions: [{ type: 'read', path: '/repo/src/a.ts' }],
    })
    expect(started).toMatchObject({ cwd: '/repo', status: 'in_progress', commandActions: [
      { type: 'read', path: '/repo/src/a.ts' }, { type: 'read', path: '/repo/src/b.ts' },
    ] })
    const completed = mapCodexThreadItem({ id: 'read', type: 'commandExecution', status: 'completed',
      aggregated_output: 'combined output', exit_code: 0 }, started ?? undefined)
    expect(completed).toMatchObject({ cwd: '/repo', aggregatedOutput: 'combined output', exitCode: 0, commandActions: started?.type === 'command_execution' ? started.commandActions : [] })
    expect(completed?.type === 'command_execution' && mapCodexCommandItem('read', { command: '', cwd: '', aggregatedOutput: '' }, completed))
      .toMatchObject({ cwd: '/repo', command: "sed -n '1,20p' src/a.ts src/b.ts", aggregatedOutput: 'combined output' })
  })

  it('retains every upstream action, including unknown actions in a mixed command', () => {
    const actions = [{ type: 'read', path: '/repo/a.ts' }, { type: 'search', query: 'TODO' }, { type: 'unknown', command: 'rm temp' }]
    expect(mapCodexCommandItem('mixed', { command: 'opaque', commandActions: actions, status: 'declined' }))
      .toMatchObject({ commandActions: actions, status: 'failed' })
  })

  it('keeps the existing numeric exit-code compatibility without accepting non-finite values', () => {
    expect(mapCodexCommandItem('command', { exit_code: '1' }).exitCode).toBe(1)
    expect(mapCodexCommandItem('command', { exitCode: Number.NaN, exit_code: '0' }).exitCode).toBe(0)
  })
})
