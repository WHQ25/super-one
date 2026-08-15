/** @vitest-environment jsdom */

/**
 * New Cursor sessions default to Claude's `default` mode, which is not in
 * CURSOR_PERMISSION_MODES. The coerce effect must write `auto` at most once —
 * a self-re-arming write is the same class as CursorModelSelector #185.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { CursorPermissionSelector } from './CursorPermissionSelector'
import { useChatStore } from '@/stores/chat'

const realSetPermissionMode = useChatStore.getState().setPermissionMode
let modeWrites: string[] = []

function seedCursorSession(permissionMode: string): void {
  useChatStore.setState({
    harnessResources: { claude: null, codex: null, acp: null, opencode: null, cursor: null },
  })
  useChatStore.getState().ensureSession('/cursor-permission')
  useChatStore.setState({ activeProject: '/cursor-permission' })
  const sid = useChatStore.getState().projectSessions['/cursor-permission']?._activeSessionId
  if (!sid) throw new Error('expected session')
  useChatStore.setState((s) => {
    const project = s.projectSessions['/cursor-permission']
    const session = project?._sessions[sid]
    if (!project || !session) return s
    return {
      projectSessions: {
        ...s.projectSessions,
        '/cursor-permission': {
          ...project,
          _sessions: {
            ...project._sessions,
            [sid]: { ...session, permissionMode: permissionMode as typeof session.permissionMode },
          },
        },
      },
    }
  })
  useChatStore.setState({
    setPermissionMode: async (mode) => {
      modeWrites.push(mode)
      await realSetPermissionMode(mode)
    },
  })
}

async function settle(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

beforeEach(() => {
  modeWrites = []
})

afterEach(() => {
  cleanup()
  useChatStore.setState({ setPermissionMode: realSetPermissionMode })
})

describe('CursorPermissionSelector coercing a Claude leftover mode', () => {
  it('writes auto at most once instead of re-arming forever', async () => {
    seedCursorSession('default')
    render(<CursorPermissionSelector />)
    await settle()
    expect(modeWrites.length).toBeLessThanOrEqual(1)
    expect(modeWrites[0]).toBe('auto')
  })

  it('does not write when the session already carries a Cursor mode', async () => {
    seedCursorSession('plan')
    render(<CursorPermissionSelector />)
    await settle()
    expect(modeWrites).toEqual([])
  })
})
