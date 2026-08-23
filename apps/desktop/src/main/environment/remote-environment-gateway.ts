import { randomUUID } from 'node:crypto'
import type {
  ControlLease,
  CreateSessionInput,
  CreateTerminalInput,
  DraftGateway,
  DraftListResult,
  DraftUpsertResult,
  EnvironmentEventEnvelope,
  EnvironmentGateway,
  EnvironmentSnapshot,
  ExecutionEnvironmentDescriptor,
  InteractionGateway,
  LeaseAcquireInput,
  LeaseReleaseInput,
  LeaseRenewInput,
  MutatingControlContext,
  PermissionResponseInput,
  PlanResponseInput,
  ProjectRef,
  ProjectSnapshot,
  QuestionResponseInput,
  SendMessageInput,
  SessionGateway,
  SessionMessagesListResult,
  SessionRef,
  SubscribeEventsInput,
  TerminalGateway,
  TerminalRef,
  TerminalResizeInput,
  TerminalWriteInput,
  WorkspaceDeleteInput,
  WorkspaceEntry,
  WorkspaceGateway,
  WorkspaceListInput,
  WorkspaceMkdirInput,
  WorkspaceMoveInput,
  WorkspaceReadInput,
  WorkspaceRenameInput,
  WorkspaceSearchInput,
  WorkspaceWatchInput,
  WorkspaceWriteInput,
  ResourceProvider,
} from '@superone/shared/environment'
import type { ProjectExtraDirsPatch } from '@superone/shared/project-extra-dirs'
import type { NodeRpcClient } from './node-rpc-client'
import type { CodexMcpOauthLoginOptions } from '@superone/shared/agent-types'

/**
 * Environment gateway that delegates to an authenticated node RPC session.
 * Sessions, interactions, terminals, and workspace (incl. watch) all go over RPC.
 */
export class RemoteEnvironmentGateway implements EnvironmentGateway {
  readonly sessions: SessionGateway
  readonly interactions: InteractionGateway
  readonly terminals: TerminalGateway
  readonly workspace: WorkspaceGateway
  readonly drafts: DraftGateway

  private descriptorCache: ExecutionEnvironmentDescriptor | null = null
  private fixedEnvironmentId: string | null = null

  constructor(private readonly client: NodeRpcClient) {
    this.sessions = this.createSessionGateway()
    this.interactions = this.createInteractionGateway()
    this.terminals = this.createTerminalGateway()
    this.workspace = this.createWorkspaceGateway()
    this.drafts = this.createDraftGateway()
  }

  /**
   * Drafts for a remote project live on that node — never mirrored here, so a
   * disconnected node simply has no drafts to show rather than a stale copy.
   */
  private createDraftGateway(): DraftGateway {
    const client = this.client
    return {
      async list(input) {
        const res = await client.rpc<DraftListResult>('draft.list', input ?? {})
        return res.drafts ?? []
      },
      async upsert(input) {
        const res = await client.rpc<DraftUpsertResult>('draft.upsert', input)
        return res.draft
      },
      async delete(draftId) {
        await client.rpc('draft.delete', { draftId })
      },
    }
  }

  private assertEnv(environmentId: string): void {
    if (this.fixedEnvironmentId && environmentId !== this.fixedEnvironmentId) {
      throw Object.assign(
        new Error(
          `environment mismatch: gateway bound to ${this.fixedEnvironmentId}, got ${environmentId}`,
        ),
        { code: 'environment_mismatch' },
      )
    }
  }

  async getDescriptor(): Promise<ExecutionEnvironmentDescriptor> {
    this.descriptorCache = await this.client.getDescriptor()
    this.fixedEnvironmentId = this.descriptorCache.environmentId
    return this.descriptorCache
  }

  async listProjects(): Promise<ProjectSnapshot[]> {
    return this.client.rpc<ProjectSnapshot[]>('project.list')
  }

  async getProject(projectId: string): Promise<ProjectSnapshot | null> {
    return this.client.rpc<ProjectSnapshot | null>('project.get', { projectId })
  }

  async getSnapshot(): Promise<EnvironmentSnapshot> {
    const snap = await this.client.rpc<{
      environmentId: string
      snapshotSequence: string
      sessions: unknown[]
      capturedAt: number
    }>('session.snapshot')
    const projects = await this.listProjects()
    return {
      environmentId: snap.environmentId,
      snapshotSequence: snap.snapshotSequence,
      capturedAt: snap.capturedAt,
      projects,
      sessions: (snap.sessions as EnvironmentSnapshot['sessions']) ?? [],
      terminals: [],
      pendingInteractions: [],
    }
  }

  /**
   * One-shot poll of the durable environment event log after `afterSequence`
   * (exclusive). Prefer this over `subscribeEvents` when the caller owns the
   * poll loop (e.g. remote chat turn drain → AgentEvent mapping).
   */
  async listEvents(afterSequence = '0'): Promise<EnvironmentEventEnvelope[]> {
    const res = await this.client.rpc<{ events: EnvironmentEventEnvelope[] }>('session.events', {
      afterSequence,
    })
    return Array.isArray(res?.events) ? res.events : []
  }

  /**
   * Head sequence of the durable environment event log (inclusive).
   * Use as the exclusive `afterSequence` for {@link listEvents} so a turn drain
   * starts at the true tail — not the end of the first page (limit 1000).
   */
  async eventHeadSequence(): Promise<string> {
    const snap = await this.client.rpc<{ snapshotSequence?: string }>('session.snapshot')
    const seq = snap?.snapshotSequence
    return typeof seq === 'string' && seq.length > 0 ? seq : '0'
  }

