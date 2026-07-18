import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../agent/event-trace', () => ({ trace: vi.fn() }))

const { clearAllGates, notifyWidgetReady, waitForWidgetReady } = await import('./widget-gate')

function settled(p: Promise<void>): Promise<boolean> {
  return Promise.race([p.then(() => true), Promise.resolve().then(() => false)])
}

describe('widget ready gate', () => {
  beforeEach(() => {
    clearAllGates()
  })

  it('releases both waiters when two widgets share a title', async () => {
    const first = waitForWidgetReady('video_panel')
    const second = waitForWidgetReady('video_panel')

    notifyWidgetReady('video_panel')
    notifyWidgetReady('video_panel')

    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined])
  })

  it('releases waiters in arrival order so one notify frees exactly one widget', async () => {
    const first = waitForWidgetReady('video_panel')
    const second = waitForWidgetReady('video_panel')

    notifyWidgetReady('video_panel')

    expect(await settled(first)).toBe(true)
    expect(await settled(second)).toBe(false)
  })

  it('resolves immediately when the iframe reported ready before the tool started waiting', async () => {
    notifyWidgetReady('early_widget')
    await expect(waitForWidgetReady('early_widget')).resolves.toBeUndefined()
  })

  it('does not let one early notify satisfy two later waiters', async () => {
    notifyWidgetReady('early_widget')

    const first = waitForWidgetReady('early_widget')
    const second = waitForWidgetReady('early_widget')

    expect(await settled(first)).toBe(true)
    expect(await settled(second)).toBe(false)
  })

  it('unblocks every pending waiter on teardown so tool calls never hang', async () => {
    const first = waitForWidgetReady('a')
    const second = waitForWidgetReady('a')
    const third = waitForWidgetReady('b')

    clearAllGates()

    await expect(Promise.all([first, second, third])).resolves.toEqual([undefined, undefined, undefined])
  })
})
