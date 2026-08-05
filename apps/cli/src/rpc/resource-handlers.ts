/**
 * Skills + MCP management RPC handlers (desktop resource management parity).
 * Methods: skills.list|get|readFile|delete|install, mcp.list|save|toggle|delete.
 */

import {
  OPERATION_SCOPES,
  hasAllScopes,
  type AuthScope,
  type ResourceProvider,
  type RpcErrorCode,
} from '@superone/shared/environment'
import {
  deleteManagedSkill,
  deleteMcpConfig,
  getManagedSkill,
  installManagedSkill,
  listManagedSkills,
  listMcpConfigs,
  readManagedSkillFile,
  saveMcpConfig,
  toggleMcpConfig,
  getSkillDirs,
  isPathAtOrWithinAllowed,
} from '@superone/runtime/fs'
import type { AuthenticatedClient } from '../auth/auth-service'
import type { ProjectRegistry } from '../workspace/project-registry'

export interface ResourceRpcResult {
  result?: unknown
  error?: { code: RpcErrorCode; message: string; details?: Record<string, unknown> }
}

export interface ResourceRpcContext {
  client: AuthenticatedClient
  projects: ProjectRegistry
  /**
   * Override host home for skill/MCP user-scope paths (tests).
   * Production omits this so the node process home is used.
   */
  homeDir?: string
  codexHome?: string
}

function requireScopes(client: AuthenticatedClient, scopes: readonly AuthScope[]): ResourceRpcResult | null {
  if (!hasAllScopes(client.scopes, scopes)) {
    return { error: { code: 'forbidden', message: `missing scopes: ${scopes.join(', ')}` } }
  }
  return null
}

function requireResourceWrite(
  client: AuthenticatedClient,
  scope: 'user' | 'project',
): ResourceRpcResult | null {
  const denied = requireScopes(client, OPERATION_SCOPES.writeWorkspace)
  if (denied) return denied
  if (scope === 'user') return requireScopes(client, OPERATION_SCOPES.adminNode)
  return null
}

function asRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
}

function mapThrown(err: unknown): ResourceRpcResult {
  const e = err as { code?: string; message?: string }
  const code = (e.code as RpcErrorCode | undefined) ?? 'internal'
  return { error: { code, message: e.message || 'internal error' } }
}

function projectRoot(projects: ProjectRegistry, projectId: string): string {
  const p = projects.get(projectId)
  if (!p) throw Object.assign(new Error('project not found'), { code: 'not_found' })
  return p.path
}

function parseProviderStrict(raw: unknown): ResourceProvider | null {
  return raw === 'claude' || raw === 'codex' ? raw : null
}

function parseScope(raw: unknown): 'user' | 'project' | null {
  if (raw === 'user' || raw === 'project') return raw
  return null
}

function manageOpts(ctx: ResourceRpcContext): { homeDir?: string; codexHome?: string } {
  return {
    ...(ctx.homeDir ? { homeDir: ctx.homeDir } : {}),
    ...(ctx.codexHome ? { codexHome: ctx.codexHome } : {}),
  }
}

export function handleSkillsList(payload: unknown, ctx: ResourceRpcContext): ResourceRpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    const projectId = String(p.projectId ?? '')
    const cwd = projectRoot(ctx.projects, projectId)
    const provider = parseProviderStrict(p.provider)
    if (!provider) return { error: { code: 'invalid_argument', message: 'provider must be claude or codex' } }
    ctx.projects.touch(projectId)
    return {
      result: {
        skills: listManagedSkills(provider, cwd, manageOpts(ctx)),
        provider,
      },
    }
  } catch (err) {
    return mapThrown(err)
  }
}

