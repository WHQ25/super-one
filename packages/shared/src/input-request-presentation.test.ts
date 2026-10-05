import { describe, expect, it } from 'vitest'
import type { PermissionRequest } from './agent-types'
import { groupPendingPermissions, isAppInputRequest, selectPendingPermission } from './input-request-presentation'

const permission = (requestId: string): PermissionRequest => ({ requestId, toolName: 'Bash', input: {}, allowAlwaysAllow: false })
const input = (requestId: string, origin: 'agent' | 'widget' | 'miniapp'): PermissionRequest => ({
  ...permission(requestId),
  requestKind: 'input_request',
  inputRequest: {
    title: requestId,
    origin: origin === 'widget' ? { kind: origin, messageId: requestId } : origin === 'miniapp' ? { kind: origin, appId: requestId } : { kind: origin },
    output: origin === 'widget' ? 'agent' : 'caller',
  },
})

describe('input request presentation', () => {
  const widget = input('widget', 'widget')
  const app = input('app', 'miniapp')
  const agent = input('agent', 'agent')
  const approval = permission('approval')

  it('preserves arrival order within each family without mutating requests', () => {
    const requests = Object.freeze([widget, agent, approval, app, permission('later')])
    expect(groupPendingPermissions(requests)).toEqual({ permissions: [approval, permission('later')], agentInputs: [agent], appInputs: [widget, app] })
    expect(requests[0]).toBe(widget)
  })

  it('lets an approval overtake an earlier application form and a question', () => {
    expect(selectPendingPermission([widget, agent, approval], { question: true, plan: true, appConsent: true })).toBe(approval)
  })

  it('keeps an existing question ahead of agent input', () => {
    expect(selectPendingPermission([widget, agent], { question: true })).toBeNull()
  })

  it('keeps agent input ahead of plan and app consent', () => {
    expect(selectPendingPermission([widget, agent], { plan: true, appConsent: true })).toBe(agent)
  })

  it.each([{ plan: true }, { appConsent: true }, { question: true }])('defers application input behind %j', blocked => {
    expect(selectPendingPermission([widget, app], blocked)).toBeNull()
  })

  it('shows the first app form when higher-priority work clears', () => {
    expect(selectPendingPermission([widget, app])).toBe(widget)
    expect(selectPendingPermission([])).toBeNull()
  })

  it('classifies both application origins without treating an agent form as an app', () => {
    expect(isAppInputRequest(widget)).toBe(true)
    expect(isAppInputRequest(app)).toBe(true)
    expect(isAppInputRequest(agent)).toBe(false)
    expect(isAppInputRequest(approval)).toBe(false)
    expect(isAppInputRequest(null)).toBe(false)
  })
})
