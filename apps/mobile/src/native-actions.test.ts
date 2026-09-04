import { describe, expect, it, vi } from 'vitest'
import { resolveNativeRequest, type NativeActionPorts } from './native-actions'

function ports(): NativeActionPorts {
  return { openLink: vi.fn(), openFile: vi.fn(), previewFile: vi.fn(), copyText: vi.fn() }
}

describe('native chat actions', () => {
  it('routes validated links and files to native ports', async () => {
    const target = ports()
    await expect(resolveNativeRequest({
      type: 'requestNative', requestId: 'link', action: 'openLink', payload: { url: 'https://example.com' },
    }, target)).resolves.toMatchObject({ result: { ok: true } })
    await expect(resolveNativeRequest({
      type: 'requestNative', requestId: 'file', action: 'openFile', payload: { path: 'src/App.tsx' },
    }, target)).resolves.toMatchObject({ result: { ok: true } })
    await expect(resolveNativeRequest({
      type: 'requestNative', requestId: 'preview', action: 'previewFile', payload: { path: 'art/output.png' },
    }, target)).resolves.toMatchObject({ result: { ok: true } })
    expect(target.openLink).toHaveBeenCalledWith('https://example.com')
    expect(target.openFile).toHaveBeenCalledWith('src/App.tsx')
    expect(target.previewFile).toHaveBeenCalledWith('art/output.png')
  })

  it('reports invalid or unsupported actions instead of false success', async () => {
    const target = ports()
    await expect(resolveNativeRequest({
      type: 'requestNative', requestId: 'bad', action: 'openLink', payload: { url: 'file:///secret' },
    }, target)).resolves.toMatchObject({ error: 'unsupported link' })
    await expect(resolveNativeRequest({
      type: 'requestNative', requestId: 'unknown', action: 'unknown',
    }, target)).resolves.toMatchObject({ error: 'unknown is not available on mobile' })
  })
})
