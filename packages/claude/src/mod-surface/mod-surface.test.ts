import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import type { ModUiOp, ModUiRequest } from '@superone/shared/mod-ui'
import recording from './__recordings__/cli-2.1.287-desktop.json'
import { ModSurface, isModUiUnavailable, type ModSurfaceQuery } from './mod-surface'
import { mapModSystemMessage } from './wire'

type Exchange = { request: Record<string, unknown>; response: Record<string, unknown> }
const exchanges = recording.exchanges as Exchange[]

/** A query that answers each control request with the next recorded response of its subtype. */
function replayQuery(overrides: Partial<ModSurfaceQuery> = {}) {
  const queue = [...exchanges]
  const sent: Record<string, unknown>[] = []
  let uiHost: Parameters<NonNullable<ModSurfaceQuery['setUiHost']>>[0] | undefined
  const query: ModSurfaceQuery = {
    initializationResult: async () => ({ capabilities: ['ui_surface_v1'] }),
    request: async (inner) => {
      sent.push(inner)
      const i = queue.findIndex((e) => e.request.subtype === inner.subtype && (inner.instance_id === undefined || e.request.instance_id === inner.instance_id))
      if (i < 0) throw new Error(`no recorded ${String(inner.subtype)}`)
      const [hit] = queue.splice(i, 1)
      if ('error' in hit.response) throw new Error(String(hit.response.error))
      return { subtype: 'success', request_id: 'r', response: hit.response }
    },
    setUiHost: (host) => {
      uiHost = host
    },
    ...overrides,
  }
  return { query, sent, host: () => uiHost! }
}

async function ready(query: ModSurfaceQuery, enabled = true) {
  const events: AgentEvent[] = []
  const surface = new ModSurface({ query, emit: (e) => events.push(e), enabled: () => enabled, hostReplyTimeoutMs: 50 })
  await vi.waitFor(() => expect(events.some((e) => e.type === 'mod_ui_state')).toBe(true))
  return { surface, events }
}

const CLIENT = 'superone-spike'

describe('ModSurface availability', () => {
  it('becomes available when the CLI lists ui_surface_v1', async () => {
    const { events, surface } = await ready(replayQuery().query)
    expect(events).toContainEqual({ type: 'mod_ui_state', available: true })
    expect(surface.isAvailable).toBe(true)
  })

  it('stays unavailable without the capability, and ops reject', async () => {
    const { query } = replayQuery({ initializationResult: async () => ({ capabilities: [] }) })
    const { events, surface } = await ready(query)
    expect(events).toContainEqual({ type: 'mod_ui_state', available: false })
    await expect(surface.call('panes', { clientId: CLIENT })).rejects.toSatisfy(isModUiUnavailable)
  })

  it('stays unavailable when the user turned mod drawing off', async () => {
    const { events } = await ready(replayQuery().query, false)
    expect(events).toContainEqual({ type: 'mod_ui_state', available: false })
  })

  it('is unavailable on an SDK without the private request API', () => {
    const emit = vi.fn()
    const surface = new ModSurface({ query: { initializationResult: async () => ({ capabilities: ['ui_surface_v1'] }) }, emit })
    expect(surface.isAvailable).toBe(false)
    expect(emit).not.toHaveBeenCalled()
  })
})

describe('ModSurface ops against the 2.1.287 recording', () => {
  it('spells each op on the wire and maps its answer', async () => {
    const { query, sent } = replayQuery()
    const { surface } = await ready(query)

    expect(await surface.call('attach', { surface: 'desktop', clientId: CLIENT, viewport: { columns: 120, rows: 40, isFullscreen: true }, answers: ['copy', 'promptRead', 'promptFill', 'promptSuggest'] }))
      .toEqual({ surfaces: ['desktop'] })
    expect(sent.at(-1)).toEqual({
      subtype: 'ui_attach',
      surface: 'desktop',
      client_id: CLIENT,
      viewport: { columns: 120, rows: 40, isFullscreen: true },
      answers: ['ui_copy', 'ui_prompt_read', 'ui_prompt_fill', 'ui_prompt_suggest'],
    })

    const band = await surface.call('render', { surface: 'desktop', clientId: CLIENT, component: 'AbovePrompt', instanceId: 'above-prompt', props: {}, contentRows: 3 })
    expect(sent.at(-1)).toMatchObject({ subtype: 'ui_render', instance_id: 'above-prompt', client_id: CLIENT, content_rows: 3 })
    expect(band.hooked).toBe(true)
    expect(band).not.toHaveProperty('rewritten')

    const pane = await surface.call('render', { surface: 'desktop', clientId: CLIENT, component: 'Pane', instanceId: 'probe', props: {} })
    expect(pane.clientModules).toEqual({ 'probe-mod': expect.stringMatching(/^[0-9a-f]{64}$/) })

    expect(await surface.call('press', { plugin: 'probe-mod', handle: 1, key: 'go', surface: 'desktop', clientId: CLIENT })).toEqual({ handled: true, element: 'go' })
    expect(await surface.call('scroll', { component: 'Pane', instanceId: 'probe', offset: 3, by: 3, bodyRows: 12, contentRows: 30, surface: 'desktop', clientId: CLIENT }))
      .toEqual({ moved: true, offset: 3 })
    expect(sent.at(-1)).toMatchObject({ body_rows: 12, content_rows: 30, instance_id: 'probe' })
    expect(await surface.call('paneShow', { id: 'probe', surface: 'desktop', clientId: CLIENT })).toEqual({ shownId: 'probe' })
    expect(await surface.call('paneFocus', { id: null, surface: 'desktop', clientId: CLIENT })).toEqual({ focusedId: null })
    expect(await surface.call('close', { id: 'probe', clientId: CLIENT })).toEqual({ closed: true })
  })

  it('maps the pane roster to camelCase', async () => {
    const { query } = replayQuery({
      request: async () => ({ response: { panes: [{ id: 'p', title: 'P', plugin: 'm', close_on_escape: true, hold_toasts: true, rows: 3 }], shown_id: 'p', focused_id: null, focus_requested_id: 'p' } }),
    })
    const { surface } = await ready(query)
    expect(await surface.call('panes', { clientId: CLIENT })).toEqual({
      panes: [{ id: 'p', title: 'P', plugin: 'm', closeOnEscape: true, holdToasts: true, rows: 3 }],
      shownId: 'p',
      focusedId: null,
      focusRequestedId: 'p',
    })
  })
})

