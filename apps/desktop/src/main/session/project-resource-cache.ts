import type { AgentInfo, SlashCommandInfo } from '@superone/shared/agent-types'
import type { ProjectResources, ScopedAdditionalDirs } from './types'

export interface DiscoverFns {
  discoverSkills(cwd: string): SlashCommandInfo[]
  discoverProjectCommands(cwd: string): SlashCommandInfo[]
  discoverProjectAgents(cwd: string): AgentInfo[]
  discoverScopedAdditionalDirs(cwd: string): ScopedAdditionalDirs
}

export class ProjectResourceCache {
  private cache = new Map<string, ProjectResources>()

  constructor(private discover: DiscoverFns) {}

  get(cwd: string): ProjectResources {
    const existing = this.cache.get(cwd)
    if (existing) return existing
    const scoped = this.discover.discoverScopedAdditionalDirs(cwd)
    const merged = Array.from(new Set([...scoped.user, ...scoped.projectShared, ...scoped.projectLocal]))
    const resources: ProjectResources = {
      cwd,
      skills: this.discover.discoverSkills(cwd),
      projectCommands: this.discover.discoverProjectCommands(cwd),
      projectAgents: this.discover.discoverProjectAgents(cwd),
      additionalDirectories: merged,
      additionalDirsScoped: scoped,
    }
    this.cache.set(cwd, resources)
    return resources
  }

  invalidate(cwd: string): void {
    this.cache.delete(cwd)
  }

  clear(): void {
    this.cache.clear()
  }
}
