/** @vitest-environment jsdom */
import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MentionCatalog } from '@superone/shared/mention-catalog'
import {
  clearMentionCatalogCache,
  loadMentionCatalog,
  peekMentionCatalog,
  useMentionCatalog,
} from './mention-catalog'

function Probe({ projectPath }: { projectPath: string | null }) {
  const { catalog, ready } = useMentionCatalog(projectPath)
  return (
    <div data-ready={String(ready)} data-caps={catalog.capabilityIds.join(',')}>
      {catalog.apps.map((app) => app.label).join(',')}
    </div>
  )
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('mention catalog cache', () => {
  beforeEach(() => {
    clearMentionCatalogCache()
    Object.assign(window.environment, {
      getMentionCatalog: vi.fn(async () => ({ capabilityIds: [], apps: [], environments: [] })),
    })
    Object.assign(window.app, {
      onAppSettingsChange: vi.fn(() => () => {}),
      onChromeBridgeStatus: vi.fn(() => () => {}),
    })
  })

  it('serves cached catalog synchronously on remount while revalidating in background', async () => {
    const initial: MentionCatalog = {
      capabilityIds: ['computer', 'browser', 'widget'],
      apps: [{ kind: 'miniapp', path: 'board', label: 'Board' }],
      environments: [],
    }
    vi.mocked(window.environment.getMentionCatalog).mockResolvedValueOnce(initial)
    await loadMentionCatalog('/repo')
    expect(peekMentionCatalog('/repo')).toEqual(initial)

    const next = deferred<MentionCatalog>()
    vi.mocked(window.environment.getMentionCatalog).mockReturnValueOnce(next.promise)

    const view = render(<Probe projectPath="/repo" />)
    const el = view.container.firstElementChild!
    expect(el.getAttribute('data-ready')).toBe('true')
    expect(el.getAttribute('data-caps')).toBe('computer,browser,widget')

    next.resolve({
      capabilityIds: ['widget'],
      apps: [{ kind: 'miniapp', path: 'board', label: 'Board v2' }],
      environments: [],
    })

    await waitFor(() => {
      expect(el.getAttribute('data-caps')).toBe('widget')
      expect(el.textContent).toBe('Board v2')
    })
  })

  it('refreshes cached local projects on settings and chrome bridge events even while unmounted', async () => {
    let onSettings: (() => void) | undefined
    let onChrome: (() => void) | undefined
    Object.assign(window.app, {
      onAppSettingsChange: vi.fn((cb: () => void) => {
        onSettings = cb
        return () => {}
      }),
      onChromeBridgeStatus: vi.fn((cb: () => void) => {
        onChrome = cb
        return () => {}
      }),
    })

    const getCatalog = vi.mocked(window.environment.getMentionCatalog)
    getCatalog
      .mockResolvedValueOnce({ capabilityIds: ['widget'], apps: [], environments: [] })
      .mockResolvedValueOnce({ capabilityIds: ['computer'], apps: [], environments: [] })
      .mockResolvedValueOnce({ capabilityIds: ['computer', 'widget'], apps: [], environments: [] })
      .mockResolvedValueOnce({ capabilityIds: ['computer', 'browser', 'widget'], apps: [], environments: [], chromeBridgeConnected: true })

    await loadMentionCatalog('/local/repo')
    await loadMentionCatalog('remote:node-a:/srv/repo')

    onSettings?.()
    await waitFor(() => {
      expect(peekMentionCatalog('/local/repo')?.capabilityIds).toEqual(['computer', 'widget'])
    })
    expect(getCatalog).toHaveBeenCalledTimes(3)
    expect(getCatalog).toHaveBeenLastCalledWith('/local/repo')

    onChrome?.()
    await waitFor(() => {
      expect(peekMentionCatalog('/local/repo')?.capabilityIds).toEqual(['computer', 'browser', 'widget'])
    })
    expect(peekMentionCatalog('remote:node-a:/srv/repo')?.capabilityIds).toEqual(['computer'])
  })

  it('keeps cached catalog on refresh error and settles uncached projects on failure', async () => {
    const getCatalog = vi.mocked(window.environment.getMentionCatalog)
    getCatalog.mockResolvedValueOnce({ capabilityIds: ['computer', 'browser'], apps: [], environments: [] })
    await loadMentionCatalog('/repo')

    getCatalog.mockRejectedValueOnce(new Error('offline'))
    const result = await loadMentionCatalog('/repo', { fresh: true })
    expect(result.capabilityIds).toEqual(['computer', 'browser'])
    expect(peekMentionCatalog('/repo')?.capabilityIds).toEqual(['computer', 'browser'])

    getCatalog.mockRejectedValueOnce(new Error('offline'))
    const view = render(<Probe projectPath="/cold" />)
    await waitFor(() => {
      expect(view.container.firstElementChild!.getAttribute('data-ready')).toBe('true')
    })
    expect(peekMentionCatalog('/cold')).toBeUndefined()
  })

  it('drops stale responses when a newer fresh request resolves first', async () => {
    const slow = deferred<MentionCatalog>()
    const fast = deferred<MentionCatalog>()
    vi.mocked(window.environment.getMentionCatalog)
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(fast.promise)

    const p1 = loadMentionCatalog('/repo')
    const p2 = loadMentionCatalog('/repo', { fresh: true })

    fast.resolve({ capabilityIds: ['computer', 'browser', 'widget'], apps: [], environments: [] })
    await p2
    expect(peekMentionCatalog('/repo')?.capabilityIds).toEqual(['computer', 'browser', 'widget'])

    slow.resolve({ capabilityIds: ['widget'], apps: [], environments: [] })
    await p1
    expect(peekMentionCatalog('/repo')?.capabilityIds).toEqual(['computer', 'browser', 'widget'])
  })
})
