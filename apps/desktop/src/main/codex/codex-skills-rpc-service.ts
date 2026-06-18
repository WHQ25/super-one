import { existsSync } from 'fs'
import { dirname, join, resolve } from 'path'
import type { ResourceScope, SkillInfo } from '@superone/shared/agent-types'
import type { CodexExperimentService } from './codex-experiment-service'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function mapScope(raw: unknown): { scope: ResourceScope; readOnly: boolean } {
  switch (readString(raw)) {
    case 'repo':
      return { scope: 'project', readOnly: false }
    case 'system':
    case 'admin':
      return { scope: 'user', readOnly: true }
    case 'user':
    default:
      return { scope: 'user', readOnly: false }
  }
}

function mapSkill(raw: unknown, fileExists: (path: string) => boolean): SkillInfo | null {
  const rec = asRecord(raw)
  if (!rec) return null
  const name = readString(rec.name)
  const skillPath = readString(rec.path)
  if (!name || !skillPath) return null
  const { scope, readOnly } = mapScope(rec.scope)
  const intf = asRecord(rec.interface)
  const skillDir = skillPath.endsWith('/SKILL.md') || skillPath.endsWith('\\SKILL.md')
    ? dirname(skillPath)
    : skillPath
  const hasConfig = fileExists(join(skillDir, 'config.json'))
  return {
    name,
    displayName: readString(intf?.displayName) ?? name,
    scope,
    description: readString(rec.description) ?? readString(rec.shortDescription) ?? readString(intf?.shortDescription) ?? '',
    argumentHint: '',
    hasConfig,
    sourcePath: skillDir,
    ...(readOnly ? { builtin: true } : {}),
  }
}

export interface CodexSkillsRpcServiceOptions {
  fileExists?: (path: string) => boolean
}

export class CodexSkillsRpcService {
  private readonly fileExists: (path: string) => boolean

  constructor(
    private readonly codexService: CodexExperimentService,
    opts: CodexSkillsRpcServiceOptions = {},
  ) {
    this.fileExists = opts.fileExists ?? existsSync
  }

  async list(projectPath: string): Promise<SkillInfo[]> {
    return this.codexService.withAppServerRequest(projectPath, async (rpc) => {
      const result = await rpc('skills/list', { cwds: projectPath ? [projectPath] : [] })
      const data = Array.isArray(result.data) ? result.data : []
      const skills: SkillInfo[] = []
      const seen = new Set<string>()
      for (const entry of data) {
        const entryRec = asRecord(entry)
        const entrySkills = Array.isArray(entryRec?.skills) ? entryRec.skills : []
        for (const raw of entrySkills) {
          const info = mapSkill(raw, this.fileExists)
          if (!info) continue
          // mapSkill always sets sourcePath (it returns null when path is absent).
          // Normalize via resolve() so path-form variants (trailing slash, ./ )
          // collapse — matching listSkillsFromDirs' resolve(skillDir) dedup key.
          const key = resolve(info.sourcePath!)
          if (seen.has(key)) continue
          seen.add(key)
          skills.push(info)
        }
      }
      return skills
    })
  }

  async setEnabled(projectPath: string, selector: { name?: string; path?: string }, enabled: boolean): Promise<void> {
    const name = selector.name?.trim()
    const path = selector.path?.trim()
    if (!name && !path) throw new Error('skills/config/write requires name or path')
    await this.codexService.withAppServerRequest(projectPath, async (rpc) => {
      await rpc('skills/config/write', {
        ...(name ? { name } : {}),
        ...(path ? { path } : {}),
        enabled,
      })
    })
  }

  isEnabledKnown(_skill: SkillInfo): boolean {
    // Reserved for future use when we surface enabled state in SkillInfo.
    return false
  }

  static mapForTesting = mapSkill
}
