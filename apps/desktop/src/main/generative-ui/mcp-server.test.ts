import { mkdtempSync, rmSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The shared setup stub hardcodes userData under /tmp; native widget_show actually writes there,
// so this file needs a directory it is allowed to create.
const USER_DATA = join(tmpdir(), 'widget-mcp-userdata')
vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'userData' ? USER_DATA : tmpdir()), getVersion: () => '0.0.0-test' },
}))
import { parseNativeWidgetResult } from '@superone/shared/generative-ui/native-widgets'
import { executeWidgetShowTool, listWidgetTemplatesHandler } from './mcp-server'
import { saveTemplate } from './template-store'

const created: string[] = []

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true })
  rmSync(USER_DATA, { recursive: true, force: true })
})

describe('widget MCP tools', () => {
  it('lists saved project templates separately from the widget manual', async () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'widget-mcp-'))
    created.push(projectPath)
    saveTemplate(
      { project: projectPath, user: homedir() },
      {
        id: 'review-dashboard-test',
        scope: 'project',
        code: '<div>review</div>',
        title: 'Review dashboard',
      },
    )

    const result = await listWidgetTemplatesHandler({ projectPath })

    expect(result.content[0].text).toContain('review-dashboard-test')
    expect(result.content[0].text).toContain('widget_show')
  })
})

describe('widget_show rendering a native SuperOne surface', () => {
  const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64')

  it('returns a payload the chat gallery owns, instead of widget code for a frame', async () => {
    const result = await executeWidgetShowTool({
      title: 'custom provider run',
      template: '@native/image-gallery',
      data: { images: [{ base64: png, mediaType: 'image/png' }], prompt: 'a cat', params: { provider: 'acme' } },
    }, { skipWidgetGate: true, sessionId: 'sess-native' })

    expect(result.isError).toBeUndefined()
    const payload = parseNativeWidgetResult(result.content[0].text)
    expect(payload?.nativeType).toBe('image-gallery')
    expect(payload!.images![0].revisedPrompt).toBe('a cat')
    created.push(dirname(payload!.images![0].savedPath!))
  })

  it('routes @native/video-gallery to the video surface', async () => {
    const result = await executeWidgetShowTool({
      title: 'clip',
      template: '@native/video-gallery',
      data: { videos: [{ base64: Buffer.from('mp4').toString('base64'), mediaType: 'video/mp4' }] },
    }, { skipWidgetGate: true, sessionId: 'sess-native' })

    const payload = parseNativeWidgetResult(result.content[0].text)
    expect(payload?.nativeType).toBe('video-gallery')
    created.push(dirname(payload!.videos![0].savedPath!))
  })

  it('reports an unknown native template rather than falling back to the saved-template lookup', async () => {
    const result = await executeWidgetShowTool(
      { title: 't', template: '@native/table', data: {} },
      { skipWidgetGate: true },
    )
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('@native/image-gallery')
  })

  it('reports a bad data shape so the agent can fix the call, and renders nothing', async () => {
    const result = await executeWidgetShowTool(
      { title: 't', template: '@native/image-gallery', data: { images: [{}] } },
      { skipWidgetGate: true },
    )
    expect(result.isError).toBe(true)
    expect(parseNativeWidgetResult(result.content[0].text)).toBeNull()
  })

  it('still resolves a saved template, so the native namespace shadows nothing', async () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'widget-mcp-'))
    created.push(projectPath)
    saveTemplate({ project: projectPath, user: homedir() }, {
      id: 'plain-card-test', scope: 'project', code: '<div>card</div>', title: 'Plain card',
    })

    const result = await executeWidgetShowTool(
      { title: 't', template: 'plain-card-test' },
      { skipWidgetGate: true, projectPath },
    )
    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toContain('card')
  })

  it('advertises the native templates in the template list so they are discoverable', async () => {
    const listed = await listWidgetTemplatesHandler({})
    expect(listed.content[0].text).toContain('@native/image-gallery')
    expect(listed.content[0].text).toContain('@native/video-gallery')
  })
})
