import { hostname, platform as osPlatform, arch as osArch } from 'node:os'
import {
  LOCAL_ENVIRONMENT_CAPABILITIES,
  LOCAL_ENVIRONMENT_LABEL,
  DATABASE_SCHEMA_GENERATION,
  PROTOCOL_GENERATION,
  type CreateSessionInput,
  type CreateTerminalInput,
  type EnvironmentEventEnvelope,
  type EnvironmentGateway,
  type EnvironmentSnapshot,
  type ExecutionEnvironmentDescriptor,
  type InteractionGateway,
  type LeaseAcquireInput,
  type LeaseReleaseInput,
  type LeaseRenewInput,
  type MutatingControlContext,
  type PermissionResponseInput,
  type PlanResponseInput,
  type ProjectRef,
  type ProjectSnapshot,
  type QuestionResponseInput,
  type SendMessageInput,
  type SessionGateway,
  type SessionRef,
  type SubscribeEventsInput,
  type TerminalGateway,
  type TerminalRef,
  type TerminalResizeInput,
  type TerminalWriteInput,
  type WorkspaceEntry,
  type WorkspaceGateway,
  type WorkspaceListInput,
  type WorkspaceReadInput,
  type WorkspaceSearchInput,
  type WorkspaceWatchInput,
  type WorkspaceWriteInput,
} from '@superone/shared/environment'
import { loadOrCreateLocalEnvironmentId } from './local-identity'

/** Minimal session port so local gateway can share harness parity with remote. */
export interface LocalSessionPort {
  create(input: {
    projectId: string
    harnessId?: string
    providerId?: string
    title?: string
  }): { sessionId: string }
  get(sessionId: string): unknown | null
  list(projectId?: string, options?: { limit: number; offset: number }): unknown[]
  send(input: {
    sessionId: string
    text: string
    client: { clientSessionId: string }
    leaseId: string
    generation: string
  }): Promise<unknown>
  patchSettings?(input: {
    sessionId: string
    permissionMode?: string | null
    sandboxMode?: string | null
    model?: string | null
    effort?: string | null
    apiProviderId?: string | null
  }): unknown
  acquireControl(input: {
    sessionId: string
    holderClientId: string
    ttlMs?: number
  }): { leaseId: string; generation: string; holderClientId: string; expiresAt: string }
  respondPermission?(input: {
    sessionId: string
    interactionId: string
    decision: string
    client: { clientSessionId: string }
    leaseId: string
    generation: string
    formAnswers?: Record<string, unknown>
    cancel?: boolean
  }): void
}

export interface LocalWorkspacePort {
  listDir(projectId: string, relativePath: string): Promise<WorkspaceEntry[]> | WorkspaceEntry[]
  readFile(
    projectId: string,
    relativePath: string,
  ): Promise<{ content: string | Uint8Array; hash?: string }> | { content: string | Uint8Array; hash?: string }
  writeFile(
    projectId: string,
    relativePath: string,
    content: string | Uint8Array,
  ): Promise<{ hash?: string }> | { hash?: string }
  search(
    projectId: string,
    query: string,
  ): Promise<Array<{ path: string; line?: number; preview?: string }>> | Array<{ path: string; line?: number; preview?: string }>
  watch?(
    projectId: string,
    relativePath?: string,
  ): AsyncIterable<{ path: string; type: string }>
}

export interface LocalEnvironmentGatewayOptions {
  /** Directory that holds `environment-id` (typically Electron userData). */
  dataDir: string
  /** Optional label override (defaults to hostname / "This computer"). */
  label?: string
  /** Injected project listing for Phase 0; defaults to empty. */
  listProjects?: () => Promise<ProjectSnapshot[]> | ProjectSnapshot[]
  getProject?: (projectId: string) => Promise<ProjectSnapshot | null> | ProjectSnapshot | null
  /** Optional node version string; defaults to process.version. */
  nodeVersion?: string
  /** Optional session port (gateway-parity path; Electron SessionManager remains separate). */
  sessions?: LocalSessionPort
  /** Optional workspace port for local FS gateway routing. */
  workspace?: LocalWorkspacePort
  clientSessionId?: string
}

function mapOs(): ExecutionEnvironmentDescriptor['platform']['os'] {
  const p = osPlatform()
  if (p === 'darwin' || p === 'linux' || p === 'win32') {
    return p === 'win32' ? 'windows' : p
  }
  // Best-effort fallback for uncommon platforms (e.g. freebsd in tests).
  return 'linux'
}

function notWired(method: string): never {
  throw new Error(
    `LocalEnvironmentGateway.${method} is not wired yet; existing desktop Session/terminal IPC remains authoritative until Phase 0 routing migrates`,
  )
}

/**
 * In-process environment gateway for the desktop runtime.
 *
 * Local is one ExecutionEnvironment. Call sites should prefer EnvironmentHost /
 * window.environment over raw app IPC; session list is the first fully wired
 * local session surface (create/send/etc. still migrate incrementally).
 */
