/**
 * Settings Skills/MCP ops: when the active project is remote, prefer node
 * `skills.*` / `mcp.*` via `window.environment` resource APIs; otherwise local
 * `window.app` FS services.
 *
 * Main EnvironmentHost + RemoteEnvironmentGateway own the RPC. Preferred path
 * is dedicated `listRemoteSkills` / `listRemoteMcpConfigs` etc. on
 * `window.environment`. When preload has not yet exposed those wrappers,
 * fall back to `window.electron.ipcRenderer.invoke` with the matching
 * `AgentIpcChannels.ENVIRONMENT_*` constants (handlers are registered from
 * the environment package).
 */

import { AgentIpcChannels } from '@superone/shared/agent-types'
import type {
  McpServerConfig,
  ResourceScope,
  SkillDetail,
  SkillInfo,
} from '@superone/shared/agent-types'
import { parseRemoteProjectKey } from './remote-project-key'

export type ResourceProviderId = 'claude' | 'codex'

/** Injectable environment surface for tests (window.environment subset). */
export interface RemoteResourceEnvironmentApi {
  listProjects?(
    connectionId: string,
    options?: { refresh?: boolean },
  ): Promise<Array<{ projectId: string; path: string }>>
  openProject?(
    connectionId: string,
    projectPath: string,
    opts?: { createIfMissing?: boolean },
  ): Promise<{ projectId: string; path: string }>
  listRemoteSkills?(
    connectionId: string,
    projectId: string,
    provider: ResourceProviderId,
  ): Promise<{ skills?: SkillInfo[] } | SkillInfo[] | unknown>
  getRemoteSkill?(
    connectionId: string,
    projectId: string,
    name: string,
    opts?: { sourcePath?: string; provider?: ResourceProviderId },
  ): Promise<{ skill?: SkillDetail | null } | SkillDetail | null | unknown>
  readRemoteSkillFile?(
    connectionId: string,
    projectId: string,
    skillName: string,
    relativePath: string,
    opts?: { sourcePath?: string; provider?: ResourceProviderId },
  ): Promise<{ content?: string } | string | null | unknown>
  deleteRemoteSkill?(
    connectionId: string,
    projectId: string,
    sourcePath: string,
    provider: ResourceProviderId,
  ): Promise<unknown>
  installRemoteSkill?(
    connectionId: string,
    projectId: string,
    input: {
      scope: 'user' | 'project'
      name: string
      files: Record<string, string>
      provider?: ResourceProviderId
    },
  ): Promise<unknown>
  listRemoteMcpConfigs?(
    connectionId: string,
    projectId: string,
    provider: ResourceProviderId,
  ): Promise<{ servers?: McpServerConfig[] } | McpServerConfig[] | unknown>
  saveRemoteMcpConfig?(
    connectionId: string,
    projectId: string,
    input: {
      provider: ResourceProviderId
      name: string
      scope: Extract<ResourceScope, 'user' | 'project'>
      config: Record<string, unknown>
    },
  ): Promise<unknown>
  toggleRemoteMcpConfig?(
    connectionId: string,
    projectId: string,
    input: {
      provider: ResourceProviderId
      name: string
      scope: Extract<ResourceScope, 'user' | 'project'>
      disabled: boolean
    },
  ): Promise<unknown>
  deleteRemoteMcpConfig?(
    connectionId: string,
    projectId: string,
    input: {
      provider: ResourceProviderId
      name: string
      scope: Extract<ResourceScope, 'user' | 'project'>
    },
  ): Promise<unknown>
}

export function isRemoteProjectPath(projectPath: string): boolean {
  return parseRemoteProjectKey(projectPath) != null
}

export function selectResourceTransport(
  projectPath: string,
  env?: RemoteResourceEnvironmentApi | null,
): 'remote-rpc' | 'local-fs' {
  if (!isRemoteProjectPath(projectPath)) return 'local-fs'
  // Remote project → node RPC path (gateway/host). Methods may be polyfilled
  // via electron.ipcRenderer when preload wrappers are missing.
  void env
  return 'remote-rpc'
}

