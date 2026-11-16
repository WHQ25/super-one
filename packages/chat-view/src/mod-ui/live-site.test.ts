// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import type { ModRenderResult, ModUiOp } from '@superone/shared/mod-ui'
import { ModUiClient, type ModSiteSnapshot, type ModUiTransport } from './client'
import { emptyModLiveMemo, modLiveSiteValue, readModSiteAnswer, stepModLiveSite, type ModLiveMemo, type ModLiveSite } from './live-site'
import { ModBackdropLayer, ModUiProvider } from './react'

function snap(status: ModSiteSnapshot['status'], props: Record<string, unknown> = { bodyColumns: 80 }): ModSiteSnapshot {
  return { status, result: status === 'ready' ? { tree: { type: 'engine', ref: 0 }, props: {}, hooked: true } : null, props }
}

/** Feeds answers in order; `value` stands for a drawn picture. */
function run(steps: Array<[ModSiteSnapshot, string | null]>): Array<ModLiveSite<string>> {
  let memo: ModLiveMemo<string> = emptyModLiveMemo()
  return steps.map(([snapshot, value]) => {
    const answer = readModSiteAnswer(true, snapshot, () => value)
    const next = stepModLiveSite(memo, answer, snapshot)
    memo = next.memo
    return next.live
  })
}

describe('mod live site', () => {
  it('waits for the first answer and shows what is remembered meanwhile', () => {
    const live = stepModLiveSite(emptyModLiveMemo<string>(), readModSiteAnswer(false, snap('off'), () => null), snap('off')).live
    expect(live.kind).toBe('waiting')
    expect(modLiveSiteValue(live, 'cached')).toBe('cached')
  })

  it('keeps showing what is remembered while a hooked site has drawn nothing yet, but not when nothing hooks it', () => {
    const [empty] = run([[snap('ready'), null]])
    expect(modLiveSiteValue(empty, 'cached')).toBe('cached')
    const [unhooked] = run([[snap('off'), null]])
    expect(unhooked.kind).toBe('unhooked')
    expect(modLiveSiteValue(unhooked, 'cached')).toBeNull()
  })

  it('reads an empty answer after a drawing as the mod taking it away', () => {
    const lives = run([[snap('ready'), 'reef'], [snap('ready'), null], [snap('ready'), null]])
    expect(lives.map((l) => l.kind)).toEqual(['active', 'cleared', 'cleared'])
    expect(lives[1]).toEqual({ kind: 'cleared', previous: 'reef' })
    expect(modLiveSiteValue(lives[2], 'cached')).toBeNull()
  })

  it('keeps the picture through an empty answer to a resized ask, and clears on the next one at that size', () => {
    const resized = snap('ready', { bodyColumns: 60 })
    const lives = run([[snap('ready'), 'reef'], [resized, null], [resized, null], [snap('ready', { bodyColumns: 60 }), null]])
    expect(lives.map((l) => l.kind)).toEqual(['active', 'active', 'active', 'cleared'])
  })

  it('starts over when the session stops answering', () => {
    let memo: ModLiveMemo<string> = emptyModLiveMemo()
    memo = stepModLiveSite(memo, { kind: 'active', value: 'reef' }, snap('ready')).memo
    memo = stepModLiveSite(memo, { kind: 'waiting' }, snap('off')).memo
    expect(stepModLiveSite(memo, { kind: 'empty' }, snap('ready')).live.kind).toBe('empty')
  })

  it('returns the same memo when nothing changed', () => {
    const snapshot = snap('ready')
    const first = stepModLiveSite(emptyModLiveMemo<string>(), { kind: 'active', value: 'reef' }, snapshot).memo
    expect(stepModLiveSite(first, { kind: 'active', value: 'reef' }, snapshot).memo).toBe(first)
  })
})

describe('ModBackdropLayer', () => {
  let cleanup: (() => void) | null = null
  afterEach(() => cleanup?.())

  it('draws the live backdrop and drops it when the mod takes it away', async () => {
    let answer: ModRenderResult = { tree: { type: 'Text', children: ['reef'] }, props: { id: 'reef' }, hooked: true }
    const transport = (async (op: ModUiOp) => {
      if (op === 'attach') return { surfaces: ['desktop'] }
      if (op === 'panes') return { panes: [], shownId: null, focusedId: null, focusRequestedId: null }
      if (op === 'render') return answer
      return {}
    }) as unknown as ModUiTransport
    const client = new ModUiClient({ transport, surface: 'desktop', clientId: 'test' })
    await client.attach()
    const container = document.body.appendChild(document.createElement('div'))
    const root = createRoot(container)
    cleanup = () => {
      act(() => root.unmount())
      container.remove()
    }
    const settle = () => act(() => new Promise((r) => setTimeout(r, 40)))
    await act(async () => root.render(createElement(ModUiProvider, { client, ports: {}, children: createElement(ModBackdropLayer) })))
    await settle()
    expect(container.querySelector('[data-mod-backdrop="true"]')?.textContent).toContain('reef')

    answer = { tree: { type: 'engine', ref: 0 }, props: {}, hooked: true }
    await act(async () => client.handleEvent({ type: 'mod_invalidate', instances: [{ surface: 'desktop', component: 'Backdrop', instanceId: 'backdrop' }] } as never))
    await settle()
    expect(container.querySelector('[data-mod-backdrop="true"]')).toBeNull()
  })
})
