import { describe, expect, it } from 'vitest'
import type { PermissionRequest } from '@superone/shared/agent-types'
import type { InputRequestOrigin } from '@superone/shared/input-request'
import { createDefaultChatCoreSession } from './defaults'
import { reduceLifecycle } from './lifecycle'

function inputRequest(requestId: string, origin: InputRequestOrigin): PermissionRequest {
  return {
    requestId, toolName: 'composer_request', input: {}, allowAlwaysAllow: false, requestKind: 'input_request',
    schemaForm: { supported: true, fields: [] },
    inputRequest: { title: 'Form', origin, output: origin.kind === 'widget' ? 'agent' : 'caller' },
  }
}

describe('interrupting a turn with input forms open', () => {
  it('drops turn prompts and agent forms but keeps forms a mini-app or widget opened', () => {
    const session = createDefaultChatCoreSession()
    const app = inputRequest('app', { kind: 'miniapp', appId: 'todo' })
    const widget = inputRequest('widget', { kind: 'widget', messageId: 'm0' })
    session.pendingPermissions = [
      { requestId: 'bash', toolName: 'Bash', input: {}, allowAlwaysAllow: true },
      inputRequest('agent', { kind: 'agent' }),
      app,
      widget,
    ]
    const patch = reduceLifecycle(session, { type: 'message_interrupted', messageId: 'm1' })
    expect(patch.pendingPermissions).toEqual([app, widget])
  })
})
