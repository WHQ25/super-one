import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, expect, test } from 'vitest'
import { initializeChatViewI18n } from './i18n'
import { PortableScheduledResumeCard } from './PortableScheduledResumeCard'
import type { ScheduledSendView } from './protocol'

beforeAll(async () => { await initializeChatViewI18n('en') })

const state: ScheduledSendView = {
  scheduled: { sessionId: 's', sendAt: Date.now() + 3_600_000, armed: false, source: 'rate_limit', message: null },
  available: true, busy: false, error: '',
}
const render = (view: ScheduledSendView) => renderToStaticMarkup(createElement(PortableScheduledResumeCard, { state: view, locale: 'en' }))

test('only shows the quota recovery offer while it is awaiting acceptance', () => {
  expect(render(state)).toContain('scheduled-resume-card')
  expect(render({ ...state, scheduled: { ...state.scheduled!, armed: true } })).toBe('')
  expect(render({ ...state, scheduled: null })).toBe('')
})

test('does not show a quota recovery card for a manual schedule', () => {
  expect(render({ ...state, scheduled: { ...state.scheduled!, source: 'manual', armed: true } })).toBe('')
})
