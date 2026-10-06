import { rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const USER_DATA = join(tmpdir(), 'widget-dispatch-userdata')
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({}))
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  app: { getPath: (name: string) => (name === 'userData' ? USER_DATA : tmpdir()), getVersion: () => '0.0.0-test' },
}))
vi.mock('../logger', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../app-settings-service', () => ({ readAppSettings: () => ({}) }))
vi.mock('./guides/overview.md?raw', () => ({ default: 'overview' }))
vi.mock('./guides/manifest.md?raw', () => ({ default: 'manifest' }))
vi.mock('./guides/permissions.md?raw', () => ({ default: 'permissions' }))
vi.mock('./guides/api/theme.md?raw', () => ({ default: 'theme' }))
vi.mock('./guides/api/locale.md?raw', () => ({ default: 'locale' }))
vi.mock('./guides/api/agent.md?raw', () => ({ default: 'agent' }))
vi.mock('./guides/api/system.md?raw', () => ({ default: 'system' }))
vi.mock('./guides/api/ui.md?raw', () => ({ default: 'ui' }))
vi.mock('./guides/api/host.md?raw', () => ({ default: 'miniapp-host' }))
vi.mock('./guides/packaging.md?raw', () => ({ default: 'packaging' }))
vi.mock('./guides/icon.md?raw', () => ({ default: 'icon' }))
vi.mock('./guides/recipes.md?raw', () => ({ default: 'recipes' }))
vi.mock('./guides/tools.md?raw', () => ({ default: 'tools' }))

import { executeSuperoneMcpTool } from './superone-mcp-tool-surface'

/**
 * The widget tools run through the same dispatcher as the stdio bridge, DeepSeek and a
 * remote node's Host Actions. They answer there as they do on the MCP server: a remote
 * node reads the reply it forwards to its harness from this.
 */
afterEach(() => rmSync(USER_DATA, { recursive: true, force: true }))

describe('the widget tools outside the MCP server', () => {
  it('answers widget_show with the payload', async () => {
    const reply = await executeSuperoneMcpTool('node-session', 'widget_show', { title: 'releases', widget_code: '<div>Release chart</div>' })
    expect(JSON.parse(reply.content[0]!.text)).toMatchObject({ title: 'releases', widget_code: '<div>Release chart</div>' })
  })

  it('answers widget_list_templates with the template list', async () => {
    const reply = await executeSuperoneMcpTool('node-session', 'widget_list_templates', {})
    expect(reply.content[0]!.text).toBeTruthy()
  })
})
