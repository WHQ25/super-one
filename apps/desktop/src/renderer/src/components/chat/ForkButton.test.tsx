/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import { ForkButton } from './ForkButton'

const { handoffMock, mockState } = vi.hoisted(() => ({
  handoffMock: vi.fn(),
  mockState: {
    activeProject: '/repo',
    projectSessions: {
      '/repo': {
        _activeSessionId: 's-1',
        _sessions: {
          's-1': {
            messages: [
              { id: 'u1', role: 'user', content: [] },
              { id: 'a1', role: 'assistant', content: [] },
              { id: 'u2', role: 'user', content: [] },
              { id: 'a2', role: 'assistant', content: [] },
            ],
          },
        },
      },
    },
  },
}))

vi.mock('@/stores/chat', () => ({
  useChatStore: { getState: () => mockState },
}))

vi.mock('@/lib/session-continuation', () => ({
  handoffToNewSession: handoffMock,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

afterEach(() => {
  vi.clearAllMocks()
})

function msg(id: string): ChatMessage {
  return {
    id,
    role: 'assistant',
    content: [],
    status: 'complete',
    createdAt: '2026-01-01T00:00:00.000Z',
    providerId: 'claude',
  }
}

describe('ForkButton', () => {
  it('hands off without cutoff when triggered on the last message', async () => {
    const user = userEvent.setup()
    render(<ForkButton message={msg('a2')} />)

    await user.click(screen.getByTitle('tooltips.fork'))
    await user.click(await screen.findByText('sidebar.contextMenu.handOffToNewSession'))

    expect(handoffMock).toHaveBeenCalledWith('/repo', 's-1', undefined)
  })

  it('hands off with upToMessageId when triggered on an earlier message', async () => {
    const user = userEvent.setup()
    render(<ForkButton message={msg('a1')} />)

    await user.click(screen.getByTitle('tooltips.fork'))
    await user.click(await screen.findByText('sidebar.contextMenu.handOffToNewSession'))

    expect(handoffMock).toHaveBeenCalledWith('/repo', 's-1', 'a1')
  })
})