export function handleSkillsGet(payload: unknown, ctx: ResourceRpcContext): ResourceRpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    const projectId = String(p.projectId ?? '')
    const cwd = projectRoot(ctx.projects, projectId)
    const provider = parseProviderStrict(p.provider)
    if (!provider) return { error: { code: 'invalid_argument', message: 'provider must be claude or codex' } }
    const name = String(p.name ?? '')
    if (!name) {
      return { error: { code: 'invalid_argument', message: 'name is required' } }
    }
    const sourcePath = typeof p.sourcePath === 'string' ? p.sourcePath : undefined
    ctx.projects.touch(projectId)
    return {
      result: {
        skill: getManagedSkill(provider, cwd, name, sourcePath, manageOpts(ctx)),
        provider,
      },
    }
  } catch (err) {
    return mapThrown(err)
  }
}

export function handleSkillsReadFile(payload: unknown, ctx: ResourceRpcContext): ResourceRpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    const projectId = String(p.projectId ?? '')
    const cwd = projectRoot(ctx.projects, projectId)
    const provider = parseProviderStrict(p.provider)
    if (!provider) return { error: { code: 'invalid_argument', message: 'provider must be claude or codex' } }
    const skillName = String(p.skillName ?? '')
    const relativePath = String(p.relativePath ?? '')
    if (!skillName || !relativePath) {
      return {
        error: { code: 'invalid_argument', message: 'skillName and relativePath are required' },
      }
    }
    const sourcePath = typeof p.sourcePath === 'string' ? p.sourcePath : undefined
    const content = readManagedSkillFile(
      provider,
      cwd,
      skillName,
      relativePath,
      sourcePath,
      manageOpts(ctx),
    )
    if (content == null) {
      return { error: { code: 'not_found', message: 'skill file not found' } }
    }
    ctx.projects.touch(projectId)
    return { result: { content, provider } }
  } catch (err) {
    return mapThrown(err)
  }
}

export function handleSkillsDelete(payload: unknown, ctx: ResourceRpcContext): ResourceRpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.writeWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    const projectId = String(p.projectId ?? '')
    const cwd = projectRoot(ctx.projects, projectId)
    const provider = parseProviderStrict(p.provider)
    if (!provider) return { error: { code: 'invalid_argument', message: 'provider must be claude or codex' } }
    const sourcePath = String(p.sourcePath ?? '')
    if (!sourcePath) {
      return { error: { code: 'invalid_argument', message: 'sourcePath is required' } }
    }
    const userRoots = getSkillDirs(provider, cwd, manageOpts(ctx))
      .filter((dir) => dir.scope === 'user' && !dir.readOnly && !dir.namePrefix)
      .map((dir) => dir.dir)
    if (isPathAtOrWithinAllowed(sourcePath, userRoots)) {
      const adminDenied = requireScopes(ctx.client, OPERATION_SCOPES.adminNode)
      if (adminDenied) return adminDenied
    }
    deleteManagedSkill(provider, cwd, sourcePath, manageOpts(ctx))
    ctx.projects.touch(projectId)
    return { result: { ok: true as const, provider } }
  } catch (err) {
    return mapThrown(err)
  }
}

export function handleSkillsInstall(payload: unknown, ctx: ResourceRpcContext): ResourceRpcResult {
  const baseDenied = requireScopes(ctx.client, OPERATION_SCOPES.writeWorkspace)
  if (baseDenied) return baseDenied
  const p = asRecord(payload)
  try {
    const projectId = String(p.projectId ?? '')
    const cwd = projectRoot(ctx.projects, projectId)
    const provider = parseProviderStrict(p.provider)
    if (!provider) return { error: { code: 'invalid_argument', message: 'provider must be claude or codex' } }
    const scope = parseScope(p.scope)
    if (!scope) {
      return { error: { code: 'invalid_argument', message: 'scope must be user or project' } }
    }
    const denied = requireResourceWrite(ctx.client, scope)
    if (denied) return denied
    const name = String(p.name ?? '')
    const filesRaw = p.files
    if (!filesRaw || typeof filesRaw !== 'object' || Array.isArray(filesRaw)) {
      return { error: { code: 'invalid_argument', message: 'files object is required' } }
    }
    const files: Record<string, string> = {}
    for (const [k, v] of Object.entries(filesRaw as Record<string, unknown>)) {
      if (typeof v !== 'string') {
        return { error: { code: 'invalid_argument', message: `files.${k} must be a string` } }
      }
      files[k] = v
    }
    const skill = installManagedSkill(provider, cwd, { scope, name, files }, manageOpts(ctx))
    ctx.projects.touch(projectId)
    return { result: { skill, provider } }
  } catch (err) {
    return mapThrown(err)
  }
}

