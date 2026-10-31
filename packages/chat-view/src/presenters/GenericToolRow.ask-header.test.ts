// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GenericToolRowPresenter, type GenericToolRowPorts } from './GenericToolRow'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const ports = (preferSentSummary: boolean): GenericToolRowPorts => ({
  cwd: '/tmp/proj',
  homedir: '/Users/me',
  stallLevel: 'normal',
  preferSentSummary,
  renderFileChip: ({ name }) => name,
  renderFileDiff: () => null,
  renderArtifactLink: ({ label }) => label,
  renderCount: (value) => value,
  renderJson: (text) => text,
  renderQuestionPreview: ({ content }) => content,
})

const question = '配对的那台电脑睡着或离线时，手机还要不要能继续用它名下的其他节点？'
const grokTitle = `Ask: ${question}`

let root: Root | undefined
let container: HTMLDivElement | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
})

async function mount(node: ReactNode) {
  container = document.body.appendChild(document.createElement('div'))
  root = createRoot(container)
  await act(async () => root!.render(node))
  return container.querySelector('.tool-node-header')!
}

describe('AskUserQuestion header', () => {
  it('keeps the count in the name and leaves the harness title out of the chip', async () => {
    const header = await mount(createElement(GenericToolRowPresenter, {
      toolName: 'AskUserQuestion',
      toolUseId: 'q-1',
      status: 'complete',
      allowExpand: true,
      autoExpandFileDiffs: false,
      defaultExpanded: true,
      toolSummary: grokTitle,
      input: JSON.stringify({
        questions: [{ question, header: 'Offline', options: [{ label: '断开' }, { label: '继续' }] }],
        answers: { [question]: '离线就断' },
      }),
      result: `"${question}"="离线就断"`,
      ports: ports(true),
    }))

    expect(header.textContent).toContain('Asked 1 question')
    expect(header.textContent).not.toContain('Ask:')
    expect(header.textContent).not.toContain(question)
    expect(container!.textContent).toContain(question)
    expect(container!.textContent).toContain('离线就断')
  })

  it('still prefers a sent summary for other tools on a remote surface', async () => {
    const header = await mount(createElement(GenericToolRowPresenter, {
      toolName: 'WebFetch',
      status: 'complete',
      allowExpand: true,
      autoExpandFileDiffs: false,
      toolSummary: 'Fetch: docs',
      input: JSON.stringify({ url: 'https://example.com/docs' }),
      ports: ports(true),
    }))

    expect(header.textContent).toContain('Fetch: docs')
  })
})