export class LocalEnvironmentGateway implements EnvironmentGateway {
  readonly sessions: SessionGateway
  readonly interactions: InteractionGateway
  readonly terminals: TerminalGateway
  readonly workspace: WorkspaceGateway

  private readonly environmentId: string
  private readonly label: string
  private readonly nodeVersion: string
  private readonly listProjectsFn: () => Promise<ProjectSnapshot[]> | ProjectSnapshot[]
  private readonly getProjectFn: (projectId: string) => Promise<ProjectSnapshot | null> | ProjectSnapshot | null
  private readonly sessionPort: LocalSessionPort | null
  private readonly workspacePort: LocalWorkspacePort | null
  private readonly clientSessionId: string

  constructor(opts: LocalEnvironmentGatewayOptions) {
    this.environmentId = loadOrCreateLocalEnvironmentId(opts.dataDir)
    this.label = opts.label ?? (hostname() || LOCAL_ENVIRONMENT_LABEL)
    this.nodeVersion = opts.nodeVersion ?? process.version
    this.listProjectsFn = opts.listProjects ?? (() => [])
    this.getProjectFn = opts.getProject ?? (async () => null)
    this.sessionPort = opts.sessions ?? null
    this.workspacePort = opts.workspace ?? null
    this.clientSessionId = opts.clientSessionId ?? 'local-desktop'

    this.sessions = this.createSessionGateway()
    this.interactions = this.createInteractionGateway()
    this.terminals = this.createTerminalGateway()
    this.workspace = this.createWorkspaceGateway()
  }

  getEnvironmentId(): string {
    return this.environmentId
  }

  async getDescriptor(): Promise<ExecutionEnvironmentDescriptor> {
    return {
      environmentId: this.environmentId,
      label: this.label,
      platform: {
        os: mapOs(),
        arch: osArch(),
      },
      nodeVersion: this.nodeVersion,
      protocolVersion: PROTOCOL_GENERATION.current,
      capabilities: { ...LOCAL_ENVIRONMENT_CAPABILITIES, harnessIds: [...LOCAL_ENVIRONMENT_CAPABILITIES.harnessIds] },
      generations: {
        protocol: { ...PROTOCOL_GENERATION },
        databaseSchema: { ...DATABASE_SCHEMA_GENERATION },
      },
    }
  }

  async listProjects(): Promise<ProjectSnapshot[]> {
    return await this.listProjectsFn()
  }

  async getProject(projectId: string): Promise<ProjectSnapshot | null> {
    return await this.getProjectFn(projectId)
  }

  async getSnapshot(): Promise<EnvironmentSnapshot> {
    const projects = await this.listProjects()
    return {
      environmentId: this.environmentId,
      snapshotSequence: '0',
      capturedAt: Date.now(),
      projects,
      sessions: [],
      terminals: [],
      pendingInteractions: [],
    }
  }

  async *subscribeEvents(_input: SubscribeEventsInput): AsyncIterable<EnvironmentEventEnvelope> {
    // Local event log is not durable yet; consumers should keep using existing
    // SessionManager / renderer transports until Phase 3 projection lands.
    return
  }

  private createSessionGateway(): SessionGateway {
    const port = this.sessionPort
    const clientSessionId = this.clientSessionId
    if (!port) {
      return {
        create: async () => notWired('sessions.create'),
        get: async () => notWired('sessions.get'),
        list: async () => notWired('sessions.list'),
        send: async () => notWired('sessions.send'),
        patchSettings: async () => notWired('sessions.patchSettings'),
        interrupt: async () => notWired('sessions.interrupt'),
        close: async () => notWired('sessions.close'),
        acquireControl: async () => notWired('sessions.acquireControl'),
        renewControl: async () => notWired('sessions.renewControl'),
        releaseControl: async () => notWired('sessions.releaseControl'),
      }
    }
    return {
      create: async (input: CreateSessionInput) => {
        const created = port.create({
          projectId: input.project.projectId,
          harnessId: (input.options?.harnessId as string) ?? undefined,
          providerId: input.providerId,
          title: input.title,
        })
        return { sessionId: created.sessionId }
      },
      get: async (ref: SessionRef) => port.get(ref.sessionId),
      list: async (project: ProjectRef, options: { limit: number; offset: number }) =>
        port.list(project.projectId, options),
      send: async (input: SendMessageInput) => {
        await port.send({
          sessionId: input.session.sessionId,
          text: input.text,
          client: { clientSessionId },
          leaseId: input.leaseId,
          generation: input.generation,
        })
      },
      patchSettings: async (input) => {
        if (!port.patchSettings) notWired('sessions.patchSettings')
        return port.patchSettings!({
          sessionId: input.session.sessionId,
          permissionMode: input.permissionMode,
          sandboxMode: input.sandboxMode,
          model: input.model,
          effort: input.effort,
          apiProviderId: input.apiProviderId,
        })
      },
      interrupt: async () => {
        /* local interrupt optional */
      },
      close: async () => {},
      acquireControl: async (input: LeaseAcquireInput & { resource: SessionRef }) => {
        const lease = port.acquireControl({
          sessionId: input.resource.sessionId,
          holderClientId: clientSessionId,
          ttlMs: input.ttlMs,
        })
        return {
          leaseId: lease.leaseId,
          resource: input.resource,
          holderClientId: lease.holderClientId,
          generation: lease.generation,
          expiresAt: lease.expiresAt,
        }
      },
      renewControl: async (input: LeaseRenewInput) => ({
        leaseId: input.leaseId,
        resource: { environmentId: this.environmentId, sessionId: '' },
        holderClientId: clientSessionId,
        generation: input.generation,
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
      }),
      releaseControl: async () => {},
    }
  }

