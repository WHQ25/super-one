import type { AgentInfo, SlashCommandInfo } from '@superone/shared/agent-types'
import type { ProjectResources } from './types'

export interface DiscoverFns {
  discoverSkills(cwd: string): SlashCommandInfo[]
  discoverProjectCommands(cwd: string): SlashCommandInfo[]
  discoverProjectAgents(cwd: string): AgentInfo[]
}

export class ProjectResourceCache {
  private cache = new Map<string, ProjectResources>()

  constructor(private discover: DiscoverFns) {}

  get(cwd: string): ProjectResources {
    const existing = this.cache.get(cwd)
    if (existing) return existing
    const resources: ProjectResources = {
      cwd,
      skills: this.discover.discoverSkills(cwd),
      projectCommands: this.discover.discoverProjectCommands(cwd),
      projectAgents: this.discover.discoverProjectAgents(cwd),
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
