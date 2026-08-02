import { app } from 'electron'
import { join } from 'node:path'
import type {
  EndpointProfile,
  EnvironmentGateway,
  EnvironmentInstallProgress,
  EnvironmentListItem,
  ExecutionEnvironmentDescriptor,
  ProjectRef,
  SupervisorSnapshot,
  TerminalReadResult,
} from '@superone/shared/environment'
import {
  DEFAULT_NODE_REMOTE_PORT,
  DEFAULT_REMOTE_INSTALL_SOURCE,
  selectEndpointWithFailover,
  tailscaleEndpoint,
  relayEndpoint,
  tunnelSpecFromEndpoint,
  type RemoteInstallSource,
} from '@superone/shared/environment'
import { EnvironmentRegistryImpl } from './environment-registry'
import { NodeConnectionManager } from './node-connection-manager'
import { NodeCredentialStore } from './node-credential-store'
import { WorkspaceRouter } from './workspace-router'
import { probeEndpointHealth, discoverTailscaleHost } from './endpoint-probes'
import type { KnownEnvironmentRecord } from './node-connection-manager'
import { SshTunnelManager } from './ssh-tunnel-manager'
import { bootstrapNodeOverSsh, type SshBootstrapOptions, type SshBootstrapResult } from './ssh-bootstrap'
import {
  installNodeFromRegistry,
  installNodeOverSsh,
  preflightBlocker,
  probeRemoteHost,
  type InstallOptions,
  type InstallResult,
  type RegistryInstallOptions,
  type RemoteHostProbe,
  type SshTarget,
} from './remote-install'
import { findDistArtifact, missingArtifactMessage, type DistArtifact } from './dist-locator'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join as pathJoin, resolve as pathResolve } from 'node:path'
import { readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { getRecentFolders, addRecentFolder, removeRecentFolder } from '../recent-folders'
import type { ProjectSnapshot } from '@superone/shared/environment'
import { RemoteEnvironmentGateway } from './remote-environment-gateway'
import {
  RemoteHostActionConsumer,
  type HostActionExecutor,
} from './remote-host-action-consumer'

export interface EnvironmentHostOptions {
  /** Injectable for tests; production opens real `ssh -L` forwards. */
  tunnels?: SshTunnelManager
  /** Injectable for tests; production shells out to the system OpenSSH client. */
  bootstrapOverSsh?: (opts: SshBootstrapOptions) => Promise<SshBootstrapResult>
  probeHost?: (target: SshTarget) => Promise<RemoteHostProbe>
  installNode?: (opts: InstallOptions) => Promise<InstallResult>
  installFromRegistry?: (opts: RegistryInstallOptions) => Promise<InstallResult>
  findArtifact?: (target: string) => DistArtifact | null
  /** Default package version for registry installs (tests / overrides). */
  defaultCliVersion?: string
  /**
   * Host Action executor. Injectable stub for tests; production will wire real
   * desktop tools later. When omitted, a no-op fail executor is used so the
   * consumer loop still runs without calling the MCP surface.
   */
  hostActionExecutor?: HostActionExecutor
  hostActionConcurrency?: number
  hostActionPollWaitMs?: number
}

export interface AddRemoteOverSshInput {
  /** OpenSSH destination: `user@host` or a `~/.ssh/config` Host alias. */
  destination: string
  /**
   * Absolute path to `superone` on the remote host. Optional: when omitted the
   * host is probed and, if missing, installed via `installSource`.
   */
  remoteExec?: string
  /**
   * How to obtain `superone` when not already on the host.
   * Default: `registry` (`@super-one/cli`). Use `upload` for local dist / debug.
   */
  installSource?: RemoteInstallSource
  /** Pinned CLI version for registry installs; defaults to desktop app version. */
  packageVersion?: string
  remotePort?: number
  remoteNodeHome?: string
  sshPort?: number
  identityFile?: string
  label?: string
}


/**
 * Main-process environment host — constructs the product path for local + remote
 * gateways, WorkspaceRouter, and credential-backed reconnection.
 */
export class EnvironmentHost {
  readonly registry: EnvironmentRegistryImpl
  readonly credentials: NodeCredentialStore
  readonly connections: NodeConnectionManager
  readonly workspaceRouter: WorkspaceRouter
  readonly tunnels: SshTunnelManager
  private readonly knownPath: string
  private readonly bootstrap: (opts: SshBootstrapOptions) => Promise<SshBootstrapResult>
  private readonly probeHost: (target: SshTarget) => Promise<RemoteHostProbe>
  private readonly installNode: (opts: InstallOptions) => Promise<InstallResult>
  private readonly installFromRegistry: (opts: RegistryInstallOptions) => Promise<InstallResult>
  private readonly findArtifact: (target: string) => DistArtifact | null
  private readonly defaultCliVersion: string | undefined
  private readonly statusListeners = new Set<(snapshot: SupervisorSnapshot) => void>()
  /** Last snapshot per connection, so list() reports state without a live socket. */
  private readonly lastStatus = new Map<string, SupervisorSnapshot>()
  /** One remote project snapshot per live connection generation. */
  private readonly remoteProjectCache = new Map<
    string,
    { generation: number; projects: ProjectSnapshot[] }
  >()
  private readonly remoteProjectLoads = new Map<
    string,
    { generation: number; promise: Promise<ProjectSnapshot[]> }
  >()
  /** One Host Action consumer per live connectionId. */
  private readonly hostActionConsumers = new Map<string, RemoteHostActionConsumer>()
  private readonly hostActionExecutor: HostActionExecutor
  private readonly hostActionConcurrency: number
  private readonly hostActionPollWaitMs: number

  constructor(userDataDir?: string, options: EnvironmentHostOptions = {}) {
    const dataDir = userDataDir || app.getPath('userData')
    mkdirSync(dataDir, { recursive: true })
    this.knownPath = join(dataDir, 'known-environments.json')
    this.credentials = new NodeCredentialStore(dataDir)
    // Production default: real desktop MCP tool surface (browser_snapshot, …).
    // Lazy require avoids pulling MCP/electron into pure unit tests that only
    // inject a stub executor.
    this.hostActionExecutor =
      options.hostActionExecutor ??
      (async (claimed, signal, connectionId) => {
        const { desktopHostActionExecutor } = await import('./host-action-executor')
        return desktopHostActionExecutor(claimed, signal, connectionId)
      })
    this.hostActionConcurrency = Math.max(2, options.hostActionConcurrency ?? 2)
    this.hostActionPollWaitMs = options.hostActionPollWaitMs ?? 10_000
    this.registry = new EnvironmentRegistryImpl({
      dataDir,
      listProjects: async () =>
        getRecentFolders().map(
          (f): ProjectSnapshot => ({
            projectId: f.id,
            path: f.path,
            name: f.name,
            lastActiveAt: Date.parse(f.lastOpened) || undefined,
          }),
        ),
      getProject: async (projectId) => {
        const f = getRecentFolders().find((x) => x.id === projectId)
        if (!f) return null
        return {
          projectId: f.id,
          path: f.path,
          name: f.name,
          lastActiveAt: Date.parse(f.lastOpened) || undefined,
        }
      },
    })
    this.tunnels = options.tunnels ?? new SshTunnelManager()
    this.bootstrap = options.bootstrapOverSsh ?? bootstrapNodeOverSsh
    this.probeHost = options.probeHost ?? probeRemoteHost
    this.installNode = options.installNode ?? installNodeOverSsh
    this.installFromRegistry = options.installFromRegistry ?? installNodeFromRegistry
    this.findArtifact = options.findArtifact ?? ((target) => findDistArtifact(target))
    this.defaultCliVersion = options.defaultCliVersion
    this.connections = new NodeConnectionManager({
      credentialStore: this.credentials,
      loadKnownEnvironments: () => this.loadKnown(),
      saveKnownEnvironment: (env) => this.saveKnown(env),
      deleteKnownEnvironment: (connectionId) => this.deleteKnown(connectionId),
      onSupervisorState: (snapshot) => this.publishStatus(snapshot),
    })
    this.registry.setConnectionManager(this.connections)
    this.workspaceRouter = new WorkspaceRouter((environmentId) => this.registry.get(environmentId))
  }

  getLocalGateway(): EnvironmentGateway {
    return this.registry.getLocal()
  }

  getGateway(environmentId: string): EnvironmentGateway | null {
    return this.registry.get(environmentId)
  }

  /** Route workspace ops for a project ref (product path — never raw local FS for remote). */
  workspace() {
    return this.workspaceRouter
  }

  async pairRemote(input: {
    baseUrl: string
    pairingToken: string
    label: string
    endpointProfiles?: EndpointProfile[]
  }) {
    const result = await this.connections.pairAndConnect(input)
    this.startHostActionConsumer(result.connectionId)
    return result
  }

  /**
   * Test helper: whether the Host Action consumer for a connection is running.
   * The consumer is independent of chat views and sendSessionMessage drains.
   */
  isHostActionConsumerRunning(connectionId: string): boolean {
    return this.hostActionConsumers.get(connectionId)?.isRunning === true
  }

  /** Subscribe to supervisor state changes; returns an unsubscribe function. */
  onStatusChange(listener: (snapshot: SupervisorSnapshot) => void): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  /**
   * Live gateway for a paired remote host, or a coded error explaining why the
   * host cannot be reached. Every remote-only operation goes through here.
   */
  private requireRemoteGateway(connectionId: string): RemoteEnvironmentGateway {
    return this.resolveRemote(connectionId).gateway
  }

  private resolveRemote(connectionId: string): {
    gateway: RemoteEnvironmentGateway
    environmentId: string
    connectionId: string
  } {
    const known = this.connections.listKnown().find((k) => k.connectionId === connectionId)
    if (!known) {
      throw Object.assign(new Error(`unknown connection ${connectionId}`), { code: 'not_found' })
    }
    const gateway = this.connections.getGateway(known.environmentId)
    if (!gateway || !(gateway instanceof RemoteEnvironmentGateway)) {
      throw Object.assign(new Error('environment is not connected'), { code: 'failed_precondition' })
    }
    return { gateway, environmentId: known.environmentId, connectionId }
  }

  /**
   * Map a node session record (or gateway list item) to the sidebar history row shape.
   */
  private mapRemoteSessionEntry(raw: unknown): {
    sessionId: string
    title: string
    lastActiveAt: string
    provider?: string
    messageCount: number
    isPinned?: boolean
    isHidden?: boolean
    worktreePath?: string | null
    isWorktree?: boolean
  } {
    const s = (raw ?? {}) as {
      sessionId?: string
      title?: string | null
      updatedAt?: number
      createdAt?: number
      harnessId?: string
      providerId?: string
      transcript?: unknown[]
      status?: string
      isPinned?: boolean
      isHidden?: boolean
      /** Absolute host cwd when session is bound to a worktree (or explicit root). */
      cwd?: string | null
    }
    const sessionId = String(s.sessionId ?? '')
    const ts = s.updatedAt ?? s.createdAt ?? Date.now()
    const cwd = typeof s.cwd === 'string' && s.cwd.trim() ? s.cwd.trim() : null
    return {
      sessionId,
      title: (s.title && String(s.title).trim()) || 'New session',
      lastActiveAt: new Date(ts).toISOString(),
      provider: s.harnessId || s.providerId || 'claude',
      messageCount: Array.isArray(s.transcript) ? s.transcript.length : 0,
      isPinned: Boolean(s.isPinned),
      isHidden: Boolean(s.isHidden),
      // Node sessions use cwd for worktree isolation; surface as desktop worktree fields.
      worktreePath: cwd,
      isWorktree: Boolean(cwd),
    }
  }

  /**
   * List sessions for a project on a host.
   * Local callers should keep using the desktop session DB; this is for remote nodes.
   */
  async listSessions(
    connectionId: string,
    projectId: string,
  ): Promise<
    Array<{
      sessionId: string
      title: string
      lastActiveAt: string
      provider?: string
      messageCount: number
    }>
  > {
    if (connectionId === 'local') {
      throw Object.assign(new Error('listSessions via environment host is remote-only'), {
        code: 'invalid_argument',
      })
    }
    if (!projectId) {
      throw Object.assign(new Error('projectId is required'), { code: 'invalid_argument' })
    }
    const { gateway, environmentId } = this.resolveRemote(connectionId)
    const listed = await gateway.sessions.list({ environmentId, projectId })
    const rows = Array.isArray(listed) ? listed : []
    return rows
      .map((r) => this.mapRemoteSessionEntry(r))
      .filter((r) => r.sessionId)
      .sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
  }

  /**
   * Create a session on a remote node project (sidebar "New session").
   */
  async createSession(
    connectionId: string,
    input: { projectId: string; title?: string; providerId?: string; harnessId?: string },
  ): Promise<{
    sessionId: string
    title: string
    lastActiveAt: string
    provider?: string
    messageCount: number
  }> {
    if (connectionId === 'local') {
      throw Object.assign(new Error('createSession via environment host is remote-only'), {
        code: 'invalid_argument',
      })
    }
    if (!input.projectId) {
      throw Object.assign(new Error('projectId is required'), { code: 'invalid_argument' })
    }
    const { gateway, environmentId } = this.resolveRemote(connectionId)
    // Match desktop default preferredProvider — not codex.
    const harnessId = input.harnessId ?? 'claude'
    const providerId = input.providerId ?? harnessId
    const { sessionId } = await gateway.sessions.create({
      project: { environmentId, projectId: input.projectId },
      providerId,
      title: input.title,
      options: { harnessId },
    })
    const got = await gateway.sessions.get({ environmentId, sessionId })
    return this.mapRemoteSessionEntry(got ?? { sessionId, title: input.title, harnessId, providerId })
  }

  /** Per remote session control lease (desktop Main owns lease lifecycle). */
  private readonly sessionLeases = new Map<
    string,
    { leaseId: string; generation: string; expiresAt: number }
  >()

  /** Serialize ensureSessionLease per session key to avoid concurrent acquire races. */
  private readonly sessionLeaseInflight = new Map<string, Promise<{ leaseId: string; generation: string }>>()

  private readonly terminalLeases = new Map<
    string,
    { leaseId: string; generation: string; expiresAt: number }
  >()

  private leaseKey(connectionId: string, sessionId: string): string {
    return `${connectionId}:${sessionId}`
  }

  private terminalLeaseKey(connectionId: string, terminalId: string): string {
    return `${connectionId}:${terminalId}`
  }

  private async ensureTerminalLease(
    connectionId: string,
    terminalId: string,
  ): Promise<{ leaseId: string; generation: string }> {
    const { gateway, environmentId } = this.resolveRemote(connectionId)
    const key = this.terminalLeaseKey(connectionId, terminalId)
    const existing = this.terminalLeases.get(key)
    const now = Date.now()
    if (existing?.expiresAt && existing.expiresAt > now + 5_000) {
      return { leaseId: existing.leaseId, generation: existing.generation }
    }

    if (existing) {
      try {
        const renewed = await gateway.terminals.renewControl({
          leaseId: existing.leaseId,
          generation: existing.generation,
          ttlMs: 60_000,
        })
        this.terminalLeases.set(key, {
          leaseId: renewed.leaseId,
          generation: renewed.generation,
          expiresAt: Date.parse(renewed.expiresAt),
        })
        return { leaseId: renewed.leaseId, generation: renewed.generation }
      } catch {
        this.terminalLeases.delete(key)
      }
    }

    const lease = await gateway.terminals.acquireControl({
      resource: { environmentId, terminalId },
      ttlMs: 60_000,
    })
    this.terminalLeases.set(key, {
      leaseId: lease.leaseId,
      generation: lease.generation,
      expiresAt: Date.parse(lease.expiresAt),
    })
    return { leaseId: lease.leaseId, generation: lease.generation }
  }

  async createRemoteTerminal(
    connectionId: string,
    input: { cwd: string; title?: string; cols?: number; rows?: number },
  ): Promise<{ terminalId: string }> {
    const { gateway } = this.resolveRemote(connectionId)
    const created = await gateway.terminals.create({
      cwd: input.cwd,
      title: input.title,
      cols: input.cols,
      rows: input.rows,
    })
    await this.ensureTerminalLease(connectionId, created.terminalId)
    return created
  }

  async attachRemoteTerminal(
    connectionId: string,
    terminalId: string,
  ): Promise<{ snapshot: string; sequence: string }> {
    const { gateway, environmentId } = this.resolveRemote(connectionId)
    return gateway.terminals.attach({ environmentId, terminalId })
  }

  async readRemoteTerminal(
    connectionId: string,
    terminalId: string,
    afterSequence: string,
  ): Promise<TerminalReadResult> {
    const { gateway, environmentId } = this.resolveRemote(connectionId)
    return gateway.terminals.read({ environmentId, terminalId }, afterSequence)
  }

  async writeRemoteTerminal(connectionId: string, terminalId: string, data: string): Promise<void> {
    const { gateway, environmentId } = this.resolveRemote(connectionId)
    const control = await this.ensureTerminalLease(connectionId, terminalId)
    await gateway.terminals.write({
      terminal: { environmentId, terminalId },
      data,
      ...control,
    })
  }

  async resizeRemoteTerminal(
    connectionId: string,
    terminalId: string,
    cols: number,
    rows: number,
  ): Promise<void> {
    const { gateway, environmentId } = this.resolveRemote(connectionId)
    const control = await this.ensureTerminalLease(connectionId, terminalId)
    await gateway.terminals.resize({
      terminal: { environmentId, terminalId },
      cols,
      rows,
      ...control,
    })
  }

  async killRemoteTerminal(connectionId: string, terminalId: string): Promise<void> {
    const { gateway, environmentId } = this.resolveRemote(connectionId)
    const key = this.terminalLeaseKey(connectionId, terminalId)
    const control = await this.ensureTerminalLease(connectionId, terminalId)
    try {
      await gateway.terminals.kill({ environmentId, terminalId }, control)
    } finally {
      this.terminalLeases.delete(key)
      await gateway.terminals.releaseControl(control).catch(() => {})
    }
  }

  private async ensureSessionLease(
    connectionId: string,
    sessionId: string,
  ): Promise<{ leaseId: string; generation: string }> {
    const key = this.leaseKey(connectionId, sessionId)
    const existingInflight = this.sessionLeaseInflight.get(key)
    if (existingInflight) return existingInflight

    const work = this.ensureSessionLeaseUnlocked(connectionId, sessionId).finally(() => {
      if (this.sessionLeaseInflight.get(key) === work) {
        this.sessionLeaseInflight.delete(key)
      }
    })
    this.sessionLeaseInflight.set(key, work)
    return work
  }

  private async ensureSessionLeaseUnlocked(
    connectionId: string,
    sessionId: string,
  ): Promise<{ leaseId: string; generation: string }> {
    const { gateway, environmentId } = this.resolveRemote(connectionId)
    const key = this.leaseKey(connectionId, sessionId)
    const existing = this.sessionLeases.get(key)
    const now = Date.now()
    const parseExpiry = (expiresAt: string | number | undefined): number => {
      if (typeof expiresAt === 'number' && Number.isFinite(expiresAt)) return expiresAt
      if (typeof expiresAt === 'string') {
        const t = Date.parse(expiresAt)
        if (Number.isFinite(t)) return t
      }
      return now + 60_000
    }
    if (existing && existing.expiresAt > now + 5_000) {
      try {
        const renewed = await gateway.sessions.renewControl({
          leaseId: existing.leaseId,
          generation: existing.generation,
          ttlMs: 60_000,
        })
        this.sessionLeases.set(key, {
          leaseId: renewed.leaseId,
          generation: renewed.generation,
          expiresAt: parseExpiry(renewed.expiresAt as string | number | undefined),
        })
        return { leaseId: renewed.leaseId, generation: renewed.generation }
      } catch {
        this.sessionLeases.delete(key)
      }
    }
    const lease = await gateway.sessions.acquireControl({
      resource: { environmentId, sessionId },
      ttlMs: 60_000,
    })
    this.sessionLeases.set(key, {
      leaseId: lease.leaseId,
      generation: lease.generation,
      expiresAt: parseExpiry(lease.expiresAt as string | number | undefined),
    })
    return { leaseId: lease.leaseId, generation: lease.generation }
  }

  async getSession(connectionId: string, sessionId: string): Promise<unknown> {
    const { gateway, environmentId } = this.resolveRemote(connectionId)
    return gateway.sessions.get({ environmentId, sessionId })
  }

  private asRemoteProviderGw(connectionId: string): RemoteEnvironmentGateway {
    const { gateway } = this.resolveRemote(connectionId)
    if (!(gateway instanceof RemoteEnvironmentGateway)) {
      throw Object.assign(new Error('environment is not connected'), { code: 'failed_precondition' })
    }
    return gateway
  }

  async listRemoteCredentials(connectionId: string): Promise<unknown> {
    return this.asRemoteProviderGw(connectionId).providerListCredentials()
  }

  async getRemoteCredentialDecrypted(connectionId: string, id: string): Promise<unknown> {
    return this.asRemoteProviderGw(connectionId).providerGetCredentialDecrypted(id)
  }

  async listRemoteModels(
    connectionId: string,
    harness: string,
    apiProviderId?: string | null,
  ): Promise<unknown> {
    return this.asRemoteProviderGw(connectionId).providerListModels({ harness, apiProviderId })
  }

  async createRemoteCredential(connectionId: string, input: Record<string, unknown>): Promise<unknown> {
    return this.asRemoteProviderGw(connectionId).providerCreateCredential(input)
  }

  async updateRemoteCredential(connectionId: string, input: Record<string, unknown>): Promise<unknown> {
    return this.asRemoteProviderGw(connectionId).providerUpdateCredential(input)
  }

  async deleteRemoteCredential(connectionId: string, id: string): Promise<unknown> {
    return this.asRemoteProviderGw(connectionId).providerDeleteCredential(id)
  }

  async listRemoteBindings(connectionId: string): Promise<unknown> {
    return this.asRemoteProviderGw(connectionId).providerListBindings()
  }

  async setRemoteBinding(connectionId: string, binding: Record<string, unknown>): Promise<unknown> {
    return this.asRemoteProviderGw(connectionId).providerSetBinding(binding)
  }

  async clearRemoteBinding(connectionId: string, consumer: string): Promise<unknown> {
    return this.asRemoteProviderGw(connectionId).providerClearBinding(consumer)
  }

  async listRemoteCustomPlatforms(connectionId: string): Promise<unknown> {
    return this.asRemoteProviderGw(connectionId).providerListCustomPlatforms()
  }

  async upsertRemoteCustomPlatform(connectionId: string, def: Record<string, unknown>): Promise<unknown> {
    return this.asRemoteProviderGw(connectionId).providerUpsertCustomPlatform(def)
  }

  async deleteRemoteCustomPlatform(connectionId: string, id: string): Promise<unknown> {
    return this.asRemoteProviderGw(connectionId).providerDeleteCustomPlatform(id)
  }

  /**
   * Push desktop provider credentials (+ bindings + custom platforms) to a node.
   * Secrets are decrypted only in Main and re-encrypted on the node.
   */
  async pushLocalProvidersToRemote(
    connectionId: string,
    opts?: { replaceAll?: boolean },
  ): Promise<{ credentials: number; bindings: number }> {
    const {
      listCredentials,
      getCredentialDecrypted,
      listBindings,
      listCustomPlatforms,
    } = await import('../providers/credential-store')
    const masked = listCredentials()
    const credentials = masked.map((c) => {
      const full = getCredentialDecrypted(c.id)
      return full ?? { ...c, secret: '' }
    })
    const bundle = {
      credentials,
      bindings: listBindings(),
      customPlatforms: listCustomPlatforms(),
    }
    const result = (await this.asRemoteProviderGw(connectionId).providerImportBundle(bundle, {
      replaceAll: opts?.replaceAll === true,
    })) as { credentials?: number; bindings?: number }
    return {
      credentials: Number(result?.credentials ?? 0),
      bindings: Number(result?.bindings ?? 0),
    }
  }

  /**
   * Pull node provider credentials onto this desktop (overwrites by id).
   */
  async pullRemoteProvidersToLocal(
    connectionId: string,
    opts?: { replaceAll?: boolean },
  ): Promise<{ credentials: number; bindings: number }> {
    const bundle = (await this.asRemoteProviderGw(connectionId).providerExportBundle()) as {
      credentials?: Array<{
        id: string
        platformId: string
        planId: string
        name: string
        secret: string
        secretEnv?: string
        overrides?: Record<string, unknown>
        endpoints?: unknown[]
        notes?: string
        sortOrder?: number
      }>
      bindings?: Array<{
        consumer: string
        credentialId: string
        endpointId?: string
        config?: unknown
      }>
      customPlatforms?: Array<{ id: string }>
    }
    const {
      createCredential,
      updateCredential,
      deleteCredential,
      listCredentials,
      setBinding,
      deleteBinding,
      listBindings,
      upsertCustomPlatform,
      deleteCustomPlatform,
      listCustomPlatforms,
    } = await import('../providers/credential-store')
    if (opts?.replaceAll) {
      for (const b of listBindings()) deleteBinding(b.consumer)
      for (const c of listCredentials()) deleteCredential(c.id)
      for (const p of listCustomPlatforms()) deleteCustomPlatform(p.id)
    }
    for (const plat of bundle.customPlatforms ?? []) {
      if (plat && typeof plat === 'object' && 'id' in plat) {
        upsertCustomPlatform(plat as never)
      }
    }
    let creds = 0
    for (const c of bundle.credentials ?? []) {
      if (!c?.id || !c.platformId || !c.planId || !c.name) continue
      const existing = listCredentials().find((x) => x.id === c.id)
      if (existing) {
        updateCredential(c.id, {
          name: c.name,
          secret: c.secret,
          secretEnv: c.secretEnv,
          overrides: c.overrides as never,
          endpoints: (c.endpoints as never) ?? null,
          notes: c.notes,
          sortOrder: c.sortOrder,
        })
      } else {
        createCredential({
          id: c.id,
          platformId: c.platformId,
          planId: c.planId,
          name: c.name,
          secret: c.secret,
          secretEnv: c.secretEnv,
          overrides: c.overrides as never,
          endpoints: c.endpoints as never,
          notes: c.notes,
        })
      }
      creds += 1
    }
    let binds = 0
    for (const b of bundle.bindings ?? []) {
      if (!b?.consumer || !b.credentialId) continue
      setBinding({
        consumer: b.consumer as never,
        credentialId: b.credentialId,
        endpointId: b.endpointId,
        config: b.config as never,
      })
      binds += 1
    }
    return { credentials: creds, bindings: binds }
  }

  /**
   * Set agent cwd on a node session (project root or worktree host path).
   * `cwdHostPath` null clears to the project registry path.
   */
  async setSessionCwd(
    connectionId: string,
    sessionId: string,
    cwdHostPath: string | null,
  ): Promise<unknown> {
    const { gateway } = this.resolveRemote(connectionId)
    if (!(gateway instanceof RemoteEnvironmentGateway)) {
      throw Object.assign(new Error('environment is not connected'), { code: 'failed_precondition' })
    }
    const control = await this.ensureSessionLease(connectionId, sessionId)
    return gateway.sessionSetCwd({
      sessionId,
      cwd: cwdHostPath,
      leaseId: control.leaseId,
      generation: control.generation,
    })
  }

  /**
   * Send a user message on a remote session, then poll until the turn settles.
   * While waiting, drain `session.events`, map text-only node events → AgentEvent,
   * and emit them via `agentEventSink` for live remote chat UI.
   * Returns the final node session record (transcript + status).
   */
  async sendSessionMessage(
    connectionId: string,
    input: {
      sessionId: string
      text: string
      clientMessageId?: string
      /** Desktop project key for AgentEvent routing (`remote:<id>:<path>`). */
      projectPath?: string
      providerId?: string
      /**
       * Host-absolute worktree cwd for this turn (node session.cwd).
       * Null/undefined leaves the session cwd unchanged; empty string clears to project root.
       */
      cwdHostPath?: string | null
      /** UI-selected model id for this turn (Claude slug / Codex model). */
      model?: string | null
      /** Node provider credential id for this turn. */
      apiProviderId?: string | null
    },
  ): Promise<unknown> {
    const { gateway, environmentId } = this.resolveRemote(connectionId)
    const control = await this.ensureSessionLease(connectionId, input.sessionId)

    if (input.cwdHostPath !== undefined && gateway instanceof RemoteEnvironmentGateway) {
      try {
        await gateway.sessionSetCwd({
          sessionId: input.sessionId,
          cwd: input.cwdHostPath && input.cwdHostPath.trim() ? input.cwdHostPath.trim() : null,
          leaseId: control.leaseId,
          generation: control.generation,
        })
      } catch {
        /* turn may still run at previous cwd */
      }
    }

    // Cursor before send so we only map this turn's durable log entries.
    let afterSequence = '0'
    try {
      const prior = await gateway.listEvents('0')
      if (prior.length > 0) {
        afterSequence = prior[prior.length - 1]!.sequence
      }
    } catch {
      /* transport blip — fall back to mapping from 0 (idempotent-ish for UI) */
    }

    const model =
      typeof input.model === 'string' && input.model.trim() ? input.model.trim() : undefined
    const apiProviderId =
      typeof input.apiProviderId === 'string' && input.apiProviderId.trim()
        ? input.apiProviderId.trim()
        : undefined
    const options: Record<string, string> = {}
    if (model) options.model = model
    if (apiProviderId) options.apiProviderId = apiProviderId
    await gateway.sessions.send({
      session: { environmentId, sessionId: input.sessionId },
      text: input.text,
      leaseId: control.leaseId,
      generation: control.generation,
      clientMessageId: input.clientMessageId,
      ...(Object.keys(options).length > 0 ? { options } : {}),
    })
    const { createNodeSessionEventMapper } = await import('@superone/shared/node-session-event-map')
    const mapper = createNodeSessionEventMapper({
      sessionId: input.sessionId,
      projectPath: input.projectPath,
      providerId: input.providerId,
      // Renderer already appends the user bubble with clientMessageId.
      skipUserMessage: true,
    })

    // session.send starts the turn async; poll events + get until settled
    // (idle/error) or a permission interaction is pending (caller respondPermission).
    const deadline = Date.now() + 120_000
    let last: unknown = null

    const drainEvents = async (): Promise<void> => {
      try {
        const batch = await gateway.listEvents(afterSequence)
        for (const ev of batch) {
          afterSequence = ev.sequence
          if (ev.aggregateType === 'session' && ev.aggregateId === input.sessionId) {
            for (const agentEvent of mapper.map(ev)) {
              this.agentEventSink?.(agentEvent)
            }
          }
        }
      } catch {
        /* ignore transient event poll errors; status poll still progresses */
      }
    }

    while (Date.now() < deadline) {
      await drainEvents()

      last = await gateway.sessions.get({ environmentId, sessionId: input.sessionId })
      const snap = last as {
        status?: string
        pendingInteraction?: { interactionId?: string } | null
      } | null
      const status = snap?.status
      if (status && status !== 'streaming') {
        // Final drain so terminal turn events aren't lost between last poll and settle.
        await drainEvents()
        return last
      }
      // Stage 5-D: surface permission wait instead of spinning until timeout.
      if (snap?.pendingInteraction?.interactionId) {
        await drainEvents()
        return last
      }
      await new Promise((r) => setTimeout(r, 80))
    }
    return last
  }

  /**
   * One-shot durable event poll for a remote environment (renderer / ops helpers).
   * `afterSequence` is exclusive.
   */
  async listSessionEvents(
    connectionId: string,
    afterSequence = '0',
  ): Promise<import('@superone/shared/environment').EnvironmentEventEnvelope[]> {
    const { gateway } = this.resolveRemote(connectionId)
    return gateway.listEvents(afterSequence)
  }

  private agentEventSink: ((event: import('@superone/shared/agent-types').AgentEvent) => void) | null =
    null

  /** Main wires this to `agent:event` so remote turns stream into the chat store. */
  setAgentEventSink(
    sink: ((event: import('@superone/shared/agent-types').AgentEvent) => void) | null,
  ): void {
    this.agentEventSink = sink
  }

  async interruptSession(connectionId: string, sessionId: string): Promise<void> {
    const { gateway, environmentId } = this.resolveRemote(connectionId)
    const control = await this.ensureSessionLease(connectionId, sessionId)
    await gateway.sessions.interrupt(
      { environmentId, sessionId },
      { leaseId: control.leaseId, generation: control.generation },
    )
  }

  async renameSession(
    connectionId: string,
    sessionId: string,
    title: string,
    source: 'user' | 'agent' = 'user',
  ): Promise<unknown> {
    const { gateway } = this.resolveRemote(connectionId)
    return gateway.renameSession(sessionId, title, source)
  }

  async removeSession(connectionId: string, sessionId: string): Promise<unknown> {
    const { gateway } = this.resolveRemote(connectionId)
    let control: { leaseId?: string; generation?: string } | undefined
    try {
      control = await this.ensureSessionLease(connectionId, sessionId)
    } catch {
      /* ended sessions may not need a lease */
    }
    const result = await gateway.removeSession(sessionId, control)
    this.sessionLeases.delete(this.leaseKey(connectionId, sessionId))
    return result
  }

  async setSessionUiFlags(
    connectionId: string,
    sessionId: string,
    flags: { isPinned?: boolean; isHidden?: boolean },
  ): Promise<unknown> {
    const { gateway } = this.resolveRemote(connectionId)
    return gateway.setSessionUiFlags(sessionId, flags)
  }

  /**
   * Fork a session on a remote node (remote worktree or remote same-dir local).
   */
  async forkSession(
    connectionId: string,
    input: { sessionId: string; mode?: 'local' | 'worktree'; forkFromMessageId?: string },
  ): Promise<{ ok: true; sessionId: string; worktreePath?: string } | { ok: false; error: string }> {
    if (connectionId === 'local') {
      throw Object.assign(new Error('forkSession via environment host is remote-only'), {
        code: 'invalid_argument',
      })
    }
    if (!input.sessionId) {
      return { ok: false, error: 'sessionId is required' }
    }
    const { gateway } = this.resolveRemote(connectionId)
    return gateway.forkSession(input)
  }

  async respondSessionPermission(
    connectionId: string,
    input: {
      sessionId: string
      interactionId: string
      decision: 'allow' | 'deny' | 'allow_always'
    },
  ): Promise<void> {
    const { gateway, environmentId } = this.resolveRemote(connectionId)
    const control = await this.ensureSessionLease(connectionId, input.sessionId)
    await gateway.interactions.respondPermission({
      session: { environmentId, sessionId: input.sessionId },
      interactionId: input.interactionId,
      decision: input.decision,
      leaseId: control.leaseId,
      generation: control.generation,
    })
  }

  /**
   * Projects visible for a host in the sidebar.
   * `connectionId` is `local` or a paired remote connection id.
   * Remote hosts must already be connected (live gateway).
   */
  async listProjects(
    connectionId: string,
    options?: { refresh?: boolean },
  ): Promise<ProjectSnapshot[]> {
    if (connectionId === 'local') {
      return this.registry.getLocal().listProjects()
    }
    const snapshot = this.lastStatus.get(connectionId) ?? this.connections.getSupervisor(connectionId)
    if (snapshot?.state !== 'connected') {
      return this.requireRemoteGateway(connectionId).listProjects()
    }
    return this.loadRemoteProjects(connectionId, snapshot.generation, options?.refresh === true)
  }

  private loadRemoteProjects(
    connectionId: string,
    generation: number,
    refresh = false,
  ): Promise<ProjectSnapshot[]> {
    const cached = this.remoteProjectCache.get(connectionId)
    if (!refresh && cached?.generation === generation) return Promise.resolve(cached.projects)

    const current = this.remoteProjectLoads.get(connectionId)
    if (current?.generation === generation) return current.promise

    let promise!: Promise<ProjectSnapshot[]>
    promise = this.requireRemoteGateway(connectionId).listProjects().then((projects) => {
      const latest = this.lastStatus.get(connectionId)
      if (latest?.state === 'connected' && latest.generation === generation) {
        this.remoteProjectCache.set(connectionId, { generation, projects })
      }
      return projects
    }).finally(() => {
      if (this.remoteProjectLoads.get(connectionId)?.promise === promise) {
        this.remoteProjectLoads.delete(connectionId)
      }
    })
    this.remoteProjectLoads.set(connectionId, { generation, promise })
    return promise
  }

  private updateRemoteProjectCache(
    connectionId: string,
    update: (projects: ProjectSnapshot[]) => ProjectSnapshot[],
  ): void {
    const cached = this.remoteProjectCache.get(connectionId)
    if (!cached) return
    this.remoteProjectCache.set(connectionId, {
      generation: cached.generation,
      projects: update(cached.projects),
    })
  }

  /**
   * Normalize a path typed against this machine:
   * - `~` / `~/…` / `~\…` → user profile home (macOS/Linux/Windows)
   * - relative (`./…`, `../…`) → absolute against the Electron main process cwd
   * - absolute paths stay absolute
   */
  private expandLocalPath(path: string): string {
    const trimmed = path.trim()
    if (!trimmed) return trimmed
    if (trimmed === '~') return homedir()
    if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
      return pathResolve(pathJoin(homedir(), trimmed.slice(2)))
    }
    return pathResolve(trimmed)
  }

  /** Add a local folder to the recents store and project it as a ProjectSnapshot. */
  private registerLocalProject(path: string): ProjectSnapshot {
    addRecentFolder(path)
    const folder = getRecentFolders().find((f) => f.path === path)
    if (!folder) {
      throw Object.assign(new Error('failed to register local project'), { code: 'internal' })
    }
    return {
      projectId: folder.id,
      path: folder.path,
      name: folder.name,
      lastActiveAt: Date.parse(folder.lastOpened) || undefined,
    }
  }

  /**
   * Register/open a project path on a host.
   * `createIfMissing` backs the dialog's "Create & Add" action; without it a
   * missing path is an error on both the local and the remote path.
   */
  /**
   * Unregister a project from a host's project list (does not delete disk files).
   * Local uses the desktop recents store; remote calls node `project.remove`.
   */
  async removeProject(
    connectionId: string,
    input: { projectId?: string; path?: string },
  ): Promise<ProjectSnapshot | { path: string; projectId?: string; name?: string }> {
    const path = input.path?.trim()
    const projectId = input.projectId?.trim()
    if (!path && !projectId) {
      throw Object.assign(new Error('projectId or path is required'), { code: 'invalid_argument' })
    }

    if (connectionId === 'local') {
      if (!path) {
        throw Object.assign(new Error('path is required for local remove'), {
          code: 'invalid_argument',
        })
      }
      const resolved = this.expandLocalPath(path)
      removeRecentFolder(resolved)
      return { path: resolved, projectId, name: basename(resolved) }
    }

    const removed = await this.requireRemoteGateway(connectionId).removeProject({
      projectId: projectId || undefined,
      path: path || undefined,
    })
    this.updateRemoteProjectCache(connectionId, (projects) =>
      projects.filter((project) => project.projectId !== removed.projectId),
    )
    return removed
  }

  async openProject(
    connectionId: string,
    projectPath: string,
    opts?: { createIfMissing?: boolean },
  ): Promise<ProjectSnapshot> {
    const path = projectPath.trim()
    if (!path) {
      throw Object.assign(new Error('project path is required'), { code: 'invalid_argument' })
    }

    if (connectionId === 'local') {
      const resolved = this.expandLocalPath(path)
      if (!existsSync(resolved)) {
        if (!opts?.createIfMissing) {
          throw Object.assign(new Error(`path does not exist: ${resolved}`), { code: 'not_found' })
        }
        mkdirSync(resolved, { recursive: true })
      }
      return this.registerLocalProject(resolved)
    }

    const project = await this.requireRemoteGateway(connectionId).openProject(
      path,
      basename(path),
      opts?.createIfMissing,
    )
    this.updateRemoteProjectCache(connectionId, (projects) => [
      project,
      ...projects.filter((entry) => entry.projectId !== project.projectId),
    ])
    return project
  }

  /**
   * Clone a repository onto a host and register the result as a project.
   * The parent directory is created when missing ("Create & Clone").
   */
  async cloneRepository(
    connectionId: string,
    input: { remoteUrl: string; parentPath: string; directoryName?: string },
  ): Promise<ProjectSnapshot> {
    if (connectionId !== 'local') {
      const project = await this.requireRemoteGateway(connectionId).cloneRepository(input)
      this.updateRemoteProjectCache(connectionId, (projects) => [
        project,
        ...projects.filter((entry) => entry.projectId !== project.projectId),
      ])
      return project
    }

    const { cloneRepository } = await import('@superone/shared/git-clone')
    const cloned = await cloneRepository({
      ...input,
      parentPath: this.expandLocalPath(input.parentPath),
    })
    return this.registerLocalProject(cloned.path)
  }

  /**
   * List directories under a path for the add-project browser.
   * Local expands `~` and resolves relative paths here; remote leaves the raw
   * string intact so the node expands `~` / `./` against **its** home and cwd
   * (desktop must not substitute the Mac user home).
   */
  async browsePath(
    connectionId: string,
    absolutePath: string,
  ): Promise<{ path: string; entries: Array<{ name: string; path: string; type: 'directory' }> }> {
    const path = connectionId === 'local' ? this.expandLocalPath(absolutePath) : absolutePath.trim()
    if (!path) {
      throw Object.assign(new Error('path is required'), { code: 'invalid_argument' })
    }

    if (connectionId === 'local') {
      const resolved = path
      if (!existsSync(resolved)) {
        throw Object.assign(new Error(`path not found: ${resolved}`), { code: 'not_found' })
      }
      if (!statSync(resolved).isDirectory()) {
        throw Object.assign(new Error('not a directory'), { code: 'invalid_argument' })
      }
      const entries = readdirSync(resolved, { withFileTypes: true })
        .filter((ent) => ent.isDirectory() && !ent.name.startsWith('.'))
        .map((ent) => ({
          name: ent.name,
          path: pathJoin(resolved, ent.name),
          type: 'directory' as const,
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
      return { path: resolved, entries }
    }

    return this.requireRemoteGateway(connectionId).listHostDir(path)
  }

  /**
   * Flattened projection of every environment the user can see: the local
   * runtime plus each paired node with its live supervisor state.
   *
   * Descriptor fields are only present while a node is reachable — a stored
   * environment stays listed when offline so the UI can offer a reconnect.
   */
  async listEnvironments(): Promise<EnvironmentListItem[]> {
    const local = this.registry.getLocal()
    const localDescriptor = await local.getDescriptor()
    const items: EnvironmentListItem[] = [
      {
        connectionId: 'local',
        environmentId: localDescriptor.environmentId,
        label: localDescriptor.label,
        kind: 'local',
        state: 'connected',
        platform: localDescriptor.platform,
        nodeVersion: localDescriptor.nodeVersion,
        protocolVersion: localDescriptor.protocolVersion,
        capabilities: localDescriptor.capabilities,
        endpointProfiles: [],
        installationProfile: 'local-electron',
      },
    ]

    for (const known of this.connections.listKnown()) {
      const gateway = this.connections.getGateway(known.environmentId)
      const snapshot = this.connections.getSupervisor(known.connectionId)
      const descriptor = gateway ? await gateway.getDescriptor().catch(() => null) : null
      // A connection with no live entry was disconnected or never dialed; the
      // last snapshot is stale in that case, so report it as disconnected.
      const state = snapshot?.state ?? (this.lastStatus.has(known.connectionId) ? 'disconnected' : 'available')

      items.push({
        connectionId: known.connectionId,
        environmentId: known.environmentId,
        label: known.label,
        kind: 'remote',
        state,
        blockReason: snapshot?.blockReason,
        lastError: snapshot?.lastError,
        nodePublicKeyFingerprint: known.nodePublicKeyFingerprint,
        platform: descriptor?.platform,
        nodeVersion: descriptor?.nodeVersion,
        protocolVersion: descriptor?.protocolVersion,
        capabilities: descriptor?.capabilities,
        endpointProfiles: known.endpointProfiles,
        preferredEndpointId: known.preferredEndpointId,
        installationProfile: known.installationProfile,
        credentialInMemoryOnly: !this.credentials.isSecureStorageAvailable(),
        updatedAt: known.updatedAt,
      })
    }

    return items
  }

  /**
   * Open (or reopen) a connection to a paired environment.
   *
   * For `ssh-forward` endpoints the stored base URL points at an ephemeral local
   * port that no longer exists after an app restart, so the tunnel is rebuilt
   * first and the fresh loopback URL is used for the connection.
   */
  async connect(connectionId: string): Promise<ExecutionEnvironmentDescriptor> {
    const known = this.connections.listKnown().find((k) => k.connectionId === connectionId)
    if (!known) throw new Error(`unknown connection ${connectionId}`)

    const baseUrl = await this.resolveBaseUrl(known)
    const descriptor = await this.connections.connectExisting(connectionId, baseUrl)
    this.startHostActionConsumer(connectionId)
    return descriptor
  }

  /** Close the socket and any SSH tunnel; credentials and metadata are kept. */
  disconnect(connectionId: string): void {
    this.stopHostActionConsumer(connectionId, 'disconnect')
    this.connections.disconnect(connectionId)
    this.tunnels.close(connectionId)
    const previous = this.lastStatus.get(connectionId)
    const snapshot: SupervisorSnapshot = {
      environmentId: previous?.environmentId ?? '',
      connectionId,
      state: 'disconnected',
      attempt: 0,
      generation: (previous?.generation ?? 0) + 1,
    }
    this.publishStatus(snapshot)
  }

  /** Disconnect and erase all client-local state for this environment. */
  forget(connectionId: string): void {
    this.stopHostActionConsumer(connectionId, 'forget')
    this.tunnels.close(connectionId)
    this.connections.forget(connectionId)
    this.lastStatus.delete(connectionId)
    this.remoteProjectCache.delete(connectionId)
    this.remoteProjectLoads.delete(connectionId)
  }

  /**
   * Install/discover a node over SSH, mint a one-time pairing token, and pair
   * through the resulting loopback forward.
   *
   * The pairing token is parsed in memory and never persisted — only the
   * endpoint profile needed to rebuild the tunnel is stored (design §12.1).
   */
  async addRemoteOverSsh(
    input: AddRemoteOverSshInput,
    onProgress?: (progress: EnvironmentInstallProgress) => void,
  ): Promise<{
    connectionId: string
    descriptor: ExecutionEnvironmentDescriptor
    persisted: boolean
    warnings: string[]
    installed?: InstallResult
  }> {
    const remotePort = input.remotePort ?? DEFAULT_NODE_REMOTE_PORT
    const extraSshArgs: string[] = []
    if (input.sshPort) extraSshArgs.push('-p', String(input.sshPort))
    if (input.identityFile) extraSshArgs.push('-i', input.identityFile)

    const sshTarget: SshTarget = { destination: input.destination, extraSshArgs }
    const warnings: string[] = []
    let remoteExec = input.remoteExec?.trim() || ''
    let installed: InstallResult | undefined
    const installSource: RemoteInstallSource =
      input.installSource ?? DEFAULT_REMOTE_INSTALL_SOURCE

    // No explicit path: find or install one. SSH key auth is all the user
    // supplies — everything below is derived from the host itself.
    if (!remoteExec) {
      onProgress?.({ phase: 'probing' })
      const probe = await this.probeHost(sshTarget)
      const blocker = preflightBlocker(probe, installSource)
      if (blocker) throw Object.assign(new Error(blocker), { code: 'failed_precondition' })

      if (probe.superonePath) {
        remoteExec = probe.superonePath
      } else if (installSource === 'upload') {
        const artifact = this.findArtifact(probe.distTarget!)
        if (!artifact) {
          throw Object.assign(new Error(missingArtifactMessage(probe.distTarget!)), {
            code: 'failed_precondition',
          })
        }
        installed = await this.installNode({
          ...sshTarget,
          tarballPath: artifact.path,
          version: artifact.version,
          distTarget: artifact.target,
          remoteHome: probe.home,
          previousVersion: probe.superoneVersion ?? undefined,
          onProgress: (step, detail) => onProgress?.({ phase: 'installing', step, detail }),
        })
        remoteExec = installed.remoteExec
      } else {
        const version = this.resolveRegistryVersion(input.packageVersion)
        installed = await this.installFromRegistry({
          ...sshTarget,
          version,
          remoteHome: probe.home,
          previousVersion: probe.superoneVersion ?? undefined,
          onProgress: (step, detail) => onProgress?.({ phase: 'installing', step, detail }),
        })
        remoteExec = installed.remoteExec
      }

      if (!probe.hasSystemd) {
        warnings.push(
          'systemd is not available on this host; the node will not restart automatically after reboot.',
        )
      }
    }

    onProgress?.({ phase: 'starting' })
    const boot = await this.bootstrap({
      destination: input.destination,
      remoteExec,
      remoteNodeHome: input.remoteNodeHome,
      remotePort,
      extraSshArgs,
      label: input.label,
    })
    warnings.push(...boot.warnings)
    onProgress?.({ phase: 'pairing' })

    const endpoint: EndpointProfile = {
      endpointId: 'ssh',
      kind: 'ssh-forward',
      label: `SSH: ${input.destination}`,
      target: input.destination,
      ssh: {
        remotePort,
        port: input.sshPort,
        identityFile: input.identityFile,
      },
      lastSuccessAt: Date.now(),
    }

    try {
      const paired = await this.connections.pairAndConnect({
        baseUrl: boot.localBaseUrl,
        pairingToken: boot.pairingToken,
        label: input.label || input.destination,
        endpointProfiles: [endpoint],
      })
      this.connections.updateKnown(paired.connectionId, {
        preferredEndpointId: 'ssh',
        installationProfile: 'systemd-user',
      })
      // Hand the bootstrap tunnel to the manager so it is closed with the connection.
      this.tunnels.adopt(paired.connectionId, boot.forward, {
        destination: input.destination,
        remotePort,
        sshPort: input.sshPort,
        identityFile: input.identityFile,
      })
      return { ...paired, warnings, installed }
    } catch (err) {
      boot.forward.stop()
      throw err
    }
  }

  /**
   * Pin registry installs to a concrete version (design §15.1). Prefer the
   * caller, then host override, then Electron app version, never bare `latest`.
   */
  private resolveRegistryVersion(explicit?: string): string {
    const pinned = explicit?.trim() || this.defaultCliVersion?.trim()
    if (pinned && pinned !== 'latest') return pinned
    try {
      const appVersion = app.getVersion()?.trim()
      if (appVersion && appVersion !== 'latest') return appVersion
    } catch {
      // Tests may construct EnvironmentHost without a full Electron app.
    }
    throw Object.assign(
      new Error(
        'registry install needs a pinned CLI version (packageVersion or app version); use installSource "upload" for local dist builds',
      ),
      { code: 'failed_precondition' },
    )
  }

  /** Resolve a usable base URL, rebuilding an SSH tunnel when the endpoint needs one. */
  private async resolveBaseUrl(known: KnownEnvironmentRecord): Promise<string | undefined> {
    const preferred =
      known.endpointProfiles.find((p) => p.endpointId === known.preferredEndpointId) ??
      known.endpointProfiles[0]
    if (!preferred) return known.baseUrl

    const spec = tunnelSpecFromEndpoint(preferred)
    if (spec) return this.tunnels.ensure(known.connectionId, spec)
    if (preferred.kind === 'direct-wss' || preferred.kind === 'tailscale') {
      return preferred.target || known.baseUrl
    }
    return known.baseUrl
  }

  private publishStatus(snapshot: SupervisorSnapshot): void {
    this.lastStatus.set(snapshot.connectionId, snapshot)
    if (snapshot.state === 'connected') {
      void this.loadRemoteProjects(snapshot.connectionId, snapshot.generation).catch(() => {})
    } else {
      this.remoteProjectCache.delete(snapshot.connectionId)
      this.remoteProjectLoads.delete(snapshot.connectionId)
    }
    for (const listener of this.statusListeners) listener(snapshot)
  }

  /**
   * Fail over across known endpoints (SSH / Tailscale / relay) while preserving identity.
   * On success, reconnects the stored credentials against the selected baseUrl.
   */
  async connectWithFailover(connectionId: string): Promise<{
    baseUrl: string
    endpointId: string
    environmentId: string
  }> {
    const known = this.connections.listKnown().find((k) => k.connectionId === connectionId)
    if (!known) throw new Error(`unknown connection ${connectionId}`)

    // Only profiles already bound to this known environment.
    // Exclude relay until transport adapter exists; never use Desktop Tailscale Self IP.
    const profiles = known.endpointProfiles.filter((p) => p.kind !== 'relay')
    void discoverTailscaleHost
    void tailscaleEndpoint

    const env = { ...known, endpointProfiles: profiles }
    const selected = await selectEndpointWithFailover({
      known: env,
      probe: async (endpoint) => {
        if (endpoint.kind === 'relay') {
          return {
            endpointId: endpoint.endpointId,
            ok: false,
            error: 'relay transport adapter not installed',
          }
        }
        if (endpoint.kind === 'ssh-forward' && known.baseUrl) {
          return probeEndpointHealth(endpoint, { baseUrlOverride: known.baseUrl })
        }
        return probeEndpointHealth(endpoint)
      },
    })

    if (!selected.selected || !selected.baseUrl) {
      throw Object.assign(new Error('no healthy endpoint with matching identity'), {
        code: 'unavailable',
        attempts: !selected.selected ? selected.attempts : [],
      })
    }

    await this.connections.connectExisting(connectionId, selected.baseUrl)
    return {
      baseUrl: selected.baseUrl,
      endpointId: selected.endpointId,
      environmentId: selected.environmentId!,
    }
  }

  /**
   * Record a relay endpoint for future transport work.
   * Relay profiles are intentionally excluded from connectWithFailover until
   * an E2E frame adapter exists — metadata only.
   */
  addRelayEndpoint(connectionId: string, relayUrl: string): void {
    const known = this.connections.listKnown().find((k) => k.connectionId === connectionId)
    if (!known) throw new Error(`unknown connection ${connectionId}`)
    const next: KnownEnvironmentRecord = {
      ...known,
      endpointProfiles: [
        ...known.endpointProfiles.filter((p) => p.kind !== 'relay'),
        {
          ...relayEndpoint({ relayUrl }),
          // Marker for UI: not selectable for NodeRpcClient connect.
          label: `${relayEndpoint({ relayUrl }).label} (unsupported transport)`,
        },
      ],
      updatedAt: Date.now(),
    }
    this.saveKnown(next)
  }

  dispose(): void {
    for (const id of [...this.hostActionConsumers.keys()]) {
      this.stopHostActionConsumer(id, 'dispose')
    }
    this.connections.disconnectAll()
    this.tunnels.closeAll()
    this.statusListeners.clear()
    this.remoteProjectCache.clear()
    this.remoteProjectLoads.clear()
  }

  private startHostActionConsumer(connectionId: string): void {
    this.stopHostActionConsumer(connectionId, 'restart')
    const client = this.connections.getClient(connectionId)
    if (!client) return
    const consumer = new RemoteHostActionConsumer({
      connectionId,
      client,
      executor: this.hostActionExecutor,
      concurrency: this.hostActionConcurrency,
      pollWaitMs: this.hostActionPollWaitMs,
    })
    this.hostActionConsumers.set(connectionId, consumer)
    consumer.start()
  }

  private stopHostActionConsumer(connectionId: string, reason: string): void {
    const consumer = this.hostActionConsumers.get(connectionId)
    if (!consumer) return
    consumer.stop(reason)
    this.hostActionConsumers.delete(connectionId)
  }

  private loadKnown(): KnownEnvironmentRecord[] {
    if (!existsSync(this.knownPath)) return []
    try {
      const raw = JSON.parse(readFileSync(this.knownPath, 'utf8')) as {
        environments?: KnownEnvironmentRecord[]
      }
      return raw.environments ?? []
    } catch {
      return []
    }
  }

  private saveKnown(env: KnownEnvironmentRecord): void {
    const all = this.loadKnown().filter((e) => e.connectionId !== env.connectionId)
    all.push(env)
    this.writeKnown(all)
  }

  private deleteKnown(connectionId: string): void {
    this.writeKnown(this.loadKnown().filter((e) => e.connectionId !== connectionId))
  }

  private writeKnown(all: KnownEnvironmentRecord[]): void {
    writeFileSync(
      this.knownPath,
      JSON.stringify({ version: 1, environments: all }, null, 2),
      'utf8',
    )
  }
}

let singleton: EnvironmentHost | null = null

/** Lazy singleton used by IPC handlers in main. */
export function getEnvironmentHost(): EnvironmentHost {
  if (!singleton) singleton = new EnvironmentHost()
  return singleton
}

export function resetEnvironmentHostForTests(): void {
  singleton?.dispose()
  singleton = null
}

/** Helper for product code: resolve gateway for a project ref. */
export function gatewayForProject(ref: ProjectRef): EnvironmentGateway {
  const host = getEnvironmentHost()
  const gw = host.getGateway(ref.environmentId)
  if (!gw) throw new Error(`unknown environment ${ref.environmentId}`)
  return gw
}
