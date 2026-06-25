import { describe, it, expect } from 'vitest'
import { collectBackgroundActivities, computeIsInWorktree } from './ChatStatusBar'
import type { ContentBlock } from '@superone/shared/agent-types'

function toolUse(id: string, toolName: string, input: Record<string, unknown>, status: 'streaming' | 'complete' = 'streaming'): ContentBlock & { type: 'tool_use' } {
  return { type: 'tool_use', toolName, toolUseId: id, input: JSON.stringify(input), status, parentToolUseId: null } as ContentBlock & { type: 'tool_use' }
}

function toolResult(id: string, opts: { outputPath?: string; summary?: string } = {}): ContentBlock & { type: 'tool_result' } {
  return { type: 'tool_result', toolUseId: id, summary: opts.summary ?? '', outputPath: opts.outputPath, parentToolUseId: null } as ContentBlock & { type: 'tool_result' }
}

function msg(...blocks: ContentBlock[]) {
  return { content: blocks }
}

describe('collectBackgroundActivities', () => {
  describe('bash filtering', () => {
    it('shows bash with run_in_background while streaming', () => {
      const messages = [msg(toolUse('t1', 'Bash', { command: 'sleep 10', run_in_background: true }))]
      const { bashActivities } = collectBackgroundActivities(messages, {})
      expect(bashActivities).toHaveLength(1)
      expect(bashActivities[0].title).toBe('sleep 10')
    })

    it('hides bash with run_in_background after tool completes', () => {
      const messages = [msg(
        toolUse('t1', 'Bash', { command: 'sleep 10', run_in_background: true }, 'complete'),
        toolResult('t1'),
      )]
      const { bashActivities } = collectBackgroundActivities(messages, {})
      expect(bashActivities).toHaveLength(0)
    })

    it('shows bash with run_in_background and taskProgress while not completed', () => {
      const messages = [msg(toolUse('t1', 'Bash', { command: 'sleep 10', run_in_background: true }))]
      const progress = { t1: { description: 'running', completed: false } }
      const { bashActivities } = collectBackgroundActivities(messages, progress)
      expect(bashActivities).toHaveLength(1)
    })

    it('hides bash with run_in_background after task_notification completes', () => {
      const messages = [msg(toolUse('t1', 'Bash', { command: 'sleep 10', run_in_background: true }))]
      const progress = { t1: { description: 'done', completed: true } }
      const { bashActivities } = collectBackgroundActivities(messages, progress)
      expect(bashActivities).toHaveLength(0)
    })

    it('shows bash with outputPath while taskProgress not completed', () => {
      const messages = [msg(
        toolUse('t1', 'Bash', { command: 'sleep 10' }, 'complete'),
        toolResult('t1', { outputPath: '/tmp/output.output' }),
      )]
      const progress = { t1: { description: 'running', completed: false } }
      const { bashActivities } = collectBackgroundActivities(messages, progress)
      expect(bashActivities).toHaveLength(1)
    })

    it('hides bash with outputPath after task_notification completes', () => {
      const messages = [msg(
        toolUse('t1', 'Bash', { command: 'sleep 10' }, 'complete'),
        toolResult('t1', { outputPath: '/tmp/output.output' }),
      )]
      const progress = { t1: { description: 'done', completed: true } }
      const { bashActivities } = collectBackgroundActivities(messages, progress)
      expect(bashActivities).toHaveLength(0)
    })

    it('does not show foreground bash even with stale taskProgress', () => {
      const messages = [msg(
        toolUse('t1', 'Bash', { command: 'fastlane beta', timeout: 600000 }, 'complete'),
        toolResult('t1', { summary: 'Exit code 0' }),
      )]
      const progress = { t1: { description: 'fastlane beta', completed: false } }
      const { bashActivities } = collectBackgroundActivities(messages, progress)
      expect(bashActivities).toHaveLength(0)
    })

    it('does not show foreground bash without any background signals', () => {
      const messages = [msg(
        toolUse('t1', 'Bash', { command: 'ls -la' }, 'complete'),
        toolResult('t1', { summary: 'file1\nfile2' }),
      )]
      const { bashActivities } = collectBackgroundActivities(messages, {})
      expect(bashActivities).toHaveLength(0)
    })

    it('does not show streaming foreground bash', () => {
      const messages = [msg(toolUse('t1', 'Bash', { command: 'npm test' }))]
      const { bashActivities } = collectBackgroundActivities(messages, {})
      expect(bashActivities).toHaveLength(0)
    })
  })

  describe('worktree indicator gate', () => {
    const noWt = { pendingBaseBranch: null, activePath: null }

    it('returns true when app-store has an active worktree path, regardless of session state', () => {
      // Regression: WorkDirIndicator (which only looks at app-store) showed "Worktree web/ui-mock"
      // while ChatStatusBar's git branch indicator (feat/video-demos) was simultaneously visible
      // because isInWorktree mistakenly required session._gitBranch to also be set.
      // Single source of truth: app-store's worktree state.
      const wt = { pendingBaseBranch: null, activePath: '/repo/.worktrees/web-ui-mock' }
      expect(computeIsInWorktree(wt)).toBe(true)
    })

    it('returns true when pending base branch is set', () => {
      const wt = { pendingBaseBranch: 'main', activePath: null }
      expect(computeIsInWorktree(wt)).toBe(true)
    })

    it('returns true when both pending and active are set', () => {
      const wt = { pendingBaseBranch: 'main', activePath: '/repo/.worktrees/x' }
      expect(computeIsInWorktree(wt)).toBe(true)
    })

    it('returns false when neither pending nor active path is set', () => {
      expect(computeIsInWorktree(noWt)).toBe(false)
    })

    it('returns false when wtState is undefined (no project)', () => {
      expect(computeIsInWorktree(undefined)).toBe(false)
    })
  })

  describe('agent filtering', () => {
    it('shows background agent while streaming', () => {
      const messages = [msg(toolUse('t1', 'Agent', { run_in_background: true, description: 'Research task' }))]
      const { agentActivities } = collectBackgroundActivities(messages, {})
      expect(agentActivities).toHaveLength(1)
      expect(agentActivities[0].title).toBe('Research task')
    })

    it('hides foreground agent', () => {
      const messages = [msg(toolUse('t1', 'Agent', { description: 'Inline agent' }))]
      const { agentActivities } = collectBackgroundActivities(messages, {})
      expect(agentActivities).toHaveLength(0)
    })

    it('hides completed background agent', () => {
      const messages = [msg(toolUse('t1', 'Agent', { run_in_background: true }))]
      const progress = { t1: { description: 'done', completed: true } }
      const { agentActivities } = collectBackgroundActivities(messages, progress)
      expect(agentActivities).toHaveLength(0)
    })
  })
})
