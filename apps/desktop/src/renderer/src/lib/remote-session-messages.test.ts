/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { elicitationFormRequest } from '@superone/shared/schema-form'
import {
  nodePendingInteractionFields,
  nodePendingToPermissionRequest,
  nodePendingToQuestionRequest,
  nodePendingToPlanApprovalRequest,
  nodeStatusToAgentStatus,
} from './remote-session-messages'

describe('nodePendingToPermissionRequest', () => {
  it('restores declarative form fields and metadata from a node snapshot', () => {
    const form = elicitationFormRequest({ type: 'object', properties: { name: { type: 'string' } } })
    const pending = { interactionId: 'form', kind: 'permission' as const, requestKind: 'mcp_elicitation', ...form,
      subtitle: 'Part', riskLevel: 'low' as const, supportsAlwaysPersist: true, allowAlwaysAllow: true }
    expect(nodePendingToPermissionRequest(pending)).toMatchObject({ ...form, subtitle: 'Part', riskLevel: 'low', supportsAlwaysPersist: true, allowAlwaysAllow: false })
    expect(nodePendingToPermissionRequest({ ...pending, schemaForm: undefined, input: { schemaForm: form.schemaForm } })).toMatchObject(form)
  })
  it('maps permission interactions to PermissionRequest', () => {
    const req = nodePendingToPermissionRequest({
      interactionId: 'i1',
      kind: 'permission',
      toolName: 'Bash',
      toolUseId: 'tu1',
      input: { command: 'ls' },
      createdAt: 1,
    })
    expect(req).toEqual({
      requestId: 'i1',
      toolName: 'Bash',
      toolUseId: 'tu1',
      input: { command: 'ls' },
      allowAlwaysAllow: true,
    })
  })

  it('maps Grok MCP elicitation onto PermissionRequest URL fields', () => {
    const req = nodePendingToPermissionRequest({
      interactionId: 'elicit-1',
      kind: 'permission',
      toolName: 'github',
      requestKind: 'mcp_elicitation',
      message: 'Sign in to GitHub',
      serverName: 'github',
      allowAlwaysAllow: false,
      input: {
        elicitationUrl: 'https://github.com/login',
        elicitationId: 'e-1',
      },
    })
    expect(req).toMatchObject({
      requestId: 'elicit-1',
      requestKind: 'mcp_elicitation',
      elicitationUrl: 'https://github.com/login',
      elicitationId: 'e-1',
      subtitle: 'https://github.com/login',
      allowAlwaysAllow: false,
    })
  })

  it('ignores non-permission kinds and empty ids', () => {
    expect(
      nodePendingToPermissionRequest({
        interactionId: 'q1',
        kind: 'question',
        createdAt: 1,
      }),
    ).toBeNull()
    expect(nodePendingToPermissionRequest(null)).toBeNull()
  })
})

describe('node pending question/plan + live drain helpers', () => {
  it('maps question and plan to store-shaped requests', () => {
    const q = nodePendingToQuestionRequest({
      interactionId: 'q1',
      kind: 'question',
      input: {
        questions: [{ question: 'Go?', header: 'Confirm', options: [{ label: 'Yes' }] }],
      },
    })
    expect(q?.requestId).toBe('q1')
    expect(q?.questions[0]?.question).toBe('Go?')

    const p = nodePendingToPlanApprovalRequest({
      interactionId: 'pl1',
      kind: 'plan',
      input: { plan: 'Ship it' },
    })
    expect(p).toEqual(
      expect.objectContaining({
        requestId: 'pl1',
        planContent: 'Ship it',
      }),
    )
  })

  it("carries the node's own previewFormat so an HTML option preview renders", () => {
    const base = {
      interactionId: 'q1',
      kind: 'question' as const,
      input: {
        questions: [{ question: 'Go?', header: 'Confirm', options: [{ label: 'Yes', preview: '<b>hi</b>' }] }],
      },
    }
    // Absent → undefined (markdown default), unknown value → dropped, 'html' → kept.
    expect(nodePendingToQuestionRequest(base)?.previewFormat).toBeUndefined()
    expect(
      nodePendingToQuestionRequest({ ...base, input: { ...base.input, previewFormat: 'pdf' } })?.previewFormat,
    ).toBeUndefined()
    expect(
      nodePendingToQuestionRequest({ ...base, input: { ...base.input, previewFormat: 'html' } })?.previewFormat,
    ).toBe('html')
  })

  it('builds interaction fields', () => {
    const fields = nodePendingInteractionFields({
      interactionId: 'q1',
      kind: 'question',
      input: { questions: [{ question: 'Go?' }] },
    })
    expect(fields.pendingQuestion?.requestId).toBe('q1')
    expect(fields.awaitingAssistantReply).toBe(true)
  })

  it('lists input forms after the harness prompt and keeps their metadata', () => {
    const inputRequest = { title: 'Deploy', origin: { kind: 'agent' as const }, output: 'caller' as const }
    const form = {
      interactionId: 'f1', kind: 'permission' as const, requestKind: 'input_request', toolName: 'composer_request',
      message: 'Deploy', inputRequest, ...elicitationFormRequest({ type: 'object', properties: { env: { type: 'string' } } }),
    }
    const fields = nodePendingInteractionFields({ interactionId: 'p1', kind: 'permission', toolName: 'Bash', input: {} }, [form])
    expect(fields.pendingPermissions.map(p => p.requestId)).toEqual(['p1', 'f1'])
    expect(fields.pendingPermissions[1]).toMatchObject({ requestKind: 'input_request', allowAlwaysAllow: false, inputRequest, schemaForm: { supported: true } })
    expect(nodePendingInteractionFields(null, [form]).awaitingAssistantReply).toBe(true)
    expect(nodePendingInteractionFields(null, [{ ...form, inputRequest: undefined }]).pendingPermissions).toEqual([])
  })
})

describe('nodeStatusToAgentStatus', () => {
  it('maps node status', () => {
    expect(nodeStatusToAgentStatus('streaming')).toBe('streaming')
    expect(nodeStatusToAgentStatus('idle')).toBe('idle')
  })
})
