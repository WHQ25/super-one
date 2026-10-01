import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import type { ToolAppAttachment } from '@superone/shared/mcp-apps'
import { forgetMcpAppArrivals, markMcpAppActivated } from './mcp-app-document'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
import McpAppFrame from './McpAppFrame'

afterEach(forgetMcpAppArrivals)

it('shows the phone omitted-result notice on restore and clears it after explicit activation', () => {
  const app: ToolAppAttachment = { appInstanceId: 'omitted', binding: { node: 'local', session: 's', server: 'cad', configGeneration: 0, configFingerprint: 'cfg' }, resourceUri: 'ui://cad', status: 'result', toolResultOmitted: { bytes: 1050849, reason: 'size_limit' } }
  const frame = () => renderToStaticMarkup(createElement(McpAppFrame, { app, messageId: 'm', html: '<html></html>', meta: {}, toolName: 'mcp__cad__library', row: () => null }))
  expect(frame()).toContain('mcpApp.resultOmitted')
  expect(frame()).toContain('mcpApp.activate')
  markMcpAppActivated(app.appInstanceId)
  expect(frame()).not.toContain('mcpApp.resultOmitted')
})

it('bounds an oversized legacy result before rendering the phone View', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const app: ToolAppAttachment = { appInstanceId: 'legacy-large', binding: { node: 'local', session: 's', server: 'cad', configGeneration: 0, configFingerprint: 'cfg' }, resourceUri: 'ui://cad', status: 'result', toolResult: { content: [{ type: 'text', text: 'x'.repeat(2 * 1024 * 1024) }] } }
    expect(renderToStaticMarkup(createElement(McpAppFrame, { app, messageId: 'm', html: '<html></html>', meta: {}, toolName: 'mcp__cad__library', row: () => null }))).toContain('mcpApp.resultOmitted')
    expect(warn).toHaveBeenCalled()
  } finally { warn.mockRestore() }
})