type IpcInvoke = (channel: string, ...args: unknown[]) => Promise<unknown>

function getElectronIpcInvoke(): IpcInvoke | null {
  if (typeof window === 'undefined') return null
  const electron = (window as unknown as { electron?: { ipcRenderer?: { invoke?: IpcInvoke } } })
    .electron
  const invoke = electron?.ipcRenderer?.invoke
  return typeof invoke === 'function' ? invoke.bind(electron!.ipcRenderer) : null
}

/** Build resource methods that invoke Main ENVIRONMENT_* channels. */
export function createIpcBackedResourceApi(
  invoke: IpcInvoke,
  base: RemoteResourceEnvironmentApi = {},
): RemoteResourceEnvironmentApi {
  return {
    listProjects: base.listProjects,
    openProject: base.openProject,
    listRemoteSkills:
      base.listRemoteSkills ??
      ((connectionId, projectId, provider) =>
        invoke(AgentIpcChannels.ENVIRONMENT_LIST_REMOTE_SKILLS, connectionId, projectId, provider)),
    getRemoteSkill:
      base.getRemoteSkill ??
      ((connectionId, projectId, name, opts) =>
        invoke(
          AgentIpcChannels.ENVIRONMENT_GET_REMOTE_SKILL,
          connectionId,
          projectId,
          name,
          opts,
        )),
    readRemoteSkillFile:
      base.readRemoteSkillFile ??
      ((connectionId, projectId, skillName, relativePath, opts) =>
        invoke(
          AgentIpcChannels.ENVIRONMENT_READ_REMOTE_SKILL_FILE,
          connectionId,
          projectId,
          skillName,
          relativePath,
          opts,
        )),
    deleteRemoteSkill:
      base.deleteRemoteSkill ??
      ((connectionId, projectId, sourcePath, provider) =>
        invoke(
          AgentIpcChannels.ENVIRONMENT_DELETE_REMOTE_SKILL,
          connectionId,
          projectId,
          sourcePath,
          provider,
        )),
    installRemoteSkill:
      base.installRemoteSkill ??
      ((connectionId, projectId, input) =>
        invoke(
          AgentIpcChannels.ENVIRONMENT_INSTALL_REMOTE_SKILL,
          connectionId,
          projectId,
          input,
        )),
    listRemoteMcpConfigs:
      base.listRemoteMcpConfigs ??
      ((connectionId, projectId, provider) =>
        invoke(
          AgentIpcChannels.ENVIRONMENT_LIST_REMOTE_MCP_CONFIGS,
          connectionId,
          projectId,
          provider,
        )),
    saveRemoteMcpConfig:
      base.saveRemoteMcpConfig ??
      ((connectionId, projectId, input) =>
        invoke(
          AgentIpcChannels.ENVIRONMENT_SAVE_REMOTE_MCP_CONFIG,
          connectionId,
          projectId,
          input,
        )),
    toggleRemoteMcpConfig:
      base.toggleRemoteMcpConfig ??
      ((connectionId, projectId, input) =>
        invoke(
          AgentIpcChannels.ENVIRONMENT_TOGGLE_REMOTE_MCP_CONFIG,
          connectionId,
          projectId,
          input,
        )),
    deleteRemoteMcpConfig:
      base.deleteRemoteMcpConfig ??
      ((connectionId, projectId, input) =>
        invoke(
          AgentIpcChannels.ENVIRONMENT_DELETE_REMOTE_MCP_CONFIG,
          connectionId,
          projectId,
          input,
        )),
  }
}

function asSkillList(raw: unknown): SkillInfo[] {
  if (Array.isArray(raw)) return raw as SkillInfo[]
  if (raw && typeof raw === 'object' && Array.isArray((raw as { skills?: unknown }).skills)) {
    return (raw as { skills: SkillInfo[] }).skills
  }
  return []
}