  async *subscribeEvents(input: SubscribeEventsInput): AsyncIterable<EnvironmentEventEnvelope> {
    let after = input.afterSequence ?? '0'
    // Poll durable event log (WS push can replace this later).
    for (;;) {
      const batch = await this.listEvents(after)
      for (const ev of batch) {
        after = ev.sequence
        yield ev
      }
      await new Promise((r) => setTimeout(r, 100))
    }
  }

  async health() {
    return this.client.health()
  }

  async systemInfo() {
    return this.client.systemInfo()
  }

  async openProject(
    path: string,
    name?: string,
    createIfMissing?: boolean,
  ): Promise<ProjectSnapshot> {
    return this.client.rpc('project.open', { path, name, createIfMissing })
  }

  /** Unregister a project on the remote node (does not delete disk files). */
  async removeProject(input: {
    projectId?: string
    path?: string
  }): Promise<ProjectSnapshot> {
    return this.client.rpc('project.remove', input)
  }

  /** Edit Project: rename and/or set workspace folders on the remote node. */
  async updateProject(input: ProjectExtraDirsPatch & {
    projectId?: string
    path?: string
    name?: string
  }): Promise<ProjectSnapshot> {
    return this.client.rpc('project.update', input)
  }

  /** List child directories at an absolute host path (add-project browser). */
  async listHostDir(
    absolutePath: string,
  ): Promise<{ path: string; entries: Array<{ name: string; path: string; type: 'directory' }> }> {
    return this.client.rpc('fs.listDir', { path: absolutePath })
  }

  /** Clone a repository on the remote host and register it as a project there. */
  async cloneRepository(input: {
    remoteUrl: string
    parentPath: string
    directoryName?: string
    shallow?: boolean
  }): Promise<ProjectSnapshot> {
    return this.client.rpc('git.clone', input)
  }

  async gitStatus(projectId: string, opts?: { cwd?: string }): Promise<unknown> {
    return this.client.rpc('git.status', {
      projectId,
      ...(opts?.cwd ? { cwd: opts.cwd } : {}),
    })
  }

  /** Path inventory for @-mention / file search (not content grep). */
  async workspaceListFiles(
    projectId: string,
    opts?: { relativePath?: string; maxDepth?: number; maxFiles?: number },
  ): Promise<{ files?: Array<{ path: string; isDirectory: boolean }> }> {
    return this.client.rpc('workspace.listFiles', {
      projectId,
      ...(opts?.relativePath ? { relativePath: opts.relativePath } : {}),
      ...(opts?.maxDepth != null ? { maxDepth: opts.maxDepth } : {}),
      ...(opts?.maxFiles != null ? { maxFiles: opts.maxFiles } : {}),
    })
  }

  /** Node-local Claude skills + slash commands (user + project). */
  async workspaceListSkills(projectId: string): Promise<{
    skills?: Array<{
      name: string
      description: string
      argumentHint: string
      isSkill: boolean
      scope?: string
    }>
    commands?: Array<{
      name: string
      description: string
      argumentHint: string
      isSkill: boolean
      scope?: string
    }>
  }> {
    return this.client.rpc('workspace.listSkills', { projectId })
  }

  /** Node-local installed Claude plugins for a project. */
  async pluginsList(projectId: string): Promise<{
    plugins?: Array<Record<string, unknown>>
    provider?: string
  }> {
    return this.client.rpc('plugins.list', { projectId, provider: 'claude' })
  }

  async pluginsGet(
    projectId: string,
    key: string,
  ): Promise<{ plugin?: unknown; provider?: string }> {
    return this.client.rpc('plugins.get', { projectId, provider: 'claude', key })
  }

  async pluginsReadFile(
    projectId: string,
    key: string,
    relativePath: string,
  ): Promise<{ content?: string; provider?: string }> {
    return this.client.rpc('plugins.readFile', {
      projectId,
      provider: 'claude',
      key,
      relativePath,
    })
  }

  async pluginsDelete(
    projectId: string,
    key: string,
    scope: 'user' | 'project',
  ): Promise<{ ok?: boolean; provider?: string }> {
    return this.client.rpc('plugins.delete', {
      projectId,
      provider: 'claude',
      key,
      scope,
    })
  }

  async pluginsInstall(
    projectId: string,
    key: string,
    scope: 'user' | 'project',
  ): Promise<{ ok?: boolean; provider?: string }> {
    return this.client.rpc('plugins.install', {
      projectId,
      provider: 'claude',
      key,
      scope,
    })
  }

  async pluginsUpdate(
    projectId: string,
    key: string,
    scope: 'user' | 'project',
  ): Promise<{ ok?: boolean; provider?: string }> {
    return this.client.rpc('plugins.update', {
      projectId,
      provider: 'claude',
      key,
      scope,
    })
  }

  async pluginsListMarketplace(projectId: string): Promise<{
    plugins?: Array<Record<string, unknown>>
    provider?: string
  }> {
    return this.client.rpc('plugins.listMarketplace', { projectId, provider: 'claude' })
  }

  async pluginsAddMarketplace(
    projectId: string,
    source: string,
    scope: 'user' | 'project',
  ): Promise<unknown> {
    return this.client.rpc('plugins.addMarketplace', {
      projectId,
      provider: 'claude',
      source,
      scope,
    })
  }

  async pluginsRemoveMarketplace(
    projectId: string,
    name: string,
    scope: 'user' | 'project' | 'local' | 'official',
  ): Promise<unknown> {
    return this.client.rpc('plugins.removeMarketplace', {
      projectId,
      provider: 'claude',
      name,
      scope,
    })
  }

