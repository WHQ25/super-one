import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage, SendMessageRequest } from '@superone/shared/agent-types'
import { mcpAppMessageAttachments } from '@superone/shared/mcp-apps-state'
import type { SessionBackend } from './types'
import { Session } from './session'
import type { McpAppMessage } from '@superone/shared/mcp-apps-state'
import { withMcpAppContext } from './mcp-app-context'

const messages: McpAppMessage[] = [{ id: 'message', metadata: { codex: { items: [{ app: {
  appInstanceId: 'view', binding: { server: 'fixture' }, resourceUri: 'ui://fixture',
  toolResult: { _meta: { privateValue: 'private-result' } },
  modelContext: { content: [{ type: 'text', text: 'Selected item-4' }], source: { server: 'forged' } },
} }] } } }]

vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }))
vi.mock('../shell-env', () => ({ ensureShellPath: vi.fn() }))

function host(harness: 'claude' | 'codex') {
  const send = vi.fn(async (_request: SendMessageRequest) => {})
  const backend = { kind: harness, start: vi.fn(async () => {}), send,
    onEvent: () => () => {}, onProviderSessionId: () => () => {}, onPermissionModeApplied: () => () => {} } as unknown as SessionBackend
  const initial: ChatMessage = { ...messages[0], role: 'assistant', status: 'complete', createdAt: '', providerId: harness, content: [] } as ChatMessage
  if (harness === 'claude') { initial.content = [{ type: 'tool_result', toolUseId: 'call', summary: 'done', app: mcpAppMessageAttachments(initial)[0] }]; delete initial.metadata }
  return { send, session: new Session({ id: 's', projectPath: '/tmp', cwd: '/tmp', providerId: harness, harnessId: harness, backend, providerConfig: {}, initialMessages: [initial] }) }
}

describe('model context at the desktop send boundary', () => {
  it('reaches Codex explicit prompts and ordinary harness input with attributed context only', () => {
    const codex = withMcpAppContext({ content: 'chat text', codex: { prompt: 'model text', mode: 'run' } }, messages)
    expect(codex.codex?.prompt).toContain('model text\n\n<mcp-app-context>')
    expect(codex.codex?.prompt).toContain('Selected item-4')
    expect(codex.codex?.prompt).toContain('"server":"fixture"')
    expect(codex.codex?.prompt).not.toContain('private-result')
    expect(codex.codex?.prompt).not.toContain('forged')
    expect(codex.codex?.mode).toBe('run')
    expect(withMcpAppContext({ content: 'question' }, messages).content).toContain('Selected item-4')
  })
  it('sends image context as real backend attachment input with no base64 or block metadata in prompts', async () => {
    const { session, send } = host('codex')
    session.emitHostEvent({ type: 'mcp_app_updated', messageId: 'message', appInstanceId: 'view', update: { modelContext: { updateId: 'r1', source: { appInstanceId: 'view', server: 'fixture' }, content: [{ type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=', _meta: { private: 'block-private' } }] } } })
    await session.send({ content: 'question', codex: { prompt: 'explicit question' } })
    const request = send.mock.calls[0]![0]
    expect(request.images).toMatchObject([{ mimeType: 'image/png', base64: 'iVBORw0KGgo=' }])
    expect(request.codex?.prompt).not.toMatch(/iVBORw0KGgo|block-private/)
    expect(session.snapshot.messages.at(-1)?.attachments).toBeUndefined()
  })

  it('keeps sends without App context unchanged', () => {
    const request = { content: 'hello', codex: { prompt: 'hello' } }
    expect(withMcpAppContext(request, [])).toBe(request)
  })
  it.each([
    ['claude', false], ['codex', false], ['codex', true],
  ] as const)('desktop %s send (explicit prompt=%s) attaches once at the model boundary', async (harness, explicit) => {
    const { session, send } = host(harness)
    await session.send({ content: 'question', ...(explicit ? { codex: { prompt: 'explicit question' } } : {}) })
    const request = send.mock.calls[0]![0] as import('@superone/shared/agent-types').SendMessageRequest
    const modelInput = request.codex?.prompt ?? request.content
    expect(modelInput).toContain('Selected item-4')
    expect(modelInput.match(/<mcp-app-context>/g)).toHaveLength(1)
    expect(modelInput).not.toContain('private-result')
    expect(session.snapshot.messages.at(-1)?.content).toEqual([{ type: 'text', text: 'question' }])
  })
})
