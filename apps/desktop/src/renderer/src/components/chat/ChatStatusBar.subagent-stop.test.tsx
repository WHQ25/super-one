/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ChatMessage, HarnessId } from '@superone/shared/agent-types'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { ChatStatusBar } from './ChatStatusBar'

const PROJECT = '/tmp/superone-status'

type Activity = 'agent' | 'bash' | 'monitor'

const ACTIVITY = {
  agent: {
    id: 'agent-1',
    chip: 'Agent',
    panel: 'Running Agent',
    body: 'Chrome Extension Engineer',
    toolName: 'Agent',
    input: { description: 'Chrome Extension Engineer', subagent_type: 'self', run_in_background: true },
  },
  bash: {
    id: 'bash-1',
    chip: 'Bash',
    panel: 'Background Bash',
    body: 'bun test',
    toolName: 'Bash',
    input: { command: 'bun test', run_in_background: true, description: 'run tests' },
  },
  monitor: {
    id: 'mon',
    chip: 'Monitor',
    panel: 'Background Monitor',
    body: 'watch the build',
    toolName: 'Monitor',
    input: { command: 'tail -f build.log', description: 'watch the build' },
  },
} as const

function activityMessage(kind: Activity): ChatMessage {
  const activity = ACTIVITY[kind]
  return {
    id: 'a1',
    role: 'assistant',
    status: 'complete',
    createdAt: '2026-01-01T00:00:00.000Z',
    providerId: 'test',
    content: [{
      type: 'tool_use',
      toolName: activity.toolName,
      toolUseId: activity.id,
      input: JSON.stringify(activity.input),
      status: 'complete',
      parentToolUseId: null,
    }],
  }
}

function seed(harness: HarnessId, kind: Activity): void {
  useChatStore.getState().ensureSession(PROJECT)
  useChatStore.setState({ activeProject: PROJECT })
  useChatStore.setState((state) => {
    const project = state.projectSessions[PROJECT]
    const sid = project._activeSessionId!
    return {
      projectSessions: {
        ...state.projectSessions,
        [PROJECT]: {
          ...project,
          _sessions: {
            ...project._sessions,
            [sid]: {
              ...project._sessions[sid],
              sessionProvider: harness,
              preferredProvider: harness,
              status: 'idle',
              messages: [activityMessage(kind)],
              taskProgress: {
                [ACTIVITY[kind].id]: {
                  description: ACTIVITY[kind].body,
                  taskId: 'task-1',
                  completed: false,
                  totalTokens: 0,
                  toolUses: 0,
                  durationMs: 0,
                  toolHistory: [],
                },
              },
            },
          },
        },
      },
    }
  })
}

beforeEach(() => {
  Object.assign(window.app, {
    getGitInfo: vi.fn(async () => ({ branch: 'main', dirty: { files: 0, insertions: 0, deletions: 0 } })),
    getWorktreeInfo: vi.fn(async () => ({ isWorktree: false, currentBranch: 'main', entries: [] })),
    collaborationMailbox: { list: async () => [], onChanged: () => () => {} },
  })
  useAppStore.setState({ experimentalRemoteNodesEnabled: false, currentFolder: PROJECT, _worktrees: {} })
})

afterEach(cleanup)

function activityChip(name: string): HTMLElement {
  const chip = screen.getAllByRole('button', { name }).find((element) => !element.getAttribute('aria-haspopup'))
  if (!chip) throw new Error(`${name} chip missing`)
  return chip
}

describe('background task stop control', () => {
  it.each([
    ['claude', 'agent'],
    ['dsh', 'agent'],
    ['claude', 'bash'],
    ['dsh', 'bash'],
    ['claude', 'monitor'],
    ['dsh', 'monitor'],
  ] as const)('shows the stop control for a %s %s', async (harness, kind) => {
    seed(harness, kind)
    const user = userEvent.setup()
    render(<ChatStatusBar />)
    await user.click(await waitFor(() => activityChip(ACTIVITY[kind].chip)))
    expect(await screen.findByText(ACTIVITY[kind].panel)).toBeTruthy()
    expect(screen.getByTitle('Stop task')).toBeTruthy()
  })

  it.each([
    ['codex', 'agent'],
    ['acp-grok', 'agent'],
    ['acp-antigravity', 'bash'],
    ['opencode', 'monitor'],
    ['cursor', 'agent'],
    ['acp-grok', 'bash'],
    ['acp-grok', 'monitor'],
  ] as const)('hides the stop control for a %s %s', async (harness, kind) => {
    seed(harness, kind)
    const user = userEvent.setup()
    render(<ChatStatusBar />)
    await user.click(await waitFor(() => activityChip(ACTIVITY[kind].chip)))
    await waitFor(() => expect(screen.getByText(ACTIVITY[kind].panel)).toBeTruthy())
    expect(screen.getByText(ACTIVITY[kind].body)).toBeTruthy()
    expect(screen.queryByTitle('Stop task')).toBeNull()
  })
})