describe('ModSurface pushes', () => {
  it('maps every recorded push and leaves notices to plugin-notice-wire', () => {
    const mapped = recording.pushes.map((p) => mapModSystemMessage(p as Record<string, unknown>))
    expect(mapped.every(Boolean)).toBe(true)
    expect(mapped).toContainEqual({
      type: 'mod_invalidate',
      instances: [
        { surface: 'desktop', component: 'Pane', instanceId: 'probe' },
        { surface: 'desktop', component: 'AbovePrompt', instanceId: 'above-prompt' },
      ],
    })
    expect(mapped).toContainEqual({ type: 'mod_scroll', clientId: CLIENT, component: 'Pane', instanceId: 'probe', offset: 17 })
    expect(mapped).toContainEqual({ type: 'mod_focus', clientId: CLIENT, component: 'Pane', instanceId: 'probe', plugin: 'probe-mod', key: 'name' })
    expect(mapModSystemMessage({ subtype: 'ui_log', plugin: 'x', text: 'y' })).toBeNull()
    expect(mapModSystemMessage({ subtype: 'ui_invalidate', event: 'ui.render' })).toEqual({ type: 'mod_invalidate' })
  })

  it('emits pushes only while available', async () => {
    const { surface, events } = await ready(replayQuery().query)
    expect(surface.handleSystem(recording.pushes[0] as Record<string, unknown>)).toBe(true)
    expect(events.at(-1)?.type).toMatch(/^mod_/)
    expect(surface.handleSystem({ subtype: 'init' })).toBe(false)
  })
})

describe('ModSurface host requests', () => {
  const attach = (surface: ModSurface, answers: ModUiRequest<'attach'>['answers']) =>
    surface.call('attach', { surface: 'desktop', clientId: CLIENT, answers })

  it('relays a recorded request to the client and returns its reply', async () => {
    const { query, host } = replayQuery()
    const { surface, events } = await ready(query)
    await attach(surface, ['promptFill', 'copy'])
    const fill = recording.hostRequests.find((r) => r.subtype === 'ui_prompt_fill') as Record<string, unknown>
    const answer = host().promptFill(fill)
    await vi.waitFor(() => expect(events.at(-1)?.type).toBe('mod_host_request'))
    const request = events.at(-1) as Extract<AgentEvent, { type: 'mod_host_request' }>
    expect(request).toMatchObject({ clientId: CLIENT, request: { kind: 'promptFill', text: 'filled by probe', mode: 'replace', decorations: [{ start: 0, end: 6, color: '#e5484d', bold: true }] } })
    expect(surface.isHostRequestPending(request.requestId)).toBe(true)
    // Only the client the request went to may answer it.
    expect(await surface.call('hostReply', { requestId: request.requestId, clientId: 'someone-else', reply: { kind: 'promptFill', filled: true } })).toEqual({ accepted: false })
    expect(await surface.call('hostReply', { requestId: request.requestId, clientId: CLIENT, reply: { kind: 'promptFill', filled: true } })).toEqual({ accepted: true })
    expect(await answer).toEqual({ filled: true })
    expect(surface.isHostRequestPending(request.requestId)).toBe(false)
  })

  it('answers the safe default for a client that does not answer that request, or too late', async () => {
    const { query, host } = replayQuery()
    const { surface } = await ready(query)
    await attach(surface, ['copy'])
    expect(await host().promptRead({ surface: 'desktop', client_id: CLIENT })).toEqual({ text: '', cursor: 0 })
    expect(await host().copy({ surface: 'desktop', client_id: CLIENT, plugin: 'p', text: 't' })).toEqual({ copied: false })
  })

  it('rejects a reply for an unknown request', async () => {
    const { surface } = await ready(replayQuery().query)
    const op: ModUiOp = 'hostReply'
    expect(await surface.call(op, { requestId: 'nope', clientId: CLIENT, reply: { kind: 'copy', copied: true } })).toEqual({ accepted: false })
  })
})
