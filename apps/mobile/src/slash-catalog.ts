import type { RelayClient } from '@superone/relay-client'
import type { HarnessId } from '@superone/shared/agent-types'
import { peekHarnessResource, requestHarnessResource } from './harness-resource-cache'
import { mergeSlashCatalogs, type SlashCommandInfo } from './slash'
import { harnessSupportsAdditionalDirs } from './provider-state'

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
 * `/add-dir` is a host command too, over a harness-neutral folder set — the
 * desktop offers it from one gate rather than copying it into every catalog
 * that happens to accept extra roots, and so does this.
 *
 * Both scopes are editable, as in the desktop popup: project folders persist
 * and every session inherits them, session folders end with the session. Either
 * reaches a running session on its next turn, which recomputes its directory
 * set — nothing has to be resent. The panel itself is a projection of this
 * command's line; see `add-dir-state.ts`.
 */
const ADD_DIR_COMMAND: SlashCommandInfo = {
  name: 'add-dir',
  description: 'Manage additional working directories',
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
  provider: HarnessId,
): Promise<SlashCommandInfo[]> {
  const [info, resources] = await Promise.all([
    requestHarnessResource(client, 'get_system_info', projectPath, provider),
    requestHarnessResource(client, 'get_project_resources', projectPath, provider).catch(() => ({})),
  ])
  return buildCatalog(info, resources, provider)
}

export function peekSlashCatalog(client: Pick<RelayClient, 'request'>, projectPath: string, provider: HarnessId) {
  const info = peekHarnessResource(client, 'get_system_info', projectPath, provider)
  const resources = peekHarnessResource(client, 'get_project_resources', projectPath, provider)
  return info && resources ? buildCatalog(info, resources, provider) : undefined
}

function buildCatalog(info: SystemInfoReply, resources: ProjectResourcesReply, provider: HarnessId): SlashCommandInfo[] {
  const catalog = mergeSlashCatalogs(
    info?.userSlashCommands ?? info?.slashCommands ?? [],
    resources?.projectSlashCommands ?? [],
    resources?.skills ?? [],
  )
  return withHostCommand(
    withHostCommand(catalog, WORKFLOWS_COMMAND, provider === 'acp'),
    ADD_DIR_COMMAND,
    harnessSupportsAdditionalDirs(provider),
  )
}

/** Offer a host command where the capability is real, and never twice. */
function withHostCommand(
  catalog: SlashCommandInfo[],
  command: SlashCommandInfo,
  offered: boolean,
): SlashCommandInfo[] {
  if (!offered || catalog.some((entry) => entry.name === command.name)) return catalog
  return [...catalog, command]
}
