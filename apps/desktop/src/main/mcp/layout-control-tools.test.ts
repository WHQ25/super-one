import { beforeEach, describe, expect, it, vi } from 'vitest'
import { decode as toonDecode } from '@toon-format/toon'
import {
  MAIN_THREAD_ONLY_SUPERONE_TOOL_NAMES,
  isStaticHostOwnedSuperoneBareName,
} from '@superone/shared/superone-host-owned-tools'
import { isNodeLocalSuperoneTool } from '@superone/shared/environment/host-action-browser-catalog'
import { HOST_ACTION_SUPERONE_TOOL_DESCRIPTORS } from '@superone/shared/environment/host-action-superone-descriptors'
import { LAYOUT_ACT_ACTIONS } from '@superone/shared/layout-control'
import type { BuiltInSuperoneToolDeps } from './superone-mcp-builtins'
import { z } from 'zod'
import { jsonSchemaToZodShape } from './json-schema-zod'

const { mockCall, mockConnection } = vi.hoisted(() => ({
  mockCall: vi.fn(),
  mockConnection: vi.fn<() => string | null>(() => null),
}))
vi.mock('../browser/browser-automation-bridge', () => ({ browserAutomationCall: mockCall }))
vi.mock('./artifact-registry', () => ({ currentHostActionConnection: mockConnection }))
vi.mock('../environment/environment-host', () => ({ getEnvironmentHost: () => ({ listEnvironments: async () => [{ connectionId: 'local', environmentId: 'desktop' }, { connectionId: 'node-1', environmentId: 'node' }] }) }))

const { layoutActHandler, layoutSnapshotHandler, openedTabNoteFor } = await import('./layout-control-tools')
const { BUILT_IN_SUPERONE_TOOL_DEFS } = await import('./superone-mcp-builtin-defs')

function deps(session: { cwd?: string; projectPath?: string } | null = { cwd: '/work/app-wt', projectPath: '/work/app' }): BuiltInSuperoneToolDeps {
  return {
    sessionId: 's1',
    sessionHost: { getSession: () => session } as never,
    notifyDevAppReady: () => {},
    applyAppSettings: () => ({}) as never,
  }
}

function text(result: { content: Array<{ text: string }> }): string {
  return result.content[0].text
}

beforeEach(() => {
  mockCall.mockReset()
  mockConnection.mockReturnValue(null)
})

describe('layout_snapshot', () => {
  it('asks the renderer for the calling session and encodes the layout as TOON', async () => {
    const snapshot = {
      visible: true,
      window: { visible: true, mode: 'full', transitioning: false, sidebar: 'expanded', layout: 'single' },
      panel: { open: true, onScreen: true, side: 'left', maximized: false },
      terminal: { open: false },
      tabs: [{ tab: 'file:src/a.ts', kind: 'file', title: 'a.ts', active: true, group: 0, openedBy: 'agent' }],
    }
    mockCall.mockResolvedValue(snapshot)

    const result = await layoutSnapshotHandler({}, deps())

    expect(mockCall).toHaveBeenCalledWith('s1', 'layoutSnapshot', { environmentId: 'desktop', root: '/work/app-wt', target: undefined }, undefined)
    expect(result.isError).toBeUndefined()
    expect(toonDecode(text(result))).toEqual(snapshot)
  })
})

describe('layout_act', () => {
  it('forwards the request with the session working folder', async () => {
    mockCall.mockResolvedValue({ status: 'queued', visible: false, tab: 'file:src/a.ts' })

    const result = await layoutActHandler({ action: 'open_file', path: 'src/a.ts', line: 3 }, deps())

    expect(mockCall).toHaveBeenCalledWith('s1', 'layoutAct', { environmentId: 'desktop', root: '/work/app-wt', request: { action: 'open_file', path: 'src/a.ts', line: 3 } }, undefined)
    expect(JSON.parse(text(result))).toEqual({ status: 'queued', visible: false, tab: 'file:src/a.ts' })
  })

  it('returns the renderer refusal as an actionable error', async () => {
    mockCall.mockRejectedValue(new Error('Tab browser-1 was not opened by you; only tabs you opened can be closed.'))

    const result = await layoutActHandler({ action: 'close_tab', tab: 'browser-1' }, deps())

    expect(result.isError).toBe(true)
    expect(text(result)).toBe('[Error] Tab browser-1 was not opened by you; only tabs you opened can be closed.')
  })

  it('keeps the node caller identity when arranging any accessible desktop layout', async () => {
    mockConnection.mockReturnValue('node-1')
    mockCall.mockResolvedValue({ status: 'queued', visible: false })
    const target = { environmentId: 'desktop', sessionId: 'other' }
    await layoutActHandler({ action: 'show_panel', target }, deps())
    expect(mockCall).toHaveBeenCalledWith('s1', 'layoutAct', { environmentId: 'node', root: '/work/app-wt', request: { action: 'show_panel', target } }, undefined)
  })
})