  /** Node-local Claude agent catalog (user + project + plugins). */
  async agentsList(projectId: string): Promise<{
    agents?: Array<{
      name: string
      description: string
      model?: string
      source: string
      scope: 'user' | 'project'
    }>
  }> {
    return this.client.rpc('agents.list', { projectId })
  }

  async agentsReadFile(projectId: string, name: string): Promise<{ content?: string | null }> {
    return this.client.rpc('agents.readFile', { projectId, name })
  }

  /** Node-local hooks from user/project/local settings.json. */
  async hooksList(projectId: string): Promise<{ hooks?: Array<Record<string, unknown>> }> {
    return this.client.rpc('hooks.list', { projectId })
  }

  async hooksSave(
    projectId: string,
    payload: unknown,
    replaceId?: string,
  ): Promise<{ ok?: boolean }> {
    return this.client.rpc('hooks.save', {
      projectId,
      payload,
      ...(replaceId ? { replaceId } : {}),
    })
  }

  async hooksDelete(projectId: string, id: string): Promise<{ ok?: boolean }> {
    return this.client.rpc('hooks.delete', { projectId, id })
  }

  async gitDiff(projectId: string, opts?: { staged?: boolean; path?: string }): Promise<unknown> {
    return this.client.rpc('git.diff', { projectId, ...opts })
  }

  async gitBranches(projectId: string): Promise<unknown> {
    return this.client.rpc('git.branches', { projectId })
  }

  async gitWorktrees(projectId: string): Promise<unknown> {
    return this.client.rpc('git.worktrees', { projectId })
  }

  async gitSwitchBranch(
    projectId: string,
    branch: string,
    opts?: { create?: boolean; cwd?: string },
  ): Promise<unknown> {
    const method = opts?.create ? 'git.createBranch' : 'git.switchBranch'
    return this.client.rpc(method, {
      projectId,
      branch,
      ...(opts?.cwd ? { cwd: opts.cwd } : {}),
    })
  }

  async gitWorktreeActivate(
    projectId: string,
    input: {
      baseBranch: string
      mode: 'branch' | 'attach' | 'detach'
      branchName?: string
      carryLocalChanges?: boolean
    },
  ): Promise<unknown> {
    return this.client.rpc('git.worktreeActivate', { projectId, ...input })
  }

  async gitWorktreeCheckedOutBranches(projectId: string): Promise<unknown> {
    return this.client.rpc('git.worktreeCheckedOutBranches', { projectId })
  }

  async gitWorktreeAssignBranch(
    projectId: string,
    worktreePath: string,
    name: string,
  ): Promise<unknown> {
    return this.client.rpc('git.worktreeAssignBranch', { projectId, worktreePath, name })
  }

  async gitWorktreeHandoff(projectId: string, worktreePath: string): Promise<unknown> {
    return this.client.rpc('git.worktreeHandoff', { projectId, worktreePath })
  }

  async gitWorktreeHandoffPreview(projectId: string, worktreePath: string): Promise<unknown> {
    return this.client.rpc('git.worktreeHandoffPreview', { projectId, worktreePath })
  }

  async sessionSetCwd(input: {
    sessionId: string
    cwd: string | null
    leaseId: string
    generation: string
  }): Promise<unknown> {
    return this.client.rpc('session.setCwd', input)
  }

  /**
   * Persist durable per-session turn defaults on the node (model/effort/…).
   * Subsequent session.send without those options uses the stored values.
   */
  async sessionPatchSettings(input: {
    sessionId: string
    permissionMode?: string | null
    sandboxMode?: string | null
    model?: string | null
    effort?: string | null
    apiProviderId?: string | null
    leaseId?: string
    generation?: string
  }): Promise<unknown> {
    const { sessionId, leaseId, generation, ...settings } = input
    if (!leaseId) {
      throw new Error('session.patchSettings requires a control lease on remote nodes')
    }
    return this.client.rpc('session.patchSettings', {
      sessionId,
      leaseId,
      generation,
      settings,
    })
  }

  // --- Provider credentials (node-local store) ---

  async providerListCredentials(): Promise<unknown> {
    return this.client.rpc('provider.listCredentials', {})
  }

  async providerGetCredentialDecrypted(id: string): Promise<unknown> {
    return this.client.rpc('provider.getCredentialDecrypted', { id })
  }

  async providerCreateCredential(input: Record<string, unknown>): Promise<unknown> {
    return this.client.rpc('provider.createCredential', input)
  }

  async providerUpdateCredential(input: Record<string, unknown>): Promise<unknown> {
    return this.client.rpc('provider.updateCredential', input)
  }

  async providerDeleteCredential(id: string): Promise<unknown> {
    return this.client.rpc('provider.deleteCredential', { id })
  }

  // --- Skills / MCP resource management (node disk via skills.* / mcp.*) ---

  async skillsList(projectId: string, provider: ResourceProvider = 'claude'): Promise<unknown> {
    return this.client.rpc('skills.list', { projectId, provider })
  }

  async skillsGet(
    projectId: string,
    name: string,
    opts?: { sourcePath?: string; provider?: ResourceProvider },
  ): Promise<unknown> {
    return this.client.rpc('skills.get', {
      projectId,
      name,
      provider: opts?.provider ?? 'claude',
      ...(opts?.sourcePath ? { sourcePath: opts.sourcePath } : {}),
    })
  }

