import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import { initializeChatViewI18n } from './i18n'
import { PortableMessage } from './PortableMessage'

beforeAll(async () => {
  await initializeChatViewI18n('en')
})

function turn(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'live',
    role: 'assistant',
    status: 'streaming',
    content: [{ type: 'text', text: 'typing' }],
    createdAt: new Date(Date.now() - 5000).toISOString(),
    providerId: 'claude',
    ...overrides,
  }
}

function render(message: ChatMessage, props: Partial<Parameters<typeof PortableMessage>[0]> = {}): string {
  return renderToStaticMarkup(createElement(PortableMessage, {
    message,
    scheme: 'dark',
    pendingPermission: null,
    ...props,
  }))
}

describe('the live-turn indicator', () => {
  it('spins for the last turn while the session is producing it', () => {
    const html = render(turn(), { isLastAssistant: true, sessionStreaming: true })
    expect(html).toContain('Sending…')
  })

  it('announces a live turn before its clock is worth showing', () => {
    // Under a second there is no duration yet, and the footer is the only place
    // the phone shows that a turn is running.
    const html = render(turn({ createdAt: new Date().toISOString() }), {
      isLastAssistant: true,
      sessionStreaming: true,
    })
    expect(html).toContain('Sending…')
  })

  // The bug: an interrupt or a dropped connection can leave a turn marked
  // `streaming` for the rest of the session. Reading only the message's own
  // status made the phone spin on it forever.
  it('does not spin on a stale streaming turn once the session is idle', () => {
    const html = render(turn(), { isLastAssistant: true, sessionStreaming: false })
    expect(html).not.toContain('Sending…')
  })

  it('does not spin on an older turn while a newer one streams', () => {
    const html = render(turn(), { isLastAssistant: false, sessionStreaming: true })
    expect(html).not.toContain('Sending…')
  })
})

describe('Grok live reasoning then text', () => {
  it('paints the text that follows reasoning while the turn is still streaming', () => {
    const html = render(turn({
      content: [
        { type: 'thinking', thinking: 'Check the mapper before answering.' },
        { type: 'text', text: 'The token block is visible.' },
      ],
    }), { isLastAssistant: true, sessionStreaming: true })
    expect(html).toContain('thinking-node')
    expect(html).toContain('The token block is visible.')
    expect(html).toContain('after-thinking')
  })

  it('keeps reasoning live when it is still the last segment', () => {
    const html = render(turn({
      content: [{ type: 'thinking', thinking: 'Still reasoning.' }],
    }), { isLastAssistant: true, sessionStreaming: true })
    expect(html).not.toContain('Still reasoning.')
    expect(html).toContain('thinking-node')
    expect(html).toContain('animate-pulse')
    expect(html).not.toContain('after-thinking')
  })
})

describe('Grok turn summary chrome', () => {
  it('prefixes the summary the same way the desktop footer does', () => {
    const html = render(turn({
      status: 'complete',
      metadata: { durationMs: 12_000, turnSummary: 'Fixed the footer inset' },
    }))
    expect(html).toContain('Summary:')
    expect(html).toContain('Fixed the footer inset')
    expect(html).toContain('data-turn-meta="summary"')
  })
})

describe('the settled turn footer', () => {
  it('shows the recorded spend and duration a turn actually cost', () => {
    const html = render(turn({
      status: 'complete',
      metadata: { durationMs: 42_000, consumedTokens: { input: 1200, output: 340 } },
    }))
    expect(html).toContain('42s')
    expect(html).toContain('1.2k')
    expect(html).toContain('340')
  })

  it('names a failure in the same words the desktop badge uses', () => {
    const html = render(turn({
      status: 'error',
      metadata: { errorInfo: { raw: 'Overloaded', httpStatus: 529 } },
    }))
    expect(html).toContain('Service Busy')
  })
})

describe('collaboration bubbles', () => {
  it('labels a host task notification, which is collaboration traffic too', () => {
    const html = render(turn({
      role: 'user',
      status: 'complete',
      content: [{ type: 'text', text: 'A collaboration mailbox message is ready' }],
      metadata: { source: 'task-notification' },
    }))
    expect(html).toContain('System wake')
  })
})
