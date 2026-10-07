import type { HarnessId, ModelOption, RemoteSystemInfo } from '@superone/shared/agent-types'
import type { HarnessResourcesBundle } from '@superone/runtime/session'
import { HARNESS_LAUNCH_OPTIONS } from '@superone/shared/launch-options'
import type { EnvironmentHost } from '../environment/environment-host'
import type { RoutedSessionSnapshot } from './environment-session-view'

/** Catalogs come from the selected node; desktop defaults never cross this boundary. */
export async function routedResources(host: EnvironmentHost, connectionId: string, snapshot: RoutedSessionSnapshot, projectPath: string, view: 'get_system_info' | 'list_models' | 'get_project_resources') {
  const harness = snapshot.harnessId as HarnessId
  const bundle = await host.getRemoteHarnessResources(connectionId, { projectId: snapshot.projectId, harnessId: harness, apiProviderId: snapshot.apiProviderId }) as HarnessResourcesBundle
  if (view === 'get_project_resources') return {
    cwd: projectPath, workspaceDirs: [],
    skills: harness === 'claude' ? bundle.claude.skills : [],
    agents: harness === 'claude' ? bundle.claude.agents : harness === 'opencode' ? bundle.opencode.agents : [],
    projectSlashCommands: harness === 'claude' ? bundle.claude.commands : harness === 'opencode' ? bundle.opencode.commands : [],
  }
  let models: ModelOption[] = harness === 'claude' ? bundle.claude.models : harness === 'codex' ? bundle.codex.models : harness === 'opencode' ? bundle.opencode.models : []
  if (!models.length) models = await host.listRemoteModels(connectionId, harness, snapshot.apiProviderId) as ModelOption[]
  if (view === 'list_models') return { models }
  const profile = await host.getRemoteSessionProvider(connectionId, snapshot.providerId ?? '').catch(() => null) as { config?: { agentId?: string } } | null
  const info: RemoteSystemInfo = {
    models, providers: [], selectedProviderId: snapshot.apiProviderId ?? null,
    permissionModes: HARNESS_LAUNCH_OPTIONS[harness]?.permissionModes ?? [],
    // Existing node session settings are authoritative until the user changes them.
    defaults: { model: snapshot.model, effort: snapshot.effort, permissionMode: snapshot.permissionMode, sandboxMode: snapshot.sandboxMode },
    userSlashCommands: harness === 'codex' ? bundle.codex.prompts : harness === 'claude' ? bundle.claude.commands : [],
    slashCommands: harness === 'claude' ? bundle.claude.slashCommands : harness === 'opencode' ? bundle.opencode.commands : [],
    ...(harness === 'acp' ? { acpAgentId: profile?.config?.agentId ?? null } : {}),
  }
  return info
}