  async skillsReadFile(
    projectId: string,
    skillName: string,
    relativePath: string,
    opts?: { sourcePath?: string; provider?: ResourceProvider },
  ): Promise<unknown> {
    return this.client.rpc('skills.readFile', {
      projectId,
      skillName,
      relativePath,
      provider: opts?.provider ?? 'claude',
      ...(opts?.sourcePath ? { sourcePath: opts.sourcePath } : {}),
    })
  }

  async skillsDelete(
    projectId: string,
    sourcePath: string,
    provider: ResourceProvider = 'claude',
  ): Promise<unknown> {
    return this.client.rpc('skills.delete', { projectId, sourcePath, provider })
  }

  async skillsInstall(
    projectId: string,
    input: {
      scope: 'user' | 'project'
      name: string
      files: Record<string, string>
      provider?: ResourceProvider
    },
  ): Promise<unknown> {
    return this.client.rpc('skills.install', {
      projectId,
      scope: input.scope,
      name: input.name,
      files: input.files,
      provider: input.provider ?? 'claude',
    })
  }

  async mcpList(projectId: string, provider: ResourceProvider): Promise<unknown> {
    return this.client.rpc('mcp.list', { projectId, provider })
  }

  async mcpSave(
    projectId: string,
    input: {
      provider: ResourceProvider
      name: string
      scope: 'user' | 'project'
      config: Record<string, unknown>
    },
  ): Promise<unknown> {
    return this.client.rpc('mcp.save', {
      projectId,
      provider: input.provider,
      name: input.name,
      scope: input.scope,
      config: input.config,
    })
  }

  async mcpToggle(
    projectId: string,
    input: {
      provider: ResourceProvider
      name: string
      scope: 'user' | 'project'
      disabled: boolean
    },
  ): Promise<unknown> {
    return this.client.rpc('mcp.toggle', {
      projectId,
      provider: input.provider,
      name: input.name,
      scope: input.scope,
      disabled: input.disabled,
    })
  }

  async mcpDelete(
    projectId: string,
    input: {
      provider: ResourceProvider
      name: string
      scope: 'user' | 'project'
    },
  ): Promise<unknown> {
    return this.client.rpc('mcp.delete', {
      projectId,
      provider: input.provider,
      name: input.name,
      scope: input.scope,
    })
  }

  async providerListBindings(): Promise<unknown> {
    return this.client.rpc('provider.listBindings', {})
  }

  async providerSetBinding(binding: Record<string, unknown>): Promise<unknown> {
    return this.client.rpc('provider.setBinding', binding)
  }

  async providerClearBinding(consumer: string): Promise<unknown> {
    return this.client.rpc('provider.clearBinding', { consumer })
  }

  async providerListCustomPlatforms(): Promise<unknown> {
    return this.client.rpc('provider.listCustomPlatforms', {})
  }

  async providerUpsertCustomPlatform(def: Record<string, unknown>): Promise<unknown> {
    return this.client.rpc('provider.upsertCustomPlatform', def)
  }

  async providerDeleteCustomPlatform(id: string): Promise<unknown> {
    return this.client.rpc('provider.deleteCustomPlatform', { id })
  }

  async providerExportBundle(): Promise<unknown> {
    return this.client.rpc('provider.exportBundle', {})
  }

  async providerImportBundle(
    bundle: unknown,
    opts?: { replaceAll?: boolean },
  ): Promise<unknown> {
    return this.client.rpc('provider.importBundle', { bundle, replaceAll: opts?.replaceAll === true })
  }

  async providerListModels(input: {
    harness: string
    apiProviderId?: string | null
  }): Promise<unknown> {
    return this.client.rpc('provider.listModels', {
      harness: input.harness,
      apiProviderId: input.apiProviderId ?? null,
    })
  }

  /**
   * Node-side CONNECT_* replacement: models + skills/commands/agents/prompts.
   * Does not use desktop harness_resource_cache.
   */
  async harnessResources(input: {
    projectId: string
    harnessId?: string
    apiProviderId?: string | null
  }): Promise<unknown> {
    return this.client.rpc('harness.resources', {
      projectId: input.projectId,
      harnessId: input.harnessId,
      apiProviderId: input.apiProviderId ?? null,
    })
  }

  /** Alias for {@link harnessResources}. */
  async harnessConnect(input: {
    projectId: string
    harnessId?: string
    apiProviderId?: string | null
  }): Promise<unknown> {
    return this.client.rpc('harness.connect', {
      projectId: input.projectId,
      harnessId: input.harnessId,
      apiProviderId: input.apiProviderId ?? null,
    })
  }

  // --- Session-layer provider profiles (session_providers) ---

  /** Agents this node can actually launch — the ids its session_collab_request validates against. */
  async collaborationListProfiles(): Promise<unknown> {
    return this.client.rpc('collaboration.listProfiles', {})
  }

  async sessionProvidersList(harnessId?: string): Promise<unknown> {
    return this.client.rpc('sessionProviders.list', harnessId ? { harnessId } : {})
  }

  async sessionProvidersGet(id: string): Promise<unknown> {
    return this.client.rpc('sessionProviders.get', { id })
  }

  async sessionProvidersGetBase(harnessId: string): Promise<unknown> {
    return this.client.rpc('sessionProviders.getBase', { harnessId })
  }

  async sessionProvidersCreate(input: {
    harnessId: string
    name: string
    config?: unknown
    id?: string
  }): Promise<unknown> {
    return this.client.rpc('sessionProviders.create', input)
  }

