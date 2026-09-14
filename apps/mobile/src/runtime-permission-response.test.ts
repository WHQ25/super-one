import { afterEach, expect, it, vi } from 'vitest'
import type { RelayClient } from '@superone/relay-client'
import type { PermissionRequest, RemoteCommand } from '@superone/shared/agent-types'
import { ChatRuntime } from './runtime'

const permission: PermissionRequest = {
  requestId: 'permission-1', toolName: 'Bash', input: { command: 'pwd' }, allowAlwaysAllow: false,
}

afterEach(() => vi.useRealTimers())

function openPermission() {
  vi.useFakeTimers()
  // Commands leave the phone, but the desktop does not echo a resolution yet.
  const send = vi.fn<(command: RemoteCommand) => void>()
  // MobileApp.syncSheets sets the native sheet's permission from this paint callback.
  const paint = vi.fn()
  const runtime = new ChatRuntime({ send } as unknown as RelayClient, session => {
    paint(session.pendingPermissions[0] ?? null)
  })
  runtime.projectPath = '/test-project'
  runtime.sessionId = 'continuous-session'
  runtime.ingest([{ type: 'permission_request', sessionId: runtime.sessionId, request: permission }])
  vi.advanceTimersByTime(33)
  expect(runtime.pendingPermission?.requestId).toBe(permission.requestId)
  expect(paint).toHaveBeenLastCalledWith(permission)
  paint.mockClear()
  return { runtime, send, paint }
}

it.each([
  ['allow', true],
  ['deny', false],
] as const)('clears the native permission sheet immediately on %s before desktop confirmation', (_action, decision) => {
  const { runtime, send, paint } = openPermission()
  try {
    runtime.respondPermission(permission.requestId, decision)

    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'respond_permission', requestId: permission.requestId, decision,
      projectPath: '/test-project', sessionId: 'continuous-session',
    }))
    // No time advance and no interaction_resolved: both local state and the rendered sheet must clear.
    expect.soft(runtime.pendingPermission).toBeUndefined()
    expect(paint).toHaveBeenLastCalledWith(null)
  } finally {
    runtime.dispose()
  }
})

it('clears the native permission sheet when a delayed desktop resolution arrives', () => {
  const { runtime, paint } = openPermission()
  try {
    runtime.respondPermission(permission.requestId, true)
    vi.advanceTimersByTime(5000)
    runtime.ingest([{
      type: 'interaction_resolved', interactionType: 'permission',
      requestId: permission.requestId, sessionId: runtime.sessionId,
    }])
    vi.advanceTimersByTime(33)

    expect(runtime.pendingPermission).toBeUndefined()
    expect(paint).toHaveBeenLastCalledWith(null)
  } finally {
    runtime.dispose()
  }
})

it('keeps a permission actionable when sending the decision fails', () => {
  const { runtime, send, paint } = openPermission()
  try {
    send.mockImplementationOnce(() => { throw new Error('connection closed') })
    expect(() => runtime.respondPermission(permission.requestId, true)).toThrow('connection closed')
    expect(runtime.pendingPermission).toEqual(permission)
    expect(paint).not.toHaveBeenCalled()
    runtime.respondPermission(permission.requestId, true)
    expect(runtime.pendingPermission).toBeUndefined()
    expect(paint).toHaveBeenLastCalledWith(null)
  } finally { runtime.dispose() }
})

it('ignores duplicate taps and stale permission events without hiding the next request', () => {
  const { runtime, send } = openPermission()
  try {
    runtime.respondPermission(permission.requestId, true)
    runtime.respondPermission(permission.requestId, false)
    expect(send).toHaveBeenCalledTimes(1)
    const next = { ...permission, requestId: 'permission-2' }
    runtime.ingest([
      { type: 'permission_request', request: permission },
      { type: 'permission_request', request: next },
      { type: 'interaction_resolved', interactionType: 'permission', requestId: permission.requestId },
    ])
    expect(runtime.session.pendingPermissions).toEqual([next])
  } finally { runtime.dispose() }
})
