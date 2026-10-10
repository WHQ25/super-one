import type { ProjectRef } from '@superone/shared/environment/refs'
import type { ProjectSnapshot } from '@superone/shared/environment/events'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import type { PhoneRpcOptions } from './phone-protocol'

type CatalogRpc = <T>(method: string, payload?: unknown, options?: PhoneRpcOptions) => Promise<T>

/** Resolve a shell's project key through the paired host's authenticated catalogs. */
export class PhoneProjectCatalog {
  private readonly lists = new Map<string, Promise<ProjectSnapshot[]>>()
  constructor(private readonly rpc: CatalogRpc, private readonly environmentId: () => string) {}

  private list(environmentId: string): Promise<ProjectSnapshot[]> {
    let list = this.lists.get(environmentId)
    if (!list) {
      list = this.rpc<ProjectSnapshot[]>('project.list', {}, { environmentId })
      this.lists.set(environmentId, list)
      void list.catch(() => { if (this.lists.get(environmentId) === list) this.lists.delete(environmentId) })
    }
    return list
  }

  async resolve(key: string): Promise<ProjectRef> {
    const remote = parseRemoteProjectKey(key)
    let environmentId = this.environmentId()
    if (remote) {
      const catalog = await this.rpc<{ environments: Array<{ connectionId: string; environmentId: string }> }>('environment.list')
      const target = catalog.environments.find(item => item.connectionId === remote.connectionId)
      if (!target) throw Object.assign(new Error('Project environment is no longer paired'), { code: 'not_found' })
      environmentId = target.environmentId
    }
    const wasCached = this.lists.has(environmentId)
    let list = this.list(environmentId)
    const find = (projects: ProjectSnapshot[]) => projects.find(item => item.path === (remote?.path ?? key))
    let project = find(await list)
    if (!project && wasCached) {
      if (this.lists.get(environmentId) === list) this.lists.delete(environmentId)
      list = this.list(environmentId)
      project = find(await list)
    }
    if (!project) {
      if (this.lists.get(environmentId) === list) this.lists.delete(environmentId)
      throw Object.assign(new Error('Project is no longer registered'), { code: 'not_found' })
    }
    return { environmentId, projectId: project.projectId }
  }

  invalidate(): void { this.lists.clear() }
}
