import { describe, expect, it, vi } from 'vitest'
import { CodexSkillsRpcService } from './codex-skills-rpc-service'
import type { CodexExperimentService } from './codex-experiment-service'

function makeService(
  requestImpl: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>,
  fileExists: (path: string) => boolean = () => false,
): CodexSkillsRpcService {
  const stub = {
    withAppServerRequest: vi.fn(async (_projectPath: string, fn: (request: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>) => unknown) => {
      return fn(requestImpl)
    }),
  } as unknown as CodexExperimentService
  return new CodexSkillsRpcService(stub, { fileExists })
}

describe('CodexSkillsRpcService.list', () => {
  it('maps SkillMetadata into SkillInfo and merges across cwd entries with scope→ResourceScope translation', async () => {
    const service = makeService(async (method, params) => {
      expect(method).toBe('skills/list')
      expect(params).toEqual({ cwds: ['/p'] })
      return {
        data: [
          {
            cwd: '/p',
            skills: [
              { name: 'lint', description: 'Run lint', path: '/home/u/.codex/skills/lint', scope: 'user', enabled: true },
              { name: 'review', description: 'Review repo PRs', path: '/p/.codex/skills/review', scope: 'repo', enabled: true, interface: { displayName: 'PR Review' } },
              { name: 'docs', description: 'Built-in docs', path: '/etc/codex/skills/docs', scope: 'system', enabled: true },
            ],
            errors: [],
          },
        ],
      }
    })
    const result = await service.list('/p')
    expect(result).toEqual([
      { name: 'lint', displayName: 'lint', scope: 'user', description: 'Run lint', argumentHint: '', hasConfig: false, sourcePath: '/home/u/.codex/skills/lint', enabled: true },
      { name: 'review', displayName: 'PR Review', scope: 'project', description: 'Review repo PRs', argumentHint: '', hasConfig: false, sourcePath: '/p/.codex/skills/review', enabled: true },
      { name: 'docs', displayName: 'docs', scope: 'user', description: 'Built-in docs', argumentHint: '', hasConfig: false, sourcePath: '/etc/codex/skills/docs', enabled: true, builtin: true },
    ])
  })

  it('marks hasConfig=true when a config.json sits beside the skill (dereferencing SKILL.md → skill directory)', async () => {
    const service = makeService(
      async () => ({
        data: [
          { cwd: '/p', skills: [{ name: 's', description: 'd', path: '/p/.codex/skills/s/SKILL.md', scope: 'user', enabled: true }], errors: [] },
        ],
      }),
      (path) => path === '/p/.codex/skills/s/config.json',
    )
    const result = await service.list('/p')
    expect(result[0].hasConfig).toBe(true)
  })

  it('deduplicates by scope+name when multiple cwd entries return the same user skill', async () => {
    const service = makeService(async () => ({
      data: [
        { cwd: '/p1', skills: [{ name: 'shared', description: 'a', path: '/u/shared', scope: 'user', enabled: true }] },
        { cwd: '/p2', skills: [{ name: 'shared', description: 'b', path: '/u/shared', scope: 'user', enabled: true }] },
      ],
    }))
    const result = await service.list('/p1')
    expect(result).toHaveLength(1)
    expect(result[0].description).toBe('a')
  })

  it('drops entries missing name or path so a malformed item does not break the whole list', async () => {
    const service = makeService(async () => ({
      data: [{
        cwd: '/p',
        skills: [
          { name: 'ok', description: 'd', path: '/p/ok', scope: 'user', enabled: true },
          { description: 'missing-name' },
          { name: 'missing-path', description: 'd' },
        ],
      }],
    }))
    const result = await service.list('/p')
    expect(result.map((s) => s.name)).toEqual(['ok'])
  })

  it('falls back to shortDescription / interface.shortDescription when description is empty', async () => {
    const service = makeService(async () => ({
      data: [{
        cwd: '/p',
        skills: [{
          name: 'fancy',
          description: '',
          shortDescription: 'short',
          interface: { shortDescription: 'iface' },
          path: '/p/.codex/skills/fancy',
          scope: 'user',
          enabled: true,
        }],
      }],
    }))
    const result = await service.list('/p')
    expect(result[0].description).toBe('short')
  })
})

describe('CodexSkillsRpcService.setEnabled', () => {
  it('forwards name selector to skills/config/write', async () => {
    const service = makeService(async (method, params) => {
      expect(method).toBe('skills/config/write')
      expect(params).toEqual({ name: 'lint', enabled: false })
      return {}
    })
    await service.setEnabled('/p', { name: 'lint' }, false)
  })

  it('forwards path selector when name is absent', async () => {
    const service = makeService(async (_method, params) => {
      expect(params).toEqual({ path: '/u/skills/lint', enabled: true })
      return {}
    })
    await service.setEnabled('/p', { path: '/u/skills/lint' }, true)
  })

  it('rejects when neither name nor path is provided', async () => {
    const request = vi.fn()
    const service = makeService(request as never)
    await expect(service.setEnabled('/p', {}, true)).rejects.toThrow(/name or path/)
    expect(request).not.toHaveBeenCalled()
  })
})
