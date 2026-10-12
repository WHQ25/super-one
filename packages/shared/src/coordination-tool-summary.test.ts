import { describe, expect, it } from 'vitest'
import { coordinationToolSummary } from './coordination-tool-summary'

const relative = (path: string) => path.replace('/repo/', '')

describe('coordinationToolSummary', () => {
  it('names the recipient and the sender’s own label, else the preview line', () => {
    expect(coordinationToolSummary('SendMessage', { to: 'worker', summary: 'assign task 1', message: 'start on task #1' }, relative))
      .toBe('worker · assign task 1')
    expect(coordinationToolSummary('SendMessage', { to: 'worker', message: 'Check the tests.\nThen report back.' }, relative))
      .toBe('worker · Check the tests.')
    expect(coordinationToolSummary('SendMessage', { to: 'lead', message: { type: 'shutdown_response', request_id: 'r', approve: true } }, relative))
      .toBe('lead · shutdown_response')
  })

  it('shows the first line of a handback report', () => {
    expect(coordinationToolSummary('SubagentHandback', { message: '\nFound 3 call sites.\n\n## Details' }, relative)).toBe('Found 3 call sites.')
  })

  it('names the worktree entered and how it was left', () => {
    expect(coordinationToolSummary('EnterWorktree', { name: 'probe' }, relative)).toBe('probe')
    expect(coordinationToolSummary('EnterWorktree', { path: '/repo/.claude/worktrees/probe' }, relative)).toBe('.claude/worktrees/probe')
    expect(coordinationToolSummary('ExitWorktree', { action: 'keep' }, relative)).toBe('keep')
    expect(coordinationToolSummary('ExitWorktree', { action: 'remove', discard_changes: true }, relative)).toBe('remove · discard changes')
  })

  it('leaves partial input empty and other tools alone', () => {
    expect(coordinationToolSummary('ExitWorktree', {}, relative)).toBe('')
    expect(coordinationToolSummary('SendMessage', {}, relative)).toBe('')
    expect(coordinationToolSummary('Bash', { command: 'ls' }, relative)).toBeNull()
  })
})
