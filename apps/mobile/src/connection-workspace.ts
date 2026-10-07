import type { RelayClient } from '@superone/relay-client'
import type { ListHarnessOptionsResponse, RemoteHarnessOption } from '@superone/shared/agent-types'
import type { Project } from './project-types'
import { randomId } from './ids'

/** Also used before adopting a prepared connection; no source state is changed. */
export async function readConnectionWorkspace(client: RelayClient): Promise<{ projects: Project[]; options: RemoteHarnessOption[] }> {
  const [result, options] = await Promise.all([
    client.request({ type: 'list_projects', requestId: randomId() }) as Promise<{ projects?: Project[]; error?: string }>,
    client.request({ type: 'list_harness_options', requestId: randomId() })
      .then(result => {
        const response = result as ListHarnessOptionsResponse | null
        return response && !('error' in response) ? response.options : []
      }).catch(() => [] as RemoteHarnessOption[]),
  ])
  if (result.error) throw new Error(result.error)
  return { projects: result.projects ?? [], options }
}