  async sessionProvidersUpdate(
    id: string,
    patch: { name?: string; config?: unknown },
  ): Promise<unknown> {
    return this.client.rpc('sessionProviders.update', { id, ...patch })
  }

  async sessionProvidersDelete(id: string): Promise<unknown> {
    return this.client.rpc('sessionProviders.delete', { id })
  }

  // --- Node agent settings (SUPERONE_NODE_HOME config.json) ---

  async settingsGet(): Promise<unknown> {
    return this.client.rpc('settings.get', {})
  }

  async settingsPatch(patch: Record<string, unknown>): Promise<unknown> {
    return this.client.rpc('settings.patch', { patch })
  }

  /** Linux bwrap/socat probe + capability booleans. */
  async sandboxProbe(): Promise<unknown> {
    return this.client.rpc('sandbox.probe', {})
  }

  // --- Automations (node-owned scheduler; local desktop keeps in-process service) ---

  async automationList(projectId: string): Promise<unknown> {
    return this.client.rpc('automation.list', { projectId })
  }

  async automationCreate(input: {
    projectId: string
    name: string
    prompt: string
    agentConfig: unknown
    schedule: unknown
  }): Promise<unknown> {
    return this.client.rpc('automation.create', input)
  }

  async automationUpdate(input: {
    automationId: string
    projectId?: string
    name?: string
    prompt?: string
    agentConfig?: unknown
    schedule?: unknown
    enabled?: boolean
  }): Promise<unknown> {
    return this.client.rpc('automation.update', input)
  }

  async automationDelete(input: { automationId: string; projectId?: string }): Promise<unknown> {
    return this.client.rpc('automation.delete', input)
  }

  async automationRunNow(input: { automationId: string; projectId?: string }): Promise<unknown> {
    return this.client.rpc('automation.runNow', input)
  }

  // --- Codex admin (node codex.* RPC; never touches local project FS) ---

  async codexGetAuthStatus(projectId: string): Promise<unknown> {
    return this.client.rpc('codex.getAuthStatus', { projectId })
  }

  async codexSetAuth(
    projectId: string,
    request: { mode: string; apiKey?: string },
  ): Promise<unknown> {
    return this.client.rpc('codex.setAuth', { projectId, ...request })
  }

  async codexGetAccountStatus(projectId: string): Promise<unknown> {
    return this.client.rpc('codex.getAccountStatus', { projectId })
  }

  async codexAccountLoginStart(projectId: string): Promise<unknown> {
    return this.client.rpc('codex.accountLoginStart', { projectId })
  }

  async codexAccountLoginCancel(loginId: string): Promise<unknown> {
    return this.client.rpc('codex.accountLoginCancel', { loginId })
  }

  async codexAccountLogout(projectId: string): Promise<unknown> {
    return this.client.rpc('codex.accountLogout', { projectId })
  }

  async codexGetRateLimits(
    projectId: string,
    apiProviderId?: string | null,
  ): Promise<unknown> {
    return this.client.rpc('codex.getRateLimits', {
      projectId,
      apiProviderId: apiProviderId ?? null,
    })
  }

  async codexGetAccountUsage(
    projectId: string,
    apiProviderId?: string | null,
    threadId?: string | null,
  ): Promise<unknown> {
    return this.client.rpc('codex.getAccountUsage', {
      projectId,
      apiProviderId: apiProviderId ?? null,
      threadId: threadId ?? null,
    })
  }

  async codexGetServerDiagnostics(
    projectId: string,
    apiProviderId?: string | null,
  ): Promise<unknown> {
    return this.client.rpc('codex.getServerDiagnostics', {
      projectId,
      apiProviderId: apiProviderId ?? null,
    })
  }

  async codexGetConfigRequirements(
    projectId: string,
    apiProviderId?: string | null,
  ): Promise<unknown> {
    return this.client.rpc('codex.getConfigRequirements', {
      projectId,
      apiProviderId: apiProviderId ?? null,
    })
  }

  async codexConsumeRateLimitReset(
    projectId: string,
    apiProviderId?: string | null,
    creditId?: string | null,
  ): Promise<unknown> {
    return this.client.rpc('codex.consumeRateLimitReset', {
      projectId,
      apiProviderId: apiProviderId ?? null,
      creditId: creditId ?? null,
    })
  }

  async codexLoginMcpOauth(
    projectId: string,
    serverName: string,
    apiProviderId?: string | null,
    options?: CodexMcpOauthLoginOptions,
  ): Promise<unknown> {
    return this.client.rpc('codex.loginMcpOauth', {
      projectId,
      serverName,
      apiProviderId: apiProviderId ?? null,
      options,
    })
  }

  async codexDetectExternalAgent(
    projectId: string,
    apiProviderId?: string | null,
  ): Promise<unknown> {
    return this.client.rpc('codex.detectExternalAgent', {
      projectId,
      apiProviderId: apiProviderId ?? null,
    })
  }

  async codexImportExternalAgent(
    projectId: string,
    items: unknown[],
    apiProviderId?: string | null,
  ): Promise<unknown> {
    return this.client.rpc('codex.importExternalAgent', {
      projectId,
      items,
      apiProviderId: apiProviderId ?? null,
    })
  }

  async codexPluginsList(
    projectId: string,
    opts?: { marketplace?: boolean; apiProviderId?: string | null },
  ): Promise<unknown> {
    return this.client.rpc('codex.plugins.list', {
      projectId,
      marketplace: opts?.marketplace === true,
      apiProviderId: opts?.apiProviderId ?? null,
    })
  }

