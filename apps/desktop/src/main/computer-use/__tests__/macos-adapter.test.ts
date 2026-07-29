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

  beforeEach(() => {
    call.mockReset()
    granted = ['com.apple.TextEdit']
    adapter = new MacosPlatformAdapter({
      client: { call, ensureConnected: vi.fn(), request: vi.fn(), close: vi.fn(), path: '/tmp/x.sock' } as never,
      getGrantedBundleIds: () => granted,
      maxCaptureWidth: 800,
    })
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
    expect(call).toHaveBeenCalledWith('capture', {
      allowAllApps: false,
      grantedBundleIds: ['com.apple.TextEdit'],
      maxWidth: 800,
      capture: 'window',
      windowId: 12345,
    })
    expect(call).toHaveBeenCalledWith('overlay_show_target', expect.objectContaining({
      app: 'TextEdit',
      bundleId: 'com.apple.TextEdit',
    }))
    expect(look.image?.data).toBe('abc')
    expect(look.coordinateSpace.fullScreen).toBe(false)
    expect(look.coordinateSpace.kind).toBe('window')
    expect(look.outline.pictureOnly).toBe(true)
    expect(look.outline.ref).toBe('@e1')
    // visual mode must not call ax_tree
    expect(call.mock.calls.some((c) => c[0] === 'ax_tree')).toBe(false)
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
      expect.objectContaining({ pid: 42, index: 3, action: 'press' }),
    )
    expect(res.steps[0]?.applied).toBe(true)
    expect(res.steps[0]?.unknown).toBe(false)
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
    windowX: 0,
    windowY: 0,
    windowWidth: 800,
    windowHeight: 600,
    windowId: 12345,
    windowLayer: 0,
  }

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
      ...coordinateFields,
    }))
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