describe('layout tool contract', () => {
  it('keeps qualified batches and divider changes valid through the Claude Zod schema and desktop/node JSON schemas', () => {
    const desktop = BUILT_IN_SUPERONE_TOOL_DEFS.find(def => def.name === 'layout_act')!
    const schema = z.object(jsonSchemaToZodShape(desktop.inputSchema))
    const calls = [
      { action: 'split_session', sessionIds: ['local', { environmentId: 'node', sessionId: 'remote' }] },
      { action: 'split_session', sessionIds: ['local', { environmentId: 'node', sessionId: 'remote' }, 'third'], layout: { direction: 'row', ratio: 0.4, first: 0, second: { direction: 'column', first: 1, second: 2 } } },
      { action: 'close_split', sessionIds: ['local'] },
      { action: 'close_split', closeAll: true },
      { action: 'maximize_split', target: { environmentId: 'node', sessionId: 'remote' } },
      { action: 'restore_splits' },
      { action: 'window_mode', mode: 'mini' },
      { action: 'window_mode', mode: 'full', target: 'foreground' },
      { action: 'resize_window', width: 1280, height: 900 },
      { action: 'enter_fullscreen' },
      { action: 'exit_fullscreen' },
      { action: 'resize_splits', dividers: [{ id: 'divider-1', ratio: 0.6 }, { id: 'divider-2', ratio: 0.5 }] },
    ]
    for (const call of calls) expect(schema.parse(call)).toEqual(call)
    for (const call of [
      { action: 'split_session', sessionIds: [] },
      { action: 'split_session', sessionIds: [{ sessionId: 'missing-host' }] },
      { action: 'split_session', sessionIds: ['A', 'B'], layout: { direction: 'row', first: 0, second: 1, ratio: 0.99 } },
      { action: 'split_session', sessionIds: ['A', 'B'], layout: { direction: 'row', first: 0, second: { direction: 'diagonal', first: 1, second: 2 } } },
      { action: 'split_session', sessionIds: ['A', 'B'], layout: { direction: 'row', first: 0 } },
      { action: 'resize_splits', dividers: [{ id: 'divider-1', ratio: Infinity }] },
      { action: 'resize_splits', dividers: [{ id: 'divider-1', ratio: 0.99 }] },
    ]) expect(schema.safeParse(call).success).toBe(false)
    expect(HOST_ACTION_SUPERONE_TOOL_DESCRIPTORS.find(def => def.name === 'layout_act')!.inputSchema).toEqual(desktop.inputSchema)
  })

  it('is admitted by every harness without a confirm, callable by subagents, and advertised to remote nodes', () => {
    for (const name of ['layout_snapshot', 'layout_act']) {
      expect(isStaticHostOwnedSuperoneBareName(name), name).toBe(true)
      expect(MAIN_THREAD_ONLY_SUPERONE_TOOL_NAMES as readonly string[]).not.toContain(name)
      expect(isNodeLocalSuperoneTool(name), name).toBe(false)
      const desktop = BUILT_IN_SUPERONE_TOOL_DEFS.find((def) => def.name === name)
      const remote = HOST_ACTION_SUPERONE_TOOL_DESCRIPTORS.find((def) => def.name === name)
      expect(remote?.description).toBe(desktop?.description)
      expect(remote?.inputSchema).toEqual(desktop?.inputSchema)
    }
  })

  it('keeps layout_act a closed action enum that sends browser and terminal opens to their own tools', () => {
    const act = BUILT_IN_SUPERONE_TOOL_DEFS.find((def) => def.name === 'layout_act')!
    const properties = act.inputSchema.properties as Record<string, { enum?: string[] }>
    expect(properties.action.enum).toEqual([...LAYOUT_ACT_ACTIONS])
    expect(properties.action.enum).toContain('maximize_split')
    expect(properties.action.enum).toContain('restore_splits')
    expect(properties.action.enum).not.toContain('maximize_session')
    expect(properties.action.enum).not.toContain('restore_mosaic')
    expect(properties.action.enum).not.toContain('open_diff')
    expect(properties).not.toHaveProperty('commit')
    expect(act.inputSchema.required).toEqual(['action'])
    expect(act.inputSchema.additionalProperties).toBe(false)
    expect(act.description).toMatch(/browser_tabs/)
    expect(act.description).toMatch(/terminal_tabs/)
    expect(act.description).toMatch(/visible/)
    expect(BUILT_IN_SUPERONE_TOOL_DEFS.find((def) => def.name === 'layout_snapshot')!.description).toMatch(/layout_act/)
  })
})

describe('opened tab note', () => {
  const focus = 'layout_act action=focus_tab tab="t1"'

  it('tells the agent a tab landed in the picture-in-picture or out of sight, and how to bring it forward', async () => {
    mockCall.mockResolvedValueOnce('pip')
    expect(await openedTabNoteFor('s1', { pip: true, bringForward: focus })).toEqual({
      shown: 'pip',
      reveal: `Opened in the background: the user sees it only as a small picture-in-picture over the chat. If they want it in front, call ${focus}.`,
    })
    expect(mockCall).toHaveBeenCalledWith('s1', 'tabPresentation', { pip: true })

    mockCall.mockResolvedValueOnce('background')
    expect(await openedTabNoteFor('s1', { pip: false, bringForward: focus })).toMatchObject({ shown: 'background', reveal: expect.stringContaining('cannot see it now') })
  })

  it('says nothing when the tab is in the panel on screen, on a remote node, or with no window to ask', async () => {
    mockCall.mockResolvedValueOnce('panel')
    expect(await openedTabNoteFor('s1', { pip: true, bringForward: focus })).toEqual({})

    mockCall.mockRejectedValueOnce(new Error('No renderer window available for browser automation'))
    expect(await openedTabNoteFor('s1', { pip: true, bringForward: focus })).toEqual({})

    mockConnection.mockReturnValue('node-1')
    mockCall.mockClear()
    expect(await openedTabNoteFor('s1', { pip: true, bringForward: focus })).toEqual({})
    expect(mockCall).not.toHaveBeenCalled()
  })
})