  async codexPluginsInstall(
    projectId: string,
    key: string,
    apiProviderId?: string | null,
  ): Promise<unknown> {
    return this.client.rpc('codex.plugins.install', {
      projectId,
      key,
      apiProviderId: apiProviderId ?? null,
    })
  }

  async codexPluginsUninstall(
    projectId: string,
    key: string,
    apiProviderId?: string | null,
  ): Promise<unknown> {
    return this.client.rpc('codex.plugins.uninstall', {
      projectId,
      key,
      apiProviderId: apiProviderId ?? null,
    })
  }

  async codexMarketplaceAdd(
    projectId: string,
    request: { source: string; refName?: string; sparsePaths?: string[] },
    apiProviderId?: string | null,
  ): Promise<unknown> {
    return this.client.rpc('codex.marketplace.add', {
      projectId,
      ...request,
      apiProviderId: apiProviderId ?? null,
    })
  }

  async codexMarketplaceRemove(
    projectId: string,
    marketplaceName: string,
    apiProviderId?: string | null,
  ): Promise<unknown> {
    return this.client.rpc('codex.marketplace.remove', {
      projectId,
      marketplaceName,
      apiProviderId: apiProviderId ?? null,
    })
  }

  async codexMarketplaceUpgrade(
    projectId: string,
    marketplaceName?: string,
    apiProviderId?: string | null,
  ): Promise<unknown> {
    return this.client.rpc('codex.marketplace.upgrade', {
      projectId,
      ...(marketplaceName ? { marketplaceName } : {}),
      apiProviderId: apiProviderId ?? null,
    })
  }

  private createSessionGateway(): SessionGateway {
    return {
      create: async (input: CreateSessionInput) => {
        this.assertEnv(input.project.environmentId)
        const result = await this.client.rpc<{ sessionId: string }>('session.create', {
          projectId: input.project.projectId,
          harnessId: (input.options?.harnessId as string) ?? undefined,
          providerId: input.providerId,
          title: input.title,
        })
        return { sessionId: result.sessionId }
      },
      get: async (ref: SessionRef) => {
        this.assertEnv(ref.environmentId)
        return this.client.rpc('session.get', { sessionId: ref.sessionId })
      },
      list: async (project: ProjectRef, options: { limit: number; offset: number }) => {
        this.assertEnv(project.environmentId)
        return this.client.rpc('session.list', {
          projectId: project.projectId,
          limit: options.limit,
          offset: options.offset,
        })
      },
      listMessages: async (input) => {
        this.assertEnv(input.session.environmentId)
        return this.client.rpc<SessionMessagesListResult>('session.messages.list', {
          sessionId: input.sessionId || input.session.sessionId,
          ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
        })
      },
      send: async (input: SendMessageInput) => {
        this.assertEnv(input.session.environmentId)
        // Unique once per logical send — never derive from text length/content.
        const clientMessageId = input.clientMessageId || randomUUID()
        await this.client.rpc(
          'session.send',
          {
            sessionId: input.session.sessionId,
            text: input.text,
            leaseId: input.leaseId,
            generation: input.generation,
            clientMessageId,
            ...(input.options && Object.keys(input.options).length > 0
              ? { options: input.options }
              : {}),
          },
          undefined,
          clientMessageId,
        )
      },
      patchSettings: async (input) => {
        this.assertEnv(input.session.environmentId)
        const {
          session,
          leaseId,
          generation,
          permissionMode,
          sandboxMode,
          model,
          effort,
          apiProviderId,
        } = input
        if (!leaseId) {
          throw new Error('session.patchSettings requires a control lease on remote nodes')
        }
        return this.client.rpc('session.patchSettings', {
          sessionId: session.sessionId,
          leaseId,
          generation,
          settings: {
            ...(permissionMode !== undefined ? { permissionMode } : {}),
            ...(sandboxMode !== undefined ? { sandboxMode } : {}),
            ...(model !== undefined ? { model } : {}),
            ...(effort !== undefined ? { effort } : {}),
            ...(apiProviderId !== undefined ? { apiProviderId } : {}),
          },
        })
      },
      interrupt: async (ref: SessionRef, control: MutatingControlContext) => {
        this.assertEnv(ref.environmentId)
        await this.client.rpc('session.interrupt', {
          sessionId: ref.sessionId,
          leaseId: control.leaseId,
          generation: control.generation,
        })
      },
      close: async (ref: SessionRef, control?: MutatingControlContext) => {
        this.assertEnv(ref.environmentId)
        if (!control?.leaseId) {
          throw Object.assign(new Error('lease required to close session'), { code: 'lease_required' })
        }
        await this.client.rpc('session.close', {
          sessionId: ref.sessionId,
          leaseId: control.leaseId,
          generation: control.generation,
        })
      },
      acquireControl: async (input: LeaseAcquireInput & { resource: SessionRef }) => {
        this.assertEnv(input.resource.environmentId)
        return this.client.rpc<ControlLease>('session.acquireControl', {
          sessionId: input.resource.sessionId,
          ttlMs: input.ttlMs,
        })
      },
      renewControl: async (input: LeaseRenewInput) => {
        return this.client.rpc<ControlLease>('session.renewControl', {
          leaseId: input.leaseId,
          generation: input.generation,
          ttlMs: input.ttlMs,
        })
      },
      releaseControl: async (input: LeaseReleaseInput) => {
        await this.client.rpc('session.releaseControl', {
          leaseId: input.leaseId,
          generation: input.generation,
        })
      },
    }
  }