export function handleMcpList(payload: unknown, ctx: ResourceRpcContext): ResourceRpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    const projectId = String(p.projectId ?? '')
    const cwd = projectRoot(ctx.projects, projectId)
    if (p.provider !== 'claude' && p.provider !== 'codex') {
      return { error: { code: 'invalid_argument', message: 'provider must be claude or codex' } }
    }
    const provider = p.provider as ResourceProvider
    ctx.projects.touch(projectId)
    const servers = listMcpConfigs(provider, cwd, manageOpts(ctx))
    // Environment variables and headers commonly contain API keys. Only node
    // administrators may read those values over the remote resource channel.
    const visibleServers = hasAllScopes(ctx.client.scopes, OPERATION_SCOPES.adminNode)
      ? servers
      : servers.map(({ env: _env, headers: _headers, ...server }) => server)
    return {
      result: {
        servers: visibleServers,
        provider,
      },
    }
  } catch (err) {
    return mapThrown(err)
  }
}

function parseMcpWriteConfig(raw: unknown): {
  ok: true
  config: Partial<{
    type: 'stdio' | 'http' | 'sse'
    command: string
    args: string[]
    env: Record<string, string>
    url: string
    headers: Record<string, string>
  }>
} | { ok: false; error: ResourceRpcResult } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      error: { error: { code: 'invalid_argument', message: 'config object is required' } },
    }
  }
  const c = raw as Record<string, unknown>
  const config: {
    type?: 'stdio' | 'http' | 'sse'
    command?: string
    args?: string[]
    env?: Record<string, string>
    url?: string
    headers?: Record<string, string>
  } = {}
  if (c.type === 'stdio' || c.type === 'http' || c.type === 'sse') {
    config.type = c.type
  }
  if (typeof c.command === 'string') config.command = c.command
  if (Array.isArray(c.args) && c.args.every((a) => typeof a === 'string')) {
    config.args = c.args as string[]
  }
  if (c.env && typeof c.env === 'object' && !Array.isArray(c.env)) {
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(c.env as Record<string, unknown>)) {
      if (typeof v === 'string') env[k] = v
    }
    config.env = env
  }
  if (typeof c.url === 'string') config.url = c.url
  if (c.headers && typeof c.headers === 'object' && !Array.isArray(c.headers)) {
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(c.headers as Record<string, unknown>)) {
      if (typeof v === 'string') headers[k] = v
    }
    config.headers = headers
  }
  return { ok: true, config }
}

export function handleMcpSave(payload: unknown, ctx: ResourceRpcContext): ResourceRpcResult {
  const baseDenied = requireScopes(ctx.client, OPERATION_SCOPES.writeWorkspace)
  if (baseDenied) return baseDenied
  const p = asRecord(payload)
  try {
    const projectId = String(p.projectId ?? '')
    const cwd = projectRoot(ctx.projects, projectId)
    if (p.provider !== 'claude' && p.provider !== 'codex') {
      return { error: { code: 'invalid_argument', message: 'provider must be claude or codex' } }
    }
    const provider = p.provider as ResourceProvider
    const scope = parseScope(p.scope)
    if (!scope) {
      return { error: { code: 'invalid_argument', message: 'scope must be user or project' } }
    }
    const denied = requireResourceWrite(ctx.client, scope)
    if (denied) return denied
    const name = String(p.name ?? '')
    if (!name) {
      return { error: { code: 'invalid_argument', message: 'name is required' } }
    }
    const parsed = parseMcpWriteConfig(p.config)
    if (!parsed.ok) return parsed.error
    saveMcpConfig(provider, name, parsed.config, scope, cwd, manageOpts(ctx))
    ctx.projects.touch(projectId)
    return { result: { ok: true as const, provider } }
  } catch (err) {
    return mapThrown(err)
  }
}

