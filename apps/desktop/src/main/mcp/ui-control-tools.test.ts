import { beforeEach, describe, expect, it, vi } from 'vitest'
import { decode as toonDecode } from '@toon-format/toon'
import {
  MAIN_THREAD_ONLY_SUPERONE_TOOL_NAMES,
  isStaticHostOwnedSuperoneBareName,
} from '@superone/shared/superone-host-owned-tools'
import { isNodeLocalSuperoneTool } from '@superone/shared/environment/host-action-browser-catalog'
import { HOST_ACTION_SUPERONE_TOOL_DESCRIPTORS } from '@superone/shared/environment/host-action-superone-descriptors'
import { UI_ACT_ACTIONS } from '@superone/shared/ui-control'
import type { BuiltInSuperoneToolDeps } from './superone-mcp-builtins'

const { mockCall, mockConnection } = vi.hoisted(() => ({
  mockCall: vi.fn(),
  mockConnection: vi.fn<() => string | null>(() => null),
}))
vi.mock('../browser/browser-automation-bridge', () => ({ browserAutomationCall: mockCall }))
vi.mock('./artifact-registry', () => ({ currentHostActionConnection: mockConnection }))

const { uiActHandler, uiSnapshotHandler } = await import('./ui-control-tools')
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

describe('ui_snapshot', () => {
  it('asks the renderer for the calling session and encodes the layout as TOON', async () => {
    const snapshot = {
      visible: true,
      window: { visible: true, sidebar: 'expanded', layout: 'single' },
      panel: { open: true, onScreen: true, side: 'left', maximized: false },
      terminal: { open: false },
      tabs: [{ tab: 'file:src/a.ts', kind: 'file', title: 'a.ts', active: true, group: 0, openedBy: 'agent' }],
    }
    mockCall.mockResolvedValue(snapshot)

    const result = await uiSnapshotHandler({}, deps())

    expect(mockCall).toHaveBeenCalledWith('s1', 'uiSnapshot', { root: '/work/app-wt' })
    expect(result.isError).toBeUndefined()
    expect(toonDecode(text(result))).toEqual(snapshot)
  })
})

describe('ui_act', () => {
  it('forwards the request with the session working folder', async () => {
    mockCall.mockResolvedValue({ status: 'queued', visible: false, tab: 'file:src/a.ts' })

    const result = await uiActHandler({ action: 'open_file', path: 'src/a.ts', line: 3 }, deps())

    expect(mockCall).toHaveBeenCalledWith('s1', 'uiAct', { root: '/work/app-wt', request: { action: 'open_file', path: 'src/a.ts', line: 3 } })
    expect(JSON.parse(text(result))).toEqual({ status: 'queued', visible: false, tab: 'file:src/a.ts' })
  })

  it('returns the renderer refusal as an actionable error', async () => {
    mockCall.mockRejectedValue(new Error('Tab browser-1 was not opened by you; only tabs you opened can be closed.'))

    const result = await uiActHandler({ action: 'close_tab', tab: 'browser-1' }, deps())

    expect(result.isError).toBe(true)
    expect(text(result)).toBe('[Error] Tab browser-1 was not opened by you; only tabs you opened can be closed.')
  })

  it('answers remote-node sessions with an explicit unsupported result and never touches the window', async () => {
    mockConnection.mockReturnValue('node-1')

    for (const result of [await uiActHandler({ action: 'show_panel' }, deps()), await uiSnapshotHandler({}, deps())]) {
      expect(result.isError).toBeUndefined()
      expect(JSON.parse(text(result))).toMatchObject({ status: 'unsupported', reason: 'remote_node' })
    }
    expect(mockCall).not.toHaveBeenCalled()
  })
})

describe('ui tool contract', () => {
  it('is admitted by every harness without a confirm, callable by subagents, and advertised to remote nodes', () => {
    for (const name of ['ui_snapshot', 'ui_act']) {
      expect(isStaticHostOwnedSuperoneBareName(name), name).toBe(true)
      expect(MAIN_THREAD_ONLY_SUPERONE_TOOL_NAMES as readonly string[]).not.toContain(name)
      expect(isNodeLocalSuperoneTool(name), name).toBe(false)
      const desktop = BUILT_IN_SUPERONE_TOOL_DEFS.find((def) => def.name === name)
      const remote = HOST_ACTION_SUPERONE_TOOL_DESCRIPTORS.find((def) => def.name === name)
      expect(remote?.description).toBe(desktop?.description)
      expect(remote?.inputSchema).toEqual(desktop?.inputSchema)
    }
  })

  it('keeps ui_act a closed action enum that sends browser and terminal opens to their own tools', () => {
    const act = BUILT_IN_SUPERONE_TOOL_DEFS.find((def) => def.name === 'ui_act')!
    const properties = act.inputSchema.properties as Record<string, { enum?: string[] }>
    expect(properties.action.enum).toEqual([...UI_ACT_ACTIONS])
    expect(act.inputSchema.required).toEqual(['action'])
    expect(act.inputSchema.additionalProperties).toBe(false)
    expect(act.description).toMatch(/browser_tabs/)
    expect(act.description).toMatch(/terminal_tabs/)
    expect(act.description).toMatch(/ui_snapshot|`visible`/)
    expect(BUILT_IN_SUPERONE_TOOL_DEFS.find((def) => def.name === 'ui_snapshot')!.description).toMatch(/ui_act/)
  })
})
