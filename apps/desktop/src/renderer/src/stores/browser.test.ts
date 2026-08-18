import { beforeEach, describe, expect, it } from 'vitest'
import { useBrowserStore } from './browser'

const PANEL_RECT = { left: 10, top: 20, width: 500, height: 600 } as DOMRectReadOnly
const PIP_RECT = { left: 300, top: 40, width: 360, height: 240 } as DOMRectReadOnly
const OVERLAY_RECT = { left: 80, top: 60, width: 1200, height: 760 } as DOMRectReadOnly

beforeEach(() => {
  useBrowserStore.setState({
    tabs: {},
    slots: {},
    pipSlots: {},
    overlaySlots: {},
    automationCounts: {},
    activeAutomationId: null,
    pendingPreviewBrowserId: null,
    automationPreviewBrowserId: null,
    expandedBrowserId: null,
    pinnedPipBrowserId: null,
    hiddenPreviewBrowserId: null,
  })
})

describe('browser presentation slots', () => {
  it('keeps panel, picture-in-picture, and overlay geometry independently', () => {
    const store = useBrowserStore.getState()
    store.ensure('browser-a', 'https://example.com')
    store.updateSlot('browser-a', 'panel', PANEL_RECT)
    store.updateSlot('browser-a', 'pip', PIP_RECT)
    store.updateSlot('browser-a', 'overlay', OVERLAY_RECT)

    expect(useBrowserStore.getState().slots['browser-a']).toMatchObject(PANEL_RECT)
    expect(useBrowserStore.getState().pipSlots['browser-a']).toMatchObject(PIP_RECT)
    expect(useBrowserStore.getState().overlaySlots['browser-a']).toMatchObject(OVERLAY_RECT)

    store.unregisterSlot('browser-a', 'pip')
    expect(useBrowserStore.getState().slots['browser-a']).toMatchObject(PANEL_RECT)
    expect(useBrowserStore.getState().pipSlots['browser-a']).toBeUndefined()
    expect(useBrowserStore.getState().overlaySlots['browser-a']).toMatchObject(OVERLAY_RECT)
  })
})

describe('browser preview controls', () => {
  it('expands, shrinks, and hides without revealing the activity panel', () => {
    const store = useBrowserStore.getState()
    store.expandPreview('browser-a')
    expect(useBrowserStore.getState()).toMatchObject({
      expandedBrowserId: 'browser-a',
      pinnedPipBrowserId: null,
      hiddenPreviewBrowserId: null,
    })

    store.shrinkPreview('browser-a')
    expect(useBrowserStore.getState()).toMatchObject({
      expandedBrowserId: null,
      pinnedPipBrowserId: 'browser-a',
    })

    store.hidePreview('browser-a')
    expect(useBrowserStore.getState()).toMatchObject({
      expandedBrowserId: null,
      pinnedPipBrowserId: null,
      hiddenPreviewBrowserId: 'browser-a',
    })

    store.beginAutomation('browser-a')
    expect(useBrowserStore.getState().hiddenPreviewBrowserId).toBeNull()
  })
})

describe('browser automation activity', () => {
  it('tracks nested calls and falls back to another active browser', () => {
    const store = useBrowserStore.getState()
    store.beginAutomation('browser-a')
    store.beginAutomation('browser-a')
    store.beginAutomation('browser-b')
    expect(useBrowserStore.getState().activeAutomationId).toBe('browser-b')

    store.endAutomation('browser-b')
    expect(useBrowserStore.getState().activeAutomationId).toBe('browser-a')

    store.endAutomation('browser-a')
    expect(useBrowserStore.getState().activeAutomationId).toBe('browser-a')
    store.endAutomation('browser-a')
    expect(useBrowserStore.getState().activeAutomationId).toBeNull()
  })

  it('waits for readiness and keeps the preview across individual calls', () => {
    const store = useBrowserStore.getState()
    store.ensure('browser-a', 'https://example.com')
    store.patch('browser-a', { loading: true })
    store.beginAutomation('browser-a')

    expect(useBrowserStore.getState().automationPreviewBrowserId).toBeNull()
    store.endAutomation('browser-a')
    expect(useBrowserStore.getState().pendingPreviewBrowserId).toBe('browser-a')

    store.patch('browser-a', { loading: false })
    store.markAutomationPreviewReady('browser-a')
    expect(useBrowserStore.getState().automationPreviewBrowserId).toBe('browser-a')

    store.beginAutomation('browser-a')
    store.endAutomation('browser-a')
    expect(useBrowserStore.getState().automationPreviewBrowserId).toBe('browser-a')

    store.clearAutomationPreview()
    expect(useBrowserStore.getState().automationPreviewBrowserId).toBeNull()
  })
})
