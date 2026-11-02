import { expect, it, vi } from 'vitest'
import { openTurnAndStream } from './codex-live-turn'

function client(request: ReturnType<typeof vi.fn>) {
  const notes = [{ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'turn', status: 'completed' } } }]
  return { request, nextNotification: async () => notes.shift() ?? null } as never
}

it('uses auto-review when a live turn has no Codex permission preset', async () => {
  const request = vi.fn().mockResolvedValue({ turn: { id: 'turn' } })
  await openTurnAndStream({
    client: client(request),
    prompt: 'hello',
    cwd: '/work',
    threadId: 'thread',
    signal: new AbortController().signal,
  })
  expect(request).toHaveBeenCalledWith('turn/start', expect.objectContaining({
    approvalPolicy: 'on-request',
    approvalsReviewer: 'auto_review',
    sandboxPolicy: expect.objectContaining({
      type: 'workspaceWrite',
      networkAccess: false,
      readOnlyAccess: { type: 'fullAccess' },
    }),
  }))
})

it('sends full access only for the full-access preset', async () => {
  const request = vi.fn().mockResolvedValue({ turn: { id: 'turn' } })
  await openTurnAndStream({
    client: client(request),
    prompt: 'hello',
    cwd: '/work',
    threadId: 'thread',
    permissionPreset: 'full-access',
    signal: new AbortController().signal,
  })
  expect(request).toHaveBeenCalledWith('turn/start', expect.objectContaining({
    approvalPolicy: 'never',
    approvalsReviewer: 'user',
    sandboxPolicy: { type: 'dangerFullAccess' },
  }))
})
