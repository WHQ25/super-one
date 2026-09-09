import { describe, expect, it, vi } from 'vitest'
import { resolveNativeRequest, type NativeActionPorts } from './native-actions'

function ports(): NativeActionPorts {
  return {
    openLink: vi.fn(),
    openFile: vi.fn(),
    previewFile: vi.fn(),
    loadImage: vi.fn(async () => ({ dataUri: 'data:image/png;base64,AA==' })),
    copyText: vi.fn(),
    setDraft: vi.fn(),
    saveWidgetTemplate: vi.fn(),
    codexPlanApproval: vi.fn(),
    codexAsyncQuestionAnswer: vi.fn(),
  }
}

describe('native chat actions', () => {
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
