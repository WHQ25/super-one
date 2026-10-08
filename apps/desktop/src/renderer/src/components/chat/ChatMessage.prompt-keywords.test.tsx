/** @vitest-environment jsdom */

import { render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ChatMessage as ChatMessageType } from '@superone/shared/agent-types'
import type { HarnessId } from '@superone/shared/harness/harness-id'
import { ChatMessage } from './ChatMessage'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'

function renderSent(text: string, harness: HarnessId = 'claude') {
  useChatStore.setState({
    activeProject: '/test',
    projectSessions: {
      '/test': {
        ...createDefaultProjectState(),
        _activeSessionId: 'sid-1',
        _sessions: { 'sid-1': { ...createDefaultPerSessionState(), sessionProvider: harness } },
      },
    },
  })
  const message: ChatMessageType = {
    id: 'user-1',
    role: 'user',
    status: 'complete',
    content: [{ type: 'text', text }],
    createdAt: new Date().toISOString(),
    providerId: 'user',
  }
  return render(<ChatMessage message={message} sessionStatus="idle" isLastAssistant={false} />).container
}

const painted = (container: HTMLElement, keyword: string) =>
  [...container.querySelectorAll(`.prompt-keyword-${keyword}`)].map((el) => el.textContent).join('')

afterEach(() => {
  useChatStore.setState({ activeProject: null, projectSessions: {} })
})

describe('ChatMessage sent prompt keywords', () => {
  it('paints the keywords the harness acted on, letter by letter', () => {
    const container = renderSent('ultrathink, then ultracode it')

    expect(painted(container, 'ultrathink')).toBe('ultrathink')
    expect(painted(container, 'ultracode')).toBe('ultracode')
    expect(container.querySelector('.prompt-keyword-ultrathink')?.getAttribute('style')).toContain('--ultrathink-0')
    expect(container.textContent).toContain('ultrathink, then ultracode it')
  })

  it('leaves a merely mentioned ultracode plain', () => {
    const container = renderSent('what is ultracode? see "ultracode"')

    expect(painted(container, 'ultracode')).toBe('')
  })

  it('paints only what the whole /goal line triggered', () => {
    const container = renderSent('/goal ultracode ship it, ultrathink first')

    expect(painted(container, 'ultracode')).toBe('')
    expect(painted(container, 'ultrathink')).toBe('ultrathink')
  })

  it('leaves the words plain for a harness without prompt keywords', () => {
    const container = renderSent('ultrathink ultracode', 'codex')

    expect(container.querySelector('[class^="prompt-keyword-"]')).toBeNull()
  })
})
