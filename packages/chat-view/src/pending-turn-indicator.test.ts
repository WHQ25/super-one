import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import { initializeChatViewI18n } from './i18n'
import { PortableMessage } from './PortableMessage'
import { pendingTurnMessage, type PendingTurnPhase } from './presenters/turn-footer-model'

beforeAll(async () => {
  await initializeChatViewI18n('en')
})

const user = {
  id: 'user', role: 'user' as const, status: 'complete' as const, providerId: 'local' as const,
  content: [], createdAt: new Date().toISOString(),
}
function pendingFooter(phase: PendingTurnPhase) {
  return renderToStaticMarkup(createElement(PortableMessage, {
    message: pendingTurnMessage(user), pendingTurn: phase, scheme: 'light', pendingPermission: null,
  }))
}

describe('the pending assistant message footer', () => {
  it('names session creation while the first message waits on it', () => {
    const html = pendingFooter('creating')
    expect(html).toContain('Creating session…')
    expect(html).toContain('data-pending-turn="creating"')
  })

  it('reads the same as the live-turn footer once the message is on the wire', () => {
    const html = pendingFooter('sending')
    expect(html).toContain('Sending…')
    expect(html).toContain('assistant-reply')
    expect(html).toContain('mt-2 flex flex-wrap')
    expect(html.match(/animate-spin/g)).toHaveLength(1)
  })
})
