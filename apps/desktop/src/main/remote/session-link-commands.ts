import type { RemoteCommand } from '@superone/shared/agent-types'
import { getEnvironmentHost } from '../environment/environment-host'
import { resolveSessionLinkTarget, sessionLinkMetadata } from '../environment/session-links'

export async function readSessionLinkCommand(command: RemoteCommand): Promise<unknown> {
  if (command.type === 'session_link_identity') {
    const items = await getEnvironmentHost().listEnvironments({ includeDescriptors: false })
    const local = items.find(item => item.kind === 'local')
    return { environmentId: local?.environmentId, environments: items.map(item => ({ environmentId: item.environmentId, label: item.label, state: item.state })) }
  }
  if (command.type === 'session_link_metadata') return { metadata: await sessionLinkMetadata(command.refs) }
  if (command.type === 'session_link_resolve') return { target: await resolveSessionLinkTarget(command.ref) }
  throw new Error('Unsupported session link command')
}
