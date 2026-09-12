import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import { initializeChatViewI18n } from './i18n'
import { PendingTurnIndicator } from './presenters/ChatMessageIndicators'

beforeAll(async () => {
  await initializeChatViewI18n('en')
})

describe('the pending-turn line under an unanswered send', () => {
  it('names session creation while the first message waits on it', () => {
    const html = renderToStaticMarkup(createElement(PendingTurnIndicator, { phase: 'creating' }))
    expect(html).toContain('Creating session…')
    expect(html).toContain('data-pending-turn="creating"')
  })

  it('reads the same as the live-turn footer once the message is on the wire', () => {
    const html = renderToStaticMarkup(createElement(PendingTurnIndicator, { phase: 'sending' }))
    expect(html).toContain('Sending…')
  })
})
