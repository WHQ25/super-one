import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MacosPlatformAdapter } from '../platform/macos-adapter'
import type { UiRootIdentity } from '../types'
import { ComputerUseError } from '../types'

function root(partial: Partial<UiRootIdentity> = {}): UiRootIdentity {
  return {
    rootId: '@r1',
    kind: 'window',
    app: 'TextEdit',
    bundleId: 'com.apple.TextEdit',
    pid: 42,
    title: 'Untitled',
    bounds: { x: 0, y: 0, width: 800, height: 600 },
    focused: true,
    visible: true,
    minimized: false,
    modal: false,
    resourceKey: 'pid:42',
    windowId: 12345,
    windowLayer: 0,
    ...partial,
  }
}

describe('MacosPlatformAdapter (mocked client)', () => {
  const call = vi.fn()
  let adapter: MacosPlatformAdapter
  let granted: string[]
  let locale: 'en' | 'zh'

  beforeEach(() => {
    call.mockReset()
    granted = ['com.apple.TextEdit']
    locale = 'en'
    adapter = new MacosPlatformAdapter({
      client: { call, ensureConnected: vi.fn(), request: vi.fn(), close: vi.fn(), path: '/tmp/x.sock' } as never,
      getGrantedBundleIds: () => granted,
      getPictureInPictureEnabled: () => true,
      getDedicatedDisplayId: () => null,
      getLocale: () => locale,
      sessionId: 'session-a',
      maxCaptureWidth: 800,
    })
  })

  it('shows a session-scoped live preview for the active window', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'capture') {
        return {
          mimeType: 'image/png',
          data: 'abc',
          width: 800,
          height: 600,
          coordinateSpace: {
            width: 800,
            height: 600,
            scale: 1,
            fullScreen: false,
            kind: 'window',
            windowId: 12345,
            capturedBounds: { x: 0, y: 0, width: 800, height: 600 },
          },
        }
      }
      return { ok: true }
    })

    await adapter.look(root(), 'visual')

    expect(call).toHaveBeenCalledWith('pip_set_enabled', { enabled: true })
    expect(call).toHaveBeenCalledWith('pip_show_target', expect.objectContaining({
      sessionId: 'session-a',
      windowId: 12345,
      app: 'TextEdit',
      bundleId: 'com.apple.TextEdit',
    }))
  })

  it('hides only its own live preview when visuals are cleared', async () => {
    call.mockResolvedValue({ ok: true })

    await adapter.clearVisuals()

    expect(call).toHaveBeenCalledTimes(1)
    expect(call).toHaveBeenCalledWith('session_clear_visuals', { sessionId: 'session-a' })
  })

  it('moves a target to the dedicated display before capturing it', async () => {
    const dedicatedAdapter = new MacosPlatformAdapter({
      client: { call, ensureConnected: vi.fn(), request: vi.fn(), close: vi.fn(), path: '/tmp/x.sock' } as never,
      getGrantedBundleIds: () => granted,
      getPictureInPictureEnabled: () => true,
      getDedicatedDisplayId: () => '731752946',
      sessionId: 'session-a',
      maxCaptureWidth: 800,
    })
    call.mockImplementation(async (method: string) => {
      if (method === 'display_place_window') {
        return {
          moved: true,
          bounds: { x: 1512, y: 80, width: 800, height: 600 },
        }
      }
      if (method === 'capture') {
        return {
          mimeType: 'image/png',
          data: 'abc',
          width: 800,
          height: 600,
          coordinateSpace: {
            width: 800,
            height: 600,
            scale: 1,
            fullScreen: false,
            kind: 'window',
            windowId: 12345,
            capturedBounds: { x: 1512, y: 80, width: 800, height: 600 },
          },
        }
      }
      return { ok: true }
    })

    const result = await dedicatedAdapter.look(root(), 'visual')

    expect(call).toHaveBeenCalledWith('display_place_window', {
      sessionId: 'session-a',
      displayId: '731752946',
      windowId: 12345,
      pid: 42,
      title: 'Untitled',
    })
    const methods = call.mock.calls.map(([method]) => method)
    expect(methods.indexOf('display_place_window')).toBeLessThan(methods.indexOf('capture'))
    expect(result.root.bounds).toEqual({ x: 1512, y: 80, width: 800, height: 600 })
  })

  it('does not show a live preview when picture-in-picture is disabled', async () => {
    const disabledAdapter = new MacosPlatformAdapter({
      client: { call, ensureConnected: vi.fn(), request: vi.fn(), close: vi.fn(), path: '/tmp/x.sock' } as never,
      getGrantedBundleIds: () => granted,
      getPictureInPictureEnabled: () => false,
      sessionId: 'session-a',
    })
    call.mockImplementation(async (method: string) => {
      if (method === 'capture') {
        return {
          data: 'abc', width: 800, height: 600,
          coordinateSpace: { width: 800, height: 600, scale: 1, fullScreen: false, kind: 'window' },
        }
      }
      return { ok: true }
    })

    await disabledAdapter.look(root(), 'visual')

    expect(call).toHaveBeenCalledWith('pip_set_enabled', { enabled: false })
    expect(call.mock.calls.some(([method]) => method === 'pip_show_target')).toBe(false)
  })

  it('listRoots preserves native dialog and modal metadata', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'list_windows') {
        return {
          windows: [
            {
              app: 'TextEdit',
              bundleId: 'com.apple.TextEdit',
              pid: 42,
              title: 'Save',
              bounds: { x: 100, y: 100, width: 400, height: 240 },
              focused: true,
              visible: true,
              minimized: false,
              modal: true,
              kind: 'dialog',
              resourceKey: 'pid:42',
              windowId: 456,
              axRootId: 'axr:4',
              windowLayer: 0,
            },
          ],
        }
      }
      if (method === 'frontmost') {
        return { app: 'TextEdit', bundleId: 'com.apple.TextEdit', pid: 42, frontmost: true }
      }
      return { ok: true }
    })

    await expect(adapter.listRoots()).resolves.toEqual([
      expect.objectContaining({
        kind: 'dialog',
        modal: true,
        focused: true,
        windowId: 456,
        axRootId: 'axr:4',
      }),
    ])
    expect(call).toHaveBeenCalledWith('list_windows', {
      scanBundleIds: ['com.apple.TextEdit'],
    })
  })

  it('selects the frontmost modal as the active root', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'list_windows') {
        return {
          windows: [
            {
              app: 'TextEdit', bundleId: 'com.apple.TextEdit', pid: 42,
              title: 'Document', bounds: { x: 0, y: 0, width: 800, height: 600 },
              focused: true, visible: true, minimized: false, modal: false,
              kind: 'window', resourceKey: 'pid:42', windowId: 123,
            },
            {
              app: 'TextEdit', bundleId: 'com.apple.TextEdit', pid: 42,
              title: 'Save', bounds: { x: 200, y: 100, width: 400, height: 240 },
              focused: false, visible: true, minimized: false, modal: true,
              kind: 'sheet', resourceKey: 'pid:42', axRootId: 'axr:8',
            },
          ],
        }
      }
      if (method === 'frontmost') {
        return { app: 'TextEdit', bundleId: 'com.apple.TextEdit', pid: 42, frontmost: true }
      }
      return { ok: true }
    })

    const roots = await adapter.listRoots()

    expect(roots.find((candidate) => candidate.kind === 'sheet')?.focused).toBe(true)
    expect(roots.find((candidate) => candidate.kind === 'window')?.focused).toBe(false)
  })

  it('look visual captures with grantedBundleIds and returns picture-only outline', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'capture') {
        return {
          mimeType: 'image/png',
          data: 'abc',
          width: 1600,
          height: 1000,
          coordinateSpace: {
            width: 800,
            height: 500,
            scale: 2,
            fullScreen: false,
            kind: 'window',
            windowId: 12345,
            capturedBounds: { x: 0, y: 0, width: 800, height: 600 },
            displayBounds: { x: 0, y: 0, width: 1512, height: 982 },
          },
          grantedBundleIds: granted,
          excludedAppCount: 12,
        }
      }
      return { ok: true }
    })
    const look = await adapter.look(root(), 'visual')
    // Software cursor is suspended only for the capture itself, then restored.
    expect(call).toHaveBeenCalledWith('overlay_cursor_visible', { visible: false })
    expect(call).toHaveBeenCalledWith('capture', {
      allowAllApps: false,
      grantedBundleIds: ['com.apple.TextEdit'],
      maxWidth: 800,
      capture: 'window',
      pid: 42,
      windowId: 12345,
    })
    expect(call).toHaveBeenCalledWith('overlay_cursor_visible', { visible: true })
    expect(call).toHaveBeenCalledWith('overlay_show_target', expect.objectContaining({
      app: 'TextEdit',
      bundleId: 'com.apple.TextEdit',
      locale: 'en',
    }))
    // Must not permanently hide the cursor after observe.
    const showCalls = call.mock.calls.filter((c) => c[0] === 'overlay_show_target')
    for (const c of showCalls) {
      expect(c[1]).not.toEqual(expect.objectContaining({ hideCursor: true }))
    }
    expect(look.image?.data).toBe('abc')
    expect(look.coordinateSpace.fullScreen).toBe(false)
    expect(look.coordinateSpace.kind).toBe('window')
    expect(look.outline.pictureOnly).toBe(true)
    expect(look.outline.ref).toBe('@e1')
    // visual mode must not call ax_tree
    expect(call.mock.calls.some((c) => c[0] === 'ax_tree')).toBe(false)
  })

  it('captures an AX-only sheet by helper root identity', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'capture') {
        return {
          mimeType: 'image/png',
          data: 'sheet',
          width: 640,
          height: 360,
          coordinateSpace: {
            width: 640,
            height: 360,
            scale: 2,
            fullScreen: false,
            kind: 'window',
            axRootId: 'axr:7',
            capturedBounds: { x: 120, y: 80, width: 320, height: 180 },
            displayBounds: { x: 0, y: 0, width: 1512, height: 982 },
          },
        }
      }
      return { ok: true }
    })

    const look = await adapter.look(root({
      kind: 'sheet',
      modal: true,
      windowId: undefined,
      windowLayer: undefined,
      axRootId: 'axr:7',
      bounds: { x: 120, y: 80, width: 320, height: 180 },
    }), 'visual')

    expect(call).toHaveBeenCalledWith('capture', expect.objectContaining({
      capture: 'window',
      pid: 42,
      axRootId: 'axr:7',
    }))
    expect(look.coordinateSpace).toMatchObject({
      kind: 'window',
      fullScreen: false,
      axRootId: 'axr:7',
    })
  })

  it('look fused captures + builds AX outline', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'capture') {
        return {
          mimeType: 'image/png',
          data: 'abc',
          width: 1600,
          height: 1000,
          coordinateSpace: {
            width: 800,
            height: 500,
            scale: 2,
            fullScreen: false,
            kind: 'window',
            windowId: 12345,
            capturedBounds: { x: 20, y: 30, width: 800, height: 600 },
            displayBounds: { x: 0, y: 0, width: 1512, height: 982 },
          },
        }
      }
      if (method === 'ax_tree') {
        return {
          tree: {
            index: 1,
            role: 'AXWindow',
            name: 'Untitled',
            actions: [],
            children: [
              {
                index: 2,
                role: 'AXTextArea',
                value: 'hi',
                settable: true,
                actions: [],
              },
            ],
          },
          nodeCount: 2,
          maxNodes: 400,
          maxDepth: 24,
          display: { width: 1512, height: 982 },
          pid: 42,
        }
      }
      return { ok: true }
    })
    const look = await adapter.look(root(), 'fused')
    expect(look.image?.data).toBe('abc')
    expect(look.outline.pictureOnly).toBeFalsy()
    expect(look.outline.ref).toBe('@e1')
    expect(look.outline.children?.[0]?.ref).toBe('@e2')
    expect(call).toHaveBeenCalledWith(
      'ax_tree',
      expect.objectContaining({
        pid: 42,
        captureWidth: 800,
        captureHeight: 500,
        captureX: 20,
        captureY: 30,
        captureSourceWidth: 800,
        captureSourceHeight: 600,
        windowId: 12345,
      }),
    )
  })

  it('look semantic returns AX outline without image', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'ax_tree') {
        return {
          tree: { index: 1, role: 'AXWindow', name: 'Doc', actions: [] },
          nodeCount: 1,
          maxNodes: 400,
          maxDepth: 24,
          display: { width: 1000, height: 800 },
          pid: 42,
        }
      }
      return { ok: true }
    })
    const look = await adapter.look(root(), 'semantic')
    expect(look.image).toBeUndefined()
    expect(look.outline.role).toBe('window')
    expect(call.mock.calls.some((c) => c[0] === 'capture')).toBe(false)
    // Semantic has no screenshot — do not suspend or force-hide the cursor.
    expect(call.mock.calls.some((c) => c[0] === 'overlay_cursor_visible')).toBe(false)
    expect(call).toHaveBeenCalledWith('overlay_show_target', expect.objectContaining({
      app: 'TextEdit',
    }))
    const showCalls = call.mock.calls.filter((c) => c[0] === 'overlay_show_target')
    for (const c of showCalls) {
      expect(c[1]).not.toEqual(expect.objectContaining({ hideCursor: true }))
    }
  })

  it('scopes semantic observe to an AX-only root', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'ax_tree') {
        return {
          tree: { index: 1, role: 'AXSheet', name: 'Save', actions: [] },
          nodeCount: 1,
          maxNodes: 400,
          maxDepth: 24,
          display: { width: 1000, height: 800 },
          pid: 42,
        }
      }
      return { ok: true }
    })
    const look = await adapter.look(root({
      kind: 'sheet',
      modal: true,
      windowId: undefined,
      axRootId: 'axr:9',
      bounds: { x: 100, y: 100, width: 400, height: 240 },
    }), 'semantic')

    expect(look.outline.role).toBe('sheet')
    expect(call).toHaveBeenCalledWith('ax_tree', expect.objectContaining({
      pid: 42,
      axRootId: 'axr:9',
    }))
  })

  it('look fails when allowlist empty', async () => {
    granted = []
    await expect(adapter.look(root(), 'visual')).rejects.toBeInstanceOf(ComputerUseError)
  })

  it('look allows empty grant list when allowAllApps is true', async () => {
    granted = []
    const allowAllAdapter = new MacosPlatformAdapter({
      client: { call, ensureConnected: vi.fn(), request: vi.fn(), close: vi.fn(), path: '/tmp/x.sock' } as never,
      getGrantedBundleIds: () => granted,
      getAllowAllApps: () => true,
      maxCaptureWidth: 800,
    })
    call.mockImplementation(async (method: string) => {
      if (method === 'capture') {
        return {
          mimeType: 'image/png',
          data: 'abc',
          width: 1600,
          height: 1000,
          coordinateSpace: {
            width: 800,
            height: 500,
            scale: 2,
            fullScreen: false,
            kind: 'window',
            windowId: 12345,
            capturedBounds: { x: 0, y: 0, width: 800, height: 600 },
            displayBounds: { x: 0, y: 0, width: 1512, height: 982 },
          },
        }
      }
      return { ok: true }
    })
    await allowAllAdapter.look(root(), 'visual')
    expect(call).toHaveBeenCalledWith('capture', {
      allowAllApps: true,
      grantedBundleIds: [],
      maxWidth: 800,
      capture: 'window',
      pid: 42,
      windowId: 12345,
    })
  })

  it('look supports explicit display capture', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'capture') {
        return {
          mimeType: 'image/png',
          data: 'display',
          width: 800,
          height: 500,
          coordinateSpace: {
            width: 800,
            height: 500,
            scale: 2,
            fullScreen: true,
            kind: 'display',
            capturedBounds: { x: 0, y: 0, width: 1512, height: 982 },
            displayBounds: { x: 0, y: 0, width: 1512, height: 982 },
          },
        }
      }
      return { ok: true }
    })

    const look = await adapter.look(root(), 'visual', 'display')
    expect(call).toHaveBeenCalledWith('capture', expect.objectContaining({
      capture: 'display',
      windowId: 12345,
    }))
    expect(look.coordinateSpace).toMatchObject({ kind: 'display', fullScreen: true })
  })

  it('act semantic rejects coordinate-only click (AX-only)', async () => {
    const res = await adapter.act({
      root: root(),
      actions: [{ type: 'click', x: 10, y: 20 }],
      delivery: 'semantic',
    })
    expect(res.steps[0]?.applied).toBe(false)
    expect(res.steps[0]?.description).toMatch(/semantic requires ref/)
  })

  it('act semantic press uses ax_action', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'ax_action') {
        return {
          ok: true,
          index: 3,
          action: 'press',
          beforeValue: 'off',
          afterValue: 'on',
        }
      }
      return { ok: true }
    })
    const res = await adapter.act({
      root: root(),
      actions: [{ type: 'press', ref: '@e3' }],
      delivery: 'semantic',
      outline: {
        ref: '@e1',
        role: 'window',
        children: [{ ref: '@e3', role: 'button', name: 'OK', capabilities: { press: true } }],
      },
    })
    expect(call).toHaveBeenCalledWith(
      'ax_action',
      expect.objectContaining({ pid: 42, index: 3, action: 'press', windowId: 12345 }),
    )
    expect(res.steps[0]?.applied).toBe(true)
    expect(res.steps[0]?.unknown).toBe(false)
  })

  it('press on a relabeling control counts the name change as evidence', async () => {
    // A control that has no AXValue now reports undefined instead of echoing
    // its title, so a title flip is the only evidence that the press landed.
    call.mockImplementation(async (method: string) => {
      if (method === 'ax_action') {
        return { ok: true, index: 3, action: 'press', beforeName: 'Play', afterName: 'Pause' }
      }
      return { ok: true }
    })
    const res = await adapter.act({
      root: root(),
      actions: [{ type: 'press', ref: '@e3' }],
      delivery: 'semantic',
      outline: {
        ref: '@e1',
        role: 'window',
        children: [{ ref: '@e3', role: 'button', name: 'Play', capabilities: { press: true } }],
      },
    })
    expect(res.steps[0]?.unknown).toBe(false)
  })

  it('press on an inert control stays unknown', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'ax_action') {
        return { ok: true, index: 3, action: 'press', beforeName: 'OK', afterName: 'OK' }
      }
      return { ok: true }
    })
    const res = await adapter.act({
      root: root(),
      actions: [{ type: 'press', ref: '@e3' }],
      delivery: 'semantic',
      outline: {
        ref: '@e1',
        role: 'window',
        children: [{ ref: '@e3', role: 'button', name: 'OK', capabilities: { press: true } }],
      },
    })
    expect(res.steps[0]?.unknown).toBe(true)
  })

  it('acts semantically within an AX-only root', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'ax_action') {
        return { ok: true, index: 2, action: 'press', beforeName: 'Save', afterName: 'Save' }
      }
      return { ok: true }
    })
    await adapter.act({
      root: root({
        kind: 'sheet',
        modal: true,
        windowId: undefined,
        axRootId: 'axr:11',
      }),
      actions: [{ type: 'press', ref: '@e2' }],
      delivery: 'semantic',
      coordinateSpace: {
        width: 400,
        height: 240,
        scale: 2,
        fullScreen: false,
        kind: 'window',
        axRootId: 'axr:11',
        capturedBounds: { x: 100, y: 100, width: 400, height: 240 },
      },
      outline: {
        ref: '@e1',
        role: 'sheet',
        children: [{ ref: '@e2', role: 'button', name: 'Save', capabilities: { press: true } }],
      },
    })

    expect(call).toHaveBeenCalledWith('ax_action', expect.objectContaining({
      pid: 42,
      targetPid: 42,
      index: 2,
      axRootId: 'axr:11',
      coordinateAxRootId: 'axr:11',
    }))
  })

  it('act setText via AX confirms when afterValue matches', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'ax_action') {
        return {
          ok: true,
          index: 2,
          action: 'set_value',
          beforeValue: '',
          afterValue: 'hello',
          value: 'hello',
        }
      }
      return { ok: true }
    })
    const res = await adapter.act({
      root: root(),
      actions: [{ type: 'setText', ref: '@e2', text: 'hello' }],
      delivery: 'semantic',
      coordinateSpace: { width: 800, height: 500, scale: 2, fullScreen: true },
      outline: {
        ref: '@e1',
        role: 'window',
        children: [{
          ref: '@e2',
          role: 'textField',
          name: 'Message',
          value: '',
          bounds: { x: 100, y: 200, width: 300, height: 40 },
          capabilities: { setText: true },
        }],
      },
    })
    expect(call).toHaveBeenCalledWith('ax_action', expect.objectContaining({
      pid: 42,
      index: 2,
      action: 'set_value',
      value: 'hello',
      windowId: 12345,
      expectedRole: 'textField',
      expectedName: 'Message',
      expectedValue: '',
      expectedBounds: [100, 200, 300, 40],
      expectedCoordinateWidth: 800,
      expectedCoordinateHeight: 500,
    }))
    expect(res.steps[0]?.applied).toBe(true)
    expect(res.steps[0]?.unknown).toBe(false)
    expect(res.steps[0]?.after?.value).toBe('hello')
  })

  it('reports helper ref recovery in semantic action evidence', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'ax_action') {
        return {
          ok: true,
          requestedIndex: 2,
          index: 9,
          recovered: true,
          action: 'set_value',
          beforeValue: '',
          afterValue: 'hello',
        }
      }
      return { ok: true }
    })
    const res = await adapter.act({
      root: root(),
      actions: [{ type: 'setText', ref: '@e2', text: 'hello' }],
      delivery: 'semantic',
      coordinateSpace: { width: 800, height: 500, scale: 2, fullScreen: true },
      outline: {
        ref: '@e1',
        role: 'window',
        children: [{
          ref: '@e2',
          role: 'textArea',
          bounds: { x: 100, y: 200, width: 300, height: 40 },
          capabilities: { setText: true },
        }],
      },
    })
    expect(res.steps[0]?.description).toContain('recovered index 2 -> 9')
  })

  const overlayFields = {
    visualIndicators: true,
    windowApp: 'TextEdit',
    windowBundleId: 'com.apple.TextEdit',
    targetBundleId: 'com.apple.TextEdit',
    sessionId: 'session-a',
    locale: 'en',
    windowX: 0,
    windowY: 0,
    windowWidth: 800,
    windowHeight: 600,
    windowId: 12345,
    windowLayer: 0,
  }

  it('forwards the current SuperOne locale to native visual indicators', async () => {
    locale = 'zh'
    call.mockResolvedValue({ ok: true, unknown: true })

    await adapter.act({
      root: root(),
      actions: [{ type: 'click', x: 100, y: 200 }],
      delivery: 'app-directed',
    })

    expect(call).toHaveBeenCalledWith('overlay_show_target', expect.objectContaining({
      locale: 'zh',
    }))
    expect(call).toHaveBeenCalledWith('click', expect.objectContaining({
      locale: 'zh',
    }))
  })

  it('act click defaults path uses app_post with target pid (background)', async () => {
    call.mockResolvedValue({ ok: true, unknown: true })
    const res = await adapter.act({
      root: root(),
      actions: [{ type: 'click', x: 100, y: 200, button: 'left' }],
      delivery: 'app-directed',
    })
    // Software cursor is painted before HID so the hop is visible during the click.
    expect(call).toHaveBeenCalledWith('overlay_show_target', expect.objectContaining({
      cursorX: 100,
      cursorY: 200,
    }))
    expect(call).toHaveBeenCalledWith('click', {
      x: 100,
      y: 200,
      button: 'left',
      count: 1,
      delivery: 'app_post',
      targetBundleId: 'com.apple.TextEdit',
      targetPid: 42,
      ...overlayFields,
    })
    expect(res.steps[0]?.applied).toBe(true)
    expect(res.steps[0]?.unknown).toBe(true)
    expect(res.steps[0]?.description).toContain('app_post')
  })

  it('passes window-local coordinates and capture geometry to helper input', async () => {
    call.mockResolvedValue({ ok: true, unknown: true })
    const coordinateSpace = {
      width: 1200,
      height: 900,
      scale: 2,
      fullScreen: false,
      kind: 'window' as const,
      windowId: 12345,
      capturedBounds: { x: 100, y: 80, width: 600, height: 450 },
      displayBounds: { x: 0, y: 0, width: 1512, height: 982 },
    }
    await adapter.act({
      root: root({ bounds: coordinateSpace.capturedBounds }),
      actions: [{ type: 'click', x: 600, y: 450 }],
      delivery: 'app-directed',
      coordinateSpace,
    })

    const coordinateFields = {
      coordinateKind: 'window',
      coordinateWidth: 1200,
      coordinateHeight: 900,
      coordinateScale: 2,
      coordinateWindowId: 12345,
      capturedX: 100,
      capturedY: 80,
      capturedWidth: 600,
      capturedHeight: 450,
      displayX: 0,
      displayY: 0,
      displayWidth: 1512,
      displayHeight: 982,
    }
    expect(call).toHaveBeenCalledWith('validate_geometry', expect.objectContaining(coordinateFields))
    expect(call).toHaveBeenCalledWith('click', expect.objectContaining({
      x: 600,
      y: 450,
      sessionId: 'session-a',
      ...coordinateFields,
    }))
  })

  it('repositions a restored target before input and shifts captured geometry', async () => {
    const dedicatedAdapter = new MacosPlatformAdapter({
      client: { call, ensureConnected: vi.fn(), request: vi.fn(), close: vi.fn(), path: '/tmp/x.sock' } as never,
      getGrantedBundleIds: () => granted,
      getDedicatedDisplayId: () => '731752946',
      sessionId: 'session-a',
    })
    call.mockImplementation(async (method: string) => {
      if (method === 'display_place_window') {
        return { moved: true, bounds: { x: 1512, y: 80, width: 800, height: 600 } }
      }
      return { ok: true, unknown: true }
    })

    await dedicatedAdapter.act({
      root: root({ bounds: { x: 0, y: 20, width: 800, height: 600 } }),
      actions: [{ type: 'click', x: 400, y: 300 }],
      delivery: 'app-directed',
      coordinateSpace: {
        width: 800,
        height: 600,
        scale: 2,
        fullScreen: false,
        kind: 'window',
        windowId: 12345,
        capturedBounds: { x: 0, y: 20, width: 800, height: 600 },
      },
    })

    const methods = call.mock.calls.map(([method]) => method)
    expect(methods.indexOf('display_place_window')).toBeLessThan(methods.indexOf('validate_geometry'))
    expect(methods.indexOf('validate_geometry')).toBeLessThan(methods.indexOf('click'))
    expect(call).toHaveBeenCalledWith('click', expect.objectContaining({
      x: 400,
      y: 300,
      capturedX: 1512,
      capturedY: 80,
      windowX: 1512,
      windowY: 80,
    }))
  })

  it('fails closed before input when dedicated-display placement fails', async () => {
    const dedicatedAdapter = new MacosPlatformAdapter({
      client: { call, ensureConnected: vi.fn(), request: vi.fn(), close: vi.fn(), path: '/tmp/x.sock' } as never,
      getGrantedBundleIds: () => granted,
      getDedicatedDisplayId: () => 'missing-display',
      sessionId: 'session-a',
    })
    call.mockImplementation(async (method: string) => {
      if (method === 'display_place_window') {
        throw Object.assign(new Error('display unavailable'), { code: 'DISPLAY_UNAVAILABLE' })
      }
      return { ok: true }
    })

    const result = await dedicatedAdapter.act({
      root: root(),
      actions: [{ type: 'click', x: 10, y: 20 }],
      delivery: 'app-directed',
      coordinateSpace: {
        width: 800,
        height: 600,
        scale: 2,
        fullScreen: false,
        kind: 'window',
        windowId: 12345,
        capturedBounds: { x: 0, y: 0, width: 800, height: 600 },
      },
    })

    expect(result.steps[0]).toMatchObject({ applied: false })
    expect(result.steps[0]?.description).toContain('DISPLAY_UNAVAILABLE')
    expect(call.mock.calls.some(([method]) => method === 'click')).toBe(false)
  })

  it('fails closed before input when window geometry changed', async () => {
    const changed = Object.assign(new Error('window resized'), {
      code: 'WINDOW_GEOMETRY_CHANGED',
    })
    call.mockImplementation(async (method: string) => {
      if (method === 'validate_geometry') throw changed
      return { ok: true }
    })
    const res = await adapter.act({
      root: root(),
      actions: [{ type: 'click', x: 10, y: 20 }],
      delivery: 'app-directed',
      coordinateSpace: {
        width: 800,
        height: 600,
        scale: 2,
        fullScreen: false,
        kind: 'window',
        windowId: 12345,
        capturedBounds: { x: 0, y: 0, width: 800, height: 600 },
        displayBounds: { x: 0, y: 0, width: 1512, height: 982 },
      },
    })

    expect(res.steps[0]).toMatchObject({ applied: false })
    expect(res.steps[0]?.description).toContain('WINDOW_GEOMETRY_CHANGED')
    expect(call.mock.calls.some(([method]) => method === 'click')).toBe(false)
  })

  it('act press (AX) paints software cursor at element bounds', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'ax_action') {
        return {
          beforeValue: '',
          afterValue: '',
          beforeName: 'OK',
          afterName: 'OK',
        }
      }
      return { ok: true }
    })
    const res = await adapter.act({
      root: root(),
      delivery: 'app-directed',
      outline: {
        ref: '@e1',
        role: 'screen',
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        children: [
          {
            ref: '@e2',
            role: 'button',
            bounds: { x: 100, y: 200, width: 80, height: 40 },
            capabilities: { press: true },
          },
        ],
      },
      actions: [{ type: 'press', ref: '@e2' }],
    })
    expect(res.steps[0]?.applied).toBe(true)
    // Center of button bounds: (140, 220)
    expect(call).toHaveBeenCalledWith('overlay_show_target', expect.objectContaining({
      cursorX: 140,
      cursorY: 220,
    }))
    expect(call).toHaveBeenCalledWith('ax_action', expect.objectContaining({
      index: 2,
      action: 'press',
    }))
  })

  it('act physical uses global HID + frontmost gate', async () => {
    call.mockResolvedValue({ ok: true, unknown: true })
    await adapter.act({
      root: root(),
      actions: [{ type: 'click', x: 1, y: 2 }],
      delivery: 'physical',
    })
    expect(call).toHaveBeenCalledWith('click', {
      x: 1,
      y: 2,
      button: 'left',
      count: 1,
      delivery: 'global',
      requireFrontmostBundleId: 'com.apple.TextEdit',
      targetBundleId: 'com.apple.TextEdit',
      targetPid: 42,
      ...overlayFields,
    })
  })

  it('act typeText / keypress go through helper with app_post', async () => {
    call.mockResolvedValue({ ok: true, unknown: true })
    await adapter.act({
      root: root(),
      actions: [
        { type: 'typeText', text: 'hi' },
        { type: 'keypress', keys: ['Return'] },
      ],
      delivery: 'app-directed',
    })
    expect(call).toHaveBeenCalledWith('type_text', {
      text: 'hi',
      delivery: 'app_post',
      targetBundleId: 'com.apple.TextEdit',
      targetPid: 42,
      ...overlayFields,
    })
    expect(call).toHaveBeenCalledWith('keypress', {
      key: 'Return',
      delivery: 'app_post',
      targetBundleId: 'com.apple.TextEdit',
      targetPid: 42,
      ...overlayFields,
    })
  })

  it('uses capture-local center for cursor feedback on a secondary display', async () => {
    call.mockResolvedValue({ ok: true, unknown: true })
    await adapter.act({
      root: root({ bounds: { x: 1512, y: 0, width: 800, height: 600 } }),
      actions: [{ type: 'keypress', keys: ['Return'] }],
      delivery: 'app-directed',
      coordinateSpace: {
        width: 1200,
        height: 900,
        scale: 1.5,
        fullScreen: true,
        kind: 'display',
        capturedBounds: { x: 1512, y: 0, width: 800, height: 600 },
        displayBounds: { x: 1512, y: 0, width: 800, height: 600 },
      },
    })

    expect(call).toHaveBeenCalledWith('overlay_show_target', expect.objectContaining({
      cursorX: 600,
      cursorY: 450,
      coordinateKind: 'display',
    }))
  })

  it('act scroll posts wheel at outline center', async () => {
    call.mockResolvedValue({ ok: true, unknown: true })
    const res = await adapter.act({
      root: root(),
      actions: [{ type: 'scroll', dy: 120 }],
      delivery: 'app-directed',
      outline: {
        ref: '@e1',
        role: 'screen',
        bounds: { x: 0, y: 0, width: 800, height: 600 },
      },
    })
    expect(call).toHaveBeenCalledWith(
      'scroll',
      expect.objectContaining({
        x: 400,
        y: 300,
        dx: 0,
        dy: 120,
        delivery: 'app_post',
        targetPid: 42,
      }),
    )
    expect(res.steps[0]?.applied).toBe(true)
  })

  it('act scroll prefers explicit x,y over outline center', async () => {
    call.mockResolvedValue({ ok: true, unknown: true })
    await adapter.act({
      root: root(),
      actions: [{ type: 'scroll', x: 700, y: 380, dy: 200 }],
      delivery: 'physical',
      outline: {
        ref: '@e1',
        role: 'screen',
        bounds: { x: 0, y: 0, width: 800, height: 600 },
      },
    })
    expect(call).toHaveBeenCalledWith(
      'scroll',
      expect.objectContaining({
        x: 700,
        y: 380,
        dy: 200,
        delivery: 'global',
        targetPid: 42,
      }),
    )
  })

  it('act drag posts path points', async () => {
    call.mockResolvedValue({ ok: true, unknown: true })
    const res = await adapter.act({
      root: root(),
      actions: [
        {
          type: 'drag',
          path: [
            { x: 10, y: 20 },
            { x: 100, y: 200 },
          ],
        },
      ],
      delivery: 'app-directed',
    })
    expect(call).toHaveBeenCalledWith(
      'drag',
      expect.objectContaining({
        path: [
          { x: 10, y: 20 },
          { x: 100, y: 200 },
        ],
        delivery: 'app_post',
        targetPid: 42,
      }),
    )
    expect(res.steps[0]?.applied).toBe(true)
    expect(res.steps[0]?.description).toContain('drag')
  })

  it('act moveMouse posts move_mouse', async () => {
    call.mockResolvedValue({ ok: true, unknown: true })
    await adapter.act({
      root: root(),
      actions: [{ type: 'moveMouse', x: 50, y: 60 }],
      delivery: 'app-directed',
    })
    expect(call).toHaveBeenCalledWith(
      'move_mouse',
      expect.objectContaining({ x: 50, y: 60, delivery: 'app_post' }),
    )
  })

  it('focusApp / launchApp never activate by default', async () => {
    call.mockResolvedValue({ ok: true })
    await adapter.focusApp('TextEdit')
    await adapter.launchApp('TextEdit')
    expect(call).toHaveBeenCalledWith('focus_app', { app: 'TextEdit', activate: false })
    expect(call).toHaveBeenCalledWith('launch_app', { app: 'TextEdit', activate: false })
  })
})

