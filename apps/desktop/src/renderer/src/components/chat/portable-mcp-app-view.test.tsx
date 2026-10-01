/** @vitest-environment jsdom */

import { render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { McpAppHostResult, ToolAppAttachment } from '@superone/shared/mcp-apps'
import { installFakeNativeHost } from '@superone/chat-view/fixtures/native-host'
import { forgetMcpAppArrivals, mcpAppNeedsActivation, noteMcpAppArrivals } from '@superone/chat-view/mcp-app-document'
import { PortableMcpAppView } from '@superone/chat-view/PortableMcpAppView'

// The frame boots the MCP SDK in an iframe; these tests cover what happens before it may.
vi.mock('../../../../../../../packages/chat-view/src/McpAppFrame', () => ({
  default: ({ app }: { app: ToolAppAttachment }) => <div data-testid="frame">{app.appInstanceId}</div>,
}))

const RESOURCE = { html: '<!doctype html><p>View</p>', hash: 'v1', meta: {} }
let operations: string[] = []
let dispose: (() => void) | null = null

function installHost(answer: (operation: string) => McpAppHostResult): void {
  dispose = installFakeNativeHost((message, send) => {
    if (message.action !== 'mcpApp') return
    const operation = String(message.payload?.operation)
    operations.push(operation)
    queueMicrotask(() => send({ result: { ok: true, response: answer(operation) } }))
  })
}

const ok = (operation: string): McpAppHostResult => ({ ok: true, value: operation === 'load' ? RESOURCE : {} })

function show(id: string, arrival: 'live' | 'restored', resource?: typeof RESOURCE) {
  const app: ToolAppAttachment = {
    appInstanceId: id,
    binding: { node: 'local', session: 's', server: 'fixture', configGeneration: 1, configFingerprint: 'f' },
    origin: { providerSessionId: 'p' },
    harnessCallId: 'c',
    resourceUri: 'ui://fixture/view.html',
    status: 'result',
    ...(resource ? { resource } : {}),
  }
  noteMcpAppArrivals([{ id: 'm', role: 'assistant', status: 'complete', createdAt: '', providerId: 'claude', content: [{ type: 'tool_result', toolUseId: 't', summary: '', app }] }], arrival)
  return render(
    <PortableMcpAppView app={app} messageId="m" toolName="mcp__fixture__view" row={({ trailing } = {}) => <div data-testid="row">{trailing}</div>} />,
  )
}

afterEach(() => {
  dispose?.()
  dispose = null
  operations = []
  forgetMcpAppArrivals()
})

describe('PortableMcpAppView activation', () => {
  it('activates a live View before loading it', async () => {
    installHost(ok)
    const view = show('live', 'live')
    await waitFor(() => expect(view.getByTestId('frame')).toBeTruthy())
    expect(operations).toEqual(['activate', 'load'])
  })

  it('holds a live View\'s snapshot until the host has activated it', async () => {
    installHost(ok)
    const view = show('live-snapshot', 'live', RESOURCE)
    expect(view.queryByTestId('frame')).toBeNull()
    expect(view.getByTestId('row')).toBeTruthy()
    await waitFor(() => expect(view.getByTestId('frame')).toBeTruthy())
    // The View stands in place of the row once there is one.
    expect(view.queryByTestId('row')).toBeNull()
    expect(operations).toEqual(['activate'])
  })

  it('lets a restored snapshot paint without calling the host', async () => {
    installHost(ok)
    const view = show('restored', 'restored', RESOURCE)
    expect(await view.findByTestId('frame')).toBeTruthy()
    expect(operations).toEqual([])
    expect(mcpAppNeedsActivation('restored')).toBe(true)
  })

  it('shows the sign-in state when a live View cannot activate', async () => {
    installHost(() => ({ ok: false, error: { code: 'auth_required', message: 'Sign in required', challenge: ['Bearer'] } }))
    const view = show('live-auth', 'live', RESOURCE)
    await waitFor(() => expect(view.getByTestId('row').querySelector('.text-error')).toBeTruthy())
    expect(view.queryByTestId('frame')).toBeNull()
    expect(operations).toEqual(['activate'])
  })
})