function asMcpList(raw: unknown): McpServerConfig[] {
  if (Array.isArray(raw)) return raw as McpServerConfig[]
  if (raw && typeof raw === 'object' && Array.isArray((raw as { servers?: unknown }).servers)) {
    return (raw as { servers: McpServerConfig[] }).servers
  }
  return []
}

function asSkillDetail(raw: unknown): SkillDetail | null {
  if (!raw) return null
  if (typeof raw === 'object' && 'skill' in (raw as object)) {
    return ((raw as { skill?: SkillDetail | null }).skill ?? null) as SkillDetail | null
  }
  if (typeof raw === 'object' && 'name' in (raw as object)) return raw as SkillDetail
  return null
}

function asSkillFileContent(raw: unknown): string | null {
  if (typeof raw === 'string') return raw
  if (raw && typeof raw === 'object' && typeof (raw as { content?: unknown }).content === 'string') {
    return (raw as { content: string }).content
  }
  return null
}

async function resolveRemoteProjectId(
  env: RemoteResourceEnvironmentApi,
  connectionId: string,
  hostPath: string,
): Promise<string | null> {
  const list = env.listProjects ? await env.listProjects(connectionId) : []
  const projects = Array.isArray(list) ? list : []
  const hit = projects.find(
    (p) => p.path === hostPath || p.path.replace(/\/$/, '') === hostPath.replace(/\/$/, ''),
  )
  if (hit?.projectId) return hit.projectId
  if (env.openProject) {
    const opened = await env.openProject(connectionId, hostPath, { createIfMissing: true })
    return opened?.projectId ?? null
  }
  return null
}

export async function fetchSkillsForProject(opts: {
  projectPath: string
  provider: ResourceProviderId
  env?: RemoteResourceEnvironmentApi | null
  localListSkills: (projectPath: string) => Promise<SkillInfo[]>
  localListCodexSkills: (projectPath: string) => Promise<SkillInfo[]>
}): Promise<SkillInfo[]> {
  const transport = selectResourceTransport(opts.projectPath, opts.env)
  if (transport === 'local-fs') {
    return opts.provider === 'codex'
      ? opts.localListCodexSkills(opts.projectPath)
      : opts.localListSkills(opts.projectPath)
  }

  const remote = parseRemoteProjectKey(opts.projectPath)!
  const env = opts.env
  if (env?.listRemoteSkills) {
    const projectId = await resolveRemoteProjectId(env, remote.connectionId, remote.path)
    if (projectId) {
      const raw = await env.listRemoteSkills(remote.connectionId, projectId, opts.provider)
      return asSkillList(raw)
    }
  }
  // Fallback: agent-service listSkills already remote-routes via workspace.listSkills.
  return opts.provider === 'codex'
    ? opts.localListCodexSkills(opts.projectPath)
    : opts.localListSkills(opts.projectPath)
}

export async function fetchMcpConfigsForProject(opts: {
  projectPath: string
  provider: ResourceProviderId
  env?: RemoteResourceEnvironmentApi | null
  localListMcp: (projectPath: string) => Promise<McpServerConfig[]>
  localListCodexMcp: (projectPath: string) => Promise<McpServerConfig[]>
}): Promise<McpServerConfig[]> {
  const transport = selectResourceTransport(opts.projectPath, opts.env)
  if (transport === 'local-fs') {
    return opts.provider === 'codex'
      ? opts.localListCodexMcp(opts.projectPath)
      : opts.localListMcp(opts.projectPath)
  }

  const remote = parseRemoteProjectKey(opts.projectPath)!
  const env = opts.env
  if (env?.listRemoteMcpConfigs) {
    const projectId = await resolveRemoteProjectId(env, remote.connectionId, remote.path)
    if (projectId) {
      const raw = await env.listRemoteMcpConfigs(remote.connectionId, projectId, opts.provider)
      return asMcpList(raw)
    }
  }
  // Without environment resource methods, avoid local FS against remote: keys.
  return []
}

