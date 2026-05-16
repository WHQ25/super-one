// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest'

const toMain = vi.fn()
const fsRequest = vi.fn().mockResolvedValue({ ok: true })

let iframeWin: Window

function emitFromIframe(data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', { data, source: iframeWin }))
}

describe('worker-host shell message routing', () => {
  beforeAll(async () => {
    window.history.replaceState({}, '', '/worker-host.html?appId=app1&projectDir=/proj&host=app1.proj&entry=background.html')
    ;(window as unknown as { workerHost: unknown }).workerHost = {
      toMain,
      fsRequest,
      gitRequest: vi.fn().mockResolvedValue({}),
      dbRequest: vi.fn().mockResolvedValue({}),
      kvRequest: vi.fn().mockResolvedValue({}),
      fsWatch: vi.fn().mockResolvedValue(1),
      fsUnwatch: vi.fn(),
      peerEmit: vi.fn(),
      toolResult: vi.fn().mockResolvedValue(undefined),
      onWorkerMsg: () => () => {},
    }
    await import('./worker-host')
    const iframe = document.querySelector('iframe') as HTMLIFrameElement
    iframeWin = iframe.contentWindow as Window
    vi.spyOn(iframeWin, 'postMessage')
  })

  it('forwards miniapp-worker-status-set to main (P2-a regression)', () => {
    emitFromIframe({ type: 'miniapp-worker-status-set', text: 'Downloading 42%' })
    expect(toMain).toHaveBeenCalledWith(
      'app1', '/proj', 'miniapp-worker-status-set',
      expect.objectContaining({ text: 'Downloading 42%' }),
    )
  })

  it('still forwards lease + event plumbing to main', () => {
    emitFromIframe({ type: 'miniapp-worker-lease', leaseId: 3, label: 'job' })
    emitFromIframe({ type: 'miniapp-worker-event', payload: { type: 'progress' } })
    expect(toMain).toHaveBeenCalledWith('app1', '/proj', 'miniapp-worker-lease', expect.any(Object))
    expect(toMain).toHaveBeenCalledWith('app1', '/proj', 'miniapp-worker-event', expect.any(Object))
  })

  it('rejects clipboard.read instead of hanging (P2-b regression)', () => {
    emitFromIframe({ type: 'miniapp-clipboard-read', id: 7 })
    expect(iframeWin.postMessage).toHaveBeenCalledWith(
      { type: 'miniapp-clipboard-response', id: 7, error: 'unavailable-in-worker' },
      '*',
    )
  })

  it('rejects ui.showContextMenu instead of hanging (P2-b regression)', () => {
    emitFromIframe({ type: 'miniapp-ui-contextmenu', id: 9, position: {}, items: [] })
    expect(iframeWin.postMessage).toHaveBeenCalledWith(
      { type: 'miniapp-ui-contextmenu-result', id: 9, error: 'unavailable-in-worker' },
      '*',
    )
  })

  it('still services headless-safe fs requests', () => {
    emitFromIframe({ type: 'miniapp-fs-request', id: 1, op: 'readFile', args: { path: 'a.txt' } })
    expect(fsRequest).toHaveBeenCalledWith('/proj', 'app1', 'readFile', { path: 'a.txt' })
  })

  it('ignores unrelated messages without throwing', () => {
    expect(() => emitFromIframe({ type: 'something-else' })).not.toThrow()
  })
})