  private createInteractionGateway(): InteractionGateway {
    const port = this.sessionPort
    const clientSessionId = this.clientSessionId
    return {
      listPending: async (session: SessionRef) => {
        if (!port) notWired('interactions.listPending')
        const s = port.get(session.sessionId) as {
          pendingInteraction?: {
            interactionId: string
            kind: 'permission' | 'question' | 'plan' | 'session_agents_confirm'
            createdAt: number
          } | null
        } | null
        if (!s?.pendingInteraction) return []
        const p = s.pendingInteraction
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
        if (!port?.respondPermission) notWired('interactions.respondPermission')
        const formAnswers =
          input.options && typeof input.options === 'object'
            ? ((input.options as { formAnswers?: Record<string, unknown> }).formAnswers
              ?? (input.options as Record<string, unknown>))
            : undefined
        const cancel =
          input.options && typeof input.options === 'object'
            ? (input.options as { cancel?: boolean }).cancel === true
            : false
        port.respondPermission!({
          sessionId: input.session.sessionId,
          interactionId: input.interactionId,
          decision: input.decision,
          client: { clientSessionId },
          leaseId: input.leaseId,
          generation: input.generation,
          formAnswers,
          cancel,
        })
      },
      respondQuestion: async () => notWired('interactions.respondQuestion'),
      respondPlan: async () => notWired('interactions.respondPlan'),
    }
  }

  private createTerminalGateway(): TerminalGateway {
    return {
      create: async (_input: CreateTerminalInput) => notWired('terminals.create'),
      attach: async (_ref: TerminalRef) => notWired('terminals.attach'),
      read: async (_ref: TerminalRef, _afterSequence: string) => notWired('terminals.read'),
      write: async (_input: TerminalWriteInput) => notWired('terminals.write'),
      resize: async (_input: TerminalResizeInput) => notWired('terminals.resize'),
      kill: async (_ref: TerminalRef, _control: MutatingControlContext) => notWired('terminals.kill'),
      acquireControl: async (_input: LeaseAcquireInput & { resource: TerminalRef }) => notWired('terminals.acquireControl'),
      renewControl: async (_input: LeaseRenewInput) => notWired('terminals.renewControl'),
      releaseControl: async (_input: LeaseReleaseInput) => notWired('terminals.releaseControl'),
    }
  }

  private createWorkspaceGateway(): WorkspaceGateway {
    const port = this.workspacePort
    if (!port) {
      return {
        listDir: async () => notWired('workspace.listDir'),
        readFile: async () => notWired('workspace.readFile'),
        writeFile: async () => notWired('workspace.writeFile'),
        rename: async () => notWired('workspace.rename'),
        move: async () => notWired('workspace.move'),
        delete: async () => notWired('workspace.delete'),
        mkdir: async () => notWired('workspace.mkdir'),
        search: async () => notWired('workspace.search'),
        watch: () => notWired('workspace.watch'),
        tailWatchStart: async () => notWired('workspace.tailWatchStart'),
        tailWatchPoll: async () => notWired('workspace.tailWatchPoll'),
        tailWatchStop: async () => notWired('workspace.tailWatchStop'),
      }
    }
    return {
      listDir: async (input: WorkspaceListInput) =>
        port.listDir(input.project.projectId, input.relativePath),
      readFile: async (input: WorkspaceReadInput) =>
        port.readFile(input.project.projectId, input.relativePath),
      writeFile: async (input: WorkspaceWriteInput) =>
        port.writeFile(input.project.projectId, input.relativePath, input.content),
      rename: async () => notWired('workspace.rename'),
      move: async () => notWired('workspace.move'),
      delete: async () => notWired('workspace.delete'),
      mkdir: async () => notWired('workspace.mkdir'),
      search: async (input: WorkspaceSearchInput) =>
        port.search(input.project.projectId, input.query),
      watch: (input: WorkspaceWatchInput): AsyncIterable<{ path: string; type: string }> => {
        if (!port.watch) notWired('workspace.watch')
        return port.watch!(input.project.projectId, input.relativePath)
      },
      tailWatchStart: async () => notWired('workspace.tailWatchStart'),
      tailWatchPoll: async () => notWired('workspace.tailWatchPoll'),
      tailWatchStop: async () => notWired('workspace.tailWatchStop'),
    }
  }
}