describe('native walk truncation', () => {
  const call = vi.fn()
  let adapter: MacosPlatformAdapter

  beforeEach(() => {
    call.mockReset()
    adapter = new MacosPlatformAdapter({
      client: { call, ensureConnected: vi.fn(), request: vi.fn(), close: vi.fn(), path: '/tmp/x.sock' } as never,
      getGrantedBundleIds: () => ['com.apple.TextEdit'],
      getPictureInPictureEnabled: () => false,
      getDedicatedDisplayId: () => null,
      getLocale: () => 'en' as const,
      sessionId: 'session-truncation',
      maxCaptureWidth: 800,
    })
  })

  function replyWith(truncated: boolean | undefined) {
    call.mockImplementation(async (method: string) => {
      if (method === 'ax_tree') {
        return {
          tree: { index: 1, role: 'AXWindow', name: 'Untitled', actions: [] },
          nodeCount: 1,
          maxNodes: 1200,
          maxDepth: 64,
          display: { width: 1440, height: 900 },
          pid: 42,
          ...(truncated === undefined ? {} : { truncated }),
        }
      }
      return {}
    })
  }

  it('reports a native walk that stopped short, which no fold count can express', async () => {
    // The helper can cut the tree before TypeScript ever sees it. Compaction
    // then shrinks what is left under the fold budget, so nodesOmitted reads 0
    // and the loss becomes invisible — including to computer_query.
    replyWith(true)
    const look = await adapter.look(root(), 'semantic')
    expect(look.outlineTruncated).toBe(true)
  })

  it('does not claim truncation when the helper walked the whole tree', async () => {
    replyWith(false)
    expect((await adapter.look(root(), 'semantic')).outlineTruncated).toBe(false)
  })

  it('treats an older helper that omits the flag as untruncated', async () => {
    replyWith(undefined)
    expect((await adapter.look(root(), 'semantic')).outlineTruncated).toBe(false)
  })
})
