import { randomUUID } from 'node:crypto'
import type {
  ControlLease,
  CreateSessionInput,
  CreateTerminalInput,
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
} from '@superone/shared/environment'
import type { NodeRpcClient } from './node-rpc-client'

/**
 * Environment gateway that delegates to an authenticated node RPC session.
 * Sessions, interactions, terminals, and workspace (incl. watch) all go over RPC.
 */
export class RemoteEnvironmentGateway implements EnvironmentGateway {
  readonly sessions: SessionGateway
  readonly interactions: InteractionGateway
  readonly terminals: TerminalGateway
  readonly workspace: WorkspaceGateway

  private descriptorCache: ExecutionEnvironmentDescriptor | null = null
  private fixedEnvironmentId: string | null = null

  constructor(private readonly client: NodeRpcClient) {
    this.sessions = this.createSessionGateway()
    this.interactions = this.createInteractionGateway()
    this.terminals = this.createTerminalGateway()
    this.workspace = this.createWorkspaceGateway()
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
      list: async (project: ProjectRef) => {
        this.assertEnv(project.environmentId)
        return this.client.rpc('session.list', { projectId: project.projectId })
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

  /** Rename a session title on the node (no lease required). */
  async renameSession(sessionId: string, title: string): Promise<unknown> {
    return this.client.rpc('session.rename', { sessionId, title })
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
          kind: 'permission' | 'question' | 'plan'
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
        await this.client.rpc('session.respondPermission', {
          sessionId: input.session.sessionId,
          interactionId: input.interactionId,
          decision: input.decision,
          leaseId: input.leaseId,
          generation: input.generation,
        })
      },
      respondQuestion: async (_input: QuestionResponseInput) => {
        // Question protocol reuses permission-shaped RPC in Phase 4+; not separate yet.
        throw new Error('respondQuestion: use harness-specific plan/question path when available')
      },
      respondPlan: async (_input: PlanResponseInput) => {
        throw new Error('respondPlan: use harness-specific plan approval path when available')
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
    }
  }
}
