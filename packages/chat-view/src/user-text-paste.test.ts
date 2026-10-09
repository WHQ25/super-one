import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { beforeAll, describe, expect, it } from 'vitest'
import { UserTextPresenter } from './presenters/UserText'
import { ComposerDraftState } from '../../../apps/mobile/src/composer-draft-state'
import { parseMentionEditorSnapshot } from '../../../apps/mobile/src/mention-editor-state'
import { localUserMessage } from '../../../apps/mobile/src/runtime-user-message'

const i18n = createInstance()
beforeAll(async () => { await i18n.init({ lng: 'en', resources: {}, initAsync: false }) })
const renderText = (block: { text: string; isPaste?: boolean }) => renderToStaticMarkup(
  createElement(I18nextProvider, { i18n }, createElement(UserTextPresenter, block)),
)

describe('composer and sent paste chip parity', () => {
  it.each(['x'.repeat(500), Array(10).fill('typed line').join('\n')])('keeps new long plain text ordinary', (text) => {
    const block = localUserMessage('m', text).content[0]
    expect(block.type).toBe('text')
    if (block.type === 'text') expect(renderText(block)).not.toContain('data-copy-paste')
  })
  it('renders only the actual pasted portion as a chip, including a short paste', () => {
    const state = new ComposerDraftState()
    state.accept(parseMentionEditorSnapshot({ text: 'Before \uFFFC after', start: 14, end: 14, eventCount: 1, composing: false,
      tokens: [{ offset: 7, kind: 'paste', value: 'short paste', displayName: 'short paste' }] }))
    const html = state.capture().userMessageContent.flatMap(block => block.type === 'text' ? [renderText(block)] : []).join('')
    expect(html.match(/data-copy-paste/g)).toHaveLength(1)
    expect(html).toContain('Before')
    expect(html).toContain('after')
  })
  it('retains the legacy heuristic for messages stored before paste marks existed', () => {
    expect(renderText({ text: 'x'.repeat(500) })).toContain('data-copy-paste')
  })
})
