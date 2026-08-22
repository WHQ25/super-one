/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import type { IDockviewPanelProps } from 'dockview-core'
import {
  DEVICE_MIN_PANEL_WIDTH,
  DeviceDockPanel,
  resolveDeviceMinWidth,
} from './DeviceDockPanel'

vi.mock('./DevicePanel', () => ({
  DevicePanel: () => <div data-testid="panel" />,
}))

const DOCKVIEW_DEFAULT = 100

function group(name: string) {
  return { name, api: { setConstraints: vi.fn() } }
}

function setup({
  dockWidth = 1200,
  initial = group('a'),
  groupCount = 1,
}: { dockWidth?: number; initial?: ReturnType<typeof group>; groupCount?: number } = {}) {
  let current = initial
  let width = dockWidth
  let onGroupChange: (() => void) | undefined
  let onLayout: (() => void) | undefined

  const api = {
    get group() { return current },
    onDidGroupChange: (listener: () => void) => {
      onGroupChange = listener
      return { dispose: vi.fn() }
    },
  }
  const containerApi = {
    get width() { return width },
    get groups() { return Array.from({ length: groupCount }) },
    onDidLayoutChange: (listener: () => void) => {
      onLayout = listener
      return { dispose: vi.fn() }
    },
  }

  const view = render(
    <DeviceDockPanel
      {...({ api, containerApi, params: { sessionId: 'session-1' } } as unknown as IDockviewPanelProps<{ sessionId: string }>)}
    />,
  )
  return {
    view,
    resizeDock: (next: number) => { width = next; onLayout?.() },
    relayout: () => onLayout?.(),
    moveTo: (next: ReturnType<typeof group>) => { current = next; onGroupChange?.() },
  }
}

describe('resolveDeviceMinWidth', () => {
  it('asks for the full floor when the dock can spare it', () => {
    expect(resolveDeviceMinWidth(1200)).toBe(DEVICE_MIN_PANEL_WIDTH)
  })

  it('never asks for more than the dock has', () => {
    // Demanding more is what makes dockview overflow the panel and clip the device.
    expect(resolveDeviceMinWidth(280)).toBe(280)
  })

  it('leaves sibling groups their own floor', () => {
    expect(resolveDeviceMinWidth(420, 1)).toBe(320)
  })

  it('falls back to dockview\'s default when the dock has not been measured', () => {
    expect(resolveDeviceMinWidth(0)).toBe(DOCKVIEW_DEFAULT)
    expect(resolveDeviceMinWidth(Number.NaN)).toBe(DOCKVIEW_DEFAULT)
  })
})

describe('iOS Simulator dock panel width floor', () => {
  it('holds the group above the width the device needs', () => {
    const a = group('a')
    setup({ initial: a })

    expect(a.api.setConstraints).toHaveBeenCalledWith({
      minimumWidth: DEVICE_MIN_PANEL_WIDTH,
    })
  })

  it('yields rather than overflow a dock that is narrower than the floor', () => {
    const a = group('a')
    setup({ initial: a, dockWidth: 300 })

    expect(a.api.setConstraints).toHaveBeenCalledWith({ minimumWidth: 300 })
  })

  it('takes the full floor back once the dock is wide enough again', () => {
    const a = group('a')
    const { resizeDock } = setup({ initial: a, dockWidth: 300 })

    resizeDock(1200)

    expect(a.api.setConstraints).toHaveBeenLastCalledWith({
      minimumWidth: DEVICE_MIN_PANEL_WIDTH,
    })
  })

  it('writes nothing when a relayout leaves the floor unchanged', () => {
    const a = group('a')
    const { relayout } = setup({ initial: a })

    a.api.setConstraints.mockClear()
    relayout()

    // Each write relayouts the dock, so re-writing the same value would spin.
    expect(a.api.setConstraints).not.toHaveBeenCalled()
  })

  it('hands the width back when the tab closes', () => {
    const a = group('a')
    const { view } = setup({ initial: a })

    view.unmount()

    // dockview's own default, not zero: other tabs may outlive this one in the group.
    expect(a.api.setConstraints).toHaveBeenLastCalledWith({ minimumWidth: DOCKVIEW_DEFAULT })
  })

  it('carries the floor to the group the tab is dragged into', () => {
    const a = group('a')
    const b = group('b')
    const { moveTo } = setup({ initial: a })

    moveTo(b)

    expect(a.api.setConstraints).toHaveBeenLastCalledWith({ minimumWidth: DOCKVIEW_DEFAULT })
    expect(b.api.setConstraints).toHaveBeenCalledWith({
      minimumWidth: DEVICE_MIN_PANEL_WIDTH,
    })
  })
})