  /**
   * Paged denser message catalog for remote UI hydrate (tool summaries, metadata).
   * Prefer this for historical open; use {@link listEvents} with afterSequence for live catch-up.
   */
  async listSessionMessages(input: {
    sessionId: string
    cursor?: string | number | null
    limit?: number
  }): Promise<SessionMessagesListResult> {
    return this.client.rpc<SessionMessagesListResult>('session.messages.list', {
      sessionId: input.sessionId,
      ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
    })
  }

  /**
   * Rename a session title on the node (no lease required).
   * @param source `'user'` locks out agent renames; `'agent'` is rejected when locked.
   */
  async renameSession(
    sessionId: string,
    title: string,
    source: 'user' | 'agent' = 'user',
  ): Promise<unknown> {
    return this.client.rpc('session.rename', { sessionId, title, source })
  }

  async setSessionTags(
    sessionId: string,
    op: { add?: unknown; remove?: unknown; set?: unknown },
  ): Promise<unknown> {
    return this.client.rpc('session.setTags', { sessionId, ...op })
  }

  /** Remove a session from the node registry (sidebar delete). */
  async removeSession(
    sessionId: string,
    control?: { leaseId?: string; generation?: string },
  ): Promise<unknown> {
    return this.client.rpc('session.remove', {
      sessionId,
      leaseId: control?.leaseId,
      generation: control?.generation,
    })
  }

  async setSessionUiFlags(
    sessionId: string,
    flags: { isPinned?: boolean; isHidden?: boolean },
  ): Promise<unknown> {
    return this.client.rpc('session.setUiFlags', { sessionId, ...flags })
  }

  /**
   * Fork a remote session on the node (worktree = new detached wt + cwd;
   * local = same cwd). Returns SessionForkResult shape.
   */
  async forkSession(input: {
    sessionId: string
    mode?: 'local' | 'worktree'
    forkFromMessageId?: string
  }): Promise<{ ok: true; sessionId: string; worktreePath?: string } | { ok: false; error: string }> {
    const result = await this.client.rpc<{
      ok?: boolean
      sessionId?: string
      worktreePath?: string
      error?: string
    }>('session.fork', {
      sessionId: input.sessionId,
      mode: input.mode ?? 'worktree',
      ...(input.forkFromMessageId ? { forkFromMessageId: input.forkFromMessageId } : {}),
    })
    if (result && result.ok === true && result.sessionId) {
      return {
        ok: true,
        sessionId: result.sessionId,
        worktreePath: result.worktreePath,
      }
    }
    if (result && result.ok === false && result.error) {
      return { ok: false, error: result.error }
    }
    return { ok: false, error: 'Fork failed on remote node' }
  }

  private createInteractionGateway(): InteractionGateway {
    return {
      listPending: async (session: SessionRef) => {
        this.assertEnv(session.environmentId)
        const s = (await this.client.rpc('session.get', {
          sessionId: session.sessionId,
        })) as { pendingInteraction?: unknown | null }
        if (!s?.pendingInteraction) return []
        const p = s.pendingInteraction as {
          interactionId: string
          kind: 'permission' | 'question' | 'plan' | 'session_agents_confirm'
          createdAt: number
        }
        return [
          {
            interactionId: p.interactionId,
            sessionId: session.sessionId,
            kind: p.kind,
            createdAt: p.createdAt,
            payload: p,
          },
        ]
      },
      respondPermission: async (input: PermissionResponseInput) => {
        this.assertEnv(input.session.environmentId)
        const formAnswers =
          input.options && typeof input.options === 'object'
            ? ((input.options as { formAnswers?: Record<string, unknown> }).formAnswers
              ?? (input.options as Record<string, unknown>))
            : undefined
        const cancel =
          input.options && typeof input.options === 'object'
            ? (input.options as { cancel?: boolean }).cancel === true
            : false
        await this.client.rpc('session.respondPermission', {
          sessionId: input.session.sessionId,
          interactionId: input.interactionId,
          decision: input.decision,
          leaseId: input.leaseId,
          generation: input.generation,
          ...(formAnswers ? { formAnswers } : {}),
          ...(cancel ? { cancel: true } : {}),
        })
      },
      respondQuestion: async (input: QuestionResponseInput) => {
        this.assertEnv(input.session.environmentId)
        await this.client.rpc('session.respondQuestion', {
          sessionId: input.session.sessionId,
          interactionId: input.interactionId,
          answers: input.answers,
          leaseId: input.leaseId,
          generation: input.generation,
        })
      },
      respondPlan: async (input: PlanResponseInput) => {
        this.assertEnv(input.session.environmentId)
        await this.client.rpc('session.respondPlan', {
          sessionId: input.session.sessionId,
          interactionId: input.interactionId,
          decision: input.decision,
          options: input.options,
          leaseId: input.leaseId,
          generation: input.generation,
        })
      },
    }
  }

