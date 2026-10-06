import { describe, expect, it, vi } from 'vitest'
import { resolveNativeRequest, type NativeActionPorts } from './native-actions'

function ports(): NativeActionPorts {
  return {
    openLink: vi.fn(),
    openFile: vi.fn(),
    previewFile: vi.fn(),
    loadImage: vi.fn(async () => ({ dataUri: 'data:image/png;base64,AA==' })),
    loadVideoPoster: vi.fn(async () => ({ dataUri: 'data:image/jpeg;base64,/9j/', width: 320, height: 180, durationMs: 4200 })),
    loadTextFile: vi.fn(async () => ({ text: '# hi\n' })),
    loadAttachment: vi.fn(async () => 'data:image/jpeg;base64,/9j/'),
    resolveFavicon: vi.fn(async () => 'data:image/png;base64,AA=='),
    previewImage: vi.fn(),
    previewMermaid: vi.fn(),
    copyText: vi.fn(),
    haptic: vi.fn(),
    setDraft: vi.fn(),
    saveWidgetTemplate: vi.fn(),
    codexPlanApproval: vi.fn(),
    codexAsyncQuestionAnswer: vi.fn(),
    answerQuestion: vi.fn(),
    dismissQuestion: vi.fn(),
    dismissSlashOutput: vi.fn(),
    documentInputFocus: vi.fn(),
    openSession: vi.fn(),
    resendFailedMessage: vi.fn(),
    editFailedMessage: vi.fn(),
    queuedMessageAction: vi.fn(),
  }
}