export function handleMcpToggle(payload: unknown, ctx: ResourceRpcContext): ResourceRpcResult {
  const baseDenied = requireScopes(ctx.client, OPERATION_SCOPES.writeWorkspace)
  if (baseDenied) return baseDenied
  const p = asRecord(payload)
  try {
    const projectId = String(p.projectId ?? '')
    const cwd = projectRoot(ctx.projects, projectId)
    if (p.provider !== 'claude' && p.provider !== 'codex') {
      return { error: { code: 'invalid_argument', message: 'provider must be claude or codex' } }
    }
    const provider = p.provider as ResourceProvider
    const scope = parseScope(p.scope)
    if (!scope) {
      return { error: { code: 'invalid_argument', message: 'scope must be user or project' } }
    }
    const denied = requireResourceWrite(ctx.client, scope)
    if (denied) return denied
    const name = String(p.name ?? '')
    if (!name) {
      return { error: { code: 'invalid_argument', message: 'name is required' } }
    }
    if (typeof p.disabled !== 'boolean') {
      return { error: { code: 'invalid_argument', message: 'disabled must be boolean' } }
    }
    toggleMcpConfig(provider, name, p.disabled, scope, cwd, manageOpts(ctx))
    ctx.projects.touch(projectId)
    return { result: { ok: true as const, provider } }
  } catch (err) {
    return mapThrown(err)
  }
}

export function handleMcpDelete(payload: unknown, ctx: ResourceRpcContext): ResourceRpcResult {
  const baseDenied = requireScopes(ctx.client, OPERATION_SCOPES.writeWorkspace)
  if (baseDenied) return baseDenied
  const p = asRecord(payload)
  try {
    const projectId = String(p.projectId ?? '')
    const cwd = projectRoot(ctx.projects, projectId)
    if (p.provider !== 'claude' && p.provider !== 'codex') {
      return { error: { code: 'invalid_argument', message: 'provider must be claude or codex' } }
    }
    const provider = p.provider as ResourceProvider
    const scope = parseScope(p.scope)
    if (!scope) {
      return { error: { code: 'invalid_argument', message: 'scope must be user or project' } }
    }
    const denied = requireResourceWrite(ctx.client, scope)
    if (denied) return denied
    const name = String(p.name ?? '')
    if (!name) {
      return { error: { code: 'invalid_argument', message: 'name is required' } }
    }
    deleteMcpConfig(provider, name, scope, cwd, manageOpts(ctx))
    ctx.projects.touch(projectId)
    return { result: { ok: true as const, provider } }
  } catch (err) {
    return mapThrown(err)
  }
}

/** Route skills.* / mcp.* methods. Returns null if method is not a resource method. */
export function dispatchResourceRpc(
  method: string,
  payload: unknown,
  ctx: ResourceRpcContext,
): ResourceRpcResult | null {
  switch (method) {
    case 'skills.list':
      return handleSkillsList(payload, ctx)
    case 'skills.get':
      return handleSkillsGet(payload, ctx)
    case 'skills.readFile':
      return handleSkillsReadFile(payload, ctx)
    case 'skills.delete':
      return handleSkillsDelete(payload, ctx)
    case 'skills.install':
      return handleSkillsInstall(payload, ctx)
    case 'mcp.list':
      return handleMcpList(payload, ctx)
    case 'mcp.save':
      return handleMcpSave(payload, ctx)
    case 'mcp.toggle':
      return handleMcpToggle(payload, ctx)
    case 'mcp.delete':
      return handleMcpDelete(payload, ctx)
    default:
      return null
  }
}

export const RESOURCE_MUTATING_METHODS = [
  'skills.delete',
  'skills.install',
  'mcp.save',
  'mcp.toggle',
  'mcp.delete',
] as const