export async function saveMcpConfigForProject(opts: {
  projectPath: string
  provider: ResourceProviderId
  name: string
  config: Record<string, unknown>
  scope: Extract<ResourceScope, 'user' | 'project'>
  env?: RemoteResourceEnvironmentApi | null
  localSave: (
    projectPath: string,
    name: string,
    config: Record<string, unknown>,
    scope: Extract<ResourceScope, 'user' | 'project'>,
  ) => Promise<void>
  localCodexSave: (
    projectPath: string,
    name: string,
    config: Record<string, unknown>,
    scope: Extract<ResourceScope, 'user' | 'project'>,
  ) => Promise<void>
}): Promise<'remote-rpc' | 'local-fs'> {
  const transport = selectResourceTransport(opts.projectPath, opts.env)
  if (transport === 'local-fs') {
    if (opts.provider === 'codex') {
      await opts.localCodexSave(opts.projectPath, opts.name, opts.config, opts.scope)
    } else {
      await opts.localSave(opts.projectPath, opts.name, opts.config, opts.scope)
    }
    return 'local-fs'
  }

  const remote = parseRemoteProjectKey(opts.projectPath)!
  const env = opts.env
  if (!env?.saveRemoteMcpConfig) {
    throw new Error('remote MCP save requires environment resource RPC (node mcp.save)')
  }
  const projectId = await resolveRemoteProjectId(env, remote.connectionId, remote.path)
  if (!projectId) throw new Error('remote project not found for MCP save')
  await env.saveRemoteMcpConfig(remote.connectionId, projectId, {
    provider: opts.provider,
    name: opts.name,
    scope: opts.scope,
    config: opts.config,
  })
  return 'remote-rpc'
}

export async function toggleMcpConfigForProject(opts: {
  projectPath: string
  provider: ResourceProviderId
  name: string
  disabled: boolean
  scope: Extract<ResourceScope, 'user' | 'project'>
  env?: RemoteResourceEnvironmentApi | null
  localToggle: (
    projectPath: string,
    name: string,
    disabled: boolean,
    scope: Extract<ResourceScope, 'user' | 'project'>,
  ) => Promise<void>
  localCodexToggle: (
    projectPath: string,
    name: string,
    disabled: boolean,
    scope: Extract<ResourceScope, 'user' | 'project'>,
  ) => Promise<void>
}): Promise<'remote-rpc' | 'local-fs'> {
  const transport = selectResourceTransport(opts.projectPath, opts.env)
  if (transport === 'local-fs') {
    if (opts.provider === 'codex') {
      await opts.localCodexToggle(opts.projectPath, opts.name, opts.disabled, opts.scope)
    } else {
      await opts.localToggle(opts.projectPath, opts.name, opts.disabled, opts.scope)
    }
    return 'local-fs'
  }

  const remote = parseRemoteProjectKey(opts.projectPath)!
  const env = opts.env
  if (!env?.toggleRemoteMcpConfig) {
    throw new Error('remote MCP toggle requires environment resource RPC (node mcp.toggle)')
  }
  const projectId = await resolveRemoteProjectId(env, remote.connectionId, remote.path)
  if (!projectId) throw new Error('remote project not found for MCP toggle')
  await env.toggleRemoteMcpConfig(remote.connectionId, projectId, {
    provider: opts.provider,
    name: opts.name,
    scope: opts.scope,
    disabled: opts.disabled,
  })
  return 'remote-rpc'
}

