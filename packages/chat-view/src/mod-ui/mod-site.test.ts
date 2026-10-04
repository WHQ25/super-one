// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import type { ModRenderResult, ModUiOp } from '@superone/shared/mod-ui'
import { ModUiClient, type ModUiTransport } from './client'
import type { ModUiPorts } from './ModTree'
import { ModSite, ModUiProvider } from './react'

const settle = () => act(() => new Promise((r) => setTimeout(r, 40)))

/** A client whose render answers are handed out one by one. */
function setup() {
  const answers: Array<(r: ModRenderResult) => void> = []
  const transport = (async (op: ModUiOp) => {
    if (op === 'attach') return { surfaces: ['desktop'] }
    if (op === 'panes') return { panes: [], shownId: null, focusedId: null, focusRequestedId: null }
    if (op === 'render') return new Promise((r) => answers.push(r))
    return {}
  }) as unknown as ModUiTransport
  const client = new ModUiClient({ transport, surface: 'desktop', clientId: 'test' })
  const answer = async (r: ModRenderResult) => {
    answers.shift()!(r)
    await settle()
  }
  return { client, answer }
}

let cleanup: (() => void) | null = null
afterEach(() => cleanup?.())

async function mount(client: ModUiClient, site: ReactNode, ports: ModUiPorts = {}) {
  const container = document.body.appendChild(document.createElement('div'))
  const root = createRoot(container)
  await act(async () => root.render(createElement(ModUiProvider, { client, ports, children: site })))
  cleanup = () => {
    act(() => root.unmount())
    container.remove()
  }
  return container
}

it('keeps a decision prompt mounted, with its typing and focus, as the mod wraps and unwraps it', async () => {
  const { client, answer } = setup()
  await client.attach()
  const site = createElement(ModSite, { component: 'AskUserQuestion', instanceId: 'q', props: {}, engineOnce: true, children: () => createElement('input', { 'aria-label': 'answer' }) })
  const container = await mount(client, site)
  await settle()
  const input = container.querySelector('input')!
  input.value = 'typed'
  input.focus()

  await answer({ tree: { type: 'Box', children: ['wrapped', { type: 'engine', ref: 0 }] }, props: {}, hooked: true })
  expect(container.textContent).toContain('wrapped')
  expect(container.querySelector('input')).toBe(input)
  expect(input.value).toBe('typed')
  expect(document.activeElement).toBe(input)

  await act(async () => client.reset())
  expect(container.textContent).not.toContain('wrapped')
  expect(container.querySelector('input')).toBe(input)
})

it('draws SuperOne’s own while a tree throws, and the plugin’s next tree again', async () => {
  const { client, answer } = setup()
  await client.attach()
  const ports: ModUiPorts = {
    renderMarkdown: (text) => {
      if (text === 'boom') throw new Error('boom')
      return text
    },
  }
  const site = createElement(ModSite, { component: 'UserMessage', instanceId: 'm', props: {}, children: () => 'own' })
  const container = await mount(client, site, ports)
  await settle()
  const markdown = (text: string): ModRenderResult => ({ tree: { type: 'Markdown', props: { text } }, props: {}, hooked: true })

  await answer(markdown('boom'))
  expect(container.textContent).toBe('own')

  await act(async () => client.handleEvent({ type: 'mod_invalidate' } as never))
  await settle()
  await answer(markdown('fixed'))
  expect(container.textContent).toBe('fixed')
})
