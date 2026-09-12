import { describe, expect, it, vi } from 'vitest'
import { resolveNativeRequest, type NativeActionPorts } from './native-actions'

function ports(): NativeActionPorts {
  return {
    openLink: vi.fn(),
    openFile: vi.fn(),
    previewFile: vi.fn(),
    loadImage: vi.fn(async () => ({ dataUri: 'data:image/png;base64,AA==' })),
    previewImage: vi.fn(),
    previewMermaid: vi.fn(),
    copyText: vi.fn(),
    haptic: vi.fn(),
    setDraft: vi.fn(),
    saveWidgetTemplate: vi.fn(),
    codexPlanApproval: vi.fn(),
    codexAsyncQuestionAnswer: vi.fn(),
  }
}

describe('native chat actions', () => {
  it('plays the requested haptic impact', async () => {
    const target = ports()
    await expect(resolveNativeRequest({
      type: 'requestNative', requestId: 'tap', action: 'haptic', payload: { style: 'light' },
    }, target)).resolves.toMatchObject({ result: { ok: true } })
    expect(target.haptic).toHaveBeenCalledWith('light')
  })

  it('falls back to a medium impact for an unknown haptic style', async () => {
    const target = ports()
    await resolveNativeRequest({ type: 'requestNative', requestId: 'tap', action: 'haptic', payload: { style: 'boom' } }, target)
    expect(target.haptic).toHaveBeenCalledWith('medium')
  })

  it("writes a widget's sendPrompt into the composer draft", async () => {
    const target = ports()
    await expect(resolveNativeRequest({
      type: 'requestNative', requestId: 'draft', action: 'setDraft', payload: { text: 'What if the rate were 10%?' },
    }, target)).resolves.toMatchObject({ result: { ok: true } })
    expect(target.setDraft).toHaveBeenCalledWith('What if the rate were 10%?')
  })

  it('forwards a widget template save with its scope intact', async () => {
    const target = ports()
    await expect(resolveNativeRequest({
      type: 'requestNative',
      requestId: 'tpl',
      action: 'saveWidgetTemplate',
      payload: { id: 'composer-options', title: 'Composer options', code: '<div/>', scope: 'project', description: 'Layout comparison' },
    }, target)).resolves.toMatchObject({ result: { ok: true } })
    expect(target.saveWidgetTemplate).toHaveBeenCalledWith({
      id: 'composer-options',
      title: 'Composer options',
      code: '<div/>',
      scope: 'project',
      description: 'Layout comparison',
    })
  })

  it('rejects a widget template save with a scope the store would not accept', async () => {
    await expect(resolveNativeRequest({
      type: 'requestNative',
      requestId: 'tpl',
      action: 'saveWidgetTemplate',
      payload: { id: 'x', title: 'x', code: '<div/>', scope: 'global' },
    }, ports())).resolves.toMatchObject({ error: 'invalid saveWidgetTemplate scope' })
  })

  it('drops an empty description instead of storing a blank one', async () => {
    const target = ports()
    await resolveNativeRequest({
      type: 'requestNative',
      requestId: 'tpl',
      action: 'saveWidgetTemplate',
      payload: { id: 'x', title: 'x', code: '<div/>', scope: 'user', description: '' },
    }, target)
    expect(target.saveWidgetTemplate).toHaveBeenCalledWith({ id: 'x', title: 'x', code: '<div/>', scope: 'user' })
  })

  it('rejects a setDraft with no text rather than clearing the composer', async () => {
    await expect(resolveNativeRequest({
      type: 'requestNative', requestId: 'draft', action: 'setDraft', payload: { text: '' },
    }, ports())).resolves.toMatchObject({ error: 'invalid setDraft payload' })
  })

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
    expect(target.previewFile).toHaveBeenCalledWith('art/output.png', undefined)
  })

  it('carries a cited line into the preview and drops a malformed one', async () => {
    const target = ports()
    await resolveNativeRequest({
      type: 'requestNative', requestId: 'p1', action: 'previewFile', payload: { path: 'src/App.tsx', line: 42 },
    }, target)
    await resolveNativeRequest({
      type: 'requestNative', requestId: 'p2', action: 'previewFile', payload: { path: 'src/App.tsx', line: '42' },
    }, target)
    expect(target.previewFile).toHaveBeenNthCalledWith(1, 'src/App.tsx', 42)
    expect(target.previewFile).toHaveBeenNthCalledWith(2, 'src/App.tsx', undefined)
  })

  it('answers loadImage with the port fields merged into the result', async () => {
    const target = ports()
    await expect(resolveNativeRequest({
      type: 'requestNative', requestId: 'img', action: 'loadImage', payload: { path: 'shots/a.png' },
    }, target)).resolves.toMatchObject({ result: { ok: true, dataUri: 'data:image/png;base64,AA==' } })
    expect(target.loadImage).toHaveBeenCalledWith('shots/a.png', false)
    await resolveNativeRequest({
      type: 'requestNative', requestId: 'img2', action: 'loadImage', payload: { path: 'shots/a.png', confirmed: true },
    }, target)
    expect(target.loadImage).toHaveBeenLastCalledWith('shots/a.png', true)
  })

  it('opens the fullscreen viewer for a picture the transcript already shows', async () => {
    const target = ports()
    await expect(resolveNativeRequest({
      type: 'requestNative', requestId: 'view', action: 'previewImage',
      payload: { src: 'data:image/png;base64,AA==', label: 'Screenshot', path: '/tmp/shot.png' },
    }, target)).resolves.toMatchObject({ result: { ok: true } })
    expect(target.previewImage).toHaveBeenCalledWith({ src: 'data:image/png;base64,AA==', label: 'Screenshot', path: '/tmp/shot.png' })
    await resolveNativeRequest({
      type: 'requestNative', requestId: 'view2', action: 'previewImage', payload: { src: 'https://example.com/a.png', label: '' },
    }, target)
    expect(target.previewImage).toHaveBeenLastCalledWith({ src: 'https://example.com/a.png' })
  })

  it('forwards a generated image\'s facts to the viewer and drops malformed ones', async () => {
    const target = ports()
    const generation = { revisedPrompt: 'astronaut', generationMs: 1200, params: [{ key: 'model', value: 'gpt-image-1' }] }
    await resolveNativeRequest({
      type: 'requestNative', requestId: 'gen', action: 'previewImage',
      payload: { src: 'data:image/png;base64,AA==', label: 'Generated image', path: '/media/a.png', generation },
    }, target)
    expect(target.previewImage).toHaveBeenLastCalledWith({ src: 'data:image/png;base64,AA==', label: 'Generated image', path: '/media/a.png', generation })
    await resolveNativeRequest({
      type: 'requestNative', requestId: 'junk', action: 'previewImage',
      payload: { src: 'data:image/png;base64,AA==', generation: { params: 'nope', generationMs: -1 } },
    }, target)
    expect(target.previewImage).toHaveBeenLastCalledWith({ src: 'data:image/png;base64,AA==' })
  })

  it('refuses a viewer source that is not an image the phone can show', async () => {
    const target = ports()
    await expect(resolveNativeRequest({
      type: 'requestNative', requestId: 'bad', action: 'previewImage', payload: { src: 'file:///etc/passwd' },
    }, target)).resolves.toMatchObject({ error: 'unsupported image source' })
    expect(target.previewImage).not.toHaveBeenCalled()
  })

  it('opens the mermaid preview page with the rendered SVG', async () => {
    const target = ports()
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>'
    await expect(resolveNativeRequest({
      type: 'requestNative', requestId: 'diagram', action: 'previewMermaid', payload: { svg },
    }, target)).resolves.toMatchObject({ result: { ok: true } })
    expect(target.previewMermaid).toHaveBeenCalledWith(svg)
  })

  it('refuses mermaid markup the preview page must not load', async () => {
    const target = ports()
    await expect(resolveNativeRequest({
      type: 'requestNative', requestId: 'bad', action: 'previewMermaid', payload: { svg: '<div>nope</div>' },
    }, target)).resolves.toMatchObject({ error: 'unsupported mermaid diagram' })
    await expect(resolveNativeRequest({
      type: 'requestNative', requestId: 'script', action: 'previewMermaid',
      payload: { svg: '<svg><script>alert(1)</script></svg>' },
    }, target)).resolves.toMatchObject({ error: 'unsupported mermaid diagram' })
    expect(target.previewMermaid).not.toHaveBeenCalled()
  })

  it('routes validated Codex plan decisions to the active runtime', async () => {
    const target = ports()
    await expect(resolveNativeRequest({
      type: 'requestNative',
      requestId: 'plan',
      action: 'codexPlanApproval',
      payload: { messageId: 'assistant-1', status: 'rejected', feedback: 'Revise step 2' },
    }, target)).resolves.toMatchObject({ result: { ok: true } })
    expect(target.codexPlanApproval).toHaveBeenCalledWith('assistant-1', 'rejected', 'Revise step 2')
  })

  it('waits for async answers and propagates rejection to the question card', async () => {
    const target = ports()
    const request = {
      type: 'requestNative' as const, requestId: 'async', action: 'codexAsyncQuestionAnswer',
      payload: { messageId: 'turn', itemId: 'question', answers: ['Production'] },
    }
    await expect(resolveNativeRequest(request, target)).resolves.toMatchObject({ result: { ok: true } })
    expect(target.codexAsyncQuestionAnswer).toHaveBeenCalledWith('turn', 'question', ['Production'])
    vi.mocked(target.codexAsyncQuestionAnswer).mockRejectedValueOnce(new Error('No active turn'))
    await expect(resolveNativeRequest(request, target)).resolves.toMatchObject({ error: 'No active turn' })
    await expect(resolveNativeRequest({ ...request, payload: { ...request.payload, answers: [''] } }, target))
      .resolves.toMatchObject({ error: 'invalid codexAsyncQuestionAnswer answers' })
    expect(target.codexAsyncQuestionAnswer).toHaveBeenCalledTimes(2)
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


it('forwards navigation requests and rejects invalid paging directions', async () => {
  const target = ports()
  target.loadNavigationIndex = vi.fn(async () => ({ messageIds: ['old'], entries: [], compacts: [] }))
  target.loadHistoryWindow = vi.fn(async () => ({ messages: [] }))
  const base = { type: 'requestNative' as const, requestId: 'nav' }
  await expect(resolveNativeRequest({ ...base, action: 'loadNavigationIndex' }, target)).resolves.toMatchObject({ result: { messageIds: ['old'] } })
  await resolveNativeRequest({ ...base, action: 'loadHistoryWindow', payload: { anchorId: 'old', direction: 'before' } }, target)
  expect(target.loadHistoryWindow).toHaveBeenCalledWith('old', 'before')
  await expect(resolveNativeRequest({ ...base, action: 'loadHistoryWindow', payload: { anchorId: 'old', direction: 'sideways' } }, target)).resolves.toMatchObject({ error: 'Invalid history direction' })
  expect(target.loadHistoryWindow).toHaveBeenCalledTimes(1)
})
