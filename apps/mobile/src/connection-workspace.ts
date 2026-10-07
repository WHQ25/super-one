import type { RelayClient } from '@superone/relay-client'
import type { ListHarnessOptionsResponse, RemoteHarnessOption } from '@superone/shared/agent-types'
import type { Project } from './project-types'
import { randomId } from './ids'

/** The host's project list; also re-read when the host reports it changed. */
export async function readProjects(client: RelayClient): Promise<Project[]> {
  const result = await client.request({ type: 'list_projects', requestId: randomId() }) as { projects?: Project[]; error?: string }
  if (result.error) throw new Error(result.error)
  return result.projects ?? []
}

/** Also used before adopting a prepared connection; no source state is changed. */
export async function readConnectionWorkspace(client: RelayClient): Promise<{ projects: Project[]; options: RemoteHarnessOption[] }> {
  const [projects, options] = await Promise.all([
    readProjects(client),
    client.request({ type: 'list_harness_options', requestId: randomId() })
      .then(result => {
        const response = result as ListHarnessOptionsResponse | null
        return response && !('error' in response) ? response.options : []
      }).catch(() => [] as RemoteHarnessOption[]),
  ])
  return { projects, options }
}