  private createTerminalGateway(): TerminalGateway {
    return {
      create: async (input: CreateTerminalInput) => {
        if (input.project) this.assertEnv(input.project.environmentId)
        const cwd = input.cwd || process.cwd()
        return this.client.terminalCreate({
          cwd,
          title: input.title,
          cols: input.cols,
          rows: input.rows,
        })
      },
      attach: async (ref: TerminalRef) => {
        this.assertEnv(ref.environmentId)
        return this.client.terminalAttach(ref.terminalId)
      },
      read: async (ref: TerminalRef, afterSequence: string) => {
        this.assertEnv(ref.environmentId)
        return this.client.terminalRead(ref.terminalId, afterSequence)
      },
      write: async (input: TerminalWriteInput) => {
        this.assertEnv(input.terminal.environmentId)
        await this.client.terminalWrite(
          input.terminal.terminalId,
          input.data,
          input.leaseId,
          input.generation,
        )
      },
      resize: async (input: TerminalResizeInput) => {
        this.assertEnv(input.terminal.environmentId)
        await this.client.terminalResize(
          input.terminal.terminalId,
          input.cols,
          input.rows,
          input.leaseId,
          input.generation,
        )
      },
      kill: async (ref: TerminalRef, control: MutatingControlContext) => {
        this.assertEnv(ref.environmentId)
        await this.client.terminalKill(ref.terminalId, control.leaseId, control.generation)
      },
      acquireControl: async (input: LeaseAcquireInput & { resource: TerminalRef }) => {
        this.assertEnv(input.resource.environmentId)
        return this.client.terminalAcquireControl(input.resource.terminalId, input.ttlMs)
      },
      renewControl: async (input: LeaseRenewInput) => {
        return this.client.rpc<ControlLease>('terminal.renewControl', {
          leaseId: input.leaseId,
          generation: input.generation,
          ttlMs: input.ttlMs,
        })
      },
      releaseControl: async (input: LeaseReleaseInput) => {
        await this.client.rpc('terminal.releaseControl', {
          leaseId: input.leaseId,
          generation: input.generation,
        })
      },
    }
  }

  private createWorkspaceGateway(): WorkspaceGateway {
    return {
      listDir: async (input: WorkspaceListInput): Promise<WorkspaceEntry[]> => {
        this.assertEnv(input.project.environmentId)
        return this.client.rpc('workspace.listDir', {
          projectId: input.project.projectId,
          relativePath: input.relativePath,
        })
      },
      readFile: async (input: WorkspaceReadInput) => {
        this.assertEnv(input.project.environmentId)
        const raw = await this.client.rpc<{
          content: string
          hash?: string
          encoding?: string
        }>('workspace.readFile', {
          projectId: input.project.projectId,
          relativePath: input.relativePath,
          offset: input.offset,
          limit: input.limit,
        })
        if (raw.encoding === 'base64') {
          return {
            content: Buffer.from(raw.content, 'base64'),
            hash: raw.hash,
          }
        }
        return { content: raw.content, hash: raw.hash }
      },
      writeFile: async (input: WorkspaceWriteInput) => {
        this.assertEnv(input.project.environmentId)
        const content =
          typeof input.content === 'string'
            ? input.content
            : Buffer.from(input.content).toString('base64')
        return this.client.rpc('workspace.writeFile', {
          projectId: input.project.projectId,
          relativePath: input.relativePath,
          content,
          encoding: typeof input.content === 'string' ? 'utf8' : 'base64',
          expectedHash: input.expectedHash,
        })
      },
      rename: async (input: WorkspaceRenameInput) => {
        this.assertEnv(input.project.environmentId)
        return this.client.rpc('workspace.rename', {
          projectId: input.project.projectId,
          relativePath: input.relativePath,
          newName: input.newName,
        })
      },
      move: async (input: WorkspaceMoveInput) => {
        this.assertEnv(input.project.environmentId)
        return this.client.rpc('workspace.move', {
          projectId: input.project.projectId,
          fromPath: input.fromPath,
          destDirPath: input.destDirPath,
        })
      },
      delete: async (input: WorkspaceDeleteInput) => {
        this.assertEnv(input.project.environmentId)
        return this.client.rpc('workspace.delete', {
          projectId: input.project.projectId,
          relativePath: input.relativePath,
        })
      },
      mkdir: async (input: WorkspaceMkdirInput) => {
        this.assertEnv(input.project.environmentId)
        return this.client.rpc('workspace.mkdir', {
          projectId: input.project.projectId,
          relativePath: input.relativePath,
        })
      },
      search: async (input: WorkspaceSearchInput) => {
        this.assertEnv(input.project.environmentId)
        return this.client.rpc('workspace.search', {
          projectId: input.project.projectId,
          query: input.query,
          relativePath: input.relativePath,
        })
      },
      watch: (input: WorkspaceWatchInput): AsyncIterable<{ path: string; type: string }> => {
        this.assertEnv(input.project.environmentId)
        const client = this.client
        const projectId = input.project.projectId
        const relativePath = input.relativePath ?? '.'
        return {
          async *[Symbol.asyncIterator]() {
            const started = await client.rpc<{ watchId: string }>('workspace.watchStart', {
              projectId,
              relativePath,
            })
            try {
              for (;;) {
                const polled = await client.rpc<{
                  events: Array<{ path: string; type: string }>
                }>('workspace.watchPoll', { watchId: started.watchId })
                for (const ev of polled.events) yield ev
                await new Promise((r) => setTimeout(r, 100))
              }
            } finally {
              await client.rpc('workspace.watchStop', { watchId: started.watchId }).catch(() => {})
            }
          },
        }
      },
      tailWatchStart: async (input) => {
        this.assertEnv(input.project.environmentId)
        return this.client.rpc<{ watchId: string; offset: number; relativePath: string; absolutePath?: string }>(
          'workspace.tailWatchStart',
          {
            projectId: input.project.projectId,
            relativePath: input.relativePath,
            offset: input.offset,
            ...(input.absolutePath ? { absolutePath: input.absolutePath } : {}),
          },
        )
      },
      tailWatchPoll: async (input) => {
        return this.client.rpc('workspace.tailWatchPoll', { watchId: input.watchId })
      },
      tailWatchStop: async (input) => {
        return this.client.rpc('workspace.tailWatchStop', { watchId: input.watchId })
      },
    }
  }
}
