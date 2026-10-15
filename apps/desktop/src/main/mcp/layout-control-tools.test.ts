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

const { mockCall, mockConnection } = vi.hoisted(() => ({
  mockCall: vi.fn(),
  mockConnection: vi.fn<() => string | null>(() => null),
}))
vi.mock('../browser/browser-automation-bridge', () => ({ browserAutomationCall: mockCall }))
vi.mock('./artifact-registry', () => ({ currentHostActionConnection: mockConnection }))

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
      window: { visible: true, sidebar: 'expanded', layout: 'single' },
      panel: { open: true, onScreen: true, side: 'left', maximized: false },
      terminal: { open: false },
      tabs: [{ tab: 'file:src/a.ts', kind: 'file', title: 'a.ts', active: true, group: 0, openedBy: 'agent' }],
    }
    mockCall.mockResolvedValue(snapshot)

    const result = await layoutSnapshotHandler({}, deps())

    expect(mockCall).toHaveBeenCalledWith('s1', 'layoutSnapshot', { root: '/work/app-wt' })
    expect(result.isError).toBeUndefined()
    expect(toonDecode(text(result))).toEqual(snapshot)
  })
})

describe('layout_act', () => {
  it('forwards the request with the session working folder', async () => {
    mockCall.mockResolvedValue({ status: 'queued', visible: false, tab: 'file:src/a.ts' })

    const result = await layoutActHandler({ action: 'open_file', path: 'src/a.ts', line: 3 }, deps())

    expect(mockCall).toHaveBeenCalledWith('s1', 'layoutAct', { root: '/work/app-wt', request: { action: 'open_file', path: 'src/a.ts', line: 3 } })
    expect(JSON.parse(text(result))).toEqual({ status: 'queued', visible: false, tab: 'file:src/a.ts' })
  })

  it('returns the renderer refusal as an actionable error', async () => {
    mockCall.mockRejectedValue(new Error('Tab browser-1 was not opened by you; only tabs you opened can be closed.'))

    const result = await layoutActHandler({ action: 'close_tab', tab: 'browser-1' }, deps())

    expect(result.isError).toBe(true)
    expect(text(result)).toBe('[Error] Tab browser-1 was not opened by you; only tabs you opened can be closed.')
  })

  it('answers remote-node sessions with an explicit unsupported result and never touches the window', async () => {
    mockConnection.mockReturnValue('node-1')

    for (const result of [await layoutActHandler({ action: 'show_panel' }, deps()), await layoutSnapshotHandler({}, deps())]) {
      expect(result.isError).toBeUndefined()
      expect(JSON.parse(text(result))).toMatchObject({ status: 'unsupported', reason: 'remote_node' })
    }
    expect(mockCall).not.toHaveBeenCalled()
  })
})

describe('layout tool contract', () => {
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
    expect(properties.action.enum).not.toContain('open_diff')
    expect(properties).not.toHaveProperty('commit')
    expect(act.inputSchema.required).toEqual(['action'])
    expect(act.inputSchema.additionalProperties).toBe(false)
    expect(act.description).toMatch(/browser_tabs/)
    expect(act.description).toMatch(/terminal_tabs/)
    expect(act.description).toMatch(/layout_snapshot|`visible`/)
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