export async function deleteMcpConfigForProject(opts: {
  projectPath: string
  provider: ResourceProviderId
  name: string
  scope: Extract<ResourceScope, 'user' | 'project'>
  env?: RemoteResourceEnvironmentApi | null
  localDelete: (
    projectPath: string,
    name: string,
    scope: Extract<ResourceScope, 'user' | 'project'>,
  ) => Promise<void>
  localCodexDelete: (
    projectPath: string,
    name: string,
    scope: Extract<ResourceScope, 'user' | 'project'>,
  ) => Promise<void>
}): Promise<'remote-rpc' | 'local-fs'> {
  const transport = selectResourceTransport(opts.projectPath, opts.env)
  if (transport === 'local-fs') {
    if (opts.provider === 'codex') {
      await opts.localCodexDelete(opts.projectPath, opts.name, opts.scope)
    } else {
      await opts.localDelete(opts.projectPath, opts.name, opts.scope)
    }
    return 'local-fs'
  }

  const remote = parseRemoteProjectKey(opts.projectPath)!
  const env = opts.env
  if (!env?.deleteRemoteMcpConfig) {
    throw new Error('remote MCP delete requires environment resource RPC (node mcp.delete)')
  }
  const projectId = await resolveRemoteProjectId(env, remote.connectionId, remote.path)
  if (!projectId) throw new Error('remote project not found for MCP delete')
  await env.deleteRemoteMcpConfig(remote.connectionId, projectId, {
    provider: opts.provider,
    name: opts.name,
    scope: opts.scope,
  })
  return 'remote-rpc'
}

export async function getSkillForProject(opts: {
  projectPath: string
  provider: ResourceProviderId
  name: string
  sourcePath?: string
  env?: RemoteResourceEnvironmentApi | null
  localRead: (projectPath: string, name: string, sourcePath?: string) => Promise<SkillDetail | null>
  localCodexRead: (
    projectPath: string,
    name: string,
    sourcePath?: string,
  ) => Promise<SkillDetail | null>
}): Promise<SkillDetail | null> {
  const transport = selectResourceTransport(opts.projectPath, opts.env)
  if (transport === 'local-fs') {
    return opts.provider === 'codex'
      ? opts.localCodexRead(opts.projectPath, opts.name, opts.sourcePath)
      : opts.localRead(opts.projectPath, opts.name, opts.sourcePath)
  }
  const remote = parseRemoteProjectKey(opts.projectPath)!
  const env = opts.env
  // Fail closed: never read local FS for a remote: project key.
  if (!env?.getRemoteSkill) return null
  const projectId = await resolveRemoteProjectId(env, remote.connectionId, remote.path)
  if (!projectId) return null
  const raw = await env.getRemoteSkill(remote.connectionId, projectId, opts.name, {
    sourcePath: opts.sourcePath,
    provider: opts.provider,
  })
  return asSkillDetail(raw)
}

export async function readSkillFileForProject(opts: {
  projectPath: string
  provider: ResourceProviderId
  skillName: string
  relativePath: string
  sourcePath?: string
  env?: RemoteResourceEnvironmentApi | null
  localRead: (
    projectPath: string,
    skillName: string,
    relativePath: string,
    sourcePath?: string,
  ) => Promise<string | null>
  localCodexRead: (
    projectPath: string,
    skillName: string,
    relativePath: string,
    sourcePath?: string,
  ) => Promise<string | null>
}): Promise<string | null> {
  const transport = selectResourceTransport(opts.projectPath, opts.env)
  if (transport === 'local-fs') {
    return opts.provider === 'codex'
      ? opts.localCodexRead(opts.projectPath, opts.skillName, opts.relativePath, opts.sourcePath)
      : opts.localRead(opts.projectPath, opts.skillName, opts.relativePath, opts.sourcePath)
  }
  const remote = parseRemoteProjectKey(opts.projectPath)!
  const env = opts.env
  // Fail closed: never read local FS for a remote: project key.
  if (!env?.readRemoteSkillFile) return null
  const projectId = await resolveRemoteProjectId(env, remote.connectionId, remote.path)
  if (!projectId) return null
  const raw = await env.readRemoteSkillFile(
    remote.connectionId,
    projectId,
    opts.skillName,
    opts.relativePath,
    { sourcePath: opts.sourcePath, provider: opts.provider },
  )
  return asSkillFileContent(raw)
}

