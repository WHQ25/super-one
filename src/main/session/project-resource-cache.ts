import type { AgentInfo, SlashCommandInfo } from '../../shared/agent-types'
import type { ProjectResources } from './types'

export interface DiscoverFns {
  discoverSkills(cwd: string): SlashCommandInfo[]
  discoverProjectCommands(cwd: string): SlashCommandInfo[]
  discoverProjectAgents(cwd: string): AgentInfo[]
}

export class ProjectResourceCache {
  private cache = new Map<string, ProjectResources>()

  constructor(private discover: DiscoverFns) {}

  get(projectPath: string): ProjectResources {
    const existing = this.cache.get(projectPath)
    if (existing) return existing
    const resources: ProjectResources = {
      projectPath,
      skills: this.discover.discoverSkills(projectPath),
      projectCommands: this.discover.discoverProjectCommands(projectPath),
      projectAgents: this.discover.discoverProjectAgents(projectPath),
    }
    this.cache.set(projectPath, resources)
    return resources
  }

  invalidate(projectPath: string): void {
    this.cache.delete(projectPath)
  }

  clear(): void {
    this.cache.clear()
  }
}
