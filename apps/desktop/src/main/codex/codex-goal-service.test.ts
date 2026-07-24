import { describe, expect, it, vi } from 'vitest'
import { CodexGoalService } from './codex-goal-service'
import type { CodexExperimentService } from './codex-experiment-service'

function makeService(requestImpl: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>): CodexGoalService {
  const codexServiceStub = {
    withAppServerRequest: vi.fn(async (_projectPath: string, fn: (request: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>) => unknown) => {
      return fn(requestImpl)
    }),
  } as unknown as CodexExperimentService
  return new CodexGoalService(codexServiceStub)
}

describe('CodexGoalService', () => {
  it('returns null from get() when the thread has no goal yet', async () => {
    const service = makeService(async (method, params) => {
      expect(method).toBe('thread/goal/get')
      expect(params).toEqual({ threadId: 't1' })
      return { goal: null }
    })
    expect(await service.get('/p', 't1')).toBeNull()
  })

  it('maps thread/goal/get into CodexGoal preserving status and budget', async () => {
    const service = makeService(async () => ({
      goal: {
        threadId: 't1',
        objective: 'Ship the JWT refactor',
        status: 'active',
        tokenBudget: 50000,
        tokensUsed: 120,
        timeUsedSeconds: 9,
        createdAt: 1234567890,
        updatedAt: 1234567900,
      },
    }))
    const goal = await service.get('/p', 't1')
    expect(goal).toEqual({
      threadId: 't1',
      objective: 'Ship the JWT refactor',
      status: 'active',
      tokenBudget: 50000,
      tokensUsed: 120,
      timeUsedSeconds: 9,
      createdAt: 1234567890,
      updatedAt: 1234567900,
    })
  })

  it('rejects empty objective without calling the server', async () => {
    const request = vi.fn()
    const service = makeService(request as never)
    await expect(service.set('/p', 't1', '   ')).rejects.toThrow(/empty/)
    expect(request).not.toHaveBeenCalled()
  })

  it('trims the objective before sending thread/goal/set', async () => {
    const service = makeService(async (method, params) => {
      expect(method).toBe('thread/goal/set')
      expect(params).toEqual({ threadId: 't1', objective: 'Refactor auth' })
      return {
        goal: {
          threadId: 't1',
          objective: 'Refactor auth',
          status: 'active',
          tokenBudget: null,
          tokensUsed: 0,
          timeUsedSeconds: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      }
    })
    const goal = await service.set('/p', 't1', '  Refactor auth  ')
    expect(goal?.objective).toBe('Refactor auth')
  })

  it('forwards an explicit goal status', async () => {
    const service = makeService(async (method, params) => {
      expect(method).toBe('thread/goal/set')
      expect(params).toEqual({ threadId: 't1', objective: 'Refactor auth', status: 'paused' })
      return {
        goal: {
          threadId: 't1',
          objective: 'Refactor auth',
          status: 'paused',
          tokenBudget: null,
          tokensUsed: 0,
          timeUsedSeconds: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      }
    })

    expect((await service.set('/p', 't1', 'Refactor auth', 'paused'))?.status).toBe('paused')
  })

  it('returns the cleared boolean from thread/goal/clear', async () => {
    const service = makeService(async (method, params) => {
      expect(method).toBe('thread/goal/clear')
      expect(params).toEqual({ threadId: 't1' })
      return { cleared: true }
    })
    expect(await service.clear('/p', 't1')).toBe(true)
  })

  it('falls back to "active" status when the server returns an unknown status', async () => {
    const service = makeService(async () => ({
      goal: {
        threadId: 't1',
        objective: 'X',
        status: 'something-new',
        tokenBudget: null,
        tokensUsed: 0,
        timeUsedSeconds: 0,
        createdAt: 0,
        updatedAt: 0,
      },
    }))
    const goal = await service.get('/p', 't1')
    expect(goal?.status).toBe('active')
  })
})
