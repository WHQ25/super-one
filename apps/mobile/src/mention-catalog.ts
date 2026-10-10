import { parseGitAvailability, type GitMentionCapabilities } from './git-mention'
import type { MentionSearchResult } from './mention-search'
import { parseAgentMentionItems, type MentionItem } from './mentions'

/** What `@` offers besides files: who can be asked, what is switched on, which portals work. */
export type MentionCatalog = {
  agentProfiles: MentionItem[]
  capabilityIds: unknown[]
  gitAvailability?: GitMentionCapabilities
}

type Client = object

/** Per connection, like the harness catalogs: a new device gets a new client. */
const catalogs = new WeakMap<Client, Map<string, MentionCatalog>>()

/**
 * What a host offers, from its search answer. A host that predates the field
 * answered without it; widget is the only still-supported capability known on.
 */
export function hostCapabilityIds(answer: unknown): unknown[] {
  return Array.isArray(answer) ? answer : ['widget']
}

export function peekMentionCatalog(client: Client | null, projectPath: string | undefined): MentionCatalog | undefined {
  return client && projectPath ? catalogs.get(client)?.get(projectPath) : undefined
}

/** Every search answer carries the catalog; the newest one is kept for the next `@`. */
export function rememberMentionCatalog(client: Client | null, projectPath: string | undefined, result: MentionSearchResult): MentionCatalog {
  const catalog: MentionCatalog = {
    agentProfiles: parseAgentMentionItems(result.agentTargets),
    capabilityIds: hostCapabilityIds(result.capabilityIds),
    gitAvailability: parseGitAvailability(result.gitMention),
  }
  if (client && projectPath) {
    let byProject = catalogs.get(client)
    if (!byProject) catalogs.set(client, byProject = new Map())
    byProject.set(projectPath, catalog)
  }
  return catalog
}
