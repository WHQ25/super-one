import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const USER_DATA = join(tmpdir(), 'widget-short-userdata')
vi.mock('../database', async () => (await import('../../test/fixtures/delivery-db')).deliveryDatabase())
vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'userData' ? USER_DATA : tmpdir()), getVersion: () => '0.0.0-test' },
}))
import { widgetShowShortContent } from '@superone/shared/generative-ui/widget-data'
import { collectArtifacts, runInLocalCallScope } from '../mcp/artifact-registry'
import { executeWidgetShowTool } from './mcp-server'
import { saveTemplate } from './template-store'
import { shortensWidgetResult } from './widget-short-result'

/**
 * A capable harness's model reads a short acknowledgement for a `widget_code` call; the
 * surfaces redraw the widget from the input. Everything else keeps the full reply.
 */
const ARGS = { title: 'releases', widget_code: '<div>Release chart</div>', data: { builds: 3 } }
const created: string[] = []

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true })
  rmSync(USER_DATA, { recursive: true, force: true })
})

function payloadOf(reply: Awaited<ReturnType<typeof executeWidgetShowTool>>) {
  return JSON.parse(reply.content[0]!.text)
}

describe('widget_show result for the calling harness', () => {
  it('acknowledges a widget_code call when the caller shortens it', async () => {
    const reply = await executeWidgetShowTool(ARGS, { shortensResult: () => true })
    expect(reply).toEqual({ content: widgetShowShortContent({ ...ARGS }) })
    expect(JSON.stringify(reply)).not.toContain('Release chart')
  })

  it('returns the payload when nothing asks for the short result', async () => {
    expect(payloadOf(await executeWidgetShowTool(ARGS))).toMatchObject({ title: 'releases', width: 800 })
    expect(payloadOf(await executeWidgetShowTool(ARGS, { shortensResult: () => false }))).toMatchObject({ title: 'releases' })
  })

  it('keeps the payload of a template call, whose code is not in the input', async () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'widget-short-'))
    created.push(projectPath)
    saveTemplate({ project: projectPath, user: USER_DATA }, { id: 'panel-a1b2c3d4', scope: 'project', code: '<div>panel</div>', title: 'Panel' })
    const reply = await executeWidgetShowTool({ title: 'panel', template: 'panel-a1b2c3d4' }, { projectPath, shortensResult: () => true })
    expect(payloadOf(reply)).toMatchObject({ templateId: 'panel-a1b2c3d4' })
  })

  it('leaves an error reply as it is', async () => {
    const reply = await executeWidgetShowTool({ title: 'nothing' }, { shortensResult: () => true })
    expect(reply).toMatchObject({ isError: true })
    expect(reply.content[0]!.text).toContain('requires either widget_code')
  })

  it('bounds the CDN warning in the full reply too', async () => {
    const code = Array.from({ length: 30 }, (_, i) => `<script src="https://evil.example/${i}.js"></script>`).join('')
    const reply = await executeWidgetShowTool({ title: 'cdn', widget_code: code })
    expect(reply.content[1]!.text).toContain('30 URLs were blocked')
    expect(reply.content[1]!.text).toContain('… and 25 more')
  })
})

describe('who gets the short widget_show result', () => {
  it.each([
    ['claude', true],
    ['codex', true],
    ['acp', false],
    ['opencode', false],
    ['cursor', false],
    ['dsh', false],
    [undefined, false],
  ])('a local %s session: %s', async (harnessId, expected) => {
    const decide = shortensWidgetResult(() => harnessId)
    expect(await runInLocalCallScope('s1', async () => decide())).toBe(expected)
  })

  it('never a remote session\'s Host Action, even under a local session id with a capable harness', async () => {
    const decide = shortensWidgetResult(() => 'claude')
    expect(await collectArtifacts('s1', 'call-1', async () => decide(), 'conn-1')).toBe(false)
  })

  it('never a call outside any scope', () => {
    expect(shortensWidgetResult(() => 'claude')()).toBe(false)
  })

  it('returns the full payload to a Host Action and the acknowledgement to the local call', async () => {
    const opts = { shortensResult: shortensWidgetResult(() => 'claude') }
    const remote = await collectArtifacts('s1', 'call-2', () => executeWidgetShowTool(ARGS, opts), 'conn-1')
    expect(payloadOf(remote)).toMatchObject({ title: 'releases' })
    const local = await runInLocalCallScope('s1', () => executeWidgetShowTool(ARGS, opts))
    expect(local).toEqual({ content: widgetShowShortContent({ ...ARGS }) })
  })
})