describe('native chat actions', () => {
  it('validates the unified composer output and forwards only trusted bridge fields', async () => {
    const target = { ...ports(), composerOpen: vi.fn(async () => ({ ok: true as const, requestId: 'form' })) }
    const spec = { title: 'Notes', requestedSchema: { type: 'object', properties: { notes: { type: 'string' } } } }
    const message = { type: 'requestNative' as const, requestId: 'native', action: 'composerOpen', payload: {
      viewId: 'view', localId: 'local', messageId: 'assistant', spec, sessionId: 'forged', output: 'caller',
    } }
    await expect(resolveNativeRequest(message, target)).resolves.toMatchObject({ result: { ok: true, requestId: 'form' } })
    expect(target.composerOpen).toHaveBeenCalledExactlyOnceWith({ viewId: 'view', localId: 'local', messageId: 'assistant', spec, output: 'caller' })
    await expect(resolveNativeRequest({ ...message, payload: { ...message.payload, output: 'other' } }, target)).resolves.toHaveProperty('error')
    expect(target.composerOpen).toHaveBeenCalledTimes(1)
  })
  it('opens a validated widget form through the native host with its captured message', async () => {
    const target = { ...ports(), requestInput: vi.fn(async () => {}) }
    const spec = { title: 'Notes', requestedSchema: { type: 'object', properties: { notes: { type: 'string' } } } }
    await expect(resolveNativeRequest({ type: 'requestNative', requestId: 'form', action: 'requestInput',
      payload: { messageId: 'assistant-1', spec, sessionId: 'forged-session' },
    }, target)).resolves.toMatchObject({ requestId: 'form', result: { ok: true } })
    expect(target.requestInput).toHaveBeenCalledExactlyOnceWith('assistant-1', spec)
    expect(target.setDraft).not.toHaveBeenCalled()
  })

  it('returns admission and host errors to the widget without opening an unsupported form', async () => {
    const target = { ...ports(), requestInput: vi.fn(async () => { throw new Error('This widget already has a form.') }) }
    await expect(resolveNativeRequest({ type: 'requestNative', requestId: 'invalid', action: 'requestInput',
      payload: { messageId: 'assistant-1', spec: {} },
    }, target)).resolves.toHaveProperty('error')
    expect(target.requestInput).not.toHaveBeenCalled()
    await expect(resolveNativeRequest({ type: 'requestNative', requestId: 'busy', action: 'requestInput',
      payload: { messageId: 'assistant-1', spec: { title: 'Notes', requestedSchema: { type: 'object', properties: { notes: { type: 'string' } } } } },
    }, target)).resolves.toMatchObject({ requestId: 'busy', error: 'This widget already has a form.' })
  })

  it('routes Resend and Edit on a failed bubble to the shell', async () => {
    const target = ports()
    await expect(resolveNativeRequest({
      type: 'requestNative', requestId: 'r', action: 'resendFailedMessage', payload: { messageId: 'u1' },
    }, target)).resolves.toMatchObject({ result: { ok: true } })
    await expect(resolveNativeRequest({
      type: 'requestNative', requestId: 'e', action: 'editFailedMessage', payload: { messageId: 'u1' },
    }, target)).resolves.toMatchObject({ result: { ok: true } })
    expect(target.resendFailedMessage).toHaveBeenCalledWith('u1')
    expect(target.editFailedMessage).toHaveBeenCalledWith('u1')
  })

  it('routes a queued bubble action to the shell and refuses an unknown one', async () => {
    const target = ports()
    await expect(resolveNativeRequest({
      type: 'requestNative', requestId: 'q', action: 'queuedMessageAction', payload: { messageId: 'q1', action: 'steerSoon' },
    }, target)).resolves.toMatchObject({ result: { ok: true } })
    expect(target.queuedMessageAction).toHaveBeenCalledWith('q1', 'steerSoon')
    await expect(resolveNativeRequest({
      type: 'requestNative', requestId: 'x', action: 'queuedMessageAction', payload: { messageId: 'q1', action: 'delete' },
    }, target)).resolves.toMatchObject({ error: 'invalid queued message action' })
  })

  it('opens the session a transcript link names', async () => {
    const target = ports()
    await expect(resolveNativeRequest({
      type: 'requestNative', requestId: 'open', action: 'openSession', payload: { sessionId: 'parent-1' },
    }, target)).resolves.toMatchObject({ result: { ok: true } })
    expect(target.openSession).toHaveBeenCalledWith('parent-1')
  })

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

  it("answers the pending question with the form's answers and notes only", async () => {
    const target = ports()
    await expect(resolveNativeRequest({
      type: 'requestNative', requestId: 'answer', action: 'answerQuestion',
      payload: { requestId: 'q-1', answers: { 'Which library?': 'dayjs' }, annotations: { 'Which library?': { notes: 'smaller', preview: 'forged' }, Other: { notes: ' ' } } },
    }, target)).resolves.toMatchObject({ result: { ok: true } })
    expect(target.answerQuestion).toHaveBeenCalledWith('q-1', { 'Which library?': 'dayjs' }, { 'Which library?': { notes: 'smaller' } })
  })

  it.each([{ q: 1 }, { q: '  ' }])('rejects answers that are not all non-blank strings: %o', async (answers) => {
    const target = ports()
    await expect(resolveNativeRequest({
      type: 'requestNative', requestId: 'answer', action: 'answerQuestion', payload: { requestId: 'q-1', answers },
    }, target)).resolves.toMatchObject({ error: 'invalid answerQuestion answers' })
    expect(target.answerQuestion).not.toHaveBeenCalled()
  })

  it('dismisses the question and the command output', async () => {
    const target = ports()
    await resolveNativeRequest({ type: 'requestNative', requestId: 'd', action: 'dismissQuestion', payload: { requestId: 'q-1' } }, target)
    await resolveNativeRequest({ type: 'requestNative', requestId: 's', action: 'dismissSlashOutput' }, target)
    expect(target.dismissQuestion).toHaveBeenCalledWith('q-1')
    expect(target.dismissSlashOutput).toHaveBeenCalledOnce()
  })

  it("hears when a field in the document holds the keyboard; anything but true releases it", async () => {
    const target = ports()
    await resolveNativeRequest({ type: 'requestNative', requestId: 'f', action: 'documentInputFocus', payload: { focused: true } }, target)
    await resolveNativeRequest({ type: 'requestNative', requestId: 'b', action: 'documentInputFocus', payload: { focused: 'yes' } }, target)
    expect(vi.mocked(target.documentInputFocus).mock.calls).toEqual([[true], [false]])
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

  it('forwards the layout a widget was rendered with, so the template reopens the same way', async () => {
    const target = ports()
    await resolveNativeRequest({
      type: 'requestNative',
      requestId: 'tpl',
      action: 'saveWidgetTemplate',
      payload: { id: 'x', title: 'x', code: '<div/>', scope: 'user', layout: 'fixed' },
    }, target)
    expect(target.saveWidgetTemplate).toHaveBeenCalledWith(expect.objectContaining({ layout: 'fixed' }))
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
    expect(target.previewFile).toHaveBeenCalledWith('art/output.png', undefined, undefined)
  })

  it('carries a cited line into the preview and drops a malformed one', async () => {
    const target = ports()
    await resolveNativeRequest({
      type: 'requestNative', requestId: 'p1', action: 'previewFile', payload: { path: 'src/App.tsx', line: 42 },
    }, target)
    await resolveNativeRequest({
      type: 'requestNative', requestId: 'p2', action: 'previewFile', payload: { path: 'src/App.tsx', line: '42' },
    }, target)
    expect(target.previewFile).toHaveBeenNthCalledWith(1, 'src/App.tsx', 42, undefined)
    expect(target.previewFile).toHaveBeenNthCalledWith(2, 'src/App.tsx', undefined, undefined)
  })

  it('answers loadImage with the port fields merged into the result', async () => {
    const target = ports()
    await expect(resolveNativeRequest({
      type: 'requestNative', requestId: 'img', action: 'loadImage', payload: { path: 'shots/a.png' },
    }, target)).resolves.toMatchObject({ result: { ok: true, dataUri: 'data:image/png;base64,AA==' } })
    expect(target.loadImage).toHaveBeenCalledWith('shots/a.png', false, undefined)
    await resolveNativeRequest({
      type: 'requestNative', requestId: 'img2', action: 'loadImage', payload: { path: 'shots/a.png', confirmed: true },
    }, target)
    expect(target.loadImage).toHaveBeenLastCalledWith('shots/a.png', true, undefined)
  })

  it('answers loadVideoPoster with the poster under its own key, and null when the host cut none', async () => {
    const target = ports()
    await expect(resolveNativeRequest({
      type: 'requestNative', requestId: 'vid', action: 'loadVideoPoster', payload: { path: 'out/clip.mp4' },
    }, target)).resolves.toMatchObject({ result: { ok: true, poster: { dataUri: 'data:image/jpeg;base64,/9j/', width: 320, height: 180, durationMs: 4200 } } })
    expect(target.loadVideoPoster).toHaveBeenCalledWith('out/clip.mp4', undefined)
    vi.mocked(target.loadVideoPoster).mockResolvedValueOnce(null)
    await expect(resolveNativeRequest({
      type: 'requestNative', requestId: 'vid2', action: 'loadVideoPoster', payload: { path: 'out/odd.mkv' },
    }, target)).resolves.toMatchObject({ result: { ok: true, poster: null } })
  })

  it('passes the session root to every file port so a node file resolves on the desktop', async () => {
    const target = ports()
    const ROOT = 'remote:conn-1:/home/node/proj'
    const NODE_FILE = '/home/node/.superone/node/sync/s1/browser/shot.png'
    await resolveNativeRequest({
      type: 'requestNative', requestId: 'i', action: 'loadImage', payload: { path: NODE_FILE, root: ROOT },
    }, target)
    await resolveNativeRequest({
      type: 'requestNative', requestId: 'v', action: 'loadVideoPoster', payload: { path: '/home/node/sync/s1/clip.mp4', root: ROOT },
    }, target)
    await resolveNativeRequest({
      type: 'requestNative', requestId: 't', action: 'loadTextFile', payload: { path: '/home/node/proj/a.md', root: ROOT },
    }, target)
    await resolveNativeRequest({
      type: 'requestNative', requestId: 'p', action: 'previewFile', payload: { path: NODE_FILE, root: ROOT },
    }, target)
    expect(target.loadImage).toHaveBeenCalledWith(NODE_FILE, false, ROOT)
    expect(target.loadVideoPoster).toHaveBeenCalledWith('/home/node/sync/s1/clip.mp4', ROOT)
    expect(target.loadTextFile).toHaveBeenCalledWith('/home/node/proj/a.md', ROOT)
    expect(target.previewFile).toHaveBeenCalledWith(NODE_FILE, undefined, ROOT)
  })

  it('answers loadTextFile with the text in-band, and passes a tooLarge verdict through', async () => {
    const target = ports()
    await expect(resolveNativeRequest({
      type: 'requestNative', requestId: 'txt', action: 'loadTextFile', payload: { path: '/proj/README.md' },
    }, target)).resolves.toMatchObject({ result: { ok: true, text: '# hi\n' } })
    expect(target.loadTextFile).toHaveBeenCalledWith('/proj/README.md', undefined)
    vi.mocked(target.loadTextFile).mockResolvedValueOnce({ tooLarge: true, size: 900_000 })
    await expect(resolveNativeRequest({
      type: 'requestNative', requestId: 'txt2', action: 'loadTextFile', payload: { path: '/proj/big.log' },
    }, target)).resolves.toMatchObject({ result: { ok: true, tooLarge: true, size: 900_000 } })
  })

  it('fetches the original behind an attachment thumbnail by id, or by name without one', async () => {
    const target = ports()
    await expect(resolveNativeRequest({
      type: 'requestNative', requestId: 'att', action: 'loadAttachment', payload: { messageId: 'user_1', attachmentId: 'a1', name: 'IMG_0005.jpg' },
    }, target)).resolves.toMatchObject({ result: { ok: true, dataUri: 'data:image/jpeg;base64,/9j/' } })
    expect(target.loadAttachment).toHaveBeenCalledWith('user_1', { attachmentId: 'a1', name: 'IMG_0005.jpg' })
    await resolveNativeRequest({
      type: 'requestNative', requestId: 'att2', action: 'loadAttachment', payload: { messageId: 'user_1', name: 'old.png' },
    }, target)
    expect(target.loadAttachment).toHaveBeenLastCalledWith('user_1', { name: 'old.png' })
  })

  it('answers resolveFavicon with the desktop icon for an http(s) link only', async () => {
    const target = ports()
    await expect(resolveNativeRequest({
      type: 'requestNative', requestId: 'ico', action: 'resolveFavicon', payload: { url: 'https://example.com/docs', isDark: true },
    }, target)).resolves.toMatchObject({ result: { ok: true, dataUrl: 'data:image/png;base64,AA==' } })
    expect(target.resolveFavicon).toHaveBeenCalledWith('https://example.com/docs', true)
    await expect(resolveNativeRequest({
      type: 'requestNative', requestId: 'ico2', action: 'resolveFavicon', payload: { url: 'file:///etc/passwd' },
    }, target)).resolves.toMatchObject({ error: 'unsupported link' })
    expect(target.resolveFavicon).toHaveBeenCalledTimes(1)
  })

  it('relays an MCP App operation and keeps the host refusal intact under the acknowledgement', async () => {
    const refusal = { ok: false, error: { code: 'denied', message: 'This tool is not available to the App' } }
    const target = { ...ports(), mcpApp: vi.fn(async () => refusal), mcpAppFullscreen: vi.fn() }
    const payload = { messageId: 'm', appInstanceId: 'view-1', operation: 'callTool', tool: 'fixture_model_echo', args: {} }
    await expect(resolveNativeRequest({ type: 'requestNative', requestId: 'app', action: 'mcpApp', payload }, target))
      .resolves.toEqual({ type: 'nativeActionResult', requestId: 'app', result: { ok: true, response: refusal } })
    expect(target.mcpApp).toHaveBeenCalledWith(payload)
    await expect(resolveNativeRequest({
      type: 'requestNative', requestId: 'link', action: 'mcpApp', payload: { messageId: 'm', appInstanceId: 'view-1', operation: 'openLink', url: 'https://example.com' },
    }, target)).resolves.toMatchObject({ error: 'invalid mcpApp payload' })
    await resolveNativeRequest({ type: 'requestNative', requestId: 'fs', action: 'mcpAppFullscreen', payload: { active: true, title: 'Maps' } }, target)
    expect(target.mcpAppFullscreen).toHaveBeenLastCalledWith({ title: 'Maps' })
    await resolveNativeRequest({ type: 'requestNative', requestId: 'fs2', action: 'mcpAppFullscreen', payload: { active: false } }, target)
    expect(target.mcpAppFullscreen).toHaveBeenLastCalledWith(null)
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
