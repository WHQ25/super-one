// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { ToolAppAttachment } from '@superone/shared/mcp-apps'

const run = vi.hoisted(() => vi.fn())
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, params?: { size?: string }) => params?.size ? `${key}: ${params.size}` : key }) }))
vi.mock('./mcp-app-executor', () => ({ runMcpAppOperation: run }))
vi.mock('./McpAppFrame', () => ({ default: () => createElement('iframe') }))
import { PortableMcpAppView } from './PortableMcpAppView'

const base: ToolAppAttachment = {
  appInstanceId: 'failed', binding: { node: 'local', session: 's', server: 'cad', configGeneration: 0, configFingerprint: 'cfg' },
  resourceUri: 'ui://cad', status: 'result', toolInput: {},
}
let root: Root | undefined, container: HTMLDivElement | undefined
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); run.mockReset() })

async function mount(app: ToolAppAttachment): Promise<string> {
  container = document.body.appendChild(document.createElement('div'))
  root = createRoot(container)
  await act(async () => root!.render(createElement(PortableMcpAppView, { app, messageId: 'm', toolName: 'mcp__cad__pick', details: null })))
  return container.querySelector('[data-mcp-app-state-card]')?.textContent ?? ''
}

it('shows an omitted result in the state card without loading the View', async () => {
  expect(await mount({ ...base, toolResultOmitted: { bytes: 2_500_000, reason: 'size_limit' } })).toContain('mcpApp.resultOverLimit: 2.4 MB')
  expect(container!.querySelector('iframe')).toBeNull()
  expect(run).not.toHaveBeenCalled()
})
