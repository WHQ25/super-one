import type { RelayClient } from '@superone/relay-client'
import type { HarnessId, RemoteCommand } from '@superone/shared/agent-types'
import { randomId } from './ids'
import { mergeSlashCatalogs, type SlashCommandInfo } from './slash'

export type SlashCatalogStatus = 'loading' | 'ready' | 'error'

type SystemInfoReply = { userSlashCommands?: unknown[]; slashCommands?: unknown[] }
type ProjectResourcesReply = { projectSlashCommands?: unknown[]; skills?: unknown[] }

/**
 * `/workflows` is a host command, not the agent's: it reads what this session
 * already ran. ACP agents do not report one, so it is offered here — the same
 * single-gate rule the desktop applies, and a same-named agent command wins
 * over it rather than being listed twice.
 */
const WORKFLOWS_COMMAND: SlashCommandInfo = {
  name: 'workflows',
  description: 'Show workflow runs in this session',
  argumentHint: '',
  isSkill: false,
}
/**
 * The command catalog for a project and harness, independent of any session.
 *
 * The composer needs it on the new-session landing too — a draft typed before
 * the first turn is still a draft — so this takes a project and a provider
 * rather than a live runtime. It is the same pair of calls `ChatRuntime` makes,
 * against the same host state.
 *
 * Project resources are optional: a host that cannot enumerate them still has
 * system commands worth showing, so that half degrades to empty rather than
 * failing the whole catalog.
 */
export async function requestSlashCatalog(
  client: Pick<RelayClient, 'request'>,
  projectPath: string,
  provider: HarnessId | string,
): Promise<SlashCommandInfo[]> {
  const [info, resources] = await Promise.all([
    client.request({
      type: 'get_system_info',
      requestId: randomId(),
      projectPath,
      provider: provider as HarnessId,
    } as RemoteCommand) as Promise<SystemInfoReply>,
    client.request({
      type: 'get_project_resources',
      requestId: randomId(),
      projectPath,
      provider: provider as HarnessId,
    } as RemoteCommand).catch(() => ({})) as Promise<ProjectResourcesReply>,
  ])
  const catalog = mergeSlashCatalogs(
    info?.userSlashCommands ?? info?.slashCommands ?? [],
    resources?.projectSlashCommands ?? [],
    resources?.skills ?? [],
  )
  if (provider !== 'acp' || catalog.some((command) => command.name === WORKFLOWS_COMMAND.name)) return catalog
  return [...catalog, WORKFLOWS_COMMAND]
}