export async function deleteSkillForProject(opts: {
  projectPath: string
  provider: ResourceProviderId
  sourcePath: string
  env?: RemoteResourceEnvironmentApi | null
  localDelete: (projectPath: string, sourcePath: string) => Promise<void>
  localCodexDelete: (projectPath: string, sourcePath: string) => Promise<void>
}): Promise<'remote-rpc' | 'local-fs'> {
  const transport = selectResourceTransport(opts.projectPath, opts.env)
  if (transport === 'local-fs') {
    if (opts.provider === 'codex') {
      await opts.localCodexDelete(opts.projectPath, opts.sourcePath)
    } else {
      await opts.localDelete(opts.projectPath, opts.sourcePath)
    }
    return 'local-fs'
  }
  const remote = parseRemoteProjectKey(opts.projectPath)!
  const env = opts.env
  if (!env?.deleteRemoteSkill) {
    throw new Error('remote skill delete requires environment resource RPC (node skills.delete)')
  }
  const projectId = await resolveRemoteProjectId(env, remote.connectionId, remote.path)
  if (!projectId) throw new Error('remote project not found for skill delete')
  await env.deleteRemoteSkill(remote.connectionId, projectId, opts.sourcePath, opts.provider)
  return 'remote-rpc'
}

/**
 * Install a skill onto a remote node from an already-packed file map.
 * Local install still uses window.app.installSkill(sourcePath) (folder picker).
 */
export async function installSkillForRemoteProject(opts: {
  projectPath: string
  provider: ResourceProviderId
  scope: 'user' | 'project'
  name: string
  files: Record<string, string>
  env?: RemoteResourceEnvironmentApi | null
}): Promise<'remote-rpc'> {
  if (selectResourceTransport(opts.projectPath, opts.env) !== 'remote-rpc') {
    throw new Error('installSkillForRemoteProject requires a remote project path')
  }
  const remote = parseRemoteProjectKey(opts.projectPath)!
  const env = opts.env
  if (!env?.installRemoteSkill) {
    throw new Error('remote skill install requires environment resource RPC (node skills.install)')
  }
  const projectId = await resolveRemoteProjectId(env, remote.connectionId, remote.path)
  if (!projectId) throw new Error('remote project not found for skill install')
  await env.installRemoteSkill(remote.connectionId, projectId, {
    scope: opts.scope,
    name: opts.name,
    files: opts.files,
    provider: opts.provider,
  })
  return 'remote-rpc'
}

/**
 * Read environment API from window when available.
 * Polyfills missing Skills/MCP methods via electron.ipcRenderer so production
 * works before preload grows dedicated wrappers.
 */
export function getWindowEnvironmentApi(): RemoteResourceEnvironmentApi | null {
  if (typeof window === 'undefined') return null
  const env = (window as unknown as { environment?: RemoteResourceEnvironmentApi }).environment
  const invoke = getElectronIpcInvoke()
  if (!env && !invoke) return null
  if (invoke) {
    return createIpcBackedResourceApi(invoke, {
      listProjects: env?.listProjects?.bind(env),
      openProject: env?.openProject?.bind(env),
      listRemoteSkills: env?.listRemoteSkills?.bind(env),
      getRemoteSkill: env?.getRemoteSkill?.bind(env),
      readRemoteSkillFile: env?.readRemoteSkillFile?.bind(env),
      deleteRemoteSkill: env?.deleteRemoteSkill?.bind(env),
      installRemoteSkill: env?.installRemoteSkill?.bind(env),
      listRemoteMcpConfigs: env?.listRemoteMcpConfigs?.bind(env),
      saveRemoteMcpConfig: env?.saveRemoteMcpConfig?.bind(env),
      toggleRemoteMcpConfig: env?.toggleRemoteMcpConfig?.bind(env),
      deleteRemoteMcpConfig: env?.deleteRemoteMcpConfig?.bind(env),
    })
  }
  return env ?? null
}
