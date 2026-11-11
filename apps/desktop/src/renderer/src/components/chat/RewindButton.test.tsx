/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { RewindButton } from './RewindButton'

function seed(acpAgentId: string) {
  useChatStore.setState({
    activeProject: '/proj',
    projectSessions: {
      '/proj': {
        ...createDefaultProjectState(),
        _activeSessionId: 'session',
        _sessions: {
          session: { ...createDefaultPerSessionState(), sessionProvider: 'acp', acpAgentId },
        },
      },
    },
  })
}

afterEach(() => {
  cleanup()
  useChatStore.setState(useChatStore.getInitialState(), true)
})

describe('rewind control', () => {
  it('shows the rewind button on a Grok session', () => {
    seed('grok-build')
    render(<RewindButton checkpointId="cp" />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('omits the rewind button on an Antigravity session', () => {
    seed('antigravity')
    render(<RewindButton checkpointId="cp" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
