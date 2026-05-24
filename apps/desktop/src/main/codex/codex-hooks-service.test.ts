import { describe, expect, it, vi } from 'vitest'
import { CodexHooksService } from './codex-hooks-service'
import type { CodexExperimentService } from './codex-experiment-service'

function makeService(requestImpl: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>): CodexHooksService {
  const codexServiceStub = {
    withAppServerRequest: vi.fn(async (_projectPath: string, fn: (request: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>) => unknown) => {
      return fn(requestImpl)
    }),
  } as unknown as CodexExperimentService
  return new CodexHooksService(codexServiceStub)
}

describe('CodexHooksService.list', () => {
  it('maps a populated hooks/list response into CodexHookGroup[]', async () => {
    const service = makeService(async (method, params) => {
      expect(method).toBe('hooks/list')
      expect(params).toEqual({ cwds: ['/project/cwd'] })
      return {
        data: [
          {
            cwd: '/project/cwd',
            hooks: [
              {
                key: 'h1',
                eventName: 'preToolUse',
                handlerType: 'command',
                matcher: 'Bash:*',
                command: 'echo hello',
                timeoutSec: 30,
                statusMessage: null,
                sourcePath: '/home/user/.codex/hooks/h1.toml',
                source: 'user',
                pluginId: null,
                displayOrder: 0,
                enabled: true,
                isManaged: false,
                currentHash: 'abc',
                trustStatus: 'trusted',
              },
              {
                key: 'h2',
                eventName: 'sessionStart',
                handlerType: 'prompt',
                matcher: null,
                command: null,
                timeoutSec: 0,
                statusMessage: 'Initializing session',
                sourcePath: '/plugins/foo/hooks.toml',
                source: 'plugin',
                pluginId: 'foo@market',
                displayOrder: 1,
                enabled: false,
                isManaged: true,
                currentHash: 'def',
                trustStatus: 'untrusted',
              },
            ],
            warnings: ['outdated config schema'],
            errors: [],
          },
        ],
      }
    })

    const result = await service.list('/project/cwd')
    expect(result).toHaveLength(1)
    const group = result[0]
    expect(group.cwd).toBe('/project/cwd')
    expect(group.warnings).toEqual(['outdated config schema'])
    expect(group.errors).toEqual([])
    expect(group.hooks).toHaveLength(2)
    expect(group.hooks[0]).toMatchObject({
      key: 'h1',
      eventName: 'preToolUse',
      handlerType: 'command',
      matcher: 'Bash:*',
      command: 'echo hello',
      timeoutSec: 30,
      source: 'user',
      trustStatus: 'trusted',
      enabled: true,
    })
    expect(group.hooks[1]).toMatchObject({
      key: 'h2',
      eventName: 'sessionStart',
      handlerType: 'prompt',
      pluginId: 'foo@market',
      source: 'plugin',
      trustStatus: 'untrusted',
      isManaged: true,
    })
  })

  it('returns [] when projectPath is empty and the response is empty', async () => {
    const service = makeService(async (method, params) => {
      expect(method).toBe('hooks/list')
      expect(params).toEqual({ cwds: [] })
      return { data: [] }
    })
    const result = await service.list('')
    expect(result).toEqual([])
  })

  it('drops malformed hook entries instead of crashing the whole group', async () => {
    const service = makeService(async () => ({
      data: [
        {
          cwd: '/c',
          hooks: [
            { /* missing key/eventName */ },
            {
              key: 'ok',
              eventName: 'stop',
              handlerType: 'command',
              sourcePath: '/x',
              source: 'user',
              displayOrder: 0,
              enabled: true,
              isManaged: false,
              trustStatus: 'trusted',
              timeoutSec: 0,
              matcher: null,
              command: 'ls',
              statusMessage: null,
              pluginId: null,
              currentHash: 'h',
            },
          ],
          warnings: [],
          errors: [],
        },
      ],
    }))
    const result = await service.list('/c')
    expect(result[0].hooks).toHaveLength(1)
    expect(result[0].hooks[0].key).toBe('ok')
  })

  it('falls back to "unknown" for unrecognized source and trustStatus enums', async () => {
    const service = makeService(async () => ({
      data: [
        {
          cwd: '/c',
          hooks: [
            {
              key: 'h',
              eventName: 'preToolUse',
              handlerType: 'command',
              sourcePath: '/x',
              source: 'something-new',
              trustStatus: 'something-new',
              displayOrder: 0,
              enabled: true,
              isManaged: false,
              timeoutSec: 0,
              matcher: null,
              command: 'ls',
              statusMessage: null,
              pluginId: null,
              currentHash: 'h',
            },
          ],
          warnings: [],
          errors: [],
        },
      ],
    }))
    const result = await service.list('/c')
    expect(result[0].hooks[0].source).toBe('unknown')
    expect(result[0].hooks[0].trustStatus).toBe('unknown')
  })
})
